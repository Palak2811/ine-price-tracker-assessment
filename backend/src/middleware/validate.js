/** Small hand-rolled validators. Every route validates its input. */

import { ApiError } from '../utils/ApiError.js';

export function requireSearchQuery(req) {
  const q = String(req.query.q ?? '').trim();
  if (!q) throw ApiError.badRequest('missing_query', 'Query parameter "q" is required');
  if (q.length > 100) throw ApiError.badRequest('query_too_long', 'Query must be 100 characters or fewer');
  return q;
}

export function parseLimit(raw, { fallback = 20, max = 100 } = {}) {
  if (raw === undefined) return fallback;
  const n = Number.parseInt(raw, 10);
  if (!Number.isFinite(n) || n < 1) {
    throw ApiError.badRequest('invalid_limit', 'limit must be a positive integer');
  }
  return Math.min(n, max);
}

/** Product ids are the store's own positive integers. */
export function parseProductId(raw) {
  const n = Number.parseInt(raw, 10);
  if (!Number.isInteger(n) || n <= 0) {
    throw ApiError.badRequest('invalid_product_id', 'productId must be a positive integer');
  }
  return n;
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function parseUuid(raw, field = 'id') {
  const value = String(raw ?? '');
  if (!UUID_RE.test(value)) {
    throw ApiError.badRequest('invalid_id', `${field} must be a UUID`);
  }
  return value;
}

export function parseInterval(raw, { fallback = 120 } = {}) {
  if (raw === undefined || raw === null) return fallback;
  const n = Number.parseInt(raw, 10);
  if (!Number.isFinite(n) || n < 5 || n > 10080) {
    throw ApiError.badRequest('invalid_interval', 'scrapeIntervalMinutes must be between 5 and 10080');
  }
  return n;
}
