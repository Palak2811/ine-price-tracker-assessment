/**
 * Layout descriptor cache + page-structure change detection.
 *
 * The store rotates the CSS class names that carry price, MRP, stock, etc. and
 * publishes the current mapping at /api/layout:
 *
 *   { revision, variant, validUntil,
 *     classes: { priceWrap, priceValue, mrp, sale, badge, rating, seller,
 *                delivery, stock },
 *     order, priceTag, priceCarrier, ... }
 *
 * Hardcoding "pv-k2" would work for about forty minutes and then silently start
 * returning nothing. Fetching this descriptor every run is what makes the
 * selectors resilient -- we look up the current class name instead of guessing.
 *
 * We also record revision changes, which gives us the bonus "flag when the
 * store's page structure changes" feature almost for free.
 */

import { API } from './constants.js';
import { logger } from '../utils/logger.js';

let cached = null;           // { layout, fetchedAt }
let lastSeenRevision = null;
let lastStructureChange = null;

const FETCH_TIMEOUT_MS = 10_000;
/** Never trust a cached descriptor for longer than this, even if validUntil is far out. */
const MAX_CACHE_MS = 5 * 60_000;

const REQUIRED_CLASS_KEYS = ['priceValue', 'mrp', 'badge', 'stock'];

/**
 * Fetch the layout descriptor, with a small cache so a run scraping several
 * products does not refetch it per product.
 */
export async function getLayout({ force = false } = {}) {
  const now = Date.now();

  if (!force && cached) {
    const age = now - cached.fetchedAt;
    const stillValid = cached.layout.validUntil ? now < cached.layout.validUntil : true;
    if (age < MAX_CACHE_MS && stillValid) return cached.layout;
  }

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);

  let layout;
  try {
    const res = await fetch(API.layout(), { signal: controller.signal });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    layout = await res.json();
  } finally {
    clearTimeout(timer);
  }

  if (!layout || typeof layout !== 'object' || !layout.classes) {
    throw new Error('layout response missing classes');
  }

  // If the store ever drops a class key we depend on, fail loudly here rather
  // than silently extracting nothing from the page later.
  const missing = REQUIRED_CLASS_KEYS.filter((k) => !layout.classes[k]);
  if (missing.length) {
    throw new Error(`layout missing required class keys: ${missing.join(', ')}`);
  }

  if (lastSeenRevision !== null && layout.revision !== lastSeenRevision) {
    lastStructureChange = {
      at: new Date().toISOString(),
      from: lastSeenRevision,
      to: layout.revision,
      variant: layout.variant,
    };
    logger.info(lastStructureChange, 'store layout revision changed');
  }
  lastSeenRevision = layout.revision;

  cached = { layout, fetchedAt: now };
  return layout;
}

/** Most recent observed structure change, for the dashboard. */
export function getLastStructureChange() {
  return lastStructureChange;
}

/** Test seam. */
export function __resetLayoutCache() {
  cached = null;
  lastSeenRevision = null;
  lastStructureChange = null;
}
