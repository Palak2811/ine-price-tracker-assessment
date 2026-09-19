import { chromium } from 'playwright';

let sharedBrowser = null;

export async function launchBrowser({ headed = false, slowMo = 0 } = {}) {
  return chromium.launch({
    headless: !headed,
    slowMo,
    args: [
      '--disable-dev-shm-usage', 
      '--no-sandbox',
    ],
  });
}

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
    }
    sharedBrowser = null;
  }
}

export async function newProductContext(browser) {
  return browser.newContext({
    viewport: { width: 1280, height: 900 },
    deviceScaleFactor: 1,
    locale: 'en-IN',
    timezoneId: 'Asia/Kolkata',
  });
}
