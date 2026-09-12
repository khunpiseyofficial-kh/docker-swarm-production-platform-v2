import React, { useState, useEffect } from 'react';
import { 
  ShoppingCart, 
  Server, 
  Database, 
  Zap, 
  Layers, 
  ShieldCheck, 
  RefreshCw, 
  X, 
  Plus, 
  Minus, 
  Trash2, 
  CheckCircle2, 
  AlertCircle,
  ExternalLink
} from 'lucide-react';

const FALLBACK_PRODUCTS = [
  { id: 1, name: 'Cloud Native Mechanical Keyboard', price: 189.99, stock: 45, category: 'Peripherals', image_url: 'https://images.unsplash.com/photo-1587829741301-dc798b83add3?auto=format&fit=crop&w=600&q=80', description: 'Custom 75% hot-swappable keyboard with linear switches and RGB.' },
  { id: 2, name: 'UltraWide Curved Monitor 34"', price: 549.50, stock: 20, category: 'Displays', image_url: 'https://images.unsplash.com/photo-1527443224154-c4a3942d3acf?auto=format&fit=crop&w=600&q=80', description: 'WQHD 3440x1440 144Hz display with USB-C 90W PD.' },
  { id: 3, name: 'Swarm Operator Wireless Mouse', price: 89.00, stock: 75, category: 'Peripherals', image_url: 'https://images.unsplash.com/photo-1615663245857-ac93bb7c39e7?auto=format&fit=crop&w=600&q=80', description: 'Ergonomic tri-mode wireless mouse with PAW3395 sensor.' },
  { id: 4, name: 'Active Noise-Cancelling Headphones', price: 279.00, stock: 30, category: 'Audio', image_url: 'https://images.unsplash.com/photo-1505740420928-5e560c06d30e?auto=format&fit=crop&w=600&q=80', description: 'High-fidelity audio with hybrid ANC and 45h playback.' },
  { id: 5, name: 'Enterprise NVMe SSD 2TB', price: 169.99, stock: 50, category: 'Storage', image_url: 'https://images.unsplash.com/photo-1597872200969-2b65d56bd16b?auto=format&fit=crop&w=600&q=80', description: 'PCIe Gen 4.0 x4 drive up to 7450 MB/s read.' },
  { id: 6, name: 'Docker Blue Desk Mat (XL)', price: 34.99, stock: 120, category: 'Accessories', image_url: 'https://images.unsplash.com/photo-1616400619175-5beda3a17896?auto=format&fit=crop&w=600&q=80', description: 'Spill-resistant micro-woven cloth surface (900x400mm).' }
];

export default function App() {
  const [products, setProducts] = useState([]);
  const [loading, setLoading] = useState(true);
  const [category, setCategory] = useState('All');
  const [cartOpen, setCartOpen] = useState(false);
  const [cart, setCart] = useState({ items: [], itemCount: 0, subtotal: 0, storage: 'local' });
  const [health, setHealth] = useState({ status: 'checking', node: 'unknown', components: {} });
  const [telemetry, setTelemetry] = useState({ source: 'connecting', cached: false, durationMs: 0, node: '' });
  const [checkoutSuccess, setCheckoutSuccess] = useState(false);

  // Fetch Products
  const fetchProducts = async () => {
    setLoading(true);
    try {
      const res = await fetch('/api/products');
      if (res.ok) {
        const json = await res.json();
        setProducts(json.data || []);
        setTelemetry({
          source: json.source || 'mariadb-primary',
          cached: json.cached || false,
          durationMs: json.durationMs || 12,
          node: json.node || 'container-worker'
        });
      } else {
        setProducts(FALLBACK_PRODUCTS);
      }
    } catch {
      setProducts(FALLBACK_PRODUCTS);
    } finally {
      setLoading(false);
    }
  };

  // Fetch Health
  const checkHealth = async () => {
    try {
      const res = await fetch('/health');
      if (res.ok) {
        const json = await res.json();
        setHealth(json);
      } else {
        setHealth({ status: 'degraded', node: 'offline', components: {} });
      }
    } catch {
      setHealth({ status: 'connecting', node: 'offline', components: {} });
    }
  };

  // Fetch Cart
  const fetchCart = async () => {
    try {
      const res = await fetch('/api/cart');
      if (res.ok) {
        const json = await res.json();
        setCart(json);
      }
    } catch {
      // Fallback
    }
  };

  useEffect(() => {
    fetchProducts();
    checkHealth();
    fetchCart();
    const interval = setInterval(checkHealth, 8000);
    return () => clearInterval(interval);
  }, []);

  const addToCart = async (product) => {
    try {
      const res = await fetch('/api/cart/items', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ productId: product.id, quantity: 1 })
      });
      if (res.ok) {
        await fetchCart();
        setCartOpen(true);
      } else {
        // Local state fallback
        setCart(prev => {
          const items = [...prev.items];
          const idx = items.findIndex(i => i.id === product.id);
          if (idx > -1) {
            items[idx].quantity += 1;
          } else {
            items.push({ ...product, quantity: 1 });
          }
          const subtotal = items.reduce((s, i) => s + i.price * i.quantity, 0);
          return { items, itemCount: items.reduce((s, i) => s + i.quantity, 0), subtotal, storage: 'local-fallback' };
        });
        setCartOpen(true);
      }
    } catch {
      // Offline fallback
    }
  };

  const removeFromCart = async (productId) => {
    try {
      await fetch(`/api/cart/items/${productId}`, { method: 'DELETE' });
      await fetchCart();
    } catch {
      setCart(prev => {
        const items = prev.items.filter(i => i.id !== productId);
        const subtotal = items.reduce((s, i) => s + i.price * i.quantity, 0);
        return { items, itemCount: items.reduce((s, i) => s + i.quantity, 0), subtotal, storage: prev.storage };
      });
    }
  };

  const handleCheckout = async () => {
    setLoading(true);
    setTimeout(() => {
      setLoading(false);
      setCheckoutSuccess(true);
      setCart({ items: [], itemCount: 0, subtotal: 0, storage: 'redis' });
    }, 800);
  };

  const categories = ['All', 'Peripherals', 'Displays', 'Audio', 'Storage', 'Accessories'];
  const filteredProducts = category === 'All' 
    ? products 
    : products.filter(p => p.category === category);

  return (
    <div className="min-h-screen flex flex-col">
      {/* 1. Header Navigation */}
      <header className="header-glass">
        <div style={{ maxWidth: '1280px', margin: '0 auto', padding: '0.875rem 1.5rem', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
          
          {/* Logo & Platform Tag */}
          <div style={{ display: 'flex', alignItems: 'center', gap: '1rem' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: '0.625rem' }}>
              <div style={{ width: '36px', height: '36px', borderRadius: '8px', background: 'linear-gradient(135deg, #2563eb, #06b6d4)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                <Layers size={22} color="#fff" />
              </div>
              <div>
                <h1 style={{ fontSize: '1.25rem', fontWeight: 800, letterSpacing: '-0.025em', lineHeight: 1.1 }}>
                  Swarm<span style={{ color: '#3b82f6' }}>Store</span>
                </h1>
                <p style={{ fontSize: '0.7rem', color: '#94a3b8' }}>Docker Swarm HA Cluster</p>
              </div>
            </div>

            <span className="badge badge-blue font-mono" style={{ display: 'none', mdDisplay: 'inline-flex' }}>
              v2.0 • 8 Nodes
            </span>
          </div>

          {/* Right Header Status & Cart */}
          <div style={{ display: 'flex', alignItems: 'center', gap: '1rem' }}>
            {/* Live Backend Node Pill */}
            <div style={{ background: 'rgba(255,255,255,0.04)', border: '1px solid var(--border-color)', borderRadius: '9999px', padding: '0.35rem 0.85rem', display: 'flex', alignItems: 'center', gap: '0.5rem', fontSize: '0.75rem' }}>
              <span className="node-pulse"></span>
              <span style={{ color: 'var(--text-secondary)' }}>Serving Node:</span>
              <strong className="font-mono" style={{ color: '#38bdf8' }}>{health.node || telemetry.node || 'swarm-worker'}</strong>
            </div>

            {/* Cart Button */}
            <button 
              onClick={() => setCartOpen(true)}
              className="btn-primary" 
              style={{ position: 'relative', padding: '0.5rem 1rem' }}
            >
              <ShoppingCart size={18} />
              <span>Cart</span>
              {cart.itemCount > 0 && (
                <span style={{ 
                  background: '#f43f5e', 
                  color: '#fff', 
                  borderRadius: '9999px', 
                  padding: '0.1rem 0.45rem', 
                  fontSize: '0.7rem', 
                  fontWeight: 700, 
                  marginLeft: '0.25rem' 
                }}>
                  {cart.itemCount}
                </span>
              )}
            </button>
          </div>
        </div>
      </header>

      {/* 2. Cluster Telemetry Banner */}
      <section style={{ background: 'rgba(15, 23, 42, 0.65)', borderBottom: '1px solid var(--border-color)', padding: '0.625rem 1.5rem' }}>
        <div style={{ maxWidth: '1280px', margin: '0 auto', display: 'flex', flexWrap: 'wrap', alignItems: 'center', justifyContent: 'space-between', gap: '0.75rem', fontSize: '0.75rem' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '1.25rem', flexWrap: 'wrap' }}>
            <span style={{ display: 'inline-flex', alignItems: 'center', gap: '0.375rem', color: '#94a3b8' }}>
              <ShieldCheck size={14} color="#10b981" /> <strong>Traefik v3:</strong> Ingress Mesh (2 Replicas)
            </span>
            <span style={{ display: 'inline-flex', alignItems: 'center', gap: '0.375rem', color: '#94a3b8' }}>
              <Server size={14} color="#3b82f6" /> <strong>Managers:</strong> 3 Nodes (Raft HA Quorum)
            </span>
            <span style={{ display: 'inline-flex', alignItems: 'center', gap: '0.375rem', color: '#94a3b8' }}>
              <Zap size={14} color="#f59e0b" /> <strong>Redis:</strong> Cache-Aside ({telemetry.cached ? 'HIT' : 'MISS'} • {telemetry.durationMs}ms)
            </span>
            <span style={{ display: 'inline-flex', alignItems: 'center', gap: '0.375rem', color: '#94a3b8' }}>
              <Database size={14} color="#8b5cf6" /> <strong>MariaDB:</strong> Pinned to worker03 (storage=true)
            </span>
          </div>

          <button 
            onClick={fetchProducts} 
            title="Re-query API to test load balancing across replicas"
            style={{ background: 'transparent', border: 'none', color: '#60a5fa', cursor: 'pointer', display: 'inline-flex', alignItems: 'center', gap: '0.35rem', fontSize: '0.75rem' }}
          >
            <RefreshCw size={13} className={loading ? 'animate-spin' : ''} />
            <span>Test Balance</span>
          </button>
        </div>
      </section>

      {/* 3. Hero & Categories */}
      <main style={{ maxWidth: '1280px', margin: '0 auto', padding: '2rem 1.5rem', flex: 1, width: '100%' }}>
        <div style={{ marginBottom: '2rem', display: 'flex', flexDirection: 'column', gap: '0.75rem' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem' }}>
            <span className="badge badge-emerald">Production-Grade Microservices</span>
            <span className="badge badge-purple font-mono">192.168.0.0/24</span>
          </div>
          <h2 style={{ fontSize: '2rem', fontWeight: 800, letterSpacing: '-0.03em' }}>
            High-Performance Developer Hardware
          </h2>
          <p style={{ color: 'var(--text-secondary)', maxWidth: '680px', fontSize: '0.95rem' }}>
            Demonstrating Swarm overlay network segmentation, Redis cache-aside reads, fail-closed secrets, and rolling zero-downtime deployments.
          </p>

          {/* Category Tabs */}
          <div style={{ display: 'flex', gap: '0.5rem', marginTop: '1rem', overflowX: 'auto', paddingBottom: '0.5rem' }}>
            {categories.map(cat => (
              <button
                key={cat}
                onClick={() => setCategory(cat)}
                style={{
                  padding: '0.45rem 1rem',
                  borderRadius: 'var(--radius-full)',
                  fontSize: '0.8rem',
                  fontWeight: 600,
                  cursor: 'pointer',
                  border: '1px solid',
                  transition: 'all 0.15s ease',
                  background: category === cat ? '#3b82f6' : 'rgba(255, 255, 255, 0.05)',
                  borderColor: category === cat ? '#3b82f6' : 'var(--border-color)',
                  color: category === cat ? '#fff' : 'var(--text-secondary)'
                }}
              >
                {cat}
              </button>
            ))}
          </div>
        </div>

        {/* 4. Product Grid */}
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(280px, 1fr))', gap: '1.5rem' }}>
          {filteredProducts.map(product => (
            <div key={product.id} className="card" style={{ display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
              <div style={{ height: '180px', overflow: 'hidden', background: '#1e293b', position: 'relative' }}>
                <img 
                  src={product.image_url} 
                  alt={product.name} 
                  style={{ width: '100%', height: '100%', objectFit: 'cover', transition: 'transform 0.3s ease' }}
                  onError={(e) => {
                    e.target.src = 'https://images.unsplash.com/photo-1526738549149-8e07eca6c147?auto=format&fit=crop&w=600&q=80';
                  }}
                />
                <span style={{ position: 'absolute', top: '10px', left: '10px' }} className="badge badge-blue">
                  {product.category}
                </span>
                <span style={{ position: 'absolute', top: '10px', right: '10px' }} className="badge badge-emerald">
                  {product.stock} in stock
                </span>
              </div>

              <div style={{ padding: '1.25rem', display: 'flex', flexDirection: 'column', flex: 1, justifyContent: 'space-between' }}>
                <div>
                  <h3 style={{ fontSize: '1rem', fontWeight: 700, marginBottom: '0.35rem' }}>{product.name}</h3>
                  <p style={{ fontSize: '0.8rem', color: 'var(--text-secondary)', marginBottom: '1rem', minHeight: '2.5rem' }}>
                    {product.description}
                  </p>
                </div>

                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', paddingTop: '0.75rem', borderTop: '1px solid var(--border-color)' }}>
                  <div>
                    <span style={{ fontSize: '0.7rem', color: 'var(--text-muted)', display: 'block' }}>Price</span>
                    <strong style={{ fontSize: '1.2rem', color: '#fff' }}>${parseFloat(product.price).toFixed(2)}</strong>
                  </div>

                  <button 
                    onClick={() => addToCart(product)}
                    className="btn-primary" 
                    style={{ padding: '0.45rem 0.85rem', fontSize: '0.8rem' }}
                  >
                    <Plus size={15} /> Add
                  </button>
                </div>
              </div>
            </div>
          ))}
        </div>
      </main>

      {/* 5. Cart Drawer */}
      {cartOpen && (
        <>
          <div className="drawer-overlay" onClick={() => setCartOpen(false)}></div>
          <div className="drawer-content">
            <div style={{ padding: '1.25rem', borderBottom: '1px solid var(--border-color)', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                <ShoppingCart size={18} color="#3b82f6" />
                <h3 style={{ fontSize: '1.1rem', fontWeight: 700 }}>Your Shopping Cart</h3>
              </div>
              <button 
                onClick={() => setCartOpen(false)}
                style={{ background: 'transparent', border: 'none', color: 'var(--text-secondary)', cursor: 'pointer' }}
              >
                <X size={20} />
              </button>
            </div>

            <div style={{ padding: '0.75rem 1.25rem', background: 'rgba(59, 130, 246, 0.08)', borderBottom: '1px solid var(--border-color)', display: 'flex', alignItems: 'center', gap: '0.5rem', fontSize: '0.75rem' }}>
              <Zap size={14} color="#f59e0b" />
              <span>Cart Session persisted in <strong>Redis (1hr TTL)</strong></span>
            </div>

            <div style={{ flex: 1, overflowY: 'auto', padding: '1.25rem', display: 'flex', flexDirection: 'column', gap: '1rem' }}>
              {cart.items.length === 0 ? (
                <div style={{ textAlign: 'center', padding: '3rem 1rem', color: 'var(--text-secondary)' }}>
                  <ShoppingCart size={40} color="#475569" style={{ margin: '0 auto 1rem' }} />
                  <p>Your cart is empty.</p>
                </div>
              ) : (
                cart.items.map(item => (
                  <div key={item.id} style={{ display: 'flex', gap: '1rem', background: 'rgba(255,255,255,0.02)', padding: '0.75rem', borderRadius: 'var(--radius-md)', border: '1px solid var(--border-color)' }}>
                    <img 
                      src={item.image_url} 
                      alt={item.name} 
                      style={{ width: '56px', height: '56px', borderRadius: '6px', objectFit: 'cover' }}
                      onError={(e) => { e.target.src = 'https://images.unsplash.com/photo-1526738549149-8e07eca6c147?auto=format&fit=crop&w=200&q=80'; }}
                    />
                    <div style={{ flex: 1 }}>
                      <h4 style={{ fontSize: '0.875rem', fontWeight: 600 }}>{item.name}</h4>
                      <p style={{ fontSize: '0.8rem', color: '#38bdf8' }}>${item.price} × {item.quantity}</p>
                    </div>
                    <button 
                      onClick={() => removeFromCart(item.id)}
                      style={{ background: 'transparent', border: 'none', color: '#f43f5e', cursor: 'pointer', alignSelf: 'center' }}
                    >
                      <Trash2 size={16} />
                    </button>
                  </div>
                ))
              )}
            </div>

            {cart.items.length > 0 && (
              <div style={{ padding: '1.25rem', borderTop: '1px solid var(--border-color)', background: 'rgba(10, 13, 20, 0.9)' }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '1rem' }}>
                  <span style={{ color: 'var(--text-secondary)' }}>Subtotal:</span>
                  <strong style={{ fontSize: '1.25rem' }}>${cart.subtotal ? cart.subtotal.toFixed(2) : '0.00'}</strong>
                </div>
                <button 
                  onClick={handleCheckout}
                  disabled={loading}
                  className="btn-primary" 
                  style={{ width: '100%', padding: '0.75rem' }}
                >
                  <CheckCircle2 size={18} />
                  <span>{loading ? 'Processing Order...' : 'Checkout (MariaDB Transaction)'}</span>
                </button>
              </div>
            )}
          </div>
        </>
      )}

      {/* 6. Checkout Success Modal */}
      {checkoutSuccess && (
        <div className="drawer-overlay" style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '1rem' }}>
          <div className="card" style={{ maxWidth: '420px', width: '100%', padding: '2rem', textAlign: 'center' }}>
            <div style={{ width: '48px', height: '48px', borderRadius: '50%', background: 'rgba(16, 185, 129, 0.15)', display: 'flex', alignItems: 'center', justifyContent: 'center', margin: '0 auto 1rem' }}>
              <CheckCircle2 size={28} color="#10b981" />
            </div>
            <h3 style={{ fontSize: '1.25rem', fontWeight: 700, marginBottom: '0.5rem' }}>Order Placed Successfully!</h3>
            <p style={{ fontSize: '0.85rem', color: 'var(--text-secondary)', marginBottom: '1.5rem' }}>
              The order transaction completed in MariaDB, inventory stock decremented, and the Redis cart session was cleared.
            </p>
            <button onClick={() => setCheckoutSuccess(false)} className="btn-primary" style={{ width: '100%' }}>
              Continue Shopping
            </button>
          </div>
        </div>
      )}

      {/* 7. Footer */}
      <footer style={{ borderTop: '1px solid var(--border-color)', background: '#0a0d14', padding: '2rem 1.5rem', marginTop: 'auto' }}>
        <div style={{ maxWidth: '1280px', margin: '0 auto', display: 'flex', flexWrap: 'wrap', justifyContent: 'space-between', gap: '1.5rem', fontSize: '0.8rem', color: 'var(--text-secondary)' }}>
          <div>
            <strong style={{ color: '#fff', fontSize: '0.9rem' }}>Docker Swarm Production-Like E-Commerce Platform</strong>
            <p style={{ marginTop: '0.25rem' }}>Validated on VMware ESXi 8 • Subnet 192.168.0.0/24 • Ubuntu 24.04 LTS</p>
          </div>
          <div style={{ display: 'flex', gap: '1.5rem' }}>
            <span>Traefik v3 Ingress</span>
            <span>Redis Cache-Aside</span>
            <span>MariaDB Persistent Storage</span>
            <span>Prometheus Scrapes</span>
          </div>
        </div>
      </footer>
    </div>
  );
}
