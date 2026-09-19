/**
 * Unit tests for price/stock parsing and validation.
 *
 * The fixtures here are real strings captured from the live mock store,
 * including the zero-width padding it injects between digits.
 */

import { describe, it, expect } from 'vitest';
import {
  stripZeroWidth, parsePrice, parseCurrency, parseStock, parseBadgePercent,
  validatePrice, validateStock, checkPriceConsistency,
} from '../src/scraper/parse.js';

const ZW = '​';

describe('stripZeroWidth', () => {
  it('removes the zero-width spaces the store injects between digits', () => {
    expect(stripZeroWidth(`₹${ZW}2${ZW}1${ZW},${ZW}1${ZW}2${ZW}4`)).toBe('₹21,124');
  });

  it('is safe on non-string input', () => {
    expect(stripZeroWidth(null)).toBe('');
    expect(stripZeroWidth(undefined)).toBe('');
  });
});

describe('parsePrice', () => {
  it('parses an Indian-grouped rupee amount', () => {
    expect(parsePrice('₹21,124')).toBe(21124);
    expect(parsePrice('₹1,30,036')).toBe(130036);
  });

  it('parses a zero-width padded price as rendered by the store', () => {
    expect(parsePrice(`₹${ZW}1${ZW},${ZW}3${ZW}0${ZW},${ZW}0${ZW}3${ZW}6`)).toBe(130036);
  });

  it('parses the "Rs." format the store also uses', () => {
    // Regression: the full stop in "Rs." used to survive the digit filter and
    // produce ".12723.00", which was rejected as malformed. A real scrape of
    // product 40 failed on exactly this string.
    expect(parsePrice('Rs. 12,723.00')).toBe(12723);
    expect(parsePrice('Rs 900')).toBe(900);
    expect(parsePrice('INR 1,234.50')).toBe(1234.5);
  });

  it('handles non-breaking spaces as digit separators', () => {
    expect(parsePrice('₹12 723')).toBe(12723);
  });

  it('refuses a percentage so a discount badge can never be read as a price', () => {
    expect(parsePrice('18% off')).toBeNull();
  });

  it('returns null rather than 0 for unusable input', () => {
    // This is the important one: a null must propagate as a scrape failure,
    // never be coerced into a zero price that would pollute the history.
    expect(parsePrice('')).toBeNull();
    expect(parsePrice(null)).toBeNull();
    expect(parsePrice('Price hidden')).toBeNull();
    expect(parsePrice('₹')).toBeNull();
  });

  it('rejects malformed numbers with multiple decimal points', () => {
    expect(parsePrice('₹1.2.3')).toBeNull();
  });
});

describe('parseCurrency', () => {
  it('detects INR from the rupee sign', () => {
    expect(parseCurrency('₹21,124')).toBe('INR');
  });
  it('returns null when no currency marker is present', () => {
    expect(parseCurrency('21124')).toBeNull();
  });
});

describe('parseStock', () => {
  // All five phrasings the store rotates between.
  it.each([
    ['In stock · 190 left', 190],
    ['Only 96 left', 96],
    ['154 in stock', 154],
    ['Selling fast — 18 left', 18],
    ['Hurry, just 184 left', 184],
  ])('parses %s', (text, qty) => {
    expect(parseStock(text, 'stock-badge in-stock')).toEqual({ inStock: true, quantity: qty });
  });

  it('parses an explicit out-of-stock state', () => {
    expect(parseStock('Out of stock', 'stock-badge out-stock')).toEqual({ inStock: false, quantity: 0 });
  });

  it('trusts the out-stock class even if the text is unusual', () => {
    expect(parseStock('Currently unavailable', 'stock-badge out-stock')).toEqual({ inStock: false, quantity: 0 });
  });

  it('does NOT treat a missing element as out of stock', () => {
    // This distinction is the whole point: absence means "we failed to read it",
    // which must be a scrape failure, not a confident "out of stock" record.
    expect(parseStock(null, null)).toBeNull();
    expect(parseStock('', '')).toBeNull();
  });

  it('treats a zero quantity as out of stock', () => {
    expect(parseStock('Only 0 left', 'stock-badge in-stock')).toEqual({ inStock: false, quantity: 0 });
  });

  it('accepts in-stock with unknown quantity', () => {
    expect(parseStock('In stock', 'stock-badge in-stock')).toEqual({ inStock: true, quantity: null });
  });
});

describe('parseBadgePercent', () => {
  it('reads the discount badge', () => {
    expect(parseBadgePercent('18% off')).toBe(18);
  });
  it('returns null when absent', () => {
    expect(parseBadgePercent('')).toBeNull();
  });
});

describe('validatePrice', () => {
  it('accepts a normal price', () => {
    expect(validatePrice(21124)).toEqual({ ok: true });
  });

  it('rejects missing, non-finite and out-of-range values', () => {
    expect(validatePrice(null).ok).toBe(false);
    expect(validatePrice(null).reason).toBe('price_missing');
    expect(validatePrice(NaN).ok).toBe(false);
    expect(validatePrice(0).ok).toBe(false);
    expect(validatePrice(-5).ok).toBe(false);
    expect(validatePrice(1e12).ok).toBe(false);
  });
});

describe('validateStock', () => {
  it('accepts valid stock', () => {
    expect(validateStock({ inStock: true, quantity: 12 })).toEqual({ ok: true });
    expect(validateStock({ inStock: true, quantity: null })).toEqual({ ok: true });
    expect(validateStock({ inStock: false, quantity: 0 })).toEqual({ ok: true });
  });

  it('rejects a null stock reading as a failure', () => {
    expect(validateStock(null)).toEqual({ ok: false, reason: 'stock_missing' });
  });

  it('rejects a non-integer or out-of-range quantity', () => {
    expect(validateStock({ inStock: true, quantity: 1.5 }).ok).toBe(false);
    expect(validateStock({ inStock: true, quantity: -1 }).ok).toBe(false);
  });
});

describe('checkPriceConsistency', () => {
  it('flags a price above the struck-through MRP', () => {
    expect(checkPriceConsistency({ price: 100, mrp: 50 })).toMatch(/exceeds/);
  });

  it('stays quiet for a normal price/MRP pair', () => {
    expect(checkPriceConsistency({ price: 21124, mrp: 25761 })).toBeNull();
  });

  it('does not fire on a non-integer implied discount', () => {
    // Measured on the live store: implied discount is often not a round number,
    // and warning about it produced false positives on most healthy scrapes.
    expect(checkPriceConsistency({ price: 13113, mrp: 26879 })).toBeNull();
  });

  it('tolerates a missing MRP', () => {
    expect(checkPriceConsistency({ price: 21124, mrp: null })).toBeNull();
  });
});

describe('cleanErrorMessage', () => {
  it('strips ANSI escapes and keeps the diagnostic line', async () => {
    const { cleanErrorMessage } = await import('../src/utils/retry.js');
    const raw = 'locator.click: Timeout 10000ms exceeded.\nCall log:\n\u001b[2m  - waiting for locator\u001b[22m\n\u001b[2m  - <div class="cookie-overlay">…</div> intercepts pointer events\u001b[22m';
    const out = cleanErrorMessage(raw);
    expect(out).not.toMatch(/\u001b|\[2m/);
    expect(out).toContain('Timeout 10000ms exceeded');
    expect(out).toContain('intercepts pointer events');
  });

  it('returns null for empty input', async () => {
    const { cleanErrorMessage } = await import('../src/utils/retry.js');
    expect(cleanErrorMessage(null)).toBeNull();
    expect(cleanErrorMessage('')).toBeNull();
  });
});
