import { useState } from 'react';
import { formatDateTime, useServerData } from '../api';

const ACTION_LABELS = {
  open: '▶ Opened',
  request: '🙋 Requested',
  blocked: '🚧 Blocked page',
  login: '👋 Started session',
  time_lock: '⏰ Time lock',
  admin_login: '🔐 Parent unlocked on laptop',
  admin_login_failed: '⚠️ Wrong parent password',
  admin_exit: '🚪 App exited by parent',
  admin_cli_unlock: '🔐 Unlock script used',
  setup: '✨ Setup',
};

export default function Activity() {
  const [deviceId, setDeviceId] = useState('');
  const devices = useServerData('/api/v1/devices');
  const { data, error, reload } = useServerData(`/api/v1/activity?limit=500${deviceId ? `&device_id=${deviceId}` : ''}`);
  const rows = data || [];

  return (
    <section>
      <div className="panel-header">
        <h1>Activity</h1>
        <select value={deviceId} onChange={(e) => setDeviceId(e.target.value)}>
          <option value="">All laptops</option>
          {(devices.data || []).map((d) => (
            <option key={d.id} value={d.id}>
              {d.name}
            </option>
          ))}
        </select>
        <button className="btn" onClick={reload}>
          ↻ Refresh
        </button>
      </div>
      <p className="muted">Laptops send their activity every minute while they are online.</p>
      {error && <p className="form-error">{error}</p>}
      {data && rows.length === 0 ? (
        <div className="empty-admin">Nothing logged yet.</div>
      ) : (
        <div className="table-wrap">
          <table className="table">
            <thead>
              <tr>
                <th>When</th>
                <th>Laptop</th>
                <th>Child</th>
                <th>What</th>
                <th>Item</th>
                <th>Details</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.id} className={r.action === 'blocked' || r.action === 'admin_login_failed' ? 'row-warn' : ''}>
                  <td className="nowrap">{formatDateTime(r.timestamp)}</td>
                  <td>{r.device_name}</td>
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
