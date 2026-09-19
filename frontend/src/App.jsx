import { Routes, Route, Link, useLocation } from 'react-router-dom';
import { useEffect, useState, useCallback } from 'react';
import Sidebar from './components/Sidebar.jsx';
import Dashboard from './pages/Dashboard.jsx';
import Products from './pages/Products.jsx';
import Activity from './pages/Activity.jsx';
import ProductDetail from './pages/ProductDetail.jsx';
import { api } from './lib/api.js';

const TITLES = {
  '/': ['Dashboard', 'Tracked products and their latest scrape'],
  '/products': ['Products', 'Search the store and manage what is tracked'],
  '/activity': ['Activity', 'Every scrape attempt across all products'],
};

export default function App() {
  const { pathname } = useLocation();

  const [counts, setCounts] = useState({ tracked: 0, failing: 0 });

  const refreshCounts = useCallback(async () => {
    try {
      const data = await api.listTracked();
      setCounts({
        tracked: data.items.length,
        failing: data.items.filter((p) => p.latestStatus === 'failed').length,
      });
    } catch {
    }
  }, []);

  useEffect(() => { refreshCounts(); }, [refreshCounts, pathname]);

  const [title, subtitle] = TITLES[pathname] ?? ['Product', null];

  return (
    <div className="shell">
      <Sidebar trackedCount={counts.tracked} failingCount={counts.failing} />

      <div className="main">
        <header className="topbar">
          <h1>{title}</h1>
          {subtitle && <span className="sub">{subtitle}</span>}
        </header>

        <div className="content">
          <Routes>
            <Route path="/" element={<Dashboard onChange={refreshCounts} />} />
            <Route path="/products" element={<Products onChange={refreshCounts} />} />
            <Route path="/activity" element={<Activity />} />
            <Route path="/product/:id" element={<ProductDetail onChange={refreshCounts} />} />
            <Route
              path="*"
              element={
                <div className="panel">
                  <div className="empty">
                    <h3>Page not found</h3>
                    <p>That route does not exist.</p>
                    <Link className="btn" to="/">Back to dashboard</Link>
                  </div>
                </div>
              }
            />
          </Routes>
        </div>
      </div>
    </div>
  );
}
