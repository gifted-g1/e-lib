import { useCallback, useEffect, useState } from 'react';
import { api, formatDateTime } from '../../api';
import ConfirmButton from '../ConfirmButton';

const ACTION_LABELS = {
  open: '▶ Opened',
  request: '🙋 Requested',
  blocked: '🚧 Blocked page',
  login: '👋 Started session',
  time_lock: '⏰ Time lock',
  admin_login: '🔐 Parent unlocked',
  admin_login_failed: '⚠️ Wrong parent password',
  admin_exit: '🚪 App exited by parent',
  admin_cli_unlock: '🔐 Unlock script used',
  setup: '✨ Setup',
};

export default function ActivityPanel({ onError }) {
  const [rows, setRows] = useState([]);
  const [children, setChildren] = useState([]);
  const [childId, setChildId] = useState('');
  const [error, setError] = useState('');

  const load = useCallback(() => {
    api.admin.activity
      .list({ limit: 500, childId: childId ? Number(childId) : undefined })
      .then(setRows)
      .catch((e) => setError(onError(e)));
  }, [childId, onError]);

  useEffect(load, [load]);
  useEffect(() => {
    api.admin.children.list().then(setChildren).catch(() => {});
  }, []);

  async function clear() {
    try {
      await api.admin.activity.clear();
      load();
    } catch (e) {
      setError(onError(e));
    }
  }

  return (
    <section>
      <div className="panel-header">
        <h1>Activity log</h1>
        <select value={childId} onChange={(e) => setChildId(e.target.value)}>
          <option value="">All children</option>
          {children.map((c) => (
            <option key={c.id} value={c.id}>
              {c.name}
            </option>
          ))}
        </select>
        <button className="btn" onClick={load}>
          ↻ Refresh
        </button>
        <ConfirmButton className="btn btn-danger-soft" onConfirm={clear} confirmLabel="Clear everything">
          Clear log
        </ConfirmButton>
      </div>
      {error && <p className="form-error">{error}</p>}
      {rows.length === 0 ? (
        <div className="empty-admin">Nothing logged yet.</div>
      ) : (
        <div className="table-wrap">
          <table className="table">
            <thead>
              <tr>
                <th>When</th>
                <th>Who</th>
                <th>What</th>
                <th>Item</th>
                <th>Details</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.id} className={r.action === 'blocked' || r.action === 'admin_login_failed' ? 'row-warn' : ''}>
                  <td className="nowrap">{formatDateTime(r.timestamp)}</td>
                  <td>{r.child_name || '—'}</td>
                  <td className="nowrap">{ACTION_LABELS[r.action] || r.action}</td>
                  <td>{r.content_title || '—'}</td>
                  <td className="url">{r.detail || ''}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}
