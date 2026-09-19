/**
 * Route table.
 *
 * Routes stay thin: they validate nothing themselves and contain no business
 * logic, they only map a path to a controller and attach middleware.
 */

import { Router } from 'express';
import * as products from '../controllers/productController.js';
import * as tracked from '../controllers/trackedProductController.js';
import * as cron from '../controllers/cronController.js';
import { asyncHandler } from '../middleware/errorHandler.js';
import { cronAuth } from '../middleware/cronAuth.js';
import { rateLimit } from '../middleware/rateLimit.js';

export const router = Router();

// ---- catalogue -------------------------------------------------------------
router.get('/products/search', asyncHandler(products.search));
router.get('/products/stats', asyncHandler(products.stats));
router.get('/products/:id', asyncHandler(products.getOne));

// ---- tracked products ------------------------------------------------------
router.get('/tracked-products', asyncHandler(tracked.list));
router.post('/tracked-products', asyncHandler(tracked.create));
router.get('/tracked-products/:id', asyncHandler(tracked.getOne));
router.delete('/tracked-products/:id', asyncHandler(tracked.remove));
router.patch('/tracked-products/:id/interval', asyncHandler(tracked.updateInterval));
router.get('/tracked-products/:id/history', asyncHandler(tracked.history));
router.get('/tracked-products/:id/logs', asyncHandler(tracked.logs));

// Manual scrape drives a real browser, so it is rate limited even though it is
// otherwise an ordinary user action.
router.post(
  '/tracked-products/:id/scrape',
  rateLimit({ windowMs: 60_000, max: 5, key: 'manual-scrape' }),
  asyncHandler(tracked.scrapeNow)
);

// ---- scheduled (external cron) ---------------------------------------------
router.post('/cron/scrape', cronAuth, asyncHandler(cron.scrape));
router.post('/cron/sync-catalog', cronAuth, asyncHandler(cron.syncCatalogue));
router.get('/cron/runs', cronAuth, asyncHandler(cron.runs));
