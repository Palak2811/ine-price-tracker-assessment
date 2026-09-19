import { useState, useEffect, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import { api } from '../lib/api.js';
import { ErrorState } from '../components/States.jsx';

/** Search the mock store's catalogue by partial or full name and pick one. */
export default function AddProduct() {
  const [query, setQuery] = useState('');
  const [results, setResults] = useState([]);
  const [status, setStatus] = useState('idle'); // idle | searching | ready | error
  const [error, setError] = useState(null);
  const [tracking, setTracking] = useState({});
  const [notice, setNotice] = useState(null);
  const navigate = useNavigate();
  const debounceRef = useRef();

  useEffect(() => {
    const q = query.trim();
    clearTimeout(debounceRef.current);

    if (q.length < 2) {
      setResults([]);
      setStatus('idle');
      return undefined;
    }

    // Debounced so typing does not fire a request per keystroke.
    debounceRef.current = setTimeout(async () => {
      setStatus('searching');
      try {
        const data = await api.searchProducts(q, 25);
        setResults(data.items);
        setStatus('ready');
        setError(null);
      } catch (err) {
        setError(err);
        setStatus('error');
      }
    }, 300);

    return () => clearTimeout(debounceRef.current);
  }, [query]);

  async function track(product) {
    setTracking((t) => ({ ...t, [product.id]: true }));
    setNotice(null);
    try {
      const created = await api.track(product.id, 120);
      setNotice({ kind: 'ok', text: `Now tracking ${product.name}.` });
      setTimeout(() => navigate(`/product/${created.id}`), 700);
    } catch (err) {
      setNotice({
        kind: 'err',
        text: err.code === 'already_tracked'
          ? `${product.name} is already being tracked.`
          : `Could not track ${product.name}: ${err.message}`,
      });
    } finally {
      setTracking((t) => ({ ...t, [product.id]: false }));
    }
  }

  return (
    <>
      <h1 className="page-title">Add a product</h1>
      <p className="page-sub">
        Search the INE mock store by partial or full product name, brand or SKU.
      </p>

      <div className="card card-pad">
        <label
          htmlFor="q"
          style={{ display: 'block', fontSize: '.85rem', fontWeight: 600, marginBottom: 7 }}
        >
          Product name
        </label>
        <input
          id="q"
          className="input"
          type="search"
          autoFocus
          placeholder="e.g. microphone, Larkspur, LAR-10325"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          autoComplete="off"
        />

        {notice && (
          <div
            className={`alert ${notice.kind === 'ok' ? 'alert-info' : 'alert-error'}`}
            style={{ marginTop: 12 }}
            role="status"
          >
            <span aria-hidden="true">{notice.kind === 'ok' ? '✓' : '✕'}</span>
            <div>{notice.text}</div>
          </div>
        )}

        {status === 'error' && (
          <div style={{ marginTop: 12 }}><ErrorState error={error} /></div>
        )}

        {status === 'searching' && (
          <p className="muted" style={{ fontSize: '.85rem', marginTop: 12 }} aria-live="polite">
            Searching…
          </p>
        )}

        {status === 'ready' && results.length === 0 && (
          <p className="muted" style={{ fontSize: '.88rem', marginTop: 14 }}>
            No products match that term. Try a shorter or different one.
          </p>
        )}

        {results.length > 0 && (
          <>
            <p className="muted" style={{ fontSize: '.8rem', margin: '14px 0 0' }}>
              {results.length} match{results.length === 1 ? '' : 'es'}
            </p>
            <div className="search-results">
              {results.map((p) => (
                <div className="search-item" key={p.id}>
                  <div className="info">
                    <div className="t">{p.name}</div>
                    <div className="s">{p.brand} · {p.category} · SKU {p.sku}</div>
                  </div>
                  <button
                    className="btn btn-primary btn-sm"
                    disabled={tracking[p.id]}
                    onClick={() => track(p)}
                  >
                    {tracking[p.id] ? 'Adding…' : 'Track'}
                  </button>
                </div>
              ))}
            </div>
          </>
        )}

        {query.trim().length === 1 && (
          <p className="muted" style={{ fontSize: '.85rem', marginTop: 12 }}>
            Type at least 2 characters.
          </p>
        )}
      </div>
    </>
  );
}
