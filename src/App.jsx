import { useCallback, useEffect, useState } from 'react';
<<<<<<< HEAD
import { api } from './api';
import { useElibEvent, useIdleCursor } from './hooks';
import AdminLogin from './components/AdminLogin';
import Home from './pages/Home';
import VideoPlayer from './pages/VideoPlayer';
import PdfViewer from './pages/PdfViewer';
import SiteViewer from './pages/SiteViewer';
import Admin from './pages/Admin';
import Setup from './pages/Setup';
import ProfilePicker from './pages/ProfilePicker';
import LockScreen from './pages/LockScreen';

const VIEWERS = { video: VideoPlayer, pdf: PdfViewer, site: SiteViewer };

export default function App() {
  const [session, setSession] = useState(null);
  const [online, setOnline] = useState(navigator.onLine);
  const [openItem, setOpenItem] = useState(null);
  const [adminMode, setAdminMode] = useState(false);
  const [showLogin, setShowLogin] = useState(false);

  useIdleCursor(3000);

  const refresh = useCallback(async () => {
    const s = await api.session.getState();
    setSession(s);
    setOnline(s.online);
  }, []);

  useEffect(() => {
    refresh();
    // No drag-and-drop navigation or browser context menus anywhere.
    const stop = (e) => e.preventDefault();
    window.addEventListener('contextmenu', stop);
    window.addEventListener('dragover', stop);
    window.addEventListener('drop', stop);
    return () => {
      window.removeEventListener('contextmenu', stop);
      window.removeEventListener('dragover', stop);
      window.removeEventListener('drop', stop);
    };
  }, [refresh]);

  useElibEvent('session:state', (s) => {
    setSession(s);
    setOnline(s.online);
  });
  useElibEvent('net:status', ({ online: o }) => setOnline(o));

  // A time lock always closes whatever is open.
  useEffect(() => {
    if (session?.locked) setOpenItem(null);
  }, [session?.locked]);

  const openAdmin = useCallback(() => setShowLogin(true), []);
  const exitAdmin = useCallback(async () => {
    await api.admin.logout().catch(() => {});
    setAdminMode(false);
    setOpenItem(null);
    refresh();
  }, [refresh]);

  if (!session) return <div className="splash">📖</div>;
  if (!session.hasAdmin) return <Setup onDone={refresh} />;

  let page;
  if (adminMode) {
    page = <Admin onExit={exitAdmin} />;
  } else if (session.locked) {
    page = <LockScreen session={session} onAdmin={openAdmin} />;
  } else if (!session.childId) {
    page = <ProfilePicker onPicked={refresh} onAdmin={openAdmin} />;
  } else if (openItem) {
    const Viewer = VIEWERS[openItem.type];
    page = (
      <Viewer
        item={openItem}
        session={session}
        online={online}
        overlayOpen={showLogin}
        onBack={() => setOpenItem(null)}
        onAdmin={openAdmin}
      />
    );
  } else {
    page = <Home session={session} online={online} onOpen={setOpenItem} onAdmin={openAdmin} />;
  }

  return (
    <>
      {page}
      {showLogin && (
        <AdminLogin
          onClose={() => setShowLogin(false)}
          onSuccess={() => {
            setShowLogin(false);
            setOpenItem(null);
            setAdminMode(true);
          }}
        />
      )}
    </>
=======
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
>>>>>>> 9cdb3b1a4e77639efe6a102895d504764a0cff37
  );
}
