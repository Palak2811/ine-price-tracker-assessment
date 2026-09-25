const SEL = {
  panel: '.offer-panel, .price-block',
  resolved: '.offer-row, .price-main',
  error: '.offer-error, .price-error',
  status: '.offer-msg, .price-status',
  substatus: '.offer-submsg, .price-substatus',
  foot: '.offer-foot, .price-meta',
  stockPill: '.avail-pill, .stock-badge',
};

const LOCKED_RE = /offer-locked|price-idle/;
const ERROR_RE = /offer-error|offer-failed|price-error/;
const SETTLING_RE = /refreshing|updating|settling/i;

export function extractPriceBlock(classes) {
  const ZW = /[​-‍⁠﻿­]/g;
  const S = {
    panel: '.offer-panel, .price-block',
    resolved: '.offer-row, .price-main',
    error: '.offer-error, .price-error',
    status: '.offer-msg, .price-status',
    foot: '.offer-foot, .price-meta',
    stockPill: '.avail-pill, .stock-badge',
  };
  const ERR = /offer-error|offer-failed|price-error/;
  const SETTLING = /refreshing|updating|settling/i;

  const isVisible = (el) => {
    if (!el) return false;
    if (el.getAttribute('aria-hidden') === 'true') return false;
    const s = getComputedStyle(el);
    if (s.display === 'none' || s.visibility === 'hidden') return false;
    if (Number(s.opacity) <= 0.05) return false;
    const r = el.getBoundingClientRect();
    return r.width > 0 && r.height > 0;
  };

  const textOf = (el) => (el ? el.textContent.replace(ZW, '').trim() : null);

  const block = document.querySelector(S.panel);
  if (!block) {
    return { state: 'missing', reason: 'price_block_absent' };
  }

  const errorPanel = block.querySelector(S.error);
  if (errorPanel || ERR.test(block.className)) {
    return {
      state: 'error',
      reason: 'store_reported_error',
      message: ((errorPanel || block).textContent || '').replace(ZW, '').trim().slice(0, 300),
      canRefresh: !!block.querySelector('button'),
    };
  }

  const main = block.querySelector(S.resolved);
  if (!main) {
    return {
      state: 'pending',
      reason: 'price_main_absent',
      status: textOf(block.querySelector(S.status)),
      busy: block.getAttribute('aria-busy') === 'true',
    };
  }

  const sel = (name) => (classes && classes[name] ? '.' + classes[name] : null);

  const pickEl = (name) => {
    const s = sel(name);
    if (!s) return null;
    return Array.from(main.querySelectorAll(s)).filter(isVisible)[0] ?? null;
  };

  const priceEl = pickEl('priceValue');

  // The v2 store renders a provisional figure at reduced opacity alongside a
  // "Refreshing prices" note, then replaces it with the final one. Reading it
  // during that window yields a value that is about to change, so report it as
  // still settling and let the caller wait rather than storing it.
  const priceOpacity = priceEl ? Number(getComputedStyle(priceEl).opacity) : null;
  const settlingNote = Array.from(block.querySelectorAll('span, small, p'))
    .map((e) => e.textContent.trim())
    .find((t) => SETTLING.test(t)) ?? null;
  const settling = (priceOpacity !== null && priceOpacity < 0.9) || !!settlingNote;

  const stockSel = sel('stock');
  const stockPill = stockSel
    ? document.querySelector(stockSel + ' ' + S.stockPill.split(', ').join(', ' + stockSel + ' '))
      ?? document.querySelector(stockSel)?.querySelector(S.stockPill)
      ?? document.querySelector(stockSel)
    : document.querySelector(S.stockPill);

  const deliverySel = sel('delivery');
  const sellerSel = sel('seller');
  const ratingSel = sel('rating');

  return {
    state: 'resolved',
    settling,
    settlingNote,
    priceOpacity,
    priceRaw: textOf(priceEl),
    mrpRaw: textOf(pickEl('mrp')),
    badgeRaw: textOf(pickEl('badge')),
    stockRaw: textOf(stockPill),
    stockClass: stockPill ? stockPill.className : null,
    deliveryRaw: deliverySel ? textOf(document.querySelector(deliverySel)) : null,
    sellerRaw: sellerSel ? textOf(document.querySelector(sellerSel)) : null,
    ratingRaw: ratingSel ? textOf(document.querySelector(ratingSel)) : null,
    attemptsRaw: textOf(block.querySelector(S.foot)),
    decoyRaw: Array.from(main.querySelectorAll('[data-price], .price-value'))
      .map((el) => el.textContent.replace(ZW, '').trim()),
  };
}

export function readGateState() {
  const S = {
    panel: '.offer-panel, .price-block',
    resolved: '.offer-row, .price-main',
    error: '.offer-error, .price-error',
    substatus: '.offer-submsg, .price-substatus',
  };
  const ERR = /offer-error|offer-failed|price-error/;
  const LOCKED = /offer-locked|price-idle/;

  const block = document.querySelector(S.panel);
  if (!block) return { present: false };

  const btn = block.querySelector('button');
  const sub = block.querySelector(S.substatus);

  return {
    present: true,
    hasButton: !!btn,
    disabled: btn ? btn.disabled : true,
    substatus: sub ? sub.textContent.trim() : null,
    resolved: !!block.querySelector(S.resolved),
    errored: !!block.querySelector(S.error) || ERR.test(block.className),
    locked: LOCKED.test(block.className),
  };
}

export { SEL, LOCKED_RE, ERROR_RE, SETTLING_RE };
