import { NavLink } from 'react-router-dom';
import { useEffect, useState } from 'react';

const ICONS = {
  dashboard: (
    <svg width="16" height="16" viewBox="0 0 16 16" fill="none" aria-hidden="true">
      <rect x="1.75" y="1.75" width="5" height="5" rx="1" stroke="currentColor" strokeWidth="1.3" />
      <rect x="9.25" y="1.75" width="5" height="5" rx="1" stroke="currentColor" strokeWidth="1.3" />
      <rect x="1.75" y="9.25" width="5" height="5" rx="1" stroke="currentColor" strokeWidth="1.3" />
      <rect x="9.25" y="9.25" width="5" height="5" rx="1" stroke="currentColor" strokeWidth="1.3" />
    </svg>
  ),
  products: (
    <svg width="16" height="16" viewBox="0 0 16 16" fill="none" aria-hidden="true">
      <path d="M2.25 4.75 8 1.75l5.75 3v6.5L8 14.25l-5.75-3v-6.5Z" stroke="currentColor" strokeWidth="1.3" strokeLinejoin="round" />
      <path d="M2.25 4.75 8 7.75l5.75-3M8 7.75v6.5" stroke="currentColor" strokeWidth="1.3" strokeLinejoin="round" />
    </svg>
  ),
  activity: (
    <svg width="16" height="16" viewBox="0 0 16 16" fill="none" aria-hidden="true">
      <path d="M1.75 8.5h3l2-5 2.5 10 2-5h3" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  ),
  chevron: (
    <svg width="16" height="16" viewBox="0 0 16 16" fill="none" aria-hidden="true">
      <path d="M9.5 4.5 6 8l3.5 3.5" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  ),
};

const STORAGE_KEY = 'ine.sidebar.collapsed';

export default function Sidebar({ trackedCount, failingCount }) {
  const [collapsed, setCollapsed] = useState(() => {
    try {
      return localStorage.getItem(STORAGE_KEY) === '1';
    } catch {
      return false;
    }
  });

  useEffect(() => {
    try {
      localStorage.setItem(STORAGE_KEY, collapsed ? '1' : '0');
    } catch {
    }
  }, [collapsed]);

  const link = ({ isActive }) => `nav-item${isActive ? ' active' : ''}`;

  return (
    <aside className="sidebar" data-collapsed={collapsed}>
      <div className="sidebar-brand">
        <div className="sidebar-mark" aria-hidden="true">IN</div>
        <div className="sidebar-name">
          Price Tracker
          <small>INE mock store</small>
        </div>
      </div>

      <nav className="sidebar-nav">
        <NavLink to="/" end className={link} title="Dashboard">
          {ICONS.dashboard}<span>Dashboard</span>
        </NavLink>

        <NavLink to="/products" className={link} title="Products">
          {ICONS.products}<span>Products</span>
          {trackedCount > 0 && <span className="nav-count">{trackedCount}</span>}
        </NavLink>

        <NavLink to="/activity" className={link} title="Activity">
          {ICONS.activity}<span>Activity</span>
          
          {failingCount > 0 && (
            <span className="nav-count" style={{ color: 'var(--fail)' }}>{failingCount}</span>
          )}
        </NavLink>

      </nav>

      <div className="sidebar-foot">
        <button
          type="button"
          className="collapse-btn"
          onClick={() => setCollapsed((c) => !c)}
          aria-label={collapsed ? 'Expand sidebar' : 'Collapse sidebar'}
        >
          <span style={{ display: 'inline-flex', transform: collapsed ? 'rotate(180deg)' : 'none' }}>
            {ICONS.chevron}
          </span>
          <span>Collapse</span>
        </button>
      </div>
    </aside>
  );
}
