import { runScrapeBatch, scrapeSingleProduct } from '../src/services/scrapeService.js';
import { listTrackedProducts } from '../src/repositories/trackingRepository.js';

const args = process.argv.slice(2);
const has = (f) => args.includes(f);
const val = (name, fallback) => {
  const hit = args.find((a) => a.startsWith(`--${name}=`));
  return hit ? hit.split('=')[1] : fallback;
};

const headed = has('--headed');
const slowMo = Number.parseInt(val('slow-mo', headed ? '300' : '0'), 10) || 0;
const productId = val('product', null);
const respectSchedule = !has('--all');

console.log(
  `\n  INE Price Tracker -- scraper CLI\n` +
  `  mode:     ${headed ? 'HEADED (visible browser)' : 'headless'}\n` +
  `  slowMo:   ${slowMo}ms\n` +
  `  schedule: ${respectSchedule ? 'only products that are due' : 'all active products (--all)'}\n`
);

if (productId) {
  const summary = await scrapeSingleProduct(productId, { trigger: 'cli' });
  if (!summary) {
    console.error(`No tracked product with id ${productId}`);
    process.exit(1);
  }
  report(summary);
} else {
  const active = await listTrackedProducts();
  if (!active.length) {
    console.error('No active tracked products. Add one via the UI or POST /api/tracked-products.');
    process.exit(1);
  }
  const summary = await runScrapeBatch({
    trigger: 'cli',
    respectSchedule,
    headed,
    slowMo,
    allowConcurrentRun: true,
  });
  report(summary);
}

function report(summary) {
  if (summary.skipped) {
    console.log(`Skipped: ${summary.reason}`);
    return;
  }
  console.log(`\n  Run ${summary.runId}`);
  console.log(`  ${summary.ok}/${summary.total} succeeded in ${(summary.durationMs / 1000).toFixed(1)}s\n`);
  for (const r of summary.results ?? []) {
    console.log(
      r.ok
        ? `  OK    ${r.productName} -- ₹${r.price} | ${r.inStock ? 'in stock' : 'OUT OF STOCK'}` +
          ` (${r.stockQty ?? '?'}) | ${r.status} after ${r.attempts} attempt(s)`
        : `  FAIL  ${r.productName} -- ${r.errorCode}: ${String(r.errorMessage).slice(0, 90)}`
    );
  }
  console.log('');
}

process.exit(0);
