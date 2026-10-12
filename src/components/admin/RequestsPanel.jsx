import { useCallback, useEffect, useState } from 'react';
import { api, formatDateTime } from '../../api';

export default function RequestsPanel({ onError, onChanged }) {
  const [status, setStatus] = useState('pending');
  const [requests, setRequests] = useState([]);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');

  const load = useCallback(() => {
    api.admin.requests.list(status).then(setRequests).catch((e) => setError(onError(e)));
  }, [status, onError]);
  useEffect(load, [load]);

  async function resolve(req, decision) {
    setError('');
    setNotice('');
    try {
      const { effect } = await api.admin.requests.resolve({ id: req.id, status: decision });
      setNotice(decision === 'approved' ? `Approved. ${effect || ''}` : 'Request denied.');
      load();
      onChanged();
    } catch (e) {
      setError(onError(e));
    }
  }

  return (
    <section>
      <div className="panel-header">
        <h1>Access requests</h1>
        <div className="segmented">
          {['pending', 'approved', 'denied', 'all'].map((s) => (
            <label key={s}>
              <input type="radio" checked={status === s} onChange={() => setStatus(s)} /> {s[0].toUpperCase() + s.slice(1)}
            </label>
          ))}
        </div>
      </div>
      <p className="muted">
        Approving a locked item unlocks it. Approving a blocked web page allows that website from the site the child was
        using. Free-text requests are reminders — add the content yourself from the Content tab.
      </p>
      {error && <p className="form-error">{error}</p>}
      {notice && <p className="form-success">{notice}</p>}
      {requests.length === 0 && <div className="empty-admin">No {status === 'all' ? '' : status} requests.</div>}

      <ul className="admin-list">
        {requests.map((r) => (
          <li key={r.id} className="admin-row">
            <div className="row-main">
              <strong>{r.content_title}</strong>
              {r.content_url && <span className="muted small url">{r.content_url}</span>}
              <span className="muted small">
                {r.child_name || 'Unknown child'} · {formatDateTime(r.created_at)}
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
    </section>
  );
}
