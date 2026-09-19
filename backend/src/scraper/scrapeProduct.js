/**
 * Scrape one product's price and stock.
 *
 * The flow per attempt:
 *   navigate -> wait for price block -> arm the human-interaction gate ->
 *   click Reveal -> wait for a terminal state -> extract -> parse -> validate
 *
 * Anything that goes wrong raises a typed ScrapeError. scrapeProductWithRetry()
 * wraps that in an exponential-backoff retry loop and reports every attempt to
 * an onAttempt callback so the caller can write one scrape_logs row per attempt.
 */

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

/**
 * Dismiss the store's cookie consent banner if it is showing.
 *
 * The banner is `.cookie-overlay`, position:fixed with z-index 50, and it
 * appears intermittently rather than on every load. While it is up it swallows
 * pointer events, so the Reveal click silently fails with "cookie-overlay
 * intercepts pointer events" -- this was the single biggest source of failed
 * attempts before it was handled.
 *
 * We click "Decline", not "Accept": declining non-essential cookies is the
 * privacy-preserving choice and the store works fine either way.
 *
 * Returns true if a banner was dismissed.
 */
async function dismissConsentBanner(page, log, { attempts = 3 } = {}) {
  const overlay = page.locator('.cookie-overlay');
  if ((await overlay.count()) === 0) return false;

  // It comes in two variants (`cookie-top` and `cookie-center`) and can
  // reappear after being dismissed, so this retries rather than assuming one
  // click settles it.
  for (let i = 1; i <= attempts; i++) {
    if ((await overlay.count()) === 0) return true;

    // Prefer Decline; fall back to any button so a copy change cannot wedge us.
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

    // Poll for it to actually go away. Checking the count rather than waiting
    // for `detached` on a specific handle means a replacement banner is seen as
    // still-present instead of being mistaken for success.
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

/**
 * Arm the store's human-interaction gate.
 *
 * The bundle constructs it as `new Ar({ minMoves: 8, minDwellMs: 600 })` and
 * disables the Reveal button until both are satisfied. We move well past the
 * minimum along a non-linear path (a straight line of evenly spaced points is
 * itself a bot signal) and then poll until the button actually enables, rather
 * than assuming our moves landed.
 */
async function armInteractionGate(page, log) {
  const block = page.locator('.price-block');
  await block.waitFor({ state: 'visible', timeout: TIMEOUTS.priceBlockMs });

  const box = await block.boundingBox();
  if (!box) throw new ScrapeError('gate_no_bounding_box', 'price block has no layout box');

  const deadline = Date.now() + TIMEOUTS.gateMs;
  let moves = 0;

  while (Date.now() < deadline) {
    // The banner can appear at any moment, not just on load.
    await dismissConsentBanner(page, log);

    // Sweep across the price area on a wobbling path.
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
    if (state.resolved || state.errored) return; // resolved without us clicking
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

/**
 * Click Reveal and wait until the price block reaches a terminal state.
 *
 * Terminal means either `.price-main` (resolved) or `.price-error` (the store
 * gave up after its own internal retries).
 *
 * WHY THIS POLLS INSTEAD OF JUST AWAITING A SELECTOR
 * --------------------------------------------------
 * Measured against the live store, the first click on a page sometimes does not
 * register at all: the block stays in its `price-idle` phase with the Reveal
 * button still enabled, and no /api/challenge request is ever made. A plain
 * `waitForFunction` then sat there for the full 60s timeout and burned an entire
 * retry attempt on what is really a dropped click.
 *
 * So we distinguish the three non-terminal phases:
 *   - idle      -> the click did not take; click again (bounded)
 *   - loading   -> the store is working; keep waiting, this is legitimate
 *   - retrying  -> the store hit an error and is retrying internally; keep waiting
 *
 * This turns a 60s dead attempt into a sub-second recovery, which matters a lot
 * when the cron run has several products to get through.
 */
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

    // Idle == the reveal has not been accepted yet.
    const isIdle = state.hasButton && !state.disabled && !state.resolved && !state.errored;

    if (isIdle) {
      if (idleSince === null) idleSince = Date.now();

      // Give a just-issued click a moment to take effect before re-clicking.
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
        // Clear the banner first: while it is up it intercepts the click.
        await dismissConsentBanner(page, log);
        try {
          await page.locator('.price-block button').first().click({ timeout: 8_000 });
        } catch (err) {
          // Usually the consent banner re-appeared and swallowed the click.
          // That is recoverable, so stay in the loop and try again rather than
          // aborting the whole attempt -- an earlier version threw here and
          // turned a transient overlay into three failed attempts in a row.
          lastClickError = err;
          log.debug({ clicks, err: err.message.slice(0, 120) }, 'reveal click was blocked');
        }
        idleSince = Date.now();
      }
    } else {
      // loading / retrying: the store is genuinely working, stop counting idle.
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

/**
 * One scrape attempt. Returns validated data or throws a typed ScrapeError.
 */
export async function scrapeProductOnce({ browser, productId, layout, log }) {
  const url = assertAllowedUrl(buildProductUrl(productId));
  const context = await newProductContext(browser);
  const page = await context.newPage();

  // Surface store-side HTTP failures as a concrete error code rather than
  // letting them show up later as a mysterious missing selector.
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
      // 404 means the product genuinely is not there -- retrying cannot help.
      throw new ScrapeError(
        status === 404 ? 'product_not_found' : 'http_error',
        `store returned HTTP ${status}`,
        { retryable: status !== 404, httpStatus: status }
      );
    }

    await dismissConsentBanner(page, log);
    await armInteractionGate(page, log);

    // Playwright dispatches real input events, so event.isTrusted is true.
    // A JS-dispatched click is ignored by the store.
    await clickRevealAndWait(page, log);

    const raw = await page.evaluate(extractPriceBlock, layout.classes);

    if (raw.state === 'error') {
      throw new ScrapeError('store_reported_error', raw.message || 'store reported an error', {
        retryable: true,
      });
    }
    if (raw.state !== 'resolved') {
      throw new ScrapeError('price_not_resolved', `unexpected block state: ${raw.state}/${raw.reason}`);
    }

    // ---- parse -------------------------------------------------------------
    const price = parsePrice(raw.priceRaw);
    const mrp = parsePrice(raw.mrpRaw);
    const badgePercent = parseBadgePercent(raw.badgeRaw);
    const stock = parseStock(raw.stockRaw, raw.stockClass);
    const currency = parseCurrency(raw.priceRaw) ?? 'INR';

    // ---- validate ----------------------------------------------------------
    // A failure here is a scrape failure, NOT a reason to store a zero or null.
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

    // ---- decoy tripwire ----------------------------------------------------
    // If the number we picked matches one of the hidden decoys, our selector has
    // drifted onto a trap. Refuse rather than store a plausible-looking wrong
    // price -- storing wrong data is worse than recording a failure.
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

/**
 * Scrape with retries.
 *
 * onAttempt is awaited after every attempt so the caller can persist a
 * scrape_logs row per attempt -- including the ones that failed. This is what
 * makes the log honest: a product that succeeded on attempt 3 leaves behind two
 * failure rows and one success row.
 *
 * Returns { ok, data, attempts, status, error }. It never throws for a scrape
 * failure; a run must not be aborted because one product is unreachable.
 */
export async function scrapeProductWithRetry({
  browser,
  productId,
  maxAttempts = RETRY.maxAttempts,
  onAttempt = async () => {},
  log = logger,
}) {
  // Fetched once per product and reused across attempts. The class names rotate
  // roughly every 40 minutes, so they must never be hardcoded.
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

      // 'retried' = eventually succeeded, but not on the first try. Surfacing
      // this separately is what makes retries visible in the UI.
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

      // Do not burn attempts on failures that cannot succeed.
      if (!error.retryable) break;
      if (attempt >= maxAttempts) break;

      const delay = backoffDelay(attempt);
      log.debug({ productId, delay }, 'backing off before retry');
      await sleep(delay);
    }
  }

  return { ok: false, attempts: attemptsMade, status: 'failed', error: lastError };
}
