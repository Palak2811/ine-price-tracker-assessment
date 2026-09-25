import { ZERO_WIDTH_RE, PRICE_BOUNDS, STOCK_BOUNDS } from './constants.js';

export function stripZeroWidth(text) {
  if (typeof text !== 'string') return '';
  return text.replace(ZERO_WIDTH_RE, '');
}

export function parsePrice(raw) {
  const text = stripZeroWidth(raw);
  if (!text) return null;

  if (/%/.test(text)) return null;

  const match = text.match(/\d[\d.,   ]*\d|\d/);
  if (!match) return null;

  const token = match[0].replace(/[   ]/g, '');
  if (!/^[\d.,]+$/.test(token)) return null;

  // Digit grouping must actually look like grouping before we strip it.
  // Western uses 3-digit groups (1,234,567); Indian uses 2-digit middles with a
  // 3-digit tail (1,56,756). Anything else -- "1.2.3" -- is malformed, and
  // joining it blindly would invent a number.
  const groupingValid = (groups) => {
    if (groups.length < 2) return true;
    if (!/^\d{1,3}$/.test(groups[0])) return false;
    if (!/^\d{3}$/.test(groups[groups.length - 1])) return false;
    return groups.slice(1, -1).every((g) => /^\d{2,3}$/.test(g));
  };

  const lastDot = token.lastIndexOf('.');
  const lastComma = token.lastIndexOf(',');
  let normalised;

  if (lastDot !== -1 && lastComma !== -1) {
    const decimalSep = lastDot > lastComma ? '.' : ',';
    const groupSep = decimalSep === '.' ? ',' : '.';
    const parts = token.split(decimalSep);
    if (parts.length !== 2) return null;
    const groups = parts[0].split(groupSep);
    if (groups.some((g) => !/^\d+$/.test(g)) || !groupingValid(groups)) return null;
    const frac = parts[1];
    if (!/^\d+$/.test(frac)) return null;
    normalised = `${groups.join('')}.${frac}`;
  } else if (lastDot !== -1 || lastComma !== -1) {
    const sep = lastDot !== -1 ? '.' : ',';
    const groups = token.split(sep);
    if (groups.some((g) => !/^\d+$/.test(g))) return null;

    const tail = groups[groups.length - 1];

    if (groups.length === 2 && tail.length !== 3) {
      normalised = `${groups[0]}.${tail}`;
    } else {
      if (!groupingValid(groups)) return null;
      normalised = groups.join('');
    }
  } else {
    if (!/^\d+$/.test(token)) return null;
    normalised = token;
  }

  const value = Number(normalised);
  if (!Number.isFinite(value)) return null;

  return value;
}

export function parseCurrency(raw) {
  const text = stripZeroWidth(raw);
  if (text.includes('₹') || /\bINR\b/i.test(text) || /\bRs\.?/i.test(text)) return 'INR';
  return null;
}

export function parseStock(raw, badgeClassName = '') {
  const text = stripZeroWidth(raw).trim();
  const cls = String(badgeClassName || '');

  const hasOutClass = /\bout-stock\b|\bavail-no\b/.test(cls);
  const hasInClass = /\bin-stock\b|\bavail-yes\b/.test(cls);

  if (!text) {
    return null;
  }

  if (/out of stock|sold out|unavailable/i.test(text) || hasOutClass) {
    return { inStock: false, quantity: 0 };
  }

  const match = text.match(/(\d[\d,]*)/);
  if (match) {
    const quantity = Number(match[1].replace(/,/g, ''));
    if (Number.isFinite(quantity)) {
      return { inStock: quantity > 0, quantity };
    }
  }

  if (hasInClass) return { inStock: true, quantity: null };

  return null;
}

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

export function checkPriceConsistency({ price, mrp }) {
  if (typeof mrp === 'number' && mrp > 0 && typeof price === 'number' && price > mrp) {
    return `price ${price} exceeds struck-through mrp ${mrp}`;
  }
  return null;
}

export function parseBadgePercent(raw) {
  const text = stripZeroWidth(raw);
  const m = text.match(/(\d+(?:\.\d+)?)\s*%/);
  return m ? Number(m[1]) : null;
}
