import { Routes, Route, NavLink, Link } from 'react-router-dom';
import Dashboard from './pages/Dashboard.jsx';
import AddProduct from './pages/AddProduct.jsx';
import ProductDetail from './pages/ProductDetail.jsx';

export default function App() {
  return (
    <>
      <header className="app-header">
        <div className="app-header-inner">
          <Link to="/" className="brand">INE Price Tracker <span>· mock store</span></Link>
          <nav className="nav">
            <NavLink to="/" end className={({ isActive }) => isActive ? 'active' : ''}>Dashboard</NavLink>
            <NavLink to="/add" className={({ isActive }) => isActive ? 'active' : ''}>Add product</NavLink>
          </nav>
        </div>
      </header>
      <main className="container">
        <Routes>
          <Route path="/" element={<Dashboard />} />
          <Route path="/add" element={<AddProduct />} />
          <Route path="/product/:id" element={<ProductDetail />} />
          <Route path="*" element={<div className="empty"><h3>Page not found</h3><Link to="/">Back to dashboard</Link></div>} />
        </Routes>
      </main>
    </>
  );
}
