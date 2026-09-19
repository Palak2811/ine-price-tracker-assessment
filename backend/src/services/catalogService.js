/**
 * Mirrors the store's product catalogue into Supabase.
 *
 * WHY MIRROR INSTEAD OF PROXYING SEARCH
 * -------------------------------------
 * The store has no search endpoint -- only GET /api/catalog?page&pageSize, which
 * silently caps pageSize at 60. Searching "by partial name" against that would
 * mean paging through 17 requests per keystroke.
 *
 * The catalogue carries no price or stock (those are behind the browser-only
 * flow), so it is cheap, stable data. We sync it once and search locally, which
 * makes typeahead instant and keeps load off the store.
 */

import { API, CATALOG_MAX_PAGE_SIZE } from '../scraper/constants.js';
import { upsertProducts, countProducts } from '../repositories/productRepository.js';
import { logger } from '../utils/logger.js';
import { sleep } from '../utils/retry.js';

const FETCH_TIMEOUT_MS = 20_000;

/** Fetch one catalogue page with a timeout and a couple of retries. */
async function fetchCatalogPage(page, pageSize, attempt = 1) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);

  try {
    const res = await fetch(API.catalog(page, pageSize), { signal: controller.signal });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return await res.json();
  } catch (err) {
    if (attempt >= 3) throw new Error(`catalog page ${page} failed after 3 attempts: ${err.message}`);
    await sleep(1000 * attempt);
    return fetchCatalogPage(page, pageSize, attempt + 1);
  } finally {
    clearTimeout(timer);
  }
}

const toRow = (item) => ({
  id: item.id,
  slug: item.slug,
  name: item.name,
  brand: item.brand ?? null,
  category: item.category ?? null,
  sku: item.sku ?? null,
  description: item.description ?? null,
  synced_at: new Date().toISOString(),
});

/**
 * Sync the whole catalogue. Idempotent: rows are upserted by the store's own id.
 *
 * WHY THIS LOOPS INSTEAD OF PAGING ONCE
 * -------------------------------------
 * The catalogue endpoint reports `total: 1000` and `pages: 17`, which looks like
 * ordinary pagination -- but it is not. Requesting page 1 twice returns two
 * completely different sets of products:
 *
 *   fetch 1 -> 840, 594, 900, 375, 683
 *   fetch 2 -> 763, 733, 979, 821, 409
 *
 * The page parameter does not select a stable slice; every request returns a
 * random sample. Walking pages 1..17 once therefore yields duplicates and misses
 * products entirely -- a first attempt did exactly that, upserting 1000 rows that
 * collapsed to only 643 distinct products.
 *
 * So we sample repeatedly until we have seen every id the store claims exists,
 * and stop early if several consecutive passes stop finding anything new (which
 * is what a smaller-than-advertised catalogue would look like).
 */
export async function syncCatalog({
  pageSize = CATALOG_MAX_PAGE_SIZE,
  maxRequests = 400,
} = {}) {
  const log = logger.child({ task: 'syncCatalog' });
  const startedAt = Date.now();

  const first = await fetchCatalogPage(1, pageSize);
  const expected = first.total ?? 0;
  const pages = first.pages ?? 1;

  const seen = new Map();
  const absorb = (items) => {
    for (const item of items) if (!seen.has(item.id)) seen.set(item.id, toRow(item));
  };
  absorb(first.items);

  let requests = 1;
  let barrenStreak = 0;

  while (requests < maxRequests && (expected === 0 || seen.size < expected)) {
    const before = seen.size;
    const page = (requests % pages) + 1;

    absorb((await fetchCatalogPage(page, pageSize)).items);
    requests++;

    // Coupon-collector tail: the last few ids take many samples to turn up, so
    // allow a generous barren streak before concluding we have them all.
    barrenStreak = seen.size === before ? barrenStreak + 1 : 0;
    if (barrenStreak >= 25) {
      log.warn({ collected: seen.size, expected }, 'no new products in 25 passes, stopping early');
      break;
    }

    // Gentle on the store: this is a bulk read, not a race.
    await sleep(80);
  }

  // One upsert per chunk keeps the payload well inside Supabase's request limit.
  const rows = [...seen.values()];
  let upserted = 0;
  for (let i = 0; i < rows.length; i += 500) {
    upserted += await upsertProducts(rows.slice(i, i + 500));
  }

  const total = await countProducts();
  const durationMs = Date.now() - startedAt;

  log.info(
    { distinctCollected: seen.size, expected, upserted, total, requests, durationMs },
    'catalogue sync complete'
  );

  if (expected && total < expected) {
    log.warn({ total, expected }, 'catalogue is incomplete; re-run sync:catalog to fill the gaps');
  }

  return { upserted, total, expected, requests, durationMs };
}
