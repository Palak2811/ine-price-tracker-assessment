/**
 * Pure parsing + validation helpers for scraped price/stock values.
 *
 * These are deliberately free of Playwright so they can be unit-tested against
 * the real strings the mock store produces (zero-width padded digits, five
 * different stock phrasings, Indian digit grouping, and so on).
 */

import { ZERO_WIDTH_RE, PRICE_BOUNDS, STOCK_BOUNDS } from './constants.js';

/** Strip the zero-width characters the store injects between every digit. */
export function stripZeroWidth(text) {
  if (typeof text !== 'string') return '';
  return text.replace(ZERO_WIDTH_RE, '');
}

/**
 * Parse a rendered price string into a number.
 *
 * The store renders Indian-grouped rupee amounts, e.g. "₹1,30,036", and pads
 * them with zero-width spaces. We strip everything that is not a digit or a
 * decimal point. Grouping separators are removed rather than interpreted,
 * which is safe because the store never renders a fractional price.
 *
 * Returns null when the input does not contain a usable number -- callers must
 * treat null as a scrape failure, never as a zero.
 */
export function parsePrice(raw) {
  const text = stripZeroWidth(raw);
  if (!text) return null;

  // Must actually look like a currency amount, not a percentage or a rating.
  if (/%/.test(text)) return null;

  // Match the numeric token rather than deleting non-digits.
  //
  // Deleting everything except [\d.] looks simpler but is wrong: the store also
  // renders prices as "Rs. 12,723.00", and the full stop in the "Rs." prefix
  // survives that filter, producing ".12723.00" -- two decimal points, which the
  // parser then rejected as malformed. A real scrape failed on exactly that.
  //
  // Anchoring on a digit-led token sidesteps every currency prefix/suffix.
  const match = text.match(/\d[\d,  ]*(?:\.\d+)?/);
  if (!match) return null;

  // Reject malformed input like "₹1.2.3" rather than silently accepting the
  // "1.2" prefix -- a partially-parsed number is exactly the kind of wrong data
  // that must never reach price_history.
  const rest = text.slice(match.index + match[0].length);
  if (/^\.?\d/.test(rest)) return null;

  const normalised = match[0].replace(/[,  ]/g, '');
  if (!normalised || !/^\d+(?:\.\d+)?$/.test(normalised)) return null;

  const value = Number(normalised);
  if (!Number.isFinite(value)) return null;

  return value;
}

/** Detect the currency from the rendered string. The store only uses INR. */
export function parseCurrency(raw) {
  const text = stripZeroWidth(raw);
  // The store renders rupees three ways: "₹21,124", "Rs. 12,723.00", "INR 900".
  if (text.includes('₹') || /\bINR\b/i.test(text) || /\bRs\.?/i.test(text)) return 'INR';
  return null;
}

/**
 * The five stock phrasings the store rotates between, taken from its bundle:
 *   `In stock · ${n} left`, `Only ${n} left`, `${n} in stock`,
 *   `Selling fast — ${n} left`, `Hurry, just ${n} left`
 *
 * Plus an explicit "Out of stock" state.
 *
 * IMPORTANT: a missing element is NOT out of stock. This function returns null
 * for anything it does not positively recognise, and the caller treats null as
 * a scrape failure. Only an explicit out-of-stock signal yields inStock:false.
 */
export function parseStock(raw, badgeClassName = '') {
  const text = stripZeroWidth(raw).trim();
  const cls = String(badgeClassName || '');

  const hasOutClass = /\bout-stock\b/.test(cls);
  const hasInClass = /\bin-stock\b/.test(cls);

  if (!text) {
    // No text at all: we cannot tell. Refuse to guess.
    return null;
  }

  if (/out of stock|sold out|unavailable/i.test(text) || hasOutClass) {
    return { inStock: false, quantity: 0 };
  }

  // Pull the first integer out of any of the five phrasings.
  const match = text.match(/(\d[\d,]*)/);
  if (match) {
    const quantity = Number(match[1].replace(/,/g, ''));
    if (Number.isFinite(quantity)) {
      // A quantity of 0 alongside an in-stock badge is contradictory; treat as
      // out of stock, which is the conservative reading.
      return { inStock: quantity > 0, quantity };
    }
  }

  // Recognised as in-stock by class, but with no parseable quantity. That is
  // still usable data: the product is available, quantity unknown.
  if (hasInClass) return { inStock: true, quantity: null };

  return null;
}

/** Validate a parsed price against sanity bounds. */
export function validatePrice(value) {
  if (value === null || value === undefined) {
    return { ok: false, reason: 'price_missing' };
  }
  if (!Number.isFinite(value)) {
    return { ok: false, reason: 'price_not_finite' };
  }
  if (value < PRICE_BOUNDS.min || value > PRICE_BOUNDS.max) {
    return { ok: false, reason: 'price_out_of_range' };
  }
  return { ok: true };
}

/** Validate a parsed stock result. */
export function validateStock(stock) {
  if (stock === null || stock === undefined) {
    return { ok: false, reason: 'stock_missing' };
  }
  if (typeof stock.inStock !== 'boolean') {
    return { ok: false, reason: 'stock_indeterminate' };
  }
  if (stock.quantity !== null && stock.quantity !== undefined) {
    if (!Number.isInteger(stock.quantity)) {
      return { ok: false, reason: 'stock_qty_not_integer' };
    }
    if (stock.quantity < STOCK_BOUNDS.min || stock.quantity > STOCK_BOUNDS.max) {
      return { ok: false, reason: 'stock_qty_out_of_range' };
    }
  }
  return { ok: true };
}

/**
 * Soft internal-consistency check, reported as a warning on the scrape log.
 *
 * WHAT WAS TRIED AND REJECTED
 * ---------------------------
 * Two tempting cross-checks were measured against the live store and thrown out,
 * because a detector that fires on most healthy scrapes is worse than none:
 *
 *   1. "(1 - price/mrp) * 100 is an exact integer". Held for roughly 8 in 10
 *      products, but broke cleanly on the rest (e.g. 51.2147%). Probably the
 *      MRP element is itself sometimes a decoy.
 *   2. "the discount badge agrees with price/mrp". The badge percentage is
 *      independently randomised -- the same product rendered 8%, 18% and 4% off
 *      across three consecutive scrapes while price and MRP barely moved.
 *
 * Together those fired on 9 of 12 healthy scrapes. So only a genuine ordering
 * violation is reported now. Real structure-change detection is done properly in
 * layout.js by watching the store's own layout revision.
 *
 * This is explicitly NOT a validator: a warning never blocks a write, because
 * rejecting a good price on a noisy heuristic would lose real history.
 */
export function checkPriceConsistency({ price, mrp }) {
  if (typeof mrp === 'number' && mrp > 0 && typeof price === 'number' && price > mrp) {
    return `price ${price} exceeds struck-through mrp ${mrp}`;
  }
  return null;
}

/** Parse the "18% off" badge into a number, or null. */
export function parseBadgePercent(raw) {
  const text = stripZeroWidth(raw);
  const m = text.match(/(\d+(?:\.\d+)?)\s*%/);
  return m ? Number(m[1]) : null;
}
