/**
 * Playwright browser lifecycle.
 *
 * WHY A HEADLESS BROWSER AT ALL
 * -----------------------------
 * The assignment asks us to prefer lightweight HTTP fetching. For this store
 * that is genuinely impossible for price/stock, and the reason is concrete:
 *
 *   1. /api/catalog and /api/product/:id return name, brand, SKU, specs and
 *      reviews -- but deliberately NO price and NO stock.
 *   2. The real price comes from /api/products/:id/price, which rejects any
 *      request without a short-lived session token.
 *   3. That token is minted by POST /api/session, which requires: a proof-of-
 *      work nonce, the output of a WASM module the server ships per-challenge,
 *      and a browser attestation containing canvas + WebGL fingerprints,
 *      hardwareConcurrency, screen metrics and frame timings.
 *   4. The response body is then encrypted and decrypted by the page's own JS.
 *   5. On top of that, the reveal is gated on >=8 real mouse moves, >=600ms
 *      dwell, and a click whose event.isTrusted is true.
 *
 * Reimplementing 1-4 in Node would mean porting the store's obfuscated crypto
 * and faking a GPU fingerprint -- brittle, and it would break the moment the
 * store rotated its WASM. Driving a real browser lets the page do that work for
 * us, so our scraper only has to solve the part that is actually stable: finding
 * the right number in the DOM.
 *
 * We therefore use ONE browser process for a whole run and open a fresh context
 * per product, which is far cheaper than a browser per product and keeps
 * products isolated from each other's storage/session state.
 */

import { chromium } from 'playwright';

/** Populated lazily so importing this module never launches a browser. */
let sharedBrowser = null;

export async function launchBrowser({ headed = false, slowMo = 0 } = {}) {
  return chromium.launch({
    headless: !headed,
    slowMo,
    args: [
      '--disable-dev-shm-usage', // Render's containers have a small /dev/shm
      '--no-sandbox',
    ],
  });
}

/** Reuse one browser across a run; callers must eventually call closeShared(). */
export async function getSharedBrowser(opts = {}) {
  if (sharedBrowser && sharedBrowser.isConnected()) return sharedBrowser;
  sharedBrowser = await launchBrowser(opts);
  return sharedBrowser;
}

export async function closeSharedBrowser() {
  if (sharedBrowser) {
    try {
      await sharedBrowser.close();
    } catch {
      /* already gone */
    }
    sharedBrowser = null;
  }
}

/**
 * A fresh context per product.
 *
 * The viewport is a realistic desktop size on purpose: the attestation the page
 * builds includes screen metrics, and a 0x0 or exotic viewport is exactly the
 * sort of thing a bot check flags.
 */
export async function newProductContext(browser) {
  return browser.newContext({
    viewport: { width: 1280, height: 900 },
    deviceScaleFactor: 1,
    locale: 'en-IN',
    timezoneId: 'Asia/Kolkata',
  });
}
