export const STORE_ORIGIN = 'https://demo.inelabteamdev.com';

export const API = {
  catalog: (page, pageSize) => `${STORE_ORIGIN}/api/v2/listings?page=${page}&limit=${pageSize}`,
  layout: () => `${STORE_ORIGIN}/api/v2/ui/manifest`,
  product: (id) => `${STORE_ORIGIN}/api/v2/items/${id}`,
};

export const CATALOG_MAX_PAGE_SIZE = 60;

export const ZERO_WIDTH_RE = /[​-‍⁠﻿­]/g;

const envInt = (name, fallback) => {
  const n = Number.parseInt(process.env[name] ?? '', 10);
  return Number.isFinite(n) && n > 0 ? n : fallback;
};

export const TIMEOUTS = {
  navigationMs: envInt('SCRAPE_NAVIGATION_TIMEOUT_MS', 30_000),
  priceBlockMs: envInt('SCRAPE_BLOCK_TIMEOUT_MS', 20_000),
  priceResolveMs: envInt('SCRAPE_RESOLVE_TIMEOUT_MS', 60_000),
  gateMs: envInt('SCRAPE_GATE_TIMEOUT_MS', 15_000),
  settleMs: envInt('SCRAPE_SETTLE_TIMEOUT_MS', 20_000),
};

export const RETRY = {
  maxAttempts: 3,
  baseDelayMs: 1_500,
  maxDelayMs: 15_000,
  jitter: 0.3,
};

export const GATE = {
  moves: 18,
  moveDelayMs: 80,
  requiredDwellMs: 600,
};

export const PRICE_BOUNDS = { min: 1, max: 100_000_000 };

export const STOCK_BOUNDS = { min: 0, max: 1_000_000 };

export function buildProductUrl(productId) {
  if (!Number.isInteger(productId) || productId <= 0) {
    throw new Error(`invalid product id: ${productId}`);
  }
  return `${STORE_ORIGIN}/item/${productId}`;
}

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
