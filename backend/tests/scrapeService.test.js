/**
 * Tests for the persistence rules that make the history and log honest.
 *
 * These are the assignment's central guarantees, so they are asserted directly
 * rather than inferred from a happy-path run:
 *
 *   1. every attempt writes a scrape_logs row, including failures
 *   2. only a validated success writes a price_history row
 *   3. a failure never overwrites the last known good price
 *
 * The scraper itself is mocked: the point here is the persistence contract, not
 * the browser work, which is covered by the live probe script.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

// Env must be satisfied before the modules under test import config.
process.env.SUPABASE_URL ??= 'https://example.supabase.co';
process.env.SUPABASE_SERVICE_ROLE_KEY ??= 'test-key';
process.env.CRON_SECRET ??= 'test-secret-value-at-least-24-chars';

const mockScrape = vi.fn();
vi.mock('../src/scraper/scrapeProduct.js', () => ({
  scrapeProductWithRetry: (...args) => mockScrape(...args),
}));

const inserted = { logs: [], history: [], alerts: [] };
const updates = [];

vi.mock('../src/repositories/trackingRepository.js', () => ({
  insertScrapeLog: async (row) => { inserted.logs.push(row); return { id: inserted.logs.length }; },
  insertPriceHistory: async (row) => { inserted.history.push(row); return { id: inserted.history.length }; },
  insertAlert: async (row) => { inserted.alerts.push(row); return { id: inserted.alerts.length }; },
  updateTrackedProduct: async (id, patch) => { updates.push({ id, patch }); return { id, ...patch }; },
  createScrapeRun: async () => ({ id: 'run-1', started_at: new Date().toISOString() }),
  completeScrapeRun: async () => ({ id: 'run-1' }),
  findRunningScrapeRun: async () => null,
  listProductsDueForScrape: async () => [],
  getTrackedProduct: async () => null,
}));

const { scrapeAndPersist } = await import('../src/services/scrapeService.js');

/** A tracked product that already has a good price recorded. */
const trackedWithGoodPrice = () => ({
  id: 'tp-1',
  product_id: 325,
  product_name: 'Larkspur Microphone Lite',
  last_price: 21124,
  last_in_stock: true,
  last_stock_qty: 96,
  consecutive_failures: 0,
});

beforeEach(() => {
  inserted.logs.length = 0;
  inserted.history.length = 0;
  inserted.alerts.length = 0;
  updates.length = 0;
  mockScrape.mockReset();
});

describe('successful scrape', () => {
  it('writes one history row and updates the last known good values', async () => {
    mockScrape.mockImplementation(async ({ onAttempt }) => {
      await onAttempt({
        attempt: 1, status: 'success', durationMs: 4200,
        startedAt: new Date(), completedAt: new Date(),
        data: { price: 19999, inStock: true, stockQty: 12, layoutRevision: 625003 },
      });
      return {
        ok: true, attempts: 1, status: 'success',
        data: {
          price: 19999, currency: 'INR', mrp: 24999,
          inStock: true, stockQty: 12, structureWarning: null, layoutRevision: 625003,
        },
      };
    });

    const result = await scrapeAndPersist({ browser: {}, tracked: trackedWithGoodPrice() });

    expect(result.ok).toBe(true);
    expect(inserted.history).toHaveLength(1);
    expect(inserted.history[0]).toMatchObject({ price: 19999, in_stock: true, stock_qty: 12 });

    const patch = updates.at(-1).patch;
    expect(patch.last_price).toBe(19999);
    expect(patch.last_status).toBe('success');
    expect(patch.last_error).toBeNull();
    expect(patch.consecutive_failures).toBe(0);
  });

  it('reports "retried" when it only succeeded on a later attempt, and logs every attempt', async () => {
    mockScrape.mockImplementation(async ({ onAttempt }) => {
      await onAttempt({
        attempt: 1, status: 'failed', durationMs: 900,
        startedAt: new Date(), completedAt: new Date(),
        error: { code: 'price_resolve_timeout', message: 'timed out' },
      });
      await onAttempt({
        attempt: 2, status: 'success', durationMs: 3100,
        startedAt: new Date(), completedAt: new Date(),
        data: { price: 18000, inStock: true, stockQty: 5 },
      });
      return {
        ok: true, attempts: 2, status: 'retried',
        data: { price: 18000, currency: 'INR', mrp: null, inStock: true, stockQty: 5, structureWarning: null },
      };
    });

    const result = await scrapeAndPersist({ browser: {}, tracked: trackedWithGoodPrice() });

    expect(result.status).toBe('retried');
    // The failed attempt is preserved, not swallowed by the eventual success.
    expect(inserted.logs).toHaveLength(2);
    expect(inserted.logs[0]).toMatchObject({ status: 'failed', error_code: 'price_resolve_timeout' });
    expect(inserted.logs[1]).toMatchObject({ status: 'success' });
    // ...but only one history row, because there was only one real observation.
    expect(inserted.history).toHaveLength(1);
  });
});

describe('failed scrape', () => {
  beforeEach(() => {
    mockScrape.mockImplementation(async ({ onAttempt }) => {
      for (const attempt of [1, 2, 3]) {
        await onAttempt({
          attempt, status: 'failed', durationMs: 1000,
          startedAt: new Date(), completedAt: new Date(),
          error: { code: 'validation_failed', message: 'price_missing' },
        });
      }
      return {
        ok: false, attempts: 3, status: 'failed',
        error: { code: 'validation_failed', message: 'price_missing' },
      };
    });
  });

  it('writes NO price history row', async () => {
    await scrapeAndPersist({ browser: {}, tracked: trackedWithGoodPrice() });
    expect(inserted.history).toHaveLength(0);
  });

  it('records every failed attempt in the log', async () => {
    await scrapeAndPersist({ browser: {}, tracked: trackedWithGoodPrice() });
    expect(inserted.logs).toHaveLength(3);
    expect(inserted.logs.every((l) => l.status === 'failed')).toBe(true);
    expect(inserted.logs.every((l) => l.error_code === 'validation_failed')).toBe(true);
    // A failed attempt must never carry a price into the log either.
    expect(inserted.logs.every((l) => l.scraped_price === null)).toBe(true);
  });

  it('does NOT overwrite the last known good price or stock', async () => {
    await scrapeAndPersist({ browser: {}, tracked: trackedWithGoodPrice() });

    const patch = updates.at(-1).patch;
    // The whole point: these keys must be absent from the update entirely.
    expect(patch).not.toHaveProperty('last_price');
    expect(patch).not.toHaveProperty('last_in_stock');
    expect(patch).not.toHaveProperty('last_success_at');

    expect(patch.last_status).toBe('failed');
    expect(patch.consecutive_failures).toBe(1);
    expect(patch.last_attempt_at).toBeTruthy();
  });

  it('raises no alerts on failure', async () => {
    await scrapeAndPersist({ browser: {}, tracked: trackedWithGoodPrice() });
    expect(inserted.alerts).toHaveLength(0);
  });
});

describe('alerts', () => {
  const succeedWith = (price, inStock) => async ({ onAttempt }) => {
    await onAttempt({
      attempt: 1, status: 'success', durationMs: 1000,
      startedAt: new Date(), completedAt: new Date(),
      data: { price, inStock, stockQty: inStock ? 10 : 0 },
    });
    return {
      ok: true, attempts: 1, status: 'success',
      data: { price, currency: 'INR', mrp: null, inStock, stockQty: inStock ? 10 : 0, structureWarning: null },
    };
  };

  it('raises a price-drop alert when the price falls', async () => {
    mockScrape.mockImplementation(succeedWith(15000, true));
    await scrapeAndPersist({ browser: {}, tracked: trackedWithGoodPrice() });

    const drop = inserted.alerts.find((a) => a.kind === 'price_drop');
    expect(drop).toBeTruthy();
    expect(drop.old_price).toBe(21124);
    expect(drop.new_price).toBe(15000);
  });

  it('raises a back-in-stock alert on an out -> in transition', async () => {
    mockScrape.mockImplementation(succeedWith(21124, true));
    const wasOut = { ...trackedWithGoodPrice(), last_in_stock: false };
    await scrapeAndPersist({ browser: {}, tracked: wasOut });

    expect(inserted.alerts.some((a) => a.kind === 'back_in_stock')).toBe(true);
  });

  it('does not raise a price-drop alert when the price rises', async () => {
    mockScrape.mockImplementation(succeedWith(25000, true));
    await scrapeAndPersist({ browser: {}, tracked: trackedWithGoodPrice() });

    expect(inserted.alerts.some((a) => a.kind === 'price_drop')).toBe(false);
  });
});
