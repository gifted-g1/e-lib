import { useCallback, useEffect, useState } from 'react';
import { api, formatDateTime } from '../../api';
import { useElibEvent } from '../../hooks';
import ConfirmButton from '../ConfirmButton';

export default function SettingsPanel({ onError }) {
  const [pw, setPw] = useState({ current: '', next: '', confirm: '' });
  const [pwMsg, setPwMsg] = useState({ error: '', ok: '' });
  const [settings, setSettings] = useState(null);
  const [syncMsg, setSyncMsg] = useState({ error: '', ok: '' });
  const [syncStatus, setSyncStatus] = useState(null);
  const [info, setInfo] = useState(null);
  const [siteMsg, setSiteMsg] = useState('');

  const load = useCallback(() => {
    api.admin.settings.get().then(setSettings).catch(onError);
    api.admin.sync.status().then(setSyncStatus).catch(() => {});
    api.admin.info().then(setInfo).catch(() => {});
  }, [onError]);
  useEffect(load, [load]);
  useElibEvent('sync:status', (s) => setSyncStatus((prev) => ({ ...prev, ...s })));
  useElibEvent('net:status', ({ online }) => setSyncStatus((prev) => ({ ...prev, online })));

  async function changePassword(e) {
    e.preventDefault();
    setPwMsg({ error: '', ok: '' });
    if (pw.next !== pw.confirm) return setPwMsg({ error: 'New passwords do not match.', ok: '' });
    try {
      await api.admin.changePassword({ current: pw.current, next: pw.next });
      setPw({ current: '', next: '', confirm: '' });
      setPwMsg({ error: '', ok: 'Password changed.' });
    } catch (err) {
      setPwMsg({ error: onError(err), ok: '' });
    }
  }

  async function saveSync(e) {
    e.preventDefault();
    setSyncMsg({ error: '', ok: '' });
    try {
      await api.admin.settings.save({ sync_server_url: settings.sync_server_url, sync_token: settings.sync_token });
      setSyncMsg({ error: '', ok: 'Saved. Syncing now…' });
    } catch (err) {
      setSyncMsg({ error: onError(err), ok: '' });
    }
  }

  async function syncNow() {
    try {
      setSyncStatus({ ...(await api.admin.sync.now()), online: syncStatus?.online });
    } catch (err) {
      setSyncMsg({ error: onError(err), ok: '' });
    }
  }

  async function clearSites() {
    try {
      await api.admin.sites.clearData();
      setSiteMsg('Website data cleared.');
    } catch (err) {
      setSiteMsg(onError(err));
    }
  }

  return (
    <section>
      <div className="panel-header">
        <h1>Settings</h1>
      </div>

      <form className="form card" onSubmit={changePassword}>
        <h2>Parent password</h2>
        <div className="form-row">
          <label>
            Current password
            <input type="password" value={pw.current} onChange={(e) => setPw({ ...pw, current: e.target.value })} />
          </label>
          <label>
            New password
            <input type="password" value={pw.next} onChange={(e) => setPw({ ...pw, next: e.target.value })} />
          </label>
          <label>
            Confirm
            <input type="password" value={pw.confirm} onChange={(e) => setPw({ ...pw, confirm: e.target.value })} />
          </label>
        </div>
        {pwMsg.error && <p className="form-error">{pwMsg.error}</p>}
        {pwMsg.ok && <p className="form-success">{pwMsg.ok}</p>}
        <div className="form-actions">
          <button className="btn btn-primary" disabled={!pw.current || !pw.next}>
            Change password
          </button>
        </div>
      </form>

      <div className="form card">
        <h2>Offline sync</h2>
        {syncStatus && (
          <p>
            <span className={`pill ${syncStatus.online ? 'pill-online' : 'pill-offline'}`}>
              {syncStatus.online ? '● Online' : '● Offline'}
            </span>{' '}
            {syncStatus.message}
            {settings?.last_sync_at && <span className="muted small"> · last run {formatDateTime(settings.last_sync_at)}</span>}
          </p>
        )}
        <p className="muted small">
          Videos and PDFs added by link are downloaded automatically whenever the computer is online, so they keep
          working offline.
        </p>
        <div className="form-actions start">
          <button className="btn" onClick={syncNow}>
            ↻ Sync now
          </button>
        </div>
      </div>

      {settings && (
        <form className="form card" onSubmit={saveSync}>
          <h2>Parent app connection (optional)</h2>
          <p className="muted small">
            To manage this laptop from the Parent app, add it there under <strong>Laptops</strong>, then enter the
            server address and the device token it shows. Once connected, content, time limits and request answers
            come from the Parent app and override changes made here. Leave empty to manage everything on this
            computer.
          </p>
          <label>
            Server address
            <input
              value={settings.sync_server_url}
              onChange={(e) => setSettings({ ...settings, sync_server_url: e.target.value })}
              placeholder="https://library.example.org"
            />
          </label>
          <label>
            Device token
            <input
              type="password"
              value={settings.sync_token}
              onChange={(e) => setSettings({ ...settings, sync_token: e.target.value })}
              autoComplete="off"
            />
          </label>
          <p className="muted small">
            Device ID: <code>{settings.device_id}</code>
          </p>
          {settings.last_sync_error && <p className="form-error">{settings.last_sync_error}</p>}
          {syncMsg.error && <p className="form-error">{syncMsg.error}</p>}
          {syncMsg.ok && <p className="form-success">{syncMsg.ok}</p>}
          <div className="form-actions">
            <button className="btn btn-primary">Save server settings</button>
          </div>
        </form>
      )}

      <div className="form card">
        <h2>Websites</h2>
        <p className="muted small">Removes cookies and logins for all approved websites.</p>
        {siteMsg && <p className="form-success">{siteMsg}</p>}
        <div className="form-actions start">
          <ConfirmButton className="btn btn-danger-soft" onConfirm={clearSites} confirmLabel="Clear website data">
            Clear website data
          </ConfirmButton>
        </div>
      </div>

      {info && (
        <div className="card">
          <h2>About</h2>
          <p className="muted small">
            Version {info.version} · {info.kiosk ? 'Kiosk mode' : 'Windowed (development) mode'}
            <br />
            Data folder: <code>{info.dataDir}</code>
          </p>
        </div>
      )}
    </section>
  );
}
