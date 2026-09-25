import { TIMEOUTS, GATE, RETRY, buildProductUrl, assertAllowedUrl } from './constants.js';
import { extractPriceBlock, readGateState } from './extract.js';
import {
  parsePrice, parseCurrency, parseStock, parseBadgePercent,
  validatePrice, validateStock, checkPriceConsistency,
} from './parse.js';
import { ScrapeError, sleep, backoffDelay } from '../utils/retry.js';
import { newProductContext } from './browser.js';
import { getLayout } from './layout.js';
import { logger } from '../utils/logger.js';

async function dismissConsentBanner(page, log, { attempts = 3 } = {}) {
  const overlay = page.locator('.cookie-overlay, .consent-overlay');
  if ((await overlay.count()) === 0) return false;

  for (let i = 1; i <= attempts; i++) {
    if ((await overlay.count()) === 0) return true;

    const decline = overlay
      .locator('button[aria-label="Decline cookies"], button:has-text("Decline")')
      .first();
    const target = (await decline.count()) > 0 ? decline : overlay.locator('button').first();

    try {
      await target.click({ timeout: 3_000 });
    } catch (err) {
      log.debug({ attempt: i, err: err.message.slice(0, 120) }, 'consent decline click failed');
      continue;
    }

    const deadline = Date.now() + 2_000;
    while (Date.now() < deadline) {
      if ((await overlay.count()) === 0) {
        log.debug({ attempt: i }, 'dismissed cookie consent banner (declined)');
        return true;
      }
      await page.waitForTimeout(150);
    }
  }

  log.debug('cookie banner still present after retries');
  return false;
}

// A short sweep across the price area. The store's gate watches for recent
// pointer activity, so it lapses and re-disables the button if the mouse goes
// still -- which is what made re-clicks time out with the button disabled.
async function sweepPriceArea(page, passes = 1) {
  const block = page.locator('.offer-panel, .price-block');
  const box = await block.boundingBox().catch(() => null);
  if (!box) return false;

  for (let p = 0; p < passes; p++) {
    for (let i = 0; i < GATE.moves; i++) {
      const t = i / GATE.moves;
      const x = box.x + 15 + t * Math.max(1, box.width - 30);
      const y = box.y + box.height / 2 + Math.sin(t * Math.PI * 3) * (box.height / 4);
      await page.mouse.move(x, y, { steps: 3 });
      await page.waitForTimeout(GATE.moveDelayMs);
    }
  }
  return true;
}

async function armInteractionGate(page, log) {
  const block = page.locator('.offer-panel, .price-block');
  await block.waitFor({ state: 'visible', timeout: TIMEOUTS.priceBlockMs });

  const box = await block.boundingBox();
  if (!box) throw new ScrapeError('gate_no_bounding_box', 'price block has no layout box');

  const deadline = Date.now() + TIMEOUTS.gateMs;
  let moves = 0;

  while (Date.now() < deadline) {
    await dismissConsentBanner(page, log);

    for (let i = 0; i < GATE.moves; i++) {
      const t = i / GATE.moves;
      const x = box.x + 15 + t * Math.max(1, box.width - 30);
      const y = box.y + box.height / 2 + Math.sin(t * Math.PI * 3) * (box.height / 4);
      await page.mouse.move(x, y, { steps: 3 });
      moves++;
      await page.waitForTimeout(GATE.moveDelayMs);
    }

    const state = await page.evaluate(readGateState);
    if (!state.present) throw new ScrapeError('gate_block_vanished', 'price block disappeared');
    if (state.resolved || state.errored) return; 
    if (state.hasButton && !state.disabled) {
      log.debug({ moves }, 'interaction gate armed');
      return;
    }
    log.debug({ moves, substatus: state.substatus }, 'gate not armed yet, continuing');
  }

  const final = await page.evaluate(readGateState);
  throw new ScrapeError(
    'gate_not_satisfied',
    `reveal button still disabled after ${moves} moves (${final.substatus ?? 'no substatus'})`
  );
}

async function clickRevealAndWait(page, log) {
  const deadline = Date.now() + TIMEOUTS.priceResolveMs;
  const maxClicks = 3;
  let clicks = 0;
  let idleSince = null;
  let lastPhase = null;
  let lastClickError = null;

  while (Date.now() < deadline) {
    const state = await page.evaluate(readGateState);

    if (state.resolved || state.errored) return;
    if (!state.present) throw new ScrapeError('gate_block_vanished', 'price block disappeared');

    const isIdle = state.hasButton && !state.disabled && !state.resolved && !state.errored;

    if (isIdle) {
      if (idleSince === null) idleSince = Date.now();

      const idleFor = Date.now() - idleSince;
      if (clicks === 0 || idleFor > 3_000) {
        if (clicks >= maxClicks) {
          throw new ScrapeError(
            'reveal_click_ignored',
            `price block stayed idle after ${clicks} reveal clicks` +
            (lastClickError ? ` (last click error: ${lastClickError.message.slice(0, 120)})` : '')
          );
        }
        clicks++;
        if (clicks > 1) log.debug({ clicks }, 're-clicking reveal; previous click did not register');
        await dismissConsentBanner(page, log);
        // Re-arm before every retry: by now the pointer has been still for
        // seconds and the gate has usually re-disabled the button, which makes
        // the click time out waiting for an actionable element.
        if (clicks > 1) await sweepPriceArea(page, 1);
        try {
          await page.locator('.offer-panel button, .price-block button').first().click({ timeout: 8_000 });
        } catch (err) {
          lastClickError = err;
          log.debug({ clicks, err: err.message.slice(0, 120) }, 'reveal click was blocked');
        }
        idleSince = Date.now();
      }
    } else {
      idleSince = null;
      if (state.substatus && state.substatus !== lastPhase) {
        lastPhase = state.substatus;
        log.debug({ phase: state.substatus }, 'store is retrying internally');
      }
    }

    await page.waitForTimeout(400);
  }

  const final = await page.evaluate(readGateState).catch(() => ({}));
  throw new ScrapeError(
    'price_resolve_timeout',
    `price did not resolve within ${TIMEOUTS.priceResolveMs}ms ` +
    `(clicks=${clicks}, substatus: ${final.substatus ?? 'unknown'})`
  );
}

export async function scrapeProductOnce({ browser, productId, layout, log }) {
  const url = assertAllowedUrl(buildProductUrl(productId));
  const context = await newProductContext(browser);
  const page = await context.newPage();

  let lastDocumentStatus = null;
  page.on('response', (res) => {
    if (res.url() === url) lastDocumentStatus = res.status();
  });

  try {
    let response;
    try {
      response = await page.goto(url, {
        waitUntil: 'domcontentloaded',
        timeout: TIMEOUTS.navigationMs,
      });
    } catch (err) {
      throw new ScrapeError('navigation_failed', `navigation failed: ${err.message}`, { cause: err });
    }

    const status = response ? response.status() : lastDocumentStatus;
    if (status && status >= 400) {
      throw new ScrapeError(
        status === 404 ? 'product_not_found' : 'http_error',
        `store returned HTTP ${status}`,
        { retryable: status !== 404, httpStatus: status }
      );
    }

    await dismissConsentBanner(page, log);
    await armInteractionGate(page, log);

    await clickRevealAndWait(page, log);

    let raw = await page.evaluate(extractPriceBlock, layout.classes);

    // The store shows a provisional price at reduced opacity with a
    // "Refreshing prices" note before replacing it with the final figure.
    // Reading during that window stores a number that is about to change, so
    // poll until it settles rather than trusting the first value seen.
    if (raw.state === 'resolved' && raw.settling) {
      const settleDeadline = Date.now() + TIMEOUTS.settleMs;
      while (Date.now() < settleDeadline) {
        await page.waitForTimeout(500);
        const next = await page.evaluate(extractPriceBlock, layout.classes);
        if (next.state !== 'resolved') { raw = next; break; }
        raw = next;
        if (!next.settling) break;
      }
      if (raw.state === 'resolved' && raw.settling) {
        log.warn(
          { note: raw.settlingNote, opacity: raw.priceOpacity },
          'price still settling when the wait expired; using the value shown',
        );
      }
    }

    if (raw.state === 'error') {
      throw new ScrapeError('store_reported_error', raw.message || 'store reported an error', {
        retryable: true,
      });
    }
    if (raw.state !== 'resolved') {
      throw new ScrapeError('price_not_resolved', `unexpected block state: ${raw.state}/${raw.reason}`);
    }

    const price = parsePrice(raw.priceRaw);
    const mrp = parsePrice(raw.mrpRaw);
    const badgePercent = parseBadgePercent(raw.badgeRaw);
    const stock = parseStock(raw.stockRaw, raw.stockClass);
    const currency = parseCurrency(raw.priceRaw) ?? 'INR';

    const priceCheck = validatePrice(price);
    if (!priceCheck.ok) {
      throw new ScrapeError(
        'validation_failed',
        `${priceCheck.reason} (raw: ${JSON.stringify(raw.priceRaw)})`
      );
    }

    const stockCheck = validateStock(stock);
    if (!stockCheck.ok) {
      throw new ScrapeError(
        'validation_failed',
        `${stockCheck.reason} (raw: ${JSON.stringify(raw.stockRaw)})`
      );
    }

    const decoyValues = (raw.decoyRaw || []).map(parsePrice).filter((v) => v !== null);
    if (decoyValues.includes(price)) {
      throw new ScrapeError(
        'decoy_price_selected',
        `selected price ${price} matches a hidden decoy; selector may have drifted`,
        { retryable: false }
      );
    }

    const structureWarning = checkPriceConsistency({ price, mrp });

    return {
      price,
      currency,
      mrp,
      inStock: stock.inStock,
      stockQty: stock.quantity,
      structureWarning,
      layoutRevision: layout.revision,
      httpStatus: status ?? null,
      extra: {
        delivery: raw.deliveryRaw,
        seller: raw.sellerRaw,
        rating: raw.ratingRaw,
        storeAttempts: raw.attemptsRaw,
      },
    };
  } finally {
    await page.close().catch(() => {});
    await context.close().catch(() => {});
  }
}

export async function scrapeProductWithRetry({
  browser,
  productId,
  maxAttempts = RETRY.maxAttempts,
  onAttempt = async () => {},
  log = logger,
}) {
  let layout;
  try {
    layout = await getLayout();
  } catch (err) {
    const error = new ScrapeError('layout_unavailable', `could not fetch layout: ${err.message}`);
    await onAttempt({
      attempt: 1, status: 'failed', error, durationMs: 0,
      startedAt: new Date(), completedAt: new Date(),
    });
    return { ok: false, attempts: 1, status: 'failed', error };
  }

  let lastError = null;
  let attemptsMade = 0;

  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    attemptsMade = attempt;
    const startedAt = new Date();
    const t0 = Date.now();

    try {
      const data = await scrapeProductOnce({ browser, productId, layout, log });
      const durationMs = Date.now() - t0;

      await onAttempt({
        attempt, status: 'success', data, durationMs,
        startedAt, completedAt: new Date(),
      });

      return {
        ok: true,
        data,
        attempts: attempt,
        status: attempt === 1 ? 'success' : 'retried',
      };
    } catch (err) {
      const durationMs = Date.now() - t0;
      const error = err instanceof ScrapeError
        ? err
        : new ScrapeError('unexpected_error', err.message, { cause: err });
      lastError = error;

      await onAttempt({
        attempt, status: 'failed', error, durationMs,
        startedAt, completedAt: new Date(),
      });

      log.warn(
        { productId, attempt, code: error.code, durationMs },
        `scrape attempt failed: ${error.message}`
      );

      if (!error.retryable) break;
      if (attempt >= maxAttempts) break;

      const delay = backoffDelay(attempt);
      log.debug({ productId, delay }, 'backing off before retry');
      await sleep(delay);
    }
  }

  return { ok: false, attempts: attemptsMade, status: 'failed', error: lastError };
}
