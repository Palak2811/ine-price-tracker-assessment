import { API } from './constants.js';
import { logger } from '../utils/logger.js';

let cached = null;           
let lastSeenRevision = null;
let lastStructureChange = null;

const FETCH_TIMEOUT_MS = 10_000;
const MAX_CACHE_MS = 5 * 60_000;

const REQUIRED_CLASS_KEYS = ['priceValue', 'mrp', 'badge', 'stock'];

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

export function getLastStructureChange() {
  return lastStructureChange;
}

export function __resetLayoutCache() {
  cached = null;
  lastSeenRevision = null;
  lastStructureChange = null;
}
