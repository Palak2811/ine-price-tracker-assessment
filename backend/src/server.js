import express from 'express';
import cors from 'cors';
import { config } from './config/env.js';
import { router } from './routes/index.js';
import { errorHandler, notFoundHandler } from './middleware/errorHandler.js';
import { pathToFileURL } from 'node:url';
import { logger } from './utils/logger.js';

export function createApp() {
  const app = express();

  app.set('trust proxy', 1);
  app.disable('x-powered-by');

  app.use(express.json({ limit: '100kb' }));

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

  app.get('/health', (req, res) => {
    res.json({ ok: true, service: 'ine-price-tracker', uptimeSec: Math.round(process.uptime()) });
  });

  app.use('/api', router);

  app.use(notFoundHandler);
  app.use(errorHandler);

  return app;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const app = createApp();
  app.listen(config.port, () => {
    logger.info(
      { port: config.port, env: config.nodeEnv, corsOrigins: config.corsOrigins },
      'server listening'
    );
  });
}
