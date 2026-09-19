import { runScrapeBatch } from '../services/scrapeService.js';
import { syncCatalog } from '../services/catalogService.js';
import { listScrapeRuns } from '../repositories/trackingRepository.js';
import { getLastStructureChange } from '../scraper/layout.js';
import { logger } from '../utils/logger.js';

export async function scrape(req, res) {
  const startedAt = Date.now();
  logger.info({ ip: req.ip }, 'cron scrape triggered');

  const summary = await runScrapeBatch({ trigger: 'cron', respectSchedule: true });

  if (summary.skipped) {
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

export async function syncCatalogue(req, res) {
  res.json({ ok: true, ...(await syncCatalog()) });
}

export async function runs(req, res) {
  res.json({ items: await listScrapeRuns({ limit: 20 }) });
}
