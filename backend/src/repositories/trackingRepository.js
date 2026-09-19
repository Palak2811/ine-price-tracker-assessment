/**
 * Tracked products, price history, scrape logs, runs and alerts.
 *
 * The write paths here enforce the assignment's central rule: a failed scrape
 * must never produce a price_history row and must never overwrite the last
 * known good price on tracked_products.
 */

import { supabase, unwrap } from './supabaseClient.js';

const TRACKED_FIELDS = `
  id, product_id, product_slug, product_name, product_url, is_active,
  scrape_interval_minutes, last_price, last_currency, last_in_stock,
  last_stock_qty, last_success_at, last_attempt_at, last_status, last_error,
  consecutive_failures, created_at, updated_at
`;

// ---------------------------------------------------------------------------
// tracked_products
// ---------------------------------------------------------------------------

export async function listTrackedProducts({ includeInactive = false } = {}) {
  let q = supabase.from('tracked_products').select(TRACKED_FIELDS);
  if (!includeInactive) q = q.eq('is_active', true);
  return unwrap(await q.order('created_at', { ascending: false }), 'listTrackedProducts');
}

export async function getTrackedProduct(id) {
  return unwrap(
    await supabase.from('tracked_products').select(TRACKED_FIELDS).eq('id', id).maybeSingle(),
    'getTrackedProduct'
  );
}

export async function getTrackedByProductId(productId) {
  return unwrap(
    await supabase.from('tracked_products').select(TRACKED_FIELDS).eq('product_id', productId).maybeSingle(),
    'getTrackedByProductId'
  );
}

export async function createTrackedProduct(row) {
  return unwrap(
    await supabase.from('tracked_products').insert(row).select(TRACKED_FIELDS).single(),
    'createTrackedProduct'
  );
}

export async function updateTrackedProduct(id, patch) {
  return unwrap(
    await supabase.from('tracked_products').update(patch).eq('id', id).select(TRACKED_FIELDS).single(),
    'updateTrackedProduct'
  );
}

export async function deleteTrackedProduct(id) {
  const result = await supabase.from('tracked_products').delete().eq('id', id).select('id');
  return unwrap(result, 'deleteTrackedProduct').length > 0;
}

/**
 * Products that are due for a scheduled scrape.
 *
 * Honouring each product's own interval (default 120 minutes) means a cron that
 * fires slightly early, or fires twice because the service retried the webhook,
 * does not produce duplicate history rows.
 */
export async function listProductsDueForScrape({ now = new Date() } = {}) {
  const active = await listTrackedProducts();
  return active.filter((p) => {
    if (!p.last_attempt_at) return true;
    const elapsedMin = (now.getTime() - new Date(p.last_attempt_at).getTime()) / 60000;
    return elapsedMin >= (p.scrape_interval_minutes ?? 120);
  });
}

// ---------------------------------------------------------------------------
// price_history -- successes only
// ---------------------------------------------------------------------------

export async function insertPriceHistory(row) {
  return unwrap(
    await supabase.from('price_history').insert(row).select('id, scraped_at').single(),
    'insertPriceHistory'
  );
}

export async function getPriceHistory(trackedProductId, { limit = 500, since = null } = {}) {
  let q = supabase
    .from('price_history')
    .select('id, price, currency, mrp, in_stock, stock_qty, scraped_at')
    .eq('tracked_product_id', trackedProductId);

  if (since) q = q.gte('scraped_at', since);

  // Newest first for the table; the chart reverses it.
  return unwrap(
    await q.order('scraped_at', { ascending: false }).limit(Math.min(limit, 2000)),
    'getPriceHistory'
  );
}

export async function getLatestPricePoint(trackedProductId) {
  return unwrap(
    await supabase
      .from('price_history')
      .select('price, in_stock, stock_qty, scraped_at')
      .eq('tracked_product_id', trackedProductId)
      .order('scraped_at', { ascending: false })
      .limit(1)
      .maybeSingle(),
    'getLatestPricePoint'
  );
}

// ---------------------------------------------------------------------------
// scrape_logs -- every attempt, including failures
// ---------------------------------------------------------------------------

export async function insertScrapeLog(row) {
  return unwrap(
    await supabase.from('scrape_logs').insert(row).select('id').single(),
    'insertScrapeLog'
  );
}

export async function getScrapeLogs(trackedProductId, { limit = 100, status = null } = {}) {
  let q = supabase
    .from('scrape_logs')
    .select(`
      id, run_id, attempt, status, error_code, error_message, http_status,
      duration_ms, scraped_price, scraped_in_stock, scraped_stock_qty,
      structure_warning, layout_revision, started_at, completed_at
    `)
    .eq('tracked_product_id', trackedProductId);

  if (status) q = q.eq('status', status);

  return unwrap(
    await q.order('started_at', { ascending: false }).limit(Math.min(limit, 500)),
    'getScrapeLogs'
  );
}

// ---------------------------------------------------------------------------
// scrape_runs
// ---------------------------------------------------------------------------

export async function createScrapeRun(trigger) {
  return unwrap(
    await supabase.from('scrape_runs').insert({ trigger }).select('id, started_at').single(),
    'createScrapeRun'
  );
}

export async function completeScrapeRun(id, summary) {
  return unwrap(
    await supabase
      .from('scrape_runs')
      .update({ ...summary, completed_at: new Date().toISOString() })
      .eq('id', id)
      .select('id')
      .single(),
    'completeScrapeRun'
  );
}

export async function listScrapeRuns({ limit = 20 } = {}) {
  return unwrap(
    await supabase
      .from('scrape_runs')
      .select('*')
      .order('started_at', { ascending: false })
      .limit(Math.min(limit, 100)),
    'listScrapeRuns'
  );
}

/**
 * Is a run already in flight?
 *
 * Guards against a duplicate cron invocation or a manual scrape overlapping the
 * scheduled one. Anything older than the stale window is treated as a crashed
 * run rather than blocking scrapes forever.
 */
export async function findRunningScrapeRun({ staleAfterMinutes = 20 } = {}) {
  const cutoff = new Date(Date.now() - staleAfterMinutes * 60000).toISOString();
  const rows = unwrap(
    await supabase
      .from('scrape_runs')
      .select('id, trigger, started_at')
      .is('completed_at', null)
      .gte('started_at', cutoff)
      .order('started_at', { ascending: false })
      .limit(1),
    'findRunningScrapeRun'
  );
  return rows[0] ?? null;
}

// ---------------------------------------------------------------------------
// alerts (bonus)
// ---------------------------------------------------------------------------

export async function insertAlert(row) {
  return unwrap(await supabase.from('alerts').insert(row).select('id').single(), 'insertAlert');
}

export async function listAlerts({ limit = 50, unacknowledgedOnly = false } = {}) {
  let q = supabase
    .from('alerts')
    .select('id, tracked_product_id, kind, message, old_price, new_price, acknowledged, created_at');
  if (unacknowledgedOnly) q = q.eq('acknowledged', false);
  return unwrap(
    await q.order('created_at', { ascending: false }).limit(Math.min(limit, 200)),
    'listAlerts'
  );
}
