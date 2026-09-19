import { ZERO_WIDTH_RE, PRICE_BOUNDS, STOCK_BOUNDS } from './constants.js';

export function stripZeroWidth(text) {
  if (typeof text !== 'string') return '';
  return text.replace(ZERO_WIDTH_RE, '');
}

export function parsePrice(raw) {
  const text = stripZeroWidth(raw);
  if (!text) return null;

  if (/%/.test(text)) return null;

  const match = text.match(/\d[\d,  ]*(?:\.\d+)?/);
  if (!match) return null;

  const rest = text.slice(match.index + match[0].length);
  if (/^\.?\d/.test(rest)) return null;

  const normalised = match[0].replace(/[,  ]/g, '');
  if (!normalised || !/^\d+(?:\.\d+)?$/.test(normalised)) return null;

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

  const hasOutClass = /\bout-stock\b/.test(cls);
  const hasInClass = /\bin-stock\b/.test(cls);

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
