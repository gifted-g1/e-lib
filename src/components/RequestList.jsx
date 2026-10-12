import { useState } from 'react';
import { api, errorMessage, formatDateTime } from '../api';

export default function RequestList({ requests, onChanged, emptyText = 'No requests.' }) {
  const [notice, setNotice] = useState('');
  const [error, setError] = useState('');

  async function resolve(req, status) {
    setNotice('');
    setError('');
    try {
      const r = await api.post(`/api/v1/requests/${req.id}/resolve`, { status });
      setNotice(status === 'approved' ? `Approved. ${r.effect || ''} It reaches the laptop within a minute.` : 'Request denied.');
      onChanged();
    } catch (e) {
      setError(errorMessage(e));
    }
  }

  return (
    <>
      {notice && <p className="form-success">{notice}</p>}
      {error && <p className="form-error">{error}</p>}
      {requests.length === 0 ? (
        <div className="empty-admin">{emptyText}</div>
      ) : (
        <ul className="admin-list">
          {requests.map((r) => (
            <li key={r.id} className="admin-row">
              <div className="row-main">
                <strong>{r.content_title}</strong>
                {r.content_url && <span className="muted small url">{r.content_url}</span>}
                <span className="muted small">
                  {r.child_name || 'A child'} on {r.device_name} · {formatDateTime(r.created_at)}
                  {r.resolved_at ? ` · ${r.status} ${formatDateTime(r.resolved_at)}` : ''}
                </span>
              </div>
              {r.status === 'pending' ? (
                <div className="row-actions">
                  <button className="btn btn-small btn-primary" onClick={() => resolve(r, 'approved')}>
                    ✓ Approve
                  </button>
                  <button className="btn btn-small btn-danger-soft" onClick={() => resolve(r, 'denied')}>
                    ✕ Deny
                  </button>
                </div>
              ) : (
                <span className={`chip ${r.status === 'approved' ? 'chip-ok' : 'chip-err'}`}>{r.status}</span>
              )}
            </li>
          ))}
        </ul>
      )}
    </>
  );
}
