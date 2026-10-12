import { useState } from 'react';
import { api, bridge, errorMessage, formatDateTime, useServerData } from '../api';

export default function Account({ config, onSignedOut }) {
  const me = useServerData('/api/v1/me');
  const [pw, setPw] = useState({ current: '', next: '', confirm: '' });
  const [msg, setMsg] = useState({ ok: '', error: '' });

  async function change(e) {
    e.preventDefault();
    setMsg({ ok: '', error: '' });
    if (pw.next !== pw.confirm) return setMsg({ ok: '', error: 'New passwords do not match.' });
    try {
      await api.post('/api/v1/auth/password', { current: pw.current, next: pw.next });
      setPw({ current: '', next: '', confirm: '' });
      setMsg({ ok: 'Password changed. Other devices were signed out.', error: '' });
    } catch (err) {
      setMsg({ ok: '', error: errorMessage(err) });
    }
  }

  return (
    <section>
      <div className="panel-header">
        <h1>Account</h1>
        <button
          className="btn btn-danger-soft"
          onClick={async () => {
            await bridge.auth.logout();
            onSignedOut();
          }}
        >
          Sign out
        </button>
      </div>

      <div className="card">
        <p>
          Signed in as <strong>{config.email}</strong>
          {me.data?.created_at && <span className="muted"> · account created {formatDateTime(me.data.created_at)}</span>}
          <br />
          Server: <code>{config.server}</code>
        </p>
      </div>

      <form className="form card" onSubmit={change}>
        <h2>Change password</h2>
        <div className="form-row">
          <label>
            Current password
            <input type="password" value={pw.current} onChange={(e) => setPw({ ...pw, current: e.target.value })} autoComplete="current-password" />
          </label>
          <label>
            New password
            <input type="password" value={pw.next} onChange={(e) => setPw({ ...pw, next: e.target.value })} autoComplete="new-password" />
          </label>
          <label>
            Confirm
            <input type="password" value={pw.confirm} onChange={(e) => setPw({ ...pw, confirm: e.target.value })} autoComplete="new-password" />
          </label>
        </div>
        <p className="hint">This is your Parent app password. Each laptop's library password is separate and set on the laptop.</p>
        {msg.error && <p className="form-error">{msg.error}</p>}
        {msg.ok && <p className="form-success">{msg.ok}</p>}
        <div className="form-actions">
          <button className="btn btn-primary" disabled={!pw.current || !pw.next}>
            Change password
          </button>
        </div>
      </form>
    </section>
  );
}
