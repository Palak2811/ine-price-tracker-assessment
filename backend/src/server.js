/** Express application entry point. */

import express from 'express';
import cors from 'cors';
import { config } from './config/env.js';
import { router } from './routes/index.js';
import { errorHandler, notFoundHandler } from './middleware/errorHandler.js';
import { pathToFileURL } from 'node:url';
import { logger } from './utils/logger.js';

export function createApp() {
  const app = express();

  // Render terminates TLS upstream, so req.ip must come from X-Forwarded-For
  // for the rate limiter to see real client addresses.
  app.set('trust proxy', 1);
  app.disable('x-powered-by');

  app.use(express.json({ limit: '100kb' }));

  /**
   * CORS is an explicit allow-list from CORS_ORIGINS, not a wildcard.
   *
   * Requests with no Origin header (cron services, curl, health checks) are
   * allowed through: CORS is a browser protection, and blocking them would
   * break the scheduled trigger.
   */
  app.use(cors({
    origin(origin, callback) {
      if (!origin) return callback(null, true);
      if (config.corsOrigins.includes(origin)) return callback(null, true);
      logger.warn({ origin }, 'blocked CORS origin');
      return callback(new Error('Not allowed by CORS'));
    },
    methods: ['GET', 'POST', 'PATCH', 'DELETE', 'OPTIONS'],
    allowedHeaders: ['Content-Type', 'Authorization', 'X-Cron-Secret'],
    maxAge: 86400,
  }));

  // Health check. Kept dependency-free and outside /api so an external pinger
  // can keep the free-tier instance warm without touching the database.
  app.get('/health', (req, res) => {
    res.json({ ok: true, service: 'ine-price-tracker', uptimeSec: Math.round(process.uptime()) });
  });

  app.use('/api', router);

  app.use(notFoundHandler);
  app.use(errorHandler);

  return app;
}

// Start only when run directly, so tests can import createApp() without
// binding a port.
//
// pathToFileURL is used rather than string-building a file:// URL: on Windows
// import.meta.url is "file:///E:/..." (three slashes) while a hand-built
// "file://E:/..." has two, so the naive comparison silently never matched and
// the server booted without ever calling listen().
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const app = createApp();
  app.listen(config.port, () => {
    logger.info(
      { port: config.port, env: config.nodeEnv, corsOrigins: config.corsOrigins },
      'server listening'
    );
  });
}
