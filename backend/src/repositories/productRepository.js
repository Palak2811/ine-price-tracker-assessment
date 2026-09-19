/**
 * Catalogue cache access: the store's 1000 products, without price or stock.
 */

import { supabase, unwrap } from './supabaseClient.js';

/**
 * Partial or full name search.
 *
 * The store offers no search endpoint -- only a paginated catalogue -- so we
 * mirror the catalogue locally and search it here. That keeps typeahead fast
 * and avoids hammering the store with a request per keystroke.
 *
 * The `%` and `_` wildcards are escaped so a user typing "100%" searches for
 * that literal string instead of matching everything.
 */
export async function searchProducts(query, { limit = 20 } = {}) {
  const term = String(query || '').trim();
  if (!term) return [];

  const escaped = term.replace(/[\\%_]/g, (c) => `\\${c}`);

  const result = await supabase
    .from('products')
    .select('id, slug, name, brand, category, sku')
    // Match the name, the brand, or the SKU so "LAR-10325" also finds it.
    .or(`name.ilike.%${escaped}%,brand.ilike.%${escaped}%,sku.ilike.%${escaped}%`)
    .order('name', { ascending: true })
    .limit(Math.min(Math.max(limit, 1), 50));

  return unwrap(result, 'searchProducts');
}

export async function getProductById(id) {
  const result = await supabase
    .from('products')
    .select('id, slug, name, brand, category, sku, description')
    .eq('id', id)
    .maybeSingle();

  return unwrap(result, 'getProductById');
}

export async function countProducts() {
  const { count, error } = await supabase
    .from('products')
    .select('id', { count: 'exact', head: true });
  if (error) throw new Error(`countProducts: ${error.message}`);
  return count ?? 0;
}

/** Bulk upsert used by the catalogue sync script. */
export async function upsertProducts(rows) {
  if (!rows.length) return 0;
  const result = await supabase
    .from('products')
    .upsert(rows, { onConflict: 'id' })
    .select('id');
  return unwrap(result, 'upsertProducts').length;
}
