/**
 * Browser-side DOM extraction.
 *
 * Everything in extractPriceBlock() runs inside the page via page.evaluate(),
 * so it must be self-contained -- it cannot close over Node-side imports.
 *
 * WHY VISIBILITY MATTERS
 * ----------------------
 * The store plants three decoy prices in the same container as the real one:
 *
 *   <span class="price-value" aria-hidden="true" style="display:none">₹26,262</span>
 *   <span class="amount" data-price="true" aria-hidden="true"
 *         style="display:none">₹14,278</span>
 *   <span class="{layout.sale}">Deal price ₹23,443</span>   <-- VISIBLE decoy
 *
 * The first two are the obvious traps: a scraper reaching for `[data-price]`
 * gets a wrong number. The third is nastier because it is visible, so a
 * visibility filter alone is not enough -- we must also select strictly by the
 * `priceValue` class from /api/layout and never fall back to `sale`.
 *
 * The real price lives in an element with the rotating `layout.classes.priceValue`
 * class, split into per-character <span>s with zero-width spaces between them.
 */

/**
 * Serialised into the page. Returns raw strings only; all parsing, validation
 * and decision-making happens Node-side in parse.js so it stays testable.
 */
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

  // The page's own error panel, shown after its internal retries are exhausted.
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
    // Still loading / retrying / idle.
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

  // Stock lives outside .price-main, in the facets row.
  const stockSel = sel('stock');
  const stockBadge = stockSel
    ? document.querySelector(stockSel + ' .stock-badge')
    : document.querySelector('.stock-badge');

  // Extra product info for the dashboard (bonus).
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
    // Decoy values, captured purely for diagnostics: if one of these ever equals
    // the value we selected, our selector has drifted onto a trap.
    decoyRaw: Array.from(main.querySelectorAll('[data-price], .price-value'))
      .map((el) => el.textContent.replace(ZW, '').trim()),
  };
}

/** Serialised into the page: reports whether the Reveal button is armed yet. */
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
