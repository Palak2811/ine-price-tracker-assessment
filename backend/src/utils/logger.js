const LEVELS = { debug: 10, info: 20, warn: 30, error: 40, silent: 99 };

const configuredLevel = () => {
  const raw = (process.env.LOG_LEVEL || 'info').toLowerCase();
  return LEVELS[raw] ?? LEVELS.info;
};

const SECRET_KEY_RE = /(secret|token|key|password|authorization|apikey)/i;

function redact(value, depth = 0) {
  if (depth > 4 || value === null || typeof value !== 'object') return value;
  if (Array.isArray(value)) return value.map((v) => redact(v, depth + 1));

  const out = {};
  for (const [k, v] of Object.entries(value)) {
    if (SECRET_KEY_RE.test(k)) {
      out[k] = '[redacted]';
    } else if (v instanceof Error) {
      out[k] = { name: v.name, message: v.message, code: v.code };
    } else {
      out[k] = redact(v, depth + 1);
    }
  }
  return out;
}

function emit(level, context, message) {
  if (LEVELS[level] < configuredLevel()) return;

  if (typeof context === 'string' && message === undefined) {
    message = context;
    context = {};
  }

  const line = {
    ts: new Date().toISOString(),
    level,
    msg: message,
    ...redact(context || {}),
  };

  const stream = level === 'error' || level === 'warn' ? process.stderr : process.stdout;
  stream.write(JSON.stringify(line) + '\n');
}

export const logger = {
  debug: (ctx, msg) => emit('debug', ctx, msg),
  info: (ctx, msg) => emit('info', ctx, msg),
  warn: (ctx, msg) => emit('warn', ctx, msg),
  error: (ctx, msg) => emit('error', ctx, msg),
  child(fixed) {
    const wrap = (level) => (ctx, msg) => {
      if (typeof ctx === 'string') return emit(level, fixed, ctx);
      return emit(level, { ...fixed, ...(ctx || {}) }, msg);
    };
    return {
      debug: wrap('debug'), info: wrap('info'),
      warn: wrap('warn'), error: wrap('error'),
      child: (more) => logger.child({ ...fixed, ...more }),
    };
  },
};
