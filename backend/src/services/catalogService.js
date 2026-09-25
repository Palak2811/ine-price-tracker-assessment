import { API, CATALOG_MAX_PAGE_SIZE } from '../scraper/constants.js';
import { upsertProducts, countProducts } from '../repositories/productRepository.js';
import { logger } from '../utils/logger.js';
import { sleep } from '../utils/retry.js';

const FETCH_TIMEOUT_MS = 20_000;

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

export async function syncCatalog({
  pageSize = CATALOG_MAX_PAGE_SIZE,
  maxRequests = 400,
} = {}) {
  const log = logger.child({ task: 'syncCatalog' });
  const startedAt = Date.now();

  const first = await fetchCatalogPage(1, pageSize);
  const expected = first.count ?? first.total ?? 0;
  const pages = first.totalPages ?? first.pages ?? 1;

  const seen = new Map();
  const absorb = (items) => {
    for (const item of items) if (!seen.has(item.id)) seen.set(item.id, toRow(item));
  };
  absorb(first.results ?? first.items ?? []);

  let requests = 1;
  let barrenStreak = 0;

  while (requests < maxRequests && (expected === 0 || seen.size < expected)) {
    const before = seen.size;
    const page = (requests % pages) + 1;

    const pageData = await fetchCatalogPage(page, pageSize);
    absorb(pageData.results ?? pageData.items ?? []);
    requests++;

    barrenStreak = seen.size === before ? barrenStreak + 1 : 0;
    if (barrenStreak >= 25) {
      log.warn({ collected: seen.size, expected }, 'no new products in 25 passes, stopping early');
      break;
    }

    await sleep(80);
  }

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
