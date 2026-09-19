import { useEffect, useState, useCallback } from 'react';
import { useParams, Link, useNavigate } from 'react-router-dom';
import { api } from '../lib/api.js';
import { formatPrice, formatDateTime, formatRelative, formatDuration } from '../lib/format.js';
import StatusBadge, { StockBadge } from '../components/StatusBadge.jsx';
import PriceChart, { StockTimeline } from '../components/PriceChart.jsx';
import { Loading, ErrorState } from '../components/States.jsx';

export default function ProductDetail() {
  const { id } = useParams();
  const navigate = useNavigate();
  const [state, setState] = useState({ status: 'loading', data: null, error: null });
  const [scraping, setScraping] = useState(false);
  const [logFilter, setLogFilter] = useState('all');

  const load = useCallback(async () => {
    setState((s) => ({ ...s, status: s.data ? 'ready' : 'loading' }));
    try {
      const data = await api.getTracked(id);
      setState({ status: 'ready', data, error: null });
    } catch (error) {
      setState({ status: 'error', data: null, error });
    }
  }, [id]);

  useEffect(() => { load(); }, [load]);

  async function scrapeNow() {
    setScraping(true);
    try {
      await api.scrapeNow(id);
      await load();
    } catch (error) {
      window.alert(`Scrape failed: ${error.message}`);
    } finally {
      setScraping(false);
    }
  }

  async function untrack() {
    if (!window.confirm('Stop tracking this product? Its history and logs are kept.')) return;
    try {
      await api.untrack(id);
      navigate('/');
    } catch (error) {
      window.alert(`Could not untrack: ${error.message}`);
    }
  }

  async function changeInterval(minutes) {
    try {
      await api.setInterval(id, Number(minutes));
      await load();
    } catch (error) {
      window.alert(`Could not change interval: ${error.message}`);
    }
  }

  if (state.status === 'loading') return <Loading rows={4} label="Loading product…" />;
  if (state.status === 'error') return <ErrorState error={state.error} onRetry={load} />;

  const { product, history, logs, stats } = state.data;
  const visibleLogs = logFilter === 'all' ? logs : logs.filter((l) => l.status === logFilter);

  const prices = history.map((h) => h.price);
  const lowest = prices.length ? Math.min(...prices) : null;
  const highest = prices.length ? Math.max(...prices) : null;

  return (
    <>
      <p style={{ margin: '0 0 10px', fontSize: '.85rem' }}>
        <Link to="/">← Dashboard</Link>
      </p>

      <div className="row" style={{ marginBottom: 6 }}>
        <h1 className="page-title" style={{ margin: 0 }}>{product.name}</h1>
        <StatusBadge status={product.latestStatus} />
      </div>
      <p className="page-sub">
        Product #{product.productId} ·{' '}
        <a href={product.url} target="_blank" rel="noreferrer noopener">View on the mock store ↗</a>
      </p>

      {product.showingStalePrice && (
        <div className="alert alert-warn" style={{ marginBottom: 16 }} role="status">
          <span aria-hidden="true">⚠</span>
          <div>
            <strong>The latest scrape failed.</strong> The price below is the last known good value,
            from {formatRelative(product.lastSuccessAt)}. It was not overwritten with failed data.
            {product.lastError && (
              <div className="muted mono" style={{ marginTop: 6, fontSize: '.78rem' }}>
                {product.lastError}
              </div>
            )}
          </div>
        </div>
      )}

      {/* ---- current state -------------------------------------------- */}
      <div className="stats" style={{ marginBottom: 16 }}>
        <div className="stat">
          <div className="label">Current price</div>
          <div className="value">
            {product.lastPrice !== null ? formatPrice(product.lastPrice, product.currency) : '—'}
          </div>
        </div>
        <div className="stat">
          <div className="label">Stock</div>
          <div className="value" style={{ fontSize: '1rem', paddingTop: 5 }}>
            <StockBadge inStock={product.inStock} qty={product.stockQty} />
          </div>
        </div>
        <div className="stat">
          <div className="label">Lowest seen</div>
          <div className="value">{lowest !== null ? formatPrice(lowest, product.currency) : '—'}</div>
        </div>
        <div className="stat">
          <div className="label">Highest seen</div>
          <div className="value">{highest !== null ? formatPrice(highest, product.currency) : '—'}</div>
        </div>
        <div className="stat">
          <div className="label">Last success</div>
          <div className="value" style={{ fontSize: '1rem', paddingTop: 5 }}>
            {formatRelative(product.lastSuccessAt)}
          </div>
        </div>
      </div>

      <div className="row" style={{ marginBottom: 20 }}>
        <button className="btn btn-primary" disabled={scraping} onClick={scrapeNow}>
          {scraping ? 'Scraping…' : 'Scrape now'}
        </button>
        <label className="row" style={{ gap: 6, fontSize: '.85rem' }}>
          <span className="muted">Every</span>
          <select
            className="select"
            value={product.scrapeIntervalMinutes}
            onChange={(e) => changeInterval(e.target.value)}
          >
            <option value={30}>30 min</option>
            <option value={60}>1 hour</option>
            <option value={120}>2 hours (default)</option>
            <option value={360}>6 hours</option>
            <option value={1440}>24 hours</option>
          </select>
        </label>
        <span className="spacer" />
        <button className="btn btn-danger btn-sm" onClick={untrack}>Stop tracking</button>
      </div>

      <div className="stack">
        {/* ---- price history ------------------------------------------ */}
        <section className="card">
          <div className="card-head">
            <h2>Price history</h2>
            <span className="hint">
              {history.length} successful scrape{history.length === 1 ? '' : 's'} · failures are not plotted
            </span>
          </div>
          <div className="card-pad">
            <PriceChart history={history} />
          </div>
        </section>

        {/* ---- stock history ------------------------------------------ */}
        {history.length > 0 && (
          <section className="card">
            <div className="card-head">
              <h2>Stock history</h2>
              <span className="hint">one segment per successful scrape</span>
            </div>
            <div className="card-pad">
              <StockTimeline history={history} />
            </div>
          </section>
        )}

        {/* ---- raw history table -------------------------------------- */}
        {history.length > 0 && (
          <section className="card">
            <div className="card-head"><h2>Recorded data points</h2></div>
            <div className="table-wrap" style={{ maxHeight: 340, overflowY: 'auto' }}>
              <table>
                <thead>
                  <tr>
                    <th>Scraped at</th>
                    <th className="num">Price</th>
                    <th className="num">MRP</th>
                    <th>Stock</th>
                  </tr>
                </thead>
                <tbody>
                  {history.map((h, i) => (
                    <tr key={i}>
                      <td>{formatDateTime(h.scrapedAt)}</td>
                      <td className="num">{formatPrice(h.price, h.currency)}</td>
                      <td className="num muted">{h.mrp ? formatPrice(h.mrp, h.currency) : '—'}</td>
                      <td>{h.inStock ? `In stock${h.stockQty != null ? ` (${h.stockQty})` : ''}` : 'Out of stock'}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </section>
        )}

        {/* ---- scrape log --------------------------------------------- */}
        <section className="card">
          <div className="card-head">
            <h2>Scrape log</h2>
            <div className="row" style={{ gap: 10 }}>
              <span className="hint">
                {stats.successfulAttempts}/{stats.totalAttempts} attempts succeeded
                {stats.successRate !== null && ` (${stats.successRate}%)`}
                {stats.avgDurationMs !== null && ` · avg ${formatDuration(stats.avgDurationMs)}`}
              </span>
              <select className="select" value={logFilter} onChange={(e) => setLogFilter(e.target.value)}>
                <option value="all">All attempts</option>
                <option value="success">Success</option>
                <option value="failed">Failed</option>
              </select>
            </div>
          </div>

          {visibleLogs.length === 0 ? (
            <div className="card-pad">
              <p className="muted" style={{ margin: 0, fontSize: '.88rem' }}>
                No scrape attempts recorded yet.
              </p>
            </div>
          ) : (
            <div className="table-wrap" style={{ maxHeight: 420, overflowY: 'auto' }}>
              <table>
                <thead>
                  <tr>
                    <th>Started</th>
                    <th>Status</th>
                    <th className="num">Attempt</th>
                    <th className="num">Took</th>
                    <th className="num">Price</th>
                    <th>Detail</th>
                  </tr>
                </thead>
                <tbody>
                  {visibleLogs.map((l) => (
                    <tr key={l.id}>
                      <td style={{ whiteSpace: 'nowrap' }}>{formatDateTime(l.startedAt)}</td>
                      <td><StatusBadge status={l.status} /></td>
                      <td className="num">#{l.attempt}</td>
                      <td className="num muted">{formatDuration(l.durationMs)}</td>
                      <td className="num">{l.price !== null ? formatPrice(l.price) : '—'}</td>
                      <td className="wrap-err">
                        {l.errorCode && <div className="mono" style={{ color: 'var(--critical)' }}>{l.errorCode}</div>}
                        {l.errorMessage && <div>{l.errorMessage.slice(0, 160)}</div>}
                        {l.structureWarning && (
                          <div style={{ color: 'var(--warning)' }}>⚠ {l.structureWarning}</div>
                        )}
                        {!l.errorCode && !l.structureWarning && <span className="muted">—</span>}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </section>
      </div>
    </>
  );
}
