import { runScrapeBatch } from '../services/scrapeService.js';
import { syncCatalog } from '../services/catalogService.js';
import { listScrapeRuns } from '../repositories/trackingRepository.js';
import { getLastStructureChange } from '../scraper/layout.js';
import { logger } from '../utils/logger.js';

export async function scrape(req, res) {
  const startedAt = Date.now();
  logger.info({ ip: req.ip }, 'cron scrape triggered');

  res.status(202).json({ ok: true, accepted: true });

  try {
    const summary = await runScrapeBatch({ trigger: 'cron', respectSchedule: true });

    if (summary.skipped) {
      logger.info(
        { reason: summary.reason, runningSince: summary.startedAt },
        'cron scrape skipped'
      );
      return;
    }

    logger.info(
      {
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
      },
      'cron scrape finished'
    );
  } catch (err) {
    logger.error({ err: err.message, stack: err.stack }, 'cron scrape threw');
  }
}

export async function syncCatalogue(req, res) {
  res.json({ ok: true, ...(await syncCatalog()) });
}

export async function runs(req, res) {
  res.json({ items: await listScrapeRuns({ limit: 20 }) });
}
