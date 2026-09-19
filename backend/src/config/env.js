/**
 * Environment configuration with fail-fast validation.
 *
 * Reading process.env directly all over the codebase makes it easy to ship a
 * deploy that only discovers a missing secret when the first cron fires at 2am.
 * This validates once at boot and refuses to start if something required is
 * absent, so a misconfigured Render deploy fails loudly and immediately.
 */

import { readFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

/** Minimal .env loader so local dev needs no extra dependency. */
function loadDotEnv() {
  const here = dirname(fileURLToPath(import.meta.url));
  const envPath = resolve(here, '../../.env');
  let raw;
  try {
    raw = readFileSync(envPath, 'utf8');
  } catch {
    return; // no .env in production -- Render injects real env vars
  }
  for (const line of raw.split('\n')) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const eq = trimmed.indexOf('=');
    if (eq === -1) continue;
    const key = trimmed.slice(0, eq).trim();
    const value = trimmed.slice(eq + 1).trim().replace(/^["']|["']$/g, '');
    if (!(key in process.env)) process.env[key] = value;
  }
}

loadDotEnv();

const required = (name) => {
  const value = process.env[name];
  if (!value || !value.trim()) {
    throw new Error(
      `Missing required environment variable ${name}. ` +
      `Copy backend/.env.example to backend/.env and fill it in.`
    );
  }
  return value.trim();
};

const optional = (name, fallback) => {
  const value = process.env[name];
  return value && value.trim() ? value.trim() : fallback;
};

const asInt = (value, fallback) => {
  const n = Number.parseInt(value, 10);
  return Number.isFinite(n) ? n : fallback;
};

export const config = {
  nodeEnv: optional('NODE_ENV', 'development'),
  port: asInt(optional('PORT', '8080'), 8080),
  logLevel: optional('LOG_LEVEL', 'info'),

  supabaseUrl: required('SUPABASE_URL'),
  supabaseServiceRoleKey: required('SUPABASE_SERVICE_ROLE_KEY'),

  cronSecret: required('CRON_SECRET'),

  corsOrigins: optional('CORS_ORIGINS', 'http://localhost:5173')
    .split(',')
    .map((o) => o.trim())
    .filter(Boolean),

  scrapeConcurrency: Math.max(1, Math.min(5, asInt(optional('SCRAPE_CONCURRENCY', '2'), 2))),

  get isProduction() {
    return this.nodeEnv === 'production';
  },
};

/**
 * A cron secret that is short or left at an example value is worse than none,
 * because it creates the illusion of protection on an endpoint that drives a
 * browser. Refuse to boot in production with a weak one.
 */
if (config.isProduction && config.cronSecret.length < 24) {
  throw new Error('CRON_SECRET must be at least 24 characters in production');
}
