import { syncCatalog } from '../src/services/catalogService.js';

const r = await syncCatalog();
console.log(
  `Catalogue synced: ${r.total}/${r.expected || '?'} products present ` +
  `(${r.requests} requests, ${(r.durationMs / 1000).toFixed(1)}s)`
);
process.exit(r.expected && r.total < r.expected ? 1 : 0);
