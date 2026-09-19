/** Catalogue search + browse. */

import { searchProducts, getProductById, countProducts } from '../repositories/productRepository.js';
import { requireSearchQuery, parseLimit, parseProductId } from '../middleware/validate.js';
import { ApiError } from '../utils/ApiError.js';

export async function search(req, res) {
  const q = requireSearchQuery(req);
  const limit = parseLimit(req.query.limit, { fallback: 20, max: 50 });
  const items = await searchProducts(q, { limit });
  res.json({ query: q, count: items.length, items });
}

export async function getOne(req, res) {
  const id = parseProductId(req.params.id);
  const product = await getProductById(id);
  if (!product) throw ApiError.notFound(`No product with id ${id}`);
  res.json(product);
}

export async function stats(req, res) {
  res.json({ catalogueSize: await countProducts() });
}
