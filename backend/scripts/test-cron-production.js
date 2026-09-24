import { argv, env, exit } from 'node:process';

const args = argv.slice(2);
const flag = (name, fallback = null) => {
  const hit = args.find((a) => a.startsWith(`--${name}=`));
  return hit ? hit.slice(name.length + 3) : fallback;
};

const base = (flag('url') ?? env.CRON_TEST_URL ?? '').replace(/\/$/, '');
const secret = flag('secret') ?? env.CRON_SECRET ?? '';
const path = flag('path', '/api/cron/scrape');
const method = flag('method', 'POST').toUpperCase();

if (!base) {
  console.error('Usage: node scripts/test-cron-production.js --url=https://<service>.onrender.com [--secret=...] [--path=/api/cron/scrape] [--method=POST]');
  exit(2);
}

const target = `${base}${path}`;

console.log('Target   :', target);
console.log('Method   :', method);
console.log('Secret   :', secret ? `provided (${secret.length} chars)` : 'NOT PROVIDED');
console.log('');

async function probe(label, url, init = {}) {
  const startedAt = Date.now();
  let res;
  try {
    res = await fetch(url, init);
  } catch (err) {
    console.log(`${label}\n  NETWORK ERROR after ${Date.now() - startedAt}ms: ${err.message}\n`);
    return null;
  }

  const body = await res.text();
  const ms = Date.now() - startedAt;
  const bytes = Buffer.byteLength(body, 'utf8');
  const type = res.headers.get('content-type') ?? '(none)';

  let jsonOk = true;
  try { JSON.parse(body); } catch { jsonOk = false; }

  console.log(label);
  console.log(`  status        : ${res.status} ${res.statusText}`);
  console.log(`  content-type  : ${type}`);
  console.log(`  bytes         : ${bytes}`);
  console.log(`  duration      : ${ms}ms`);
  console.log(`  valid JSON    : ${jsonOk ? 'yes' : 'NO - likely an HTML error page'}`);
  console.log(`  body          : ${body.slice(0, 200)}${body.length > 200 ? ' …' : ''}`);

  if (bytes > 1024) console.log('  WARNING       : over 1KB - cron-job.org may reject this as "output too large"');
  if (ms > 30_000) console.log('  WARNING       : over 30s - cron-job.org will time out');
  if (!jsonOk) console.log('  WARNING       : non-JSON response - the request may not be reaching the app');
  console.log('');

  return { status: res.status, bytes, ms, jsonOk };
}

await probe('[1] health (no auth)', `${base}/health`);

await probe('[2] cron WITHOUT secret (expect 401)', target, { method });

if (secret) {
  await probe('[3] cron WITH secret', target, {
    method,
    headers: { Authorization: `Bearer ${secret}` },
  });
}

console.log('Note: a scrape started by this call continues in the background.');
console.log('Check results with: GET /api/cron/runs (requires the same secret).');
