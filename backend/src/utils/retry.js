/** Retry helpers: exponential backoff with jitter, and a typed error class. */

import { RETRY } from '../scraper/constants.js';

/**
 * An error carrying a machine-readable code, so scrape_logs.error_code can be
 * grouped and queried instead of matching on free-text messages.
 *
 * `retryable` distinguishes transient problems (timeouts, slow loads, the
 * store's own injected errors) from permanent ones (product does not exist,
 * refused origin), so we do not burn attempts on failures that cannot succeed.
 */
export class ScrapeError extends Error {
  constructor(code, message, { retryable = true, cause = null, httpStatus = null } = {}) {
    super(message);
    this.name = 'ScrapeError';
    this.code = code;
    this.retryable = retryable;
    this.httpStatus = httpStatus;
    if (cause) this.cause = cause;
  }
}

export const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

/**
 * Exponential backoff with full-range jitter.
 *
 * Jitter matters here because the cron endpoint scrapes several products and
 * we retry each one; without it, a store-wide hiccup would make every product
 * retry in lockstep and hammer the store in synchronised bursts.
 */
export function backoffDelay(attempt, opts = {}) {
  const { baseDelayMs = RETRY.baseDelayMs, maxDelayMs = RETRY.maxDelayMs, jitter = RETRY.jitter } = opts;
  const exponential = Math.min(baseDelayMs * 2 ** (attempt - 1), maxDelayMs);
  const delta = exponential * jitter;
  const value = exponential + (Math.random() * 2 - 1) * delta;
  return Math.max(0, Math.round(value));
}

/** Wrap a promise with a timeout that produces a typed ScrapeError. */
export async function withTimeout(promise, ms, code, label) {
  let timer;
  const timeout = new Promise((_, reject) => {
    timer = setTimeout(
      () => reject(new ScrapeError(code, `${label} timed out after ${ms}ms`, { retryable: true })),
      ms
    );
  });
  try {
    return await Promise.race([promise, timeout]);
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Tidy an error message for storage and display.
 *
 * Playwright's actionability errors embed a multi-line "Call log:" block with
 * ANSI colour escapes. Stored raw, those escapes render as literal "[2m" noise
 * in the scrape-log table, and the block dwarfs the useful first line.
 *
 * The first line is kept (it names the failure), plus the most diagnostic line
 * of the call log if one is present -- e.g. the "<div class="cookie-overlay">
 * intercepts pointer events" line that explained a whole class of failures.
 */
export function cleanErrorMessage(message, maxLength = 400) {
  if (!message) return null;

  // eslint-disable-next-line no-control-regex
  const stripped = String(message).replace(/\u001B\[[0-9;]*m/g, '');
  const lines = stripped.split('\n').map((l) => l.trim()).filter(Boolean);
  if (!lines.length) return null;

  const headline = lines[0];
  const culprit = lines.slice(1).find((l) => /intercepts pointer events|is not visible|outside of the viewport|element is not enabled/.test(l));

  return (culprit ? `${headline} — ${culprit}` : headline).slice(0, maxLength);
}
