/**
 * Scrape status badge.
 *
 * Status is never communicated by colour alone: each badge carries a glyph and
 * a word, so it survives colour-vision deficiency and greyscale printing.
 */
export default function StatusBadge({ status, compact = false }) {
  const map = {
    success: { cls: 'badge-good', icon: '✓', label: 'Success' },
    retried: { cls: 'badge-warning', icon: '↻', label: 'Retried' },
    failed: { cls: 'badge-critical', icon: '✕', label: 'Failed' },
  };
  const s = map[status] ?? { cls: 'badge-neutral', icon: '•', label: 'Never run' };
  return (
    <span className={`badge ${s.cls}`} title={`Latest scrape: ${s.label}`}>
      <span aria-hidden="true">{s.icon}</span>{compact ? null : s.label}
    </span>
  );
}

export function StockBadge({ inStock, qty }) {
  if (inStock === null || inStock === undefined) {
    return <span className="badge badge-neutral"><span aria-hidden="true">•</span>Unknown</span>;
  }
  return inStock
    ? <span className="badge badge-good"><span aria-hidden="true">✓</span>In stock{qty != null ? ` · ${qty}` : ''}</span>
    : <span className="badge badge-critical"><span aria-hidden="true">✕</span>Out of stock</span>;
}
