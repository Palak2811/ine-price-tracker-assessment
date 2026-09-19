/** Tracked products, history, logs and manual scrape. */

import {
  trackProduct, untrackProduct, getDashboard,
  getTrackedProductDetail, setScrapeInterval,
} from '../services/trackingService.js';
import { scrapeSingleProduct } from '../services/scrapeService.js';
import { getPriceHistory, getScrapeLogs } from '../repositories/trackingRepository.js';
import { parseProductId, parseUuid, parseLimit, parseInterval } from '../middleware/validate.js';
import { ApiError } from '../utils/ApiError.js';

export async function list(req, res) {
  res.json({ items: await getDashboard() });
}

export async function create(req, res) {
  const body = req.body ?? {};
  if (body.productId === undefined) {
    throw ApiError.badRequest('missing_product_id', 'Body must include productId');
  }
  // Only an id is accepted. A client-supplied URL is never trusted, which is
  // what keeps the scraper pinned to the mock store.
  const productId = parseProductId(body.productId);
  const interval = parseInterval(body.scrapeIntervalMinutes);
  const tracked = await trackProduct(productId, { scrapeIntervalMinutes: interval });
  res.status(201).json(tracked);
}

export async function getOne(req, res) {
  const id = parseUuid(req.params.id);
  res.json(await getTrackedProductDetail(id));
}

export async function remove(req, res) {
  const id = parseUuid(req.params.id);
  const hard = req.query.hard === 'true';
  res.json(await untrackProduct(id, { hardDelete: hard }));
}

export async function updateInterval(req, res) {
  const id = parseUuid(req.params.id);
  const minutes = parseInterval(req.body?.scrapeIntervalMinutes, { fallback: null });
  if (minutes === null) {
    throw ApiError.badRequest('missing_interval', 'Body must include scrapeIntervalMinutes');
  }
  res.json(await setScrapeInterval(id, minutes));
}

export async function history(req, res) {
  const id = parseUuid(req.params.id);
  const limit = parseLimit(req.query.limit, { fallback: 500, max: 2000 });
  const rows = await getPriceHistory(id, { limit, since: req.query.since ?? null });
  res.json({
    count: rows.length,
    items: rows.map((h) => ({
      price: Number(h.price),
      mrp: h.mrp === null ? null : Number(h.mrp),
      currency: h.currency,
      inStock: h.in_stock,
      stockQty: h.stock_qty,
      scrapedAt: h.scraped_at,
    })),
  });
}

export async function logs(req, res) {
  const id = parseUuid(req.params.id);
  const limit = parseLimit(req.query.limit, { fallback: 100, max: 500 });
  const status = req.query.status ?? null;
  if (status && !['success', 'retried', 'failed'].includes(status)) {
    throw ApiError.badRequest('invalid_status', 'status must be success, retried or failed');
  }
  const rows = await getScrapeLogs(id, { limit, status });
  res.json({
    count: rows.length,
    items: rows.map((l) => ({
      id: l.id, runId: l.run_id, attempt: l.attempt, status: l.status,
      errorCode: l.error_code, errorMessage: l.error_message,
      httpStatus: l.http_status, durationMs: l.duration_ms,
      price: l.scraped_price === null ? null : Number(l.scraped_price),
      inStock: l.scraped_in_stock, structureWarning: l.structure_warning,
      startedAt: l.started_at, completedAt: l.completed_at,
    })),
  });
}

/** Manual scrape. Rate-limited in the route to stop it being abused. */
export async function scrapeNow(req, res) {
  const id = parseUuid(req.params.id);
  const result = await scrapeSingleProduct(id);
  if (result === null) throw ApiError.notFound('Tracked product not found');
  res.json(result);
}
