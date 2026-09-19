import { useEffect, useState, useCallback } from 'react';
import { Link } from 'react-router-dom';
import { api } from '../lib/api.js';
import { formatPrice, formatDateTime, formatDuration } from '../lib/format.js';
import StatusBadge, { TriggerLabel } from '../components/StatusBadge.jsx';
import { Loading, ErrorState } from '../components/States.jsx';

export default function Activity() {
  const [state, setState] = useState({ status: 'loading', rows: [], error: null });
  const [filter, setFilter] = useState('all'); 

  const load = useCallback(async () => {
    setState((s) => ({ ...s, status: 'loading' }));
    try {
      const { items } = await api.listTracked();

      const details = await Promise.all(
        items.map(async (p) => {
          try {
            const d = await api.getTracked(p.id);
            return d.logs.map((l) => ({ ...l, productName: p.name, trackedId: p.id }));
          } catch {
            return [];
          }
        })
      );

      const rows = details
        .flat()
        .sort((a, b) => new Date(b.startedAt) - new Date(a.startedAt))
        .slice(0, 200);

      setState({ status: 'ready', rows, error: null });
    } catch (error) {
      setState({ status: 'error', rows: [], error });
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  if (state.status === 'loading') return <Loading label="Collecting scrape logs…" />;
  if (state.status === 'error') return <ErrorState error={state.error} onRetry={load} />;

  const { rows } = state;

  if (!rows.length) {
    return (
      <div className="panel">
        <div className="empty">
          <h3>No scrape attempts recorded</h3>
          <p>Attempts appear here as soon as a product is scraped.</p>
          <Link className="btn btn-primary" to="/products">Track a product</Link>
        </div>
      </div>
    );
  }

  const failed = rows.filter((r) => r.status === 'failed');
  const succeeded = rows.filter((r) => r.status === 'success');
  const visible = filter === 'all' ? rows : rows.filter((r) => r.status === filter);

  const successRate = rows.length
    ? ((succeeded.length / rows.length) * 100).toFixed(0)
    : null;

  return (
    <>
      <div className="stat-row">
        <div className="stat">
          <div className="k">Attempts shown</div>
          <div className="v">{rows.length}</div>
        </div>
        <div className="stat">
          <div className="k">Succeeded</div>
          <div className="v">{succeeded.length}<small>· {successRate}%</small></div>
        </div>
        <div className="stat">
          <div className="k">Failed</div>
          <div className={`v${failed.length ? ' is-fail' : ''}`}>{failed.length}</div>
        </div>
      </div>

      <div className="toolbar">
        <div className="seg">
          <button type="button" aria-pressed={filter === 'all'} onClick={() => setFilter('all')}>All</button>
          <button type="button" aria-pressed={filter === 'success'} onClick={() => setFilter('success')}>Success</button>
          <button type="button" aria-pressed={filter === 'failed'} onClick={() => setFilter('failed')}>Failed</button>
        </div>
        <span className="grow" />
        <button className="btn btn-quiet btn-xs" onClick={load}>Refresh</button>
      </div>

      <div className="panel">
        <div className="table-scroll">
          <table className="data">
            <thead>
              <tr>
                <th>When</th>
                <th>Product</th>
                <th>Source</th>
                <th>Result</th>
                <th className="opt num">Try</th>
                <th className="opt num">Took</th>
                <th className="num">Price</th>
                <th className="opt">Detail</th>
              </tr>
            </thead>
            <tbody>
              {visible.map((r) => (
                <tr key={`${r.trackedId}-${r.id}`} className={r.status === 'failed' ? 'row-failed' : undefined}>
                  <td className="nowrap" style={{ color: 'var(--text-secondary)' }}>
                    {formatDateTime(r.startedAt)}
                  </td>
                  <td>
                    <div className="cell-primary">
                      <Link to={`/product/${r.trackedId}`}>{r.productName}</Link>
                    </div>
                  </td>
                  <td><TriggerLabel trigger={r.trigger} /></td>
                  <td><StatusBadge status={r.status} /></td>
                  <td className="opt num" style={{ color: 'var(--text-muted)' }}>#{r.attempt}</td>
                  <td className="opt num" style={{ color: 'var(--text-muted)' }}>{formatDuration(r.durationMs)}</td>
                  <td className="num">
                    {r.price !== null
                      ? <span className="price" style={{ fontSize: 13.5 }}>{formatPrice(r.price)}</span>
                      : <span className="price-none">—</span>}
                  </td>
                  <td className="opt err-cell">
                    {r.errorCode && <div className="err-code">{r.errorCode}</div>}
                    {r.errorMessage && <div className="err-msg">{r.errorMessage.slice(0, 150)}</div>}
                    {r.structureWarning && (
                      <div className="err-msg" style={{ color: 'var(--warn)' }}>{r.structureWarning}</div>
                    )}
                    {!r.errorCode && !r.structureWarning && <span style={{ color: 'var(--text-muted)' }}>—</span>}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        {visible.length === 0 && (
          <div className="empty" style={{ padding: '28px 20px' }}>
            <p style={{ margin: 0 }}>No {filter} attempts in the recent log.</p>
          </div>
        )}
      </div>

      <p style={{ color: 'var(--text-muted)', fontSize: 12.5, marginTop: 10 }}>
        Showing the {rows.length} most recent attempts, merged from each product&rsquo;s log.
        Failed attempts are kept exactly as recorded — a product that succeeded on its third
        try still shows the two failures that preceded it.
      </p>
    </>
  );
}
