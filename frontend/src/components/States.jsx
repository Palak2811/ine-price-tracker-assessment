export function Loading({ rows = 3, label = 'Loading…' }) {
  return (
    <div aria-live="polite" aria-busy="true">
      <p style={{ color: 'var(--text-muted)', fontSize: 13, margin: '0 0 10px' }}>{label}</p>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
        {Array.from({ length: rows }, (_, i) => (
          <div key={i} className="skeleton" style={{ height: 46 }} />
        ))}
      </div>
    </div>
  );
}

export function ErrorState({ error, onRetry }) {
  const isNetwork = error?.code === 'network_error';

  return (
    <div className="note note-fail" role="alert">
      <span className="mark" aria-hidden="true">!</span>
      <div style={{ flex: 1 }}>
        <strong>{isNetwork ? 'Cannot reach the backend.' : 'Something went wrong.'}</strong>{' '}
        {error?.message ?? 'Unknown error'}
        {onRetry && (
          <div style={{ marginTop: 9 }}>
            <button className="btn btn-xs" onClick={onRetry}>Try again</button>
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
