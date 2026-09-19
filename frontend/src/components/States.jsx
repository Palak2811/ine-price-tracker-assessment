/** Loading / error / empty states, shared across pages. */

export function Loading({ rows = 3, label = 'Loading…' }) {
  return (
    <div aria-live="polite" aria-busy="true">
      <span className="muted" style={{ fontSize: '.85rem' }}>{label}</span>
      <div className="stack" style={{ marginTop: 10 }}>
        {Array.from({ length: rows }, (_, i) => (
          <div key={i} className="skeleton" style={{ height: 72 }} />
        ))}
      </div>
    </div>
  );
}

export function ErrorState({ error, onRetry }) {
  return (
    <div className="alert alert-error" role="alert">
      <span aria-hidden="true">✕</span>
      <div style={{ flex: 1 }}>
        <strong>Something went wrong.</strong>{' '}
        {error?.message ?? 'Unknown error'}
        {onRetry && (
          <div style={{ marginTop: 10 }}>
            <button className="btn btn-sm" onClick={onRetry}>Try again</button>
          </div>
        )}
      </div>
    </div>
  );
}

export function Empty({ title, children }) {
  return (
    <div className="empty">
      <h3>{title}</h3>
      {children}
    </div>
  );
}
