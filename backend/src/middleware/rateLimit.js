import { ApiError } from '../utils/ApiError.js';

const buckets = new Map();

export function rateLimit({ windowMs = 60_000, max = 10, key = 'default' } = {}) {
  return (req, res, next) => {
    const id = `${key}:${req.ip}`;
    const now = Date.now();
    const entry = buckets.get(id);

    if (!entry || now > entry.resetAt) {
      buckets.set(id, { count: 1, resetAt: now + windowMs });
      return next();
    }

    if (entry.count >= max) {
      const retryAfter = Math.ceil((entry.resetAt - now) / 1000);
      res.set('Retry-After', String(retryAfter));
      return next(new ApiError(429, 'rate_limited',
        `Too many requests. Try again in ${retryAfter}s.`));
    }

    entry.count++;
    next();
  };
}

setInterval(() => {
  const now = Date.now();
  for (const [id, entry] of buckets) if (now > entry.resetAt) buckets.delete(id);
}, 300_000).unref();
