/** Scheduled scrape endpoint, called by an external cron service. */

import { runScrapeBatch } from '../services/scrapeService.js';
import { syncCatalog } from '../services/catalogService.js';
import { listScrapeRuns } from '../repositories/trackingRepository.js';
import { getLastStructureChange } from '../scraper/layout.js';
import { logger } from '../utils/logger.js';

/**
 * POST /api/cron/scrape
 *
 * Scrapes every active tracked product that is due. Individual product failures
 * are recorded and do not abort the run, so one broken product cannot stop the
 * other nine from being scraped.
 *
 * Always returns 200 with a summary when the run executes, because a cron
 * service treats a non-2xx as "retry", and retrying a partially-completed
 * scrape run would double-write history.
 */
export async function scrape(req, res) {
  const startedAt = Date.now();
  logger.info({ ip: req.ip }, 'cron scrape triggered');

  const summary = await runScrapeBatch({ trigger: 'cron', respectSchedule: true });

  if (summary.skipped) {
    // 200, not 409: this is a normal, expected outcome of overlapping crons.
    return res.json({
      ok: true,
      skipped: true,
      reason: summary.reason,
      runningSince: summary.startedAt,
    });
  }

  res.json({
    ok: true,
    runId: summary.runId,
    total: summary.total,
    succeeded: summary.ok,
    failed: summary.failed,
    durationMs: Date.now() - startedAt,
    structureChange: getLastStructureChange(),
    results: (summary.results ?? []).map((r) => ({
      product: r.productName,
      status: r.status,
      attempts: r.attempts,
      price: r.price ?? null,
      inStock: r.inStock ?? null,
      error: r.errorCode ?? null,
    })),
  });
}

/**
 * POST /api/cron/sync-catalog
 * Refreshes the local catalogue mirror. Useful weekly, not every two hours.
 */
export async function syncCatalogue(req, res) {
  res.json({ ok: true, ...(await syncCatalog()) });
}

/** GET /api/cron/runs -- recent run summaries, for debugging the schedule. */
export async function runs(req, res) {
  res.json({ items: await listScrapeRuns({ limit: 20 }) });
}
