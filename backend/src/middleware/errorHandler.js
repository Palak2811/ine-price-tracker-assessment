/** Centralised error handling + 404 fallback. */

import { ApiError } from '../utils/ApiError.js';
import { logger } from '../utils/logger.js';
import { config } from '../config/env.js';

export function notFoundHandler(req, res) {
  res.status(404).json({
    error: { code: 'route_not_found', message: `No route for ${req.method} ${req.path}` },
  });
}

// Express identifies error middleware by arity, so `next` must stay.
// eslint-disable-next-line no-unused-vars
export function errorHandler(err, req, res, next) {
  if (err instanceof ApiError) {
    logger.warn(
      { path: req.path, method: req.method, code: err.code, status: err.status },
      err.message
    );
    return res.status(err.status).json({
      error: { code: err.code, message: err.message, details: err.details ?? undefined },
    });
  }

  // Unexpected: log everything, tell the client nothing specific.
  logger.error(
    { path: req.path, method: req.method, stack: err.stack },
    `unhandled error: ${err.message}`
  );

  res.status(500).json({
    error: {
      code: 'internal_error',
      message: 'An unexpected error occurred',
      // Only in development, and never the stack.
      ...(config.isProduction ? {} : { debug: err.message }),
    },
  });
}

/** Wraps an async route so rejected promises reach the error handler. */
export function asyncHandler(fn) {
  return (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);
}
