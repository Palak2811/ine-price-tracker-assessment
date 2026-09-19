import { useEffect, useState, useCallback } from 'react';
import { Link } from 'react-router-dom';
import { api } from '../lib/api.js';
import { formatPrice, formatRelative } from '../lib/format.js';
import StatusBadge, { StockBadge } from '../components/StatusBadge.jsx';
import { Loading, ErrorState } from '../components/States.jsx';

export default function Dashboard({ onChange }) {
  const [state, setState] = useState({ status: 'loading', items: [], error: null });
  const [busy, setBusy] = useState({});
  const [filter, setFilter] = useState('all'); 

  const load = useCallback(async ({ quiet = false } = {}) => {
    if (!quiet) setState((s) => ({ ...s, status: s.items.length ? 'ready' : 'loading' }));
    try {
      const data = await api.listTracked();
      setState({ status: 'ready', items: data.items, error: null });
    } catch (error) {
      setState((s) => ({ status: s.items.length ? 'ready' : 'error', items: s.items, error }));
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  async function scrapeNow(id) {
    setBusy((b) => ({ ...b, [id]: true }));
    try {
      await api.scrapeNow(id);
      await load({ quiet: true });
      onChange?.();
    } catch (error) {
      setState((s) => ({ ...s, error }));
    } finally {
      setBusy((b) => ({ ...b, [id]: false }));
    }
  }

  if (state.status === 'loading') return <Loading label="Loading tracked products…" />;
  if (state.status === 'error') return <ErrorState error={state.error} onRetry={load} />;

  const { items } = state;

  if (!items.length) {
    return (
      <div className="panel">
        <div className="empty">
          <h3>Nothing tracked yet</h3>
          <p>Pick a product from the INE mock store to start recording its price and stock.</p>
          <Link className="btn btn-primary" to="/products">Find a product</Link>
        </div>
      </div>
    );
  }

  const failing = items.filter((p) => p.latestStatus === 'failed');
  const withPrice = items.filter((p) => p.lastPrice !== null);
  const outOfStock = items.filter((p) => p.inStock === false);
  const rows = filter === 'failing' ? failing : items;

  return (
    <>
      <div className="stat-row">
        <div className="stat">
          <div className="k">Tracked</div>
          <div className="v">{items.length}</div>
        </div>
        <div className="stat">
          <div className="k">With a price</div>
          <div className="v">{withPrice.length}<small>of {items.length}</small></div>
        </div>
        <div className="stat">
          <div className="k">Out of stock</div>
          <div className="v">{outOfStock.length}</div>
        </div>
        <div className="stat">
          <div className="k">Last scrape failed</div>
          <div className={`v${failing.length ? ' is-fail' : ''}`}>{failing.length}</div>
        </div>
      </div>

      {state.error && (
        <div className="note note-fail" style={{ marginBottom: 14 }} role="alert">
          <span className="mark" aria-hidden="true">!</span>
          <div>{state.error.message}</div>
        </div>
      )}

      <div className="toolbar">
        <div className="seg">
          <button type="button" aria-pressed={filter === 'all'} onClick={() => setFilter('all')}>
            All {items.length}
          </button>
          <button type="button" aria-pressed={filter === 'failing'} onClick={() => setFilter('failing')}>
            Failing {failing.length}
          </button>
        </div>
        <span className="grow" />
        <button className="btn btn-quiet btn-xs" onClick={() => load()}>Refresh</button>
        <Link className="btn btn-primary btn-xs" to="/products">Add product</Link>
      </div>

      <div className="panel">
        <div className="table-scroll">
          <table className="data">
            <thead>
              <tr>
                <th>Product</th>
                <th className="num">Price</th>
                <th>Stock</th>
                <th>Last scrape</th>
                <th className="opt">Last success</th>
                <th className="opt num">Every</th>
                <th className="num" aria-label="Actions" />
              </tr>
            </thead>
            <tbody>
              {rows.map((p) => (
                <tr key={p.id} className={p.latestStatus === 'failed' ? 'row-failed' : undefined}>
                  <td>
                    <div className="cell-primary">
                      <Link to={`/product/${p.id}`}>{p.name}</Link>
                    </div>
                    <div className="cell-sub">#{p.productId}</div>
                  </td>

                  <td className="num">
                    {p.lastPrice !== null ? (
                      <>
                        <div className={`price${p.showingStalePrice ? ' price-stale' : ''}`}>
                          {formatPrice(p.lastPrice, p.currency)}
                        </div>
                        
                        {p.showingStalePrice && <div className="cell-sub">last known</div>}
                      </>
                    ) : (
                      <span className="price-none">—</span>
                    )}
                  </td>

                  <td><StockBadge inStock={p.inStock} qty={p.stockQty} /></td>

                  <td>
                    <StatusBadge status={p.latestStatus} />
                    <div className="cell-sub">{formatRelative(p.lastAttemptAt)}</div>
                  </td>

                  <td className="opt nowrap">
                    <span style={{ color: 'var(--text-secondary)' }}>
                      {formatRelative(p.lastSuccessAt)}
                    </span>
                    {p.consecutiveFailures > 0 && (
                      <div className="cell-sub" style={{ color: 'var(--fail)' }}>
                        {p.consecutiveFailures} failed in a row
                      </div>
                    )}
                  </td>

                  <td className="opt num nowrap" style={{ color: 'var(--text-muted)' }}>
                    {p.scrapeIntervalMinutes >= 60
                      ? `${p.scrapeIntervalMinutes / 60}h`
                      : `${p.scrapeIntervalMinutes}m`}
                  </td>

                  <td className="num nowrap">
                    <button
                      className="btn btn-xs"
                      disabled={busy[p.id]}
                      onClick={() => scrapeNow(p.id)}
                    >
                      {busy[p.id] ? 'Scraping…' : 'Scrape'}
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        {rows.length === 0 && (
          <div className="empty" style={{ padding: '28px 20px' }}>
            <p style={{ margin: 0 }}>No products are currently failing.</p>
          </div>
        )}
      </div>

      <p style={{ color: 'var(--text-muted)', fontSize: 12.5, marginTop: 10 }}>
        A scrape runs roughly every 2 hours per product, triggered by an external cron service.
        Manual scrapes reset that product&rsquo;s timer.
      </p>
    </>
  );
}
