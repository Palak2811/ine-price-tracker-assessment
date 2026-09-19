import { useEffect, useState, useCallback } from 'react';
import { useParams, Link, useNavigate } from 'react-router-dom';
import { api } from '../lib/api.js';
import { formatPrice, formatDateTime, formatRelative, formatDuration } from '../lib/format.js';
import StatusBadge, { StockBadge, TriggerLabel } from '../components/StatusBadge.jsx';
import PriceChart from '../components/PriceChart.jsx';
import { Loading, ErrorState } from '../components/States.jsx';

export default function ProductDetail({ onChange }) {
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
      setState((s) => ({ status: s.data ? 'ready' : 'error', data: s.data, error }));
    }
  }, [id]);

  useEffect(() => { load(); }, [load]);

  async function scrapeNow() {
    setScraping(true);
    try {
      await api.scrapeNow(id);
      await load();
      onChange?.();
    } catch (error) {
      setState((s) => ({ ...s, error }));
    } finally {
      setScraping(false);
    }
  }

  async function untrack() {
    if (!window.confirm('Stop tracking this product? Its history and logs are kept.')) return;
    try {
      await api.untrack(id);
      onChange?.();
      navigate('/');
    } catch (error) {
      setState((s) => ({ ...s, error }));
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
      <div className="breadcrumb">
        <Link to="/">Dashboard</Link> <span aria-hidden="true">/</span> {product.name}
      </div>

      <div className="detail-head">
        <div>
          <h1>{product.name}</h1>
          <div className="sub">
            #{product.productId} ·{' '}
            <a href={product.url} target="_blank" rel="noreferrer noopener">View on the store ↗</a>
          </div>
        </div>
        <div className="detail-actions">
          <StatusBadge status={product.latestStatus} />
          <button className="btn btn-primary btn-xs" disabled={scraping} onClick={scrapeNow}>
            {scraping ? 'Scraping…' : 'Scrape now'}
          </button>
          <button className="btn btn-xs btn-danger" onClick={untrack}>Remove</button>
        </div>
      </div>

      {state.error && (
        <div className="note note-fail" style={{ marginBottom: 14 }} role="alert">
          <span className="mark" aria-hidden="true">!</span>
          <div>{state.error.message}</div>
        </div>
      )}

      
      {product.showingStalePrice && (
        <div className="note note-fail" style={{ marginBottom: 14 }} role="status">
          <span className="mark" aria-hidden="true">!</span>
          <div>
            <strong>The latest scrape failed.</strong> The price below is the last known good
            value, from {formatRelative(product.lastSuccessAt)}. It was not overwritten.
            {product.lastError && (
              <div className="mono" style={{ marginTop: 5, opacity: .85 }}>{product.lastError}</div>
            )}
          </div>
        </div>
      )}

      <div className="stat-row">
        <div className="stat">
          <div className="k">Current price</div>
          <div className="v">
            {product.lastPrice !== null ? formatPrice(product.lastPrice, product.currency) : '—'}
          </div>
        </div>
        <div className="stat">
          <div className="k">Stock</div>
          <div className="v" style={{ fontSize: 14, paddingTop: 4 }}>
            <StockBadge inStock={product.inStock} qty={product.stockQty} />
          </div>
        </div>
        <div className="stat">
          <div className="k">Lowest seen</div>
          <div className="v">{lowest !== null ? formatPrice(lowest, product.currency) : '—'}</div>
        </div>
        <div className="stat">
          <div className="k">Highest seen</div>
          <div className="v">{highest !== null ? formatPrice(highest, product.currency) : '—'}</div>
        </div>
        <div className="stat">
          <div className="k">Last success</div>
          <div className="v" style={{ fontSize: 14, paddingTop: 4 }}>
            {formatRelative(product.lastSuccessAt)}
          </div>
        </div>
      </div>

      <div className="panel">
        <div className="panel-head">
          <h2>Price history</h2>
          <span className="meta">
            {history.length} successful scrape{history.length === 1 ? '' : 's'} · failures are not plotted
          </span>
        </div>
        <div className="panel-body">
          <PriceChart history={history} />
        </div>
      </div>

      {history.length > 0 && (
        <div className="panel">
          <div className="panel-head"><h2>Recorded data points</h2></div>
          <div className="table-scroll" style={{ maxHeight: 300, overflowY: 'auto' }}>
            <table className="data">
              <thead>
                <tr>
                  <th>Scraped at</th>
                  <th className="num">Price</th>
                  <th className="opt num">MRP</th>
                  <th>Stock</th>
                </tr>
              </thead>
              <tbody>
                {history.map((h, i) => (
                  <tr key={i}>
                    <td className="nowrap" style={{ color: 'var(--text-secondary)' }}>
                      {formatDateTime(h.scrapedAt)}
                    </td>
                    <td className="num"><span className="price" style={{ fontSize: 13.5 }}>{formatPrice(h.price, h.currency)}</span></td>
                    <td className="opt num" style={{ color: 'var(--text-muted)' }}>
                      {h.mrp ? formatPrice(h.mrp, h.currency) : '—'}
                    </td>
                    <td><StockBadge inStock={h.inStock} qty={h.stockQty} /></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      <div className="panel">
        <div className="panel-head">
          <h2>Scrape log</h2>
          <span className="meta">
            {stats.successfulAttempts}/{stats.totalAttempts} attempts succeeded
            {stats.successRate !== null && ` · ${stats.successRate}%`}
            {stats.avgDurationMs !== null && ` · avg ${formatDuration(stats.avgDurationMs)}`}
          </span>
          <div className="seg">
            <button type="button" aria-pressed={logFilter === 'all'} onClick={() => setLogFilter('all')}>All</button>
            <button type="button" aria-pressed={logFilter === 'success'} onClick={() => setLogFilter('success')}>Success</button>
            <button type="button" aria-pressed={logFilter === 'failed'} onClick={() => setLogFilter('failed')}>Failed</button>
          </div>
        </div>

        {visibleLogs.length === 0 ? (
          <div className="empty" style={{ padding: '26px 20px' }}>
            <p style={{ margin: 0 }}>No {logFilter === 'all' ? '' : `${logFilter} `}attempts recorded.</p>
          </div>
        ) : (
          <div className="table-scroll" style={{ maxHeight: 400, overflowY: 'auto' }}>
            <table className="data">
              <thead>
                <tr>
                  <th>Started</th>
                  <th>Source</th>
                  <th>Result</th>
                  <th className="opt num">Try</th>
                  <th className="opt num">Took</th>
                  <th className="num">Price</th>
                  <th className="opt">Detail</th>
                </tr>
              </thead>
              <tbody>
                {visibleLogs.map((l) => (
                  <tr key={l.id} className={l.status === 'failed' ? 'row-failed' : undefined}>
                    <td className="nowrap" style={{ color: 'var(--text-secondary)' }}>
                      {formatDateTime(l.startedAt)}
                    </td>
                    <td><TriggerLabel trigger={l.trigger} /></td>
                    <td><StatusBadge status={l.status} /></td>
                    <td className="opt num" style={{ color: 'var(--text-muted)' }}>#{l.attempt}</td>
                    <td className="opt num" style={{ color: 'var(--text-muted)' }}>{formatDuration(l.durationMs)}</td>
                    <td className="num">
                      {l.price !== null
                        ? <span className="price" style={{ fontSize: 13.5 }}>{formatPrice(l.price)}</span>
                        : <span className="price-none">—</span>}
                    </td>
                    <td className="opt err-cell">
                      {l.errorCode && <div className="err-code">{l.errorCode}</div>}
                      {l.errorMessage && <div className="err-msg">{l.errorMessage.slice(0, 160)}</div>}
                      {l.structureWarning && (
                        <div className="err-msg" style={{ color: 'var(--warn)' }}>{l.structureWarning}</div>
                      )}
                      {!l.errorCode && !l.structureWarning && (
                        <span style={{ color: 'var(--text-muted)' }}>—</span>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </>
  );
}
