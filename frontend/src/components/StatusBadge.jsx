const STATUS = {
  success: { cls: 'status-ok', label: 'Success' },
  retried: { cls: 'status-retried', label: 'Retried' },
  failed: { cls: 'status-failed', label: 'Failed' },
};

export default function StatusBadge({ status }) {
  const s = STATUS[status] ?? { cls: 'status-none', label: 'Not run' };
  return (
    <span className={`status ${s.cls}`}>
      <span className="dot" aria-hidden="true" />
      {s.label}
    </span>
  );
}

const TRIGGERS = {
  cron: { label: 'Scheduled', title: 'Triggered by the external cron service' },
  manual: { label: 'Manual', title: 'Triggered from the dashboard' },
  cli: { label: 'CLI', title: 'Triggered from the command line' },
};

export function TriggerLabel({ trigger }) {
  const t = TRIGGERS[trigger];
  if (!t) return <span style={{ color: 'var(--text-muted)' }}>—</span>;
  return (
    <span style={{ color: 'var(--text-secondary)', fontSize: 13 }} title={t.title}>
      {t.label}
    </span>
  );
}

export function StockBadge({ inStock, qty }) {
  if (inStock === null || inStock === undefined) {
    return (
      <span className="stock stock-unknown">
        <span className="bar" aria-hidden="true" />
        Unknown
      </span>
    );
  }

  if (!inStock) {
    return (
      <span className="stock stock-out">
        <span className="bar" aria-hidden="true" />
        Out of stock
      </span>
    );
  }

  return (
    <span className="stock stock-in">
      <span className="bar" aria-hidden="true" />
      In stock{qty != null ? ` · ${qty}` : ''}
    </span>
  );
}
