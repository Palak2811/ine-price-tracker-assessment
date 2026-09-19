import { timingSafeEqual } from 'node:crypto';
import { config } from '../config/env.js';
import { ApiError } from '../utils/ApiError.js';
import { logger } from '../utils/logger.js';

function secretMatches(provided) {
  const a = Buffer.from(String(provided), 'utf8');
  const b = Buffer.from(config.cronSecret, 'utf8');
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
    logger.warn({ ip: req.ip, path: req.path }, 'cron request with invalid secret');
    return next(ApiError.unauthorized('Invalid cron credentials'));
  }

  return next();
}
