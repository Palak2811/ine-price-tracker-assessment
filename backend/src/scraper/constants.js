/**
 * Scraper constants.
 *
 * The scraper is ONLY ever allowed to talk to the INE mock store. Every URL it
 * builds goes through buildProductUrl() below, and assertAllowedUrl() is the
 * single choke point that enforces the origin. No user input ever becomes a URL.
 */

export const STORE_ORIGIN = 'https://demo.inelabteamdev.com';

export const API = {
  catalog: (page, pageSize) => `${STORE_ORIGIN}/api/catalog?page=${page}&pageSize=${pageSize}`,
  layout: () => `${STORE_ORIGIN}/api/layout`,
  product: (id) => `${STORE_ORIGIN}/api/product/${id}`,
};

/** The catalogue endpoint silently caps pageSize at 60. */
export const CATALOG_MAX_PAGE_SIZE = 60;

/** Zero-width / soft-hyphen characters the store injects between price digits. */
export const ZERO_WIDTH_RE = /[​-‍⁠﻿­]/g;

const envInt = (name, fallback) => {
  const n = Number.parseInt(process.env[name] ?? '', 10);
  return Number.isFinite(n) && n > 0 ? n : fallback;
};

export const TIMEOUTS = {
  /** Navigating to the product page. */
  navigationMs: envInt('SCRAPE_NAVIGATION_TIMEOUT_MS', 30_000),
  /** Waiting for the price block shell to appear after navigation. */
  priceBlockMs: envInt('SCRAPE_BLOCK_TIMEOUT_MS', 20_000),
  /** Waiting for the price to resolve after clicking Reveal. The page runs its
   *  own internal retry loop (up to 6 attempts) before giving up, and each
   *  attempt can be slow, so this has to be generous.
   *
   *  Overridable mainly so a demo can force a realistic timeout on camera --
   *  see scripts/scrape-cli.js --simulate-slow. */
  priceResolveMs: envInt('SCRAPE_RESOLVE_TIMEOUT_MS', 60_000),
  /** Arming the human-interaction gate. */
  gateMs: envInt('SCRAPE_GATE_TIMEOUT_MS', 15_000),
};

/** Our own retry layer, sitting on top of the page's internal retries. */
export const RETRY = {
  maxAttempts: 3,
  baseDelayMs: 1_500,
  maxDelayMs: 15_000,
  /** Jitter factor: actual delay is delay * (1 +/- jitter). */
  jitter: 0.3,
};

/**
 * Human-interaction gate thresholds, read out of the store's own bundle:
 *   new Ar({ minMoves: 8, minDwellMs: 600 })
 * We over-satisfy both so a slightly dropped mouse event does not fail the run.
 */
export const GATE = {
  moves: 18,
  moveDelayMs: 80,
  requiredDwellMs: 600,
};

/** Price sanity bounds, in rupees. Guards against a parse picking up a stray
 *  number (e.g. a rating count or a "18% off" badge) instead of a price. */
export const PRICE_BOUNDS = { min: 1, max: 100_000_000 };

/** Stock quantity sanity bounds. */
export const STOCK_BOUNDS = { min: 0, max: 1_000_000 };

export function buildProductUrl(productId) {
  if (!Number.isInteger(productId) || productId <= 0) {
    throw new Error(`invalid product id: ${productId}`);
  }
  return `${STORE_ORIGIN}/product/${productId}`;
}

/**
 * Hard guarantee that we never navigate anywhere but the mock store, even if a
 * stored product_url were somehow tampered with in the database.
 */
export function assertAllowedUrl(url) {
  let parsed;
  try {
    parsed = new URL(url);
  } catch {
    throw new Error(`malformed url: ${url}`);
  }
  if (parsed.origin !== STORE_ORIGIN) {
    throw new Error(`refusing to scrape non-store origin: ${parsed.origin}`);
  }
  return parsed.toString();
}
