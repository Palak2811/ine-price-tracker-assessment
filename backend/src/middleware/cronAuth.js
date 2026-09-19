/**
 * Authenticates requests to the scheduled-scrape endpoint.
 *
 * The endpoint drives real browsers, so leaving it open would be a free
 * denial-of-wallet and a way for anyone to hammer the mock store through us.
 *
 * The secret may arrive either as `Authorization: Bearer <secret>` or as an
 * `X-Cron-Secret` header, because cron-job.org can send custom headers but the
 * Authorization form is easier to configure elsewhere.
 *
 * The secret is deliberately NOT accepted as a query parameter: query strings
 * end up in access logs and browser history.
 */

import { timingSafeEqual } from 'node:crypto';
import { config } from '../config/env.js';
import { ApiError } from '../utils/ApiError.js';
import { logger } from '../utils/logger.js';

/**
 * Constant-time comparison, so an attacker cannot recover the secret by timing
 * how long a wrong guess takes to reject.
 */
function secretMatches(provided) {
  const a = Buffer.from(String(provided), 'utf8');
  const b = Buffer.from(config.cronSecret, 'utf8');
  // timingSafeEqual throws on length mismatch, so compare lengths separately.
  if (a.length !== b.length) return false;
  return timingSafeEqual(a, b);
}

export function cronAuth(req, res, next) {
  const authHeader = req.get('authorization') ?? '';
  const bearer = authHeader.toLowerCase().startsWith('bearer ')
    ? authHeader.slice(7).trim()
    : null;
  const provided = bearer ?? req.get('x-cron-secret');

  if (!provided) {
    logger.warn({ ip: req.ip, path: req.path }, 'cron request with no credentials');
    return next(ApiError.unauthorized('Missing cron credentials'));
  }

  if (!secretMatches(provided)) {
    // Never log the provided value -- it would put a guess (or the real secret)
    // into the logs.
    logger.warn({ ip: req.ip, path: req.path }, 'cron request with invalid secret');
    return next(ApiError.unauthorized('Invalid cron credentials'));
  }

  return next();
}
