import { useState, useEffect, useRef, useCallback } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { api } from '../lib/api.js';
import { formatPrice, formatRelative } from '../lib/format.js';
import StatusBadge from '../components/StatusBadge.jsx';
import { ErrorState } from '../components/States.jsx';

export default function Products({ onChange }) {
  const [query, setQuery] = useState('');
  const [results, setResults] = useState([]);
  const [searchState, setSearchState] = useState('idle'); 
  const [searchError, setSearchError] = useState(null);
  const [busy, setBusy] = useState({});
  const [notice, setNotice] = useState(null);
  const [tracked, setTracked] = useState([]);
  const navigate = useNavigate();
  const debounce = useRef();

  const loadTracked = useCallback(async () => {
    try {
      const data = await api.listTracked();
      setTracked(data.items);
    } catch {
    }
  }, []);

  useEffect(() => { loadTracked(); }, [loadTracked]);

  useEffect(() => {
    const q = query.trim();
    clearTimeout(debounce.current);

    if (q.length < 2) {
      setResults([]);
      setSearchState('idle');
      return undefined;
    }

    debounce.current = setTimeout(async () => {
      setSearchState('searching');
      try {
        const data = await api.searchProducts(q, 25);
        setResults(data.items);
        setSearchState('ready');
        setSearchError(null);
      } catch (err) {
        setSearchError(err);
        setSearchState('error');
      }
    }, 280);

    return () => clearTimeout(debounce.current);
  }, [query]);

  const trackedIds = new Set(tracked.map((t) => t.productId));

  async function track(product) {
    setBusy((b) => ({ ...b, [product.id]: true }));
    setNotice(null);
    try {
      const created = await api.track(product.id, 120);
      await loadTracked();
      onChange?.();
      navigate(`/product/${created.id}`);
    } catch (err) {
      setNotice({
        kind: 'fail',
        text: err.code === 'already_tracked'
          ? `${product.name} is already tracked.`
          : `Could not track ${product.name}: ${err.message}`,
      });
    } finally {
      setBusy((b) => ({ ...b, [product.id]: false }));
    }
  }

  async function untrack(row) {
    if (!window.confirm(`Stop tracking ${row.name}? Its history and logs are kept.`)) return;
    try {
      await api.untrack(row.id);
      await loadTracked();
      onChange?.();
    } catch (err) {
      setNotice({ kind: 'fail', text: `Could not untrack: ${err.message}` });
    }
  }

  return (
    <>
      <div className="panel">
        <div className="panel-head">
          <h2>Find a product</h2>
          <span className="meta">1,000 products mirrored from the mock store</span>
        </div>
        <div className="panel-body">
          <label className="field-label" htmlFor="q">Search by name, brand or SKU</label>
          <input
            id="q"
            className="input"
            type="search"
            autoFocus
            autoComplete="off"
            placeholder="microphone · Larkspur · LAR-10325"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
          />

          {notice && (
            <div className={`note ${notice.kind === 'fail' ? 'note-fail' : ''}`} style={{ marginTop: 12 }} role="status">
              <span className="mark" aria-hidden="true">!</span>
              <div>{notice.text}</div>
            </div>
          )}

          {searchState === 'error' && (
            <div style={{ marginTop: 12 }}><ErrorState error={searchError} /></div>
          )}

          {searchState === 'searching' && (
            <p style={{ color: 'var(--text-muted)', fontSize: 13, marginBottom: 0 }} aria-live="polite">
              Searching…
            </p>
          )}

          {searchState === 'ready' && results.length === 0 && (
            <p style={{ color: 'var(--text-muted)', fontSize: 13, marginBottom: 0 }}>
              Nothing matched that term.
            </p>
          )}

          {results.length > 0 && (
            <div className="search-list">
              {results.map((p) => {
                const already = trackedIds.has(p.id);
                return (
                  <div className="search-row" key={p.id}>
                    <div className="info">
                      <div className="t">{p.name}</div>
                      <div className="s">{p.brand} · {p.category} · {p.sku}</div>
                    </div>
                    {already ? (
                      <span style={{ color: 'var(--text-muted)', fontSize: 12.5 }}>Tracked</span>
                    ) : (
                      <button
                        className="btn btn-xs btn-primary"
                        disabled={busy[p.id]}
                        onClick={() => track(p)}
                      >
                        {busy[p.id] ? 'Adding…' : 'Track'}
                      </button>
                    )}
                  </div>
                );
              })}
            </div>
          )}

          {query.trim().length === 1 && (
            <p style={{ color: 'var(--text-muted)', fontSize: 13, marginBottom: 0 }}>
              Type at least two characters.
            </p>
          )}
        </div>
      </div>

      {tracked.length > 0 && (
        <div className="panel">
          <div className="panel-head">
            <h2>Tracked</h2>
            <span className="meta">{tracked.length} product{tracked.length === 1 ? '' : 's'}</span>
          </div>
          <div className="table-scroll">
            <table className="data">
              <thead>
                <tr>
                  <th>Product</th>
                  <th className="num">Price</th>
                  <th>Last scrape</th>
                  <th className="opt">Added</th>
                  <th className="num" aria-label="Actions" />
                </tr>
              </thead>
              <tbody>
                {tracked.map((t) => (
                  <tr key={t.id} className={t.latestStatus === 'failed' ? 'row-failed' : undefined}>
                    <td>
                      <div className="cell-primary"><Link to={`/product/${t.id}`}>{t.name}</Link></div>
                      <div className="cell-sub">#{t.productId}</div>
                    </td>
                    <td className="num">
                      {t.lastPrice !== null
                        ? <span className="price">{formatPrice(t.lastPrice, t.currency)}</span>
                        : <span className="price-none">—</span>}
                    </td>
                    <td>
                      <StatusBadge status={t.latestStatus} />
                      <div className="cell-sub">{formatRelative(t.lastAttemptAt)}</div>
                    </td>
                    <td className="opt nowrap" style={{ color: 'var(--text-muted)' }}>
                      {formatRelative(t.createdAt)}
                    </td>
                    <td className="num">
                      <button className="btn btn-xs btn-danger" onClick={() => untrack(t)}>Remove</button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </>
  );
}
