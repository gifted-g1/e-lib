import { useState } from 'react';
import { api, errorMessage, formatMinutes, isOnline, timeAgo, useServerData } from '../api';
import Modal from '../components/Modal';
import ConfirmButton from '../components/ConfirmButton';

function TokenInstructions({ server, token, name }) {
  const [copied, setCopied] = useState('');
  const copy = (text, what) =>
    navigator.clipboard.writeText(text).then(() => {
      setCopied(what);
      setTimeout(() => setCopied(''), 2000);
    });
  return (
    <div className="form">
      <p>
        Connect <strong>{name}</strong> with these details. <strong>The token is shown only once</strong> — you can
        always make a new one later.
      </p>
      <label>
        Server address
        <div className="token-box">
          <code>{server}</code>
          <button type="button" className="btn btn-small" onClick={() => copy(server, 'server')}>
            {copied === 'server' ? 'Copied ✓' : 'Copy'}
          </button>
        </div>
      </label>
      <label>
        Device token
        <div className="token-box">
          <code>{token}</code>
          <button type="button" className="btn btn-small" onClick={() => copy(token, 'token')}>
            {copied === 'token' ? 'Copied ✓' : 'Copy'}
          </button>
        </div>
      </label>
      <ol className="steps">
        <li>On the child's laptop, press and hold the 📖 logo for 3 seconds and enter the library password.</li>
        <li>
          Open <strong>Settings → Parent app connection</strong>.
        </li>
        <li>Paste the server address and device token, then press “Save server settings”.</li>
        <li>Within a minute the laptop shows up here as online.</li>
      </ol>
    </div>
  );
}

function LaptopRow({ device, server, onChanged }) {
  const [form, setForm] = useState({
    daily_limit_minutes: device.daily_limit_minutes,
    schedule_enabled: !!device.schedule_enabled,
    schedule_start: device.schedule_start,
    schedule_end: device.schedule_end,
  });
  const [name, setName] = useState(device.name);
  const [renaming, setRenaming] = useState(false);
  const [newToken, setNewToken] = useState(null);
  const [msg, setMsg] = useState({ ok: '', error: '' });

  const run = async (fn, ok) => {
    setMsg({ ok: '', error: '' });
    try {
      await fn();
      setMsg({ ok, error: '' });
      onChanged();
    } catch (e) {
      setMsg({ ok: '', error: errorMessage(e) });
    }
  };

  const saveLimits = (e) => {
    e.preventDefault();
    run(
      () =>
        api.patch(`/api/v1/devices/${device.id}`, {
          ...form,
          daily_limit_minutes: parseInt(form.daily_limit_minutes, 10) || 0,
        }),
      'Saved. The laptop picks this up within a minute.'
    );
  };

  return (
    <div className="card">
      <div className="panel-header">
        {renaming ? (
          <form
            className="inline-form"
            style={{ margin: 0, flex: 1 }}
            onSubmit={(e) => {
              e.preventDefault();
              run(() => api.patch(`/api/v1/devices/${device.id}`, { name }), 'Renamed.').then(() => setRenaming(false));
            }}
          >
            <input className="grow" value={name} onChange={(e) => setName(e.target.value)} autoFocus />
            <button className="btn btn-small btn-primary">Save</button>
            <button type="button" className="btn btn-small" onClick={() => setRenaming(false)}>
              Cancel
            </button>
          </form>
        ) : (
          <h2 style={{ margin: '0 auto 0 0' }}>
            <span className={`dot ${isOnline(device) ? 'dot-online' : ''}`} /> {device.name}{' '}
            <button className="btn btn-small btn-link" onClick={() => setRenaming(true)}>
              rename
            </button>
          </h2>
        )}
        <span className="muted small">
          {device.hardware_id
            ? isOnline(device)
              ? `Online · app ${device.app_version || '?'}`
              : `Last seen ${timeAgo(device.last_seen_at)}`
            : 'Waiting for the laptop to connect'}
        </span>
      </div>

      {(device.children || []).length > 0 && (
        <ul className="admin-list section">
          {device.children.map((c) => (
            <li key={c.local_id} className="admin-row">
              <span className="row-thumb">{c.avatar || '🧒'}</span>
              <div className="row-main">
                <strong>
                  {c.name} {c.age != null && <span className="muted">· age {c.age}</span>}
                </strong>
                <span className="muted small">
                  {c.usage_seconds != null ? `Used ${formatMinutes(c.usage_seconds)} on ${c.usage_day}` : 'No use yet'}
                </span>
              </div>
            </li>
          ))}
        </ul>
      )}

      <form className="limits-form form" onSubmit={saveLimits}>
        <label>
          Daily limit (min, 0 = none)
          <input
            type="number"
            min="0"
            max="1440"
            className="narrow-input"
            value={form.daily_limit_minutes}
            onChange={(e) => setForm({ ...form, daily_limit_minutes: e.target.value })}
          />
        </label>
        <label className="inline">
          <input
            type="checkbox"
            checked={form.schedule_enabled}
            onChange={(e) => setForm({ ...form, schedule_enabled: e.target.checked })}
          />
          Open hours
        </label>
        <label>
          From
          <input
            type="time"
            value={form.schedule_start}
            disabled={!form.schedule_enabled}
            onChange={(e) => setForm({ ...form, schedule_start: e.target.value })}
          />
        </label>
        <label>
          To
          <input
            type="time"
            value={form.schedule_end}
            disabled={!form.schedule_enabled}
            onChange={(e) => setForm({ ...form, schedule_end: e.target.value })}
          />
        </label>
        <button className="btn btn-primary">Save limits</button>
      </form>

      <div className="form-actions start" style={{ marginTop: 14, flexWrap: 'wrap' }}>
        <button
          className="btn"
          onClick={() => run(() => api.post(`/api/v1/devices/${device.id}/grants`, { minutes: 15 }), 'Added 15 minutes for today.')}
        >
          +15 min today
        </button>
        <button
          className="btn"
          onClick={() => run(() => api.post(`/api/v1/devices/${device.id}/grants`, { minutes: 30 }), 'Added 30 minutes for today.')}
        >
          +30 min today
        </button>
        <span className="grow" />
        <ConfirmButton
          className="btn"
          confirmLabel="Make new token"
          onConfirm={() =>
            run(async () => setNewToken((await api.post(`/api/v1/devices/${device.id}/token`)).token), 'New token created.')
          }
        >
          New token
        </ConfirmButton>
        <ConfirmButton
          className="btn btn-danger-soft"
          confirmLabel="Remove laptop"
          onConfirm={() => run(() => api.del(`/api/v1/devices/${device.id}`), 'Removed.')}
        >
          Remove
        </ConfirmButton>
      </div>
      {msg.ok && <p className="form-success" style={{ marginTop: 12 }}>{msg.ok}</p>}
      {msg.error && <p className="form-error" style={{ marginTop: 12 }}>{msg.error}</p>}

      {newToken && (
        <Modal title="New device token" onClose={() => setNewToken(null)}>
          <p className="form-error">The old token no longer works. Enter this one on the laptop.</p>
          <TokenInstructions server={server} token={newToken} name={device.name} />
        </Modal>
      )}
    </div>
  );
}

export default function Laptops({ config }) {
  const devices = useServerData('/api/v1/devices', { poll: 30_000 });
  const [adding, setAdding] = useState(false);
  const [name, setName] = useState('');
  const [created, setCreated] = useState(null);
  const [error, setError] = useState('');

  async function add(e) {
    e.preventDefault();
    setError('');
    try {
      const d = await api.post('/api/v1/devices', { name });
      setCreated(d);
      setName('');
      devices.reload();
    } catch (err) {
      setError(errorMessage(err));
    }
  }

  return (
    <section>
      <div className="panel-header">
        <h1>Laptops</h1>
        <button className="btn btn-primary" onClick={() => setAdding(true)}>
          ＋ Connect a laptop
        </button>
      </div>
      <p className="muted">Each child laptop has its own time limits. Content is shared by all laptops.</p>
      {devices.error && <p className="form-error">{devices.error}</p>}
      {devices.data && devices.data.length === 0 && <div className="empty-admin">No laptops yet.</div>}
      {(devices.data || []).map((d) => (
        <LaptopRow key={`${d.id}-${d.daily_limit_minutes}-${d.schedule_enabled}-${d.schedule_start}-${d.schedule_end}`} device={d} server={config.server} onChanged={devices.reload} />
      ))}

      {adding && (
        <Modal
          title={created ? 'Laptop added' : 'Connect a laptop'}
          onClose={() => {
            setAdding(false);
            setCreated(null);
          }}
        >
          {created ? (
            <TokenInstructions server={config.server} token={created.token} name={created.name} />
          ) : (
            <form className="form" onSubmit={add}>
              <label>
                Laptop name
                <input value={name} onChange={(e) => setName(e.target.value)} placeholder="Ada's laptop" autoFocus maxLength={100} />
              </label>
              {error && <p className="form-error">{error}</p>}
              <div className="form-actions">
                <button type="button" className="btn" onClick={() => setAdding(false)}>
                  Cancel
                </button>
                <button className="btn btn-primary" disabled={!name.trim()}>
                  Create token
                </button>
              </div>
            </form>
          )}
        </Modal>
      )}
    </section>
  );
}
