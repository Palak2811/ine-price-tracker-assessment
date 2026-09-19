/**
 * Orchestrates scraping and persistence.
 *
 * This is where the assignment's core rule is enforced:
 *
 *   - EVERY attempt writes a scrape_logs row, success or failure.
 *   - ONLY a validated success writes a price_history row.
 *   - A failure NEVER overwrites last_price / last_in_stock on tracked_products.
 *
 * Those three together are what make the history and the log honest.
 */

import {
  insertScrapeLog, insertPriceHistory, updateTrackedProduct,
  createScrapeRun, completeScrapeRun, findRunningScrapeRun,
  listProductsDueForScrape, getTrackedProduct, insertAlert,
} from '../repositories/trackingRepository.js';
import { scrapeProductWithRetry } from '../scraper/scrapeProduct.js';
import { getSharedBrowser, closeSharedBrowser } from '../scraper/browser.js';
import { cleanErrorMessage } from '../utils/retry.js';
import { logger } from '../utils/logger.js';
import { config } from '../config/env.js';

/**
 * Scrape one tracked product and persist everything about it.
 *
 * Returns a summary; it does not throw for scrape failures, because one
 * unreachable product must not abort a run covering several others.
 */
export async function scrapeAndPersist({ browser, tracked, runId = null }) {
  const log = logger.child({ trackedProductId: tracked.id, productId: tracked.product_id });
  const attemptRows = [];

  const result = await scrapeProductWithRetry({
    browser,
    productId: tracked.product_id,
    log,
    // Called once per attempt, before we know whether later attempts succeed.
    onAttempt: async ({ attempt, status, data, error, durationMs, startedAt, completedAt }) => {
      try {
        await insertScrapeLog({
          tracked_product_id: tracked.id,
          run_id: runId,
          attempt,
          status,
          error_code: error?.code ?? null,
          // Cleaned: a raw Playwright timeout message is thousands of chars of
          // ANSI-escaped call log, which renders as noise in the UI.
          error_message: cleanErrorMessage(error?.message),
          http_status: error?.httpStatus ?? data?.httpStatus ?? null,
          duration_ms: durationMs,
          scraped_price: status === 'success' ? data.price : null,
          scraped_in_stock: status === 'success' ? data.inStock : null,
          scraped_stock_qty: status === 'success' ? data.stockQty : null,
          structure_warning: data?.structureWarning ?? null,
          layout_revision: data?.layoutRevision ?? null,
          started_at: startedAt.toISOString(),
          completed_at: completedAt.toISOString(),
        });
        attemptRows.push({ attempt, status });
      } catch (err) {
        // Losing a log row must not fail the scrape itself, but it is serious
        // enough to shout about -- the log is a deliverable.
        log.error({ err: err.message, attempt }, 'failed to write scrape log row');
      }
    },
  });

  const nowIso = new Date().toISOString();

  // ---- failure path --------------------------------------------------------
  if (!result.ok) {
    // Deliberately does NOT touch last_price / last_in_stock / last_success_at.
    // The dashboard keeps showing the last known good price alongside the
    // failure, which is exactly what the assignment asks for.
    await updateTrackedProduct(tracked.id, {
      last_attempt_at: nowIso,
      last_status: 'failed',
      last_error: cleanErrorMessage(result.error?.message) ?? 'unknown error',
      consecutive_failures: (tracked.consecutive_failures ?? 0) + 1,
    });

    log.warn(
      { code: result.error?.code, attempts: result.attempts },
      'scrape failed after all retries'
    );

    return {
      trackedProductId: tracked.id,
      productName: tracked.product_name,
      ok: false,
      status: 'failed',
      attempts: result.attempts,
      errorCode: result.error?.code ?? 'unknown',
      errorMessage: result.error?.message ?? 'unknown error',
    };
  }

  // ---- success path --------------------------------------------------------
  const { price, currency, mrp, inStock, stockQty, structureWarning } = result.data;

  // Compare against the previous good value BEFORE we overwrite it, so alerts
  // reflect a real transition.
  const previous = {
    price: tracked.last_price !== null && tracked.last_price !== undefined
      ? Number(tracked.last_price) : null,
    inStock: tracked.last_in_stock,
  };

  await insertPriceHistory({
    tracked_product_id: tracked.id,
    price,
    currency,
    mrp,
    in_stock: inStock,
    stock_qty: stockQty,
    scraped_at: nowIso,
  });

  await updateTrackedProduct(tracked.id, {
    last_price: price,
    last_currency: currency,
    last_in_stock: inStock,
    last_stock_qty: stockQty,
    last_success_at: nowIso,
    last_attempt_at: nowIso,
    last_status: result.status, // 'success' or 'retried'
    last_error: null,
    consecutive_failures: 0,
  });

  await raiseAlerts({ tracked, previous, current: { price, inStock }, log });

  if (structureWarning) {
    log.warn({ structureWarning }, 'price/mrp consistency warning');
  }

  log.info(
    { price, inStock, stockQty, attempts: result.attempts, status: result.status },
    'scrape succeeded'
  );

  return {
    trackedProductId: tracked.id,
    productName: tracked.product_name,
    ok: true,
    status: result.status,
    attempts: result.attempts,
    price,
    inStock,
    stockQty,
    structureWarning,
  };
}

/** Bonus: price-drop and back-in-stock alerts. */
async function raiseAlerts({ tracked, previous, current, log }) {
  const events = [];

  if (previous.price !== null && current.price < previous.price) {
    const drop = previous.price - current.price;
    const pct = (drop / previous.price) * 100;
    events.push({
      kind: 'price_drop',
      message: `${tracked.product_name} dropped ${pct.toFixed(1)}% (₹${previous.price} → ₹${current.price})`,
      old_price: previous.price,
      new_price: current.price,
    });
  }

  if (previous.inStock === false && current.inStock === true) {
    events.push({
      kind: 'back_in_stock',
      message: `${tracked.product_name} is back in stock`,
      old_price: previous.price,
      new_price: current.price,
    });
  }

  if (previous.inStock === true && current.inStock === false) {
    events.push({
      kind: 'out_of_stock',
      message: `${tracked.product_name} is now out of stock`,
      old_price: previous.price,
      new_price: current.price,
    });
  }

  for (const e of events) {
    try {
      await insertAlert({ tracked_product_id: tracked.id, ...e });
    } catch (err) {
      log.error({ err: err.message, kind: e.kind }, 'failed to record alert');
    }
  }
}

/**
 * Run a batch of products with bounded concurrency.
 *
 * Each product drives a real browser context, so concurrency is deliberately
 * small (default 2). Launching one per product would exhaust Render's free-tier
 * memory long before it got faster.
 */
async function runWithConcurrency(items, limit, worker) {
  const results = [];
  let cursor = 0;

  const runners = Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (cursor < items.length) {
      const index = cursor++;
      results[index] = await worker(items[index]);
    }
  });

  await Promise.all(runners);
  return results;
}

/**
 * Scrape a set of tracked products as one recorded run.
 *
 * `trigger` is 'cron', 'manual' or 'cli'. Scheduled runs skip products that are
 * not yet due; manual runs scrape whatever they are given.
 */
export async function runScrapeBatch({
  trigger = 'cron',
  trackedProducts = null,
  respectSchedule = true,
  headed = false,
  slowMo = 0,
  allowConcurrentRun = false,
} = {}) {
  const log = logger.child({ trigger });

  // Overlap guard: a second cron firing while the first is still working would
  // double-scrape every product and race on the tracked_products update.
  if (!allowConcurrentRun) {
    const inFlight = await findRunningScrapeRun();
    if (inFlight) {
      log.warn({ runId: inFlight.id, startedAt: inFlight.started_at }, 'run already in progress, skipping');
      return {
        skipped: true,
        reason: 'run_already_in_progress',
        runId: inFlight.id,
        startedAt: inFlight.started_at,
      };
    }
  }

  const targets = trackedProducts
    ?? (respectSchedule ? await listProductsDueForScrape() : await listProductsDueForScrape({ now: new Date(8640000000000000) }));

  const run = await createScrapeRun(trigger);
  const startedAt = Date.now();

  if (!targets.length) {
    await completeScrapeRun(run.id, {
      products_total: 0, products_ok: 0, products_failed: 0,
      notes: 'no products due',
    });
    return { runId: run.id, total: 0, ok: 0, failed: 0, durationMs: 0, results: [] };
  }

  log.info({ runId: run.id, count: targets.length, concurrency: config.scrapeConcurrency }, 'scrape run starting');

  let browser;
  let results = [];

  try {
    browser = await getSharedBrowser({ headed, slowMo });

    results = await runWithConcurrency(
      targets,
      headed ? 1 : config.scrapeConcurrency, // headed runs stay sequential so they are watchable
      (tracked) => scrapeAndPersist({ browser, tracked, runId: run.id })
        .catch((err) => {
          // A persistence error is ours, not the store's. Record it and carry on.
          log.error({ err: err.message, trackedProductId: tracked.id }, 'scrapeAndPersist threw');
          return {
            trackedProductId: tracked.id,
            productName: tracked.product_name,
            ok: false, status: 'failed',
            errorCode: 'persistence_error', errorMessage: err.message,
          };
        })
    );
  } finally {
    // Always close the browser: a leaked Chromium on Render's free tier will
    // eat the memory limit and take the next run down with it.
    await closeSharedBrowser();
  }

  const ok = results.filter((r) => r.ok).length;
  const failed = results.length - ok;
  const durationMs = Date.now() - startedAt;

  await completeScrapeRun(run.id, {
    products_total: results.length,
    products_ok: ok,
    products_failed: failed,
    notes: failed ? `${failed} product(s) failed` : null,
  });

  log.info({ runId: run.id, ok, failed, durationMs }, 'scrape run finished');

  return { runId: run.id, total: results.length, ok, failed, durationMs, results };
}

/** Manual single-product scrape, used by the UI's "Scrape now" button. */
export async function scrapeSingleProduct(trackedProductId, { trigger = 'manual' } = {}) {
  const tracked = await getTrackedProduct(trackedProductId);
  if (!tracked) return null;

  return runScrapeBatch({
    trigger,
    trackedProducts: [tracked],
    respectSchedule: false,
    // A manual scrape is explicitly user-requested, so it is allowed to run
    // even if a scheduled run is in flight.
    allowConcurrentRun: true,
  });
}
