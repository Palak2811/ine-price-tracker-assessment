export function extractPriceBlock(classes) {
  const ZW = /[​-‍⁠﻿­]/g;

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

  const block = document.querySelector('.price-block');
  if (!block) {
    return { state: 'missing', reason: 'price_block_absent' };
  }

  const errorPanel = block.querySelector('.price-error');
  if (errorPanel) {
    return {
      state: 'error',
      reason: 'store_reported_error',
      message: (errorPanel.textContent || '').replace(ZW, '').trim().slice(0, 300),
      canRefresh: !!block.querySelector('button'),
    };
  }

  const main = block.querySelector('.price-main');
  if (!main) {
    const status = textOf(block.querySelector('.price-status'));
    return {
      state: 'pending',
      reason: 'price_main_absent',
      status,
      busy: block.getAttribute('aria-busy') === 'true',
    };
  }

  const sel = (name) => (classes && classes[name] ? '.' + classes[name] : null);

  const pick = (name) => {
    const s = sel(name);
    if (!s) return null;
    const matches = Array.from(main.querySelectorAll(s)).filter(isVisible);
    return matches.length ? textOf(matches[0]) : null;
  };

  const priceRaw = pick('priceValue');
  const mrpRaw = pick('mrp');
  const badgeRaw = pick('badge');

  const stockSel = sel('stock');
  const stockBadge = stockSel
    ? document.querySelector(stockSel + ' .stock-badge')
    : document.querySelector('.stock-badge');

  const deliverySel = sel('delivery');
  const sellerSel = sel('seller');
  const ratingSel = sel('rating');

  return {
    state: 'resolved',
    priceRaw,
    mrpRaw,
    badgeRaw,
    stockRaw: textOf(stockBadge),
    stockClass: stockBadge ? stockBadge.className : null,
    deliveryRaw: deliverySel ? textOf(document.querySelector(deliverySel)) : null,
    sellerRaw: sellerSel ? textOf(document.querySelector(sellerSel)) : null,
    ratingRaw: ratingSel ? textOf(document.querySelector(ratingSel)) : null,
    attemptsRaw: textOf(block.querySelector('.price-meta')),
    decoyRaw: Array.from(main.querySelectorAll('[data-price], .price-value'))
      .map((el) => el.textContent.replace(ZW, '').trim()),
  };
}

export function readGateState() {
  const block = document.querySelector('.price-block');
  if (!block) return { present: false };
  const btn = block.querySelector('button');
  const sub = block.querySelector('.price-substatus');
  return {
    present: true,
    hasButton: !!btn,
    disabled: btn ? btn.disabled : true,
    substatus: sub ? sub.textContent.trim() : null,
    resolved: !!block.querySelector('.price-main'),
    errored: !!block.querySelector('.price-error'),
  };
}
