/** Shared formatting helpers. */

export const formatPrice = (value, currency = 'INR') => {
  if (value === null || value === undefined) return '—';
  return new Intl.NumberFormat('en-IN', {
    style: 'currency', currency, maximumFractionDigits: 0,
  }).format(value);
};

/** Compact price for chart axes, e.g. ₹1.3L. */
export const formatPriceShort = (value) => {
  if (value === null || value === undefined) return '';
  if (value >= 10_000_000) return `₹${(value / 10_000_000).toFixed(1)}Cr`;
  if (value >= 100_000) return `₹${(value / 100_000).toFixed(1)}L`;
  if (value >= 1_000) return `₹${(value / 1_000).toFixed(1)}k`;
  return `₹${value}`;
};

export const formatDateTime = (iso) => {
  if (!iso) return '—';
  return new Date(iso).toLocaleString('en-IN', {
    day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit',
  });
};

export const formatRelative = (iso) => {
  if (!iso) return 'never';
  const diffMs = Date.now() - new Date(iso).getTime();
  const mins = Math.round(diffMs / 60000);
  if (mins < 1) return 'just now';
  if (mins < 60) return `${mins}m ago`;
  const hours = Math.round(mins / 60);
  if (hours < 24) return `${hours}h ago`;
  return `${Math.round(hours / 24)}d ago`;
};

export const formatDuration = (ms) => {
  if (ms === null || ms === undefined) return '—';
  return ms < 1000 ? `${ms}ms` : `${(ms / 1000).toFixed(1)}s`;
};
