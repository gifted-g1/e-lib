import { useCallback, useEffect, useState } from 'react';
import { api, bridge } from './api';
import Login from './pages/Login';
import Overview from './pages/Overview';
import Laptops from './pages/Laptops';
import Content from './pages/Content';
import Categories from './pages/Categories';
import Requests from './pages/Requests';
import Activity from './pages/Activity';
import Account from './pages/Account';

const TABS = [
  { id: 'overview', label: '🏠 Overview', Component: Overview },
  { id: 'laptops', label: '💻 Laptops', Component: Laptops },
  { id: 'content', label: '📦 Content', Component: Content },
  { id: 'categories', label: '🗂 Categories', Component: Categories },
  { id: 'requests', label: '🙋 Requests', Component: Requests },
  { id: 'activity', label: '📜 Activity', Component: Activity },
  { id: 'account', label: '👤 Account', Component: Account },
];

export default function App() {
  const [config, setConfig] = useState(null);
  const [tab, setTab] = useState('overview');
  const [pending, setPending] = useState(0);

  useEffect(() => {
    bridge.config.get().then(setConfig);
    return bridge.on('auth:expired', () => setConfig((c) => ({ ...c, signedIn: false })));
  }, []);

  const refreshPending = useCallback(() => {
    api
      .get('/api/v1/requests?status=pending')
      .then((r) => setPending(r.length))
      .catch(() => {});
  }, []);

  useEffect(() => {
    if (!config?.signedIn) return undefined;
    refreshPending();
    const t = setInterval(refreshPending, 30_000);
    return () => clearInterval(t);
  }, [config?.signedIn, refreshPending]);

  if (!config) return <div className="splash">📖</div>;
  if (!config.signedIn) return <Login initial={config} onSignedIn={setConfig} />;

  const Active = TABS.find((t) => t.id === tab).Component;
  return (
    <div className="admin">
      <aside className="admin-nav">
        <div className="admin-brand">
          📖 <span>E-Library Parent</span>
        </div>
        {TABS.map((t) => (
          <button key={t.id} className={`admin-tab ${tab === t.id ? 'active' : ''}`} onClick={() => setTab(t.id)}>
            {t.label}
            {t.id === 'requests' && pending > 0 && <span className="count">{pending}</span>}
          </button>
        ))}
        <div className="admin-nav-footer">
          <p className="muted tiny">
            {config.email}
            <br />
            {config.server.replace(/^https?:\/\//, '')}
          </p>
        </div>
      </aside>
      <main className="admin-main">
        <Active
          config={config}
          onNavigate={setTab}
          onRequestsChanged={refreshPending}
          onSignedOut={() => bridge.config.get().then(setConfig)}
        />
      </main>
    </div>
  );
}
