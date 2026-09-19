import { RETRY } from '../scraper/constants.js';

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

export function backoffDelay(attempt, opts = {}) {
  const { baseDelayMs = RETRY.baseDelayMs, maxDelayMs = RETRY.maxDelayMs, jitter = RETRY.jitter } = opts;
  const exponential = Math.min(baseDelayMs * 2 ** (attempt - 1), maxDelayMs);
  const delta = exponential * jitter;
  const value = exponential + (Math.random() * 2 - 1) * delta;
  return Math.max(0, Math.round(value));
}

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

export function cleanErrorMessage(message, maxLength = 400) {
  if (!message) return null;

  const stripped = String(message).replace(/\u001B\[[0-9;]*m/g, '');
  const lines = stripped.split('\n').map((l) => l.trim()).filter(Boolean);
  if (!lines.length) return null;

  const headline = lines[0];
  const culprit = lines.slice(1).find((l) => /intercepts pointer events|is not visible|outside of the viewport|element is not enabled/.test(l));

  return (culprit ? `${headline} — ${culprit}` : headline).slice(0, maxLength);
}
