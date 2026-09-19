/**
 * Business logic for tracking products, and for assembling the dashboard view.
 */

import {
  listTrackedProducts, getTrackedProduct, getTrackedByProductId,
  createTrackedProduct, updateTrackedProduct, deleteTrackedProduct,
  getPriceHistory, getScrapeLogs,
} from '../repositories/trackingRepository.js';
import { getProductById } from '../repositories/productRepository.js';
import { buildProductUrl } from '../scraper/constants.js';
import { ApiError } from '../utils/ApiError.js';

/**
 * Start tracking a product.
 *
 * The caller supplies only a product id -- never a URL. The URL is derived from
 * the id via buildProductUrl(), so a client can never steer the scraper at an
 * arbitrary site.
 */
export async function trackProduct(productId, { scrapeIntervalMinutes = 120 } = {}) {
  const product = await getProductById(productId);
  if (!product) {
    throw new ApiError(404, 'product_not_found', `No product with id ${productId} in the catalogue`);
  }

  const existing = await getTrackedByProductId(productId);
  if (existing) {
    if (existing.is_active) {
      throw new ApiError(409, 'already_tracked', `${product.name} is already being tracked`);
    }
    // Re-activate rather than creating a duplicate, so the product keeps its
    // existing price history.
    return updateTrackedProduct(existing.id, {
      is_active: true,
      scrape_interval_minutes: scrapeIntervalMinutes,
    });
  }

  return createTrackedProduct({
    product_id: product.id,
    product_slug: product.slug,
    product_name: product.name,
    product_url: buildProductUrl(product.id),
    scrape_interval_minutes: scrapeIntervalMinutes,
    is_active: true,
  });
}

export async function untrackProduct(id, { hardDelete = false } = {}) {
  const tracked = await getTrackedProduct(id);
  if (!tracked) throw new ApiError(404, 'not_found', 'Tracked product not found');

  if (hardDelete) {
    await deleteTrackedProduct(id);
    return { deleted: true };
  }

  // Soft-delete by default: history and logs stay intact.
  await updateTrackedProduct(id, { is_active: false });
  return { deleted: false, deactivated: true };
}

export async function setScrapeInterval(id, minutes) {
  const tracked = await getTrackedProduct(id);
  if (!tracked) throw new ApiError(404, 'not_found', 'Tracked product not found');
  return updateTrackedProduct(id, { scrape_interval_minutes: minutes });
}

/** Dashboard list: one row per tracked product with its current state. */
export async function getDashboard() {
  const tracked = await listTrackedProducts();

  return tracked.map((t) => ({
    id: t.id,
    productId: t.product_id,
    name: t.product_name,
    url: t.product_url,
    isActive: t.is_active,
    scrapeIntervalMinutes: t.scrape_interval_minutes,
    // Last known GOOD values. These survive a failed scrape by design.
    lastPrice: t.last_price === null ? null : Number(t.last_price),
    currency: t.last_currency ?? 'INR',
    inStock: t.last_in_stock,
    stockQty: t.last_stock_qty,
    lastSuccessAt: t.last_success_at,
    lastAttemptAt: t.last_attempt_at,
    latestStatus: t.last_status,
    lastError: t.last_error,
    consecutiveFailures: t.consecutive_failures,
    // True when the most recent attempt failed but we still hold a good price.
    showingStalePrice: t.last_status === 'failed' && t.last_price !== null,
    createdAt: t.created_at,
  }));
}

/** Detail view: product + history + logs in one round trip. */
export async function getTrackedProductDetail(id, { historyLimit = 500, logLimit = 100 } = {}) {
  const tracked = await getTrackedProduct(id);
  if (!tracked) throw new ApiError(404, 'not_found', 'Tracked product not found');

  const [history, logs] = await Promise.all([
    getPriceHistory(id, { limit: historyLimit }),
    getScrapeLogs(id, { limit: logLimit }),
  ]);

  return {
    product: {
      id: tracked.id,
      productId: tracked.product_id,
      name: tracked.product_name,
      slug: tracked.product_slug,
      url: tracked.product_url,
      isActive: tracked.is_active,
      scrapeIntervalMinutes: tracked.scrape_interval_minutes,
      lastPrice: tracked.last_price === null ? null : Number(tracked.last_price),
      currency: tracked.last_currency ?? 'INR',
      inStock: tracked.last_in_stock,
      stockQty: tracked.last_stock_qty,
      lastSuccessAt: tracked.last_success_at,
      lastAttemptAt: tracked.last_attempt_at,
      latestStatus: tracked.last_status,
      lastError: tracked.last_error,
      consecutiveFailures: tracked.consecutive_failures,
      showingStalePrice: tracked.last_status === 'failed' && tracked.last_price !== null,
    },
    history: history.map((h) => ({
      price: Number(h.price),
      mrp: h.mrp === null ? null : Number(h.mrp),
      currency: h.currency,
      inStock: h.in_stock,
      stockQty: h.stock_qty,
      scrapedAt: h.scraped_at,
    })),
    logs: logs.map((l) => ({
      id: l.id,
      runId: l.run_id,
      attempt: l.attempt,
      status: l.status,
      errorCode: l.error_code,
      errorMessage: l.error_message,
      httpStatus: l.http_status,
      durationMs: l.duration_ms,
      price: l.scraped_price === null ? null : Number(l.scraped_price),
      inStock: l.scraped_in_stock,
      structureWarning: l.structure_warning,
      startedAt: l.started_at,
      completedAt: l.completed_at,
    })),
    stats: summariseLogs(logs),
  };
}

/** Simple reliability stats so the UI can show an honest success rate. */
function summariseLogs(logs) {
  const total = logs.length;
  const success = logs.filter((l) => l.status === 'success').length;
  const failed = logs.filter((l) => l.status === 'failed').length;
  const durations = logs.filter((l) => l.duration_ms > 0).map((l) => l.duration_ms);
  const avg = durations.length
    ? Math.round(durations.reduce((a, b) => a + b, 0) / durations.length)
    : null;

  return {
    totalAttempts: total,
    successfulAttempts: success,
    failedAttempts: failed,
    successRate: total ? Number(((success / total) * 100).toFixed(1)) : null,
    avgDurationMs: avg,
  };
}
