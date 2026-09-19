import { getSharedBrowser, closeSharedBrowser } from '../src/scraper/browser.js';
import { scrapeProductWithRetry } from '../src/scraper/scrapeProduct.js';
import { logger } from '../src/utils/logger.js';

const args = process.argv.slice(2);
const headed = args.includes('--headed');
const ids = args.filter((a) => /^\d+$/.test(a)).map(Number);
if (!ids.length) ids.push(325, 174, 2, 42, 500);

const browser = await getSharedBrowser({ headed, slowMo: headed ? 300 : 0 });

let ok = 0, failed = 0, retried = 0, warned = 0;
const t0 = Date.now();

for (const id of ids) {
  const attempts = [];
  const result = await scrapeProductWithRetry({
    browser,
    productId: id,
    log: logger,
    onAttempt: async (a) => {
      attempts.push(`#${a.attempt} ${a.status}${a.error ? ' ' + a.error.code : ''} ${a.durationMs}ms`);
    },
  });

  if (result.ok) {
    result.status === 'retried' ? retried++ : ok++;
    if (result.data.structureWarning) warned++;
    console.log(
      `✓ ${String(id).padEnd(5)} ₹${String(result.data.price).padEnd(10)}` +
      ` mrp=${String(result.data.mrp ?? '-').padEnd(10)}` +
      ` stock=${result.data.inStock ? 'IN' : 'OUT'}(${result.data.stockQty ?? '?'})` +
      ` [${result.status}] ${attempts.join(' | ')}` +
      (result.data.structureWarning ? `\n      ⚠ ${result.data.structureWarning}` : '')
    );
  } else {
    failed++;
    console.log(`✗ ${String(id).padEnd(5)} FAILED ${result.error?.code}: ${result.error?.message?.slice(0, 110)}`);
    console.log(`      attempts: ${attempts.join(' | ')}`);
  }
}

console.log(
  `\nRESULT  first-try=${ok}  retried=${retried}  failed=${failed}` +
  `  structureWarnings=${warned}  total=${ids.length}  elapsed=${((Date.now() - t0) / 1000).toFixed(1)}s`
);

await closeSharedBrowser();
process.exit(failed ? 1 : 0);
