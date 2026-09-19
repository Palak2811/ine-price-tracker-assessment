import { useEffect, useState, useCallback } from 'react';
import { Link } from 'react-router-dom';
import { api } from '../lib/api.js';
import { formatPrice, formatRelative } from '../lib/format.js';
import StatusBadge, { StockBadge } from '../components/StatusBadge.jsx';
import { Loading, ErrorState, Empty } from '../components/States.jsx';

export default function Dashboard() {
  const [state, setState] = useState({ status: 'loading', items: [], error: null });
  const [scraping, setScraping] = useState({});

  const load = useCallback(async () => {
    setState((s) => ({ ...s, status: 'loading' }));
    try {
      const data = await api.listTracked();
      setState({ status: 'ready', items: data.items, error: null });
    } catch (error) {
      setState({ status: 'error', items: [], error });
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  async function scrapeNow(id) {
    setScraping((s) => ({ ...s, [id]: true }));
    try {
      await api.scrapeNow(id);
      await load();
    } catch (error) {
      window.alert(`Scrape failed: ${error.message}`);
    } finally {
      setScraping((s) => ({ ...s, [id]: false }));
    }
  }

  if (state.status === 'loading') {
    return (
      <>
        <h1 className="page-title">Dashboard</h1>
        <Loading rows={3} label="Loading tracked products…" />
      </>
    );
  }

  if (state.status === 'error') {
    return (
      <>
        <h1 className="page-title">Dashboard</h1>
        <ErrorState error={state.error} onRetry={load} />
      </>
    );
  }

  if (!state.items.length) {
    return (
      <>
        <h1 className="page-title">Dashboard</h1>
        <Empty title="No products tracked yet">
          <p>Search the INE mock store and pick a product to start tracking its price and stock.</p>
          <Link className="btn btn-primary" to="/add">Add a product</Link>
        </Empty>
      </>
    );
  }

  const failing = state.items.filter((p) => p.latestStatus === 'failed');

  return (
    <>
      <h1 className="page-title">Dashboard</h1>
      <p className="page-sub">
        {state.items.length} product{state.items.length === 1 ? '' : 's'} tracked · scraped automatically every 2 hours
      </p>

      {failing.length > 0 && (
        <div className="alert alert-warn" style={{ marginBottom: 16 }} role="status">
          <span aria-hidden="true">⚠</span>
          <div>
            <strong>
              {failing.length} product{failing.length === 1 ? '' : 's'} failed the latest scrape.
            </strong>{' '}
            The last known good price is still shown below and is clearly marked as stale.
          </div>
        </div>
      )}

      <div className="grid grid-cards">
        {state.items.map((p) => (
          <article className="card product-card" key={p.id}>
            <div className="body">
              <Link to={`/product/${p.id}`} className="name">{p.name}</Link>
              <div className="meta">#{p.productId} · every {p.scrapeIntervalMinutes}min</div>

              <div className="price-row">
                {p.lastPrice !== null
                  ? <span className="price-big">{formatPrice(p.lastPrice, p.currency)}</span>
                  : <span className="price-none">No price yet</span>}
                <StockBadge inStock={p.inStock} qty={p.stockQty} />
              </div>

              {/* A failed scrape never overwrites the price, so say so plainly. */}
              {p.showingStalePrice && (
                <div className="alert alert-warn" style={{ marginTop: 12, fontSize: '.8rem' }}>
                  <span aria-hidden="true">⚠</span>
                  <div>
                    <strong>Latest scrape failed.</strong>{' '}
                    Showing last good price from {formatRelative(p.lastSuccessAt)}.
                    {p.lastError && (
                      <div className="muted" style={{ marginTop: 3 }}>{p.lastError.slice(0, 120)}</div>
                    )}
                  </div>
                </div>
              )}
            </div>

            <div className="foot">
              <StatusBadge status={p.latestStatus} />
              <span>last ok {formatRelative(p.lastSuccessAt)}</span>
              <span className="spacer" />
              <button className="btn btn-sm" disabled={scraping[p.id]} onClick={() => scrapeNow(p.id)}>
                {scraping[p.id] ? 'Scraping…' : 'Scrape now'}
              </button>
            </div>
          </article>
        ))}
      </div>
    </>
  );
}
