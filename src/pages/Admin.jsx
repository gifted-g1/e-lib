import { useCallback, useEffect, useState } from 'react';
import { api, errorMessage } from '../api';
import { useInactivity } from '../hooks';
import ContentManager from '../components/admin/ContentManager';
import CategoryManager from '../components/admin/CategoryManager';
import RequestsPanel from '../components/admin/RequestsPanel';
import ActivityPanel from '../components/admin/ActivityPanel';
import ChildrenManager from '../components/admin/ChildrenManager';
import LimitsPanel from '../components/admin/LimitsPanel';
import SettingsPanel from '../components/admin/SettingsPanel';
import Modal from '../components/Modal';

const TABS = [
  { id: 'content', label: '📦 Content', Component: ContentManager },
  { id: 'categories', label: '🗂 Categories', Component: CategoryManager },
  { id: 'requests', label: '🙋 Requests', Component: RequestsPanel },
  { id: 'activity', label: '📜 Activity log', Component: ActivityPanel },
  { id: 'children', label: '👧 Children', Component: ChildrenManager },
  { id: 'limits', label: '⏱ Time limits', Component: LimitsPanel },
  { id: 'settings', label: '⚙️ Settings', Component: SettingsPanel },
];

const AUTO_LOCK_MS = 5 * 60_000;

export default function Admin({ onExit }) {
  const [tab, setTab] = useState('content');
  const [info, setInfo] = useState(null);
  const [error, setError] = useState('');
  const [confirmQuit, setConfirmQuit] = useState(false);

  // Never leave the dashboard open for a child to find.
  useInactivity(onExit, AUTO_LOCK_MS);

  const refreshInfo = useCallback(() => {
    api.admin
      .info()
      .then(setInfo)
      .catch((e) => {
        setError(errorMessage(e));
        onExit();
      });
  }, [onExit]);

  useEffect(refreshInfo, [refreshInfo, tab]);

  // Any "session ended" error from a panel returns to the child view.
  const onError = useCallback(
    (e) => {
      const msg = errorMessage(e);
      if (/session has ended/i.test(msg)) onExit();
      return msg;
    },
    [onExit]
  );

  const Active = TABS.find((t) => t.id === tab).Component;

  return (
    <div className="admin">
      <aside className="admin-nav">
        <div className="admin-brand">
          📖 <span>Parent Dashboard</span>
        </div>
        {TABS.map((t) => (
          <button key={t.id} className={`admin-tab ${tab === t.id ? 'active' : ''}`} onClick={() => setTab(t.id)}>
            {t.label}
            {t.id === 'requests' && info?.pendingRequests > 0 && <span className="count">{info.pendingRequests}</span>}
          </button>
        ))}
        <div className="admin-nav-footer">
          <button className="btn btn-primary" onClick={onExit}>
            🔒 Lock &amp; return to library
          </button>
          <button className="btn btn-danger-soft" onClick={() => setConfirmQuit(true)}>
            🚪 Exit app
          </button>
          {info && (
            <p className="muted tiny">
              v{info.version} · {info.kiosk ? 'Kiosk mode' : 'Windowed (dev) mode'}
            </p>
          )}
        </div>
      </aside>
      <main className="admin-main">
        {error && <p className="form-error">{error}</p>}
        <Active onError={onError} onChanged={refreshInfo} />
      </main>

      {confirmQuit && (
        <Modal title="Exit the E-Library?" onClose={() => setConfirmQuit(false)}>
          <p>
            The library will close. In a kiosk session this logs out to the login screen, where you can sign in to
            your own account. It starts again on the next boot.
          </p>
          <div className="form-actions">
            <button className="btn" onClick={() => setConfirmQuit(false)}>
              Cancel
            </button>
            <button className="btn btn-danger" onClick={() => api.admin.quit().catch((e) => setError(onError(e)))}>
              Exit app
            </button>
          </div>
        </Modal>
      )}
    </div>
  );
}
