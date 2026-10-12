import { useCallback, useEffect, useState } from 'react';
import { api, formatMinutes } from '../../api';

export default function LimitsPanel({ onError }) {
  const [settings, setSettings] = useState(null);
  const [children, setChildren] = useState([]);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');

  const load = useCallback(() => {
    api.admin.settings.get().then(setSettings).catch((e) => setError(onError(e)));
    api.admin.children.list().then(setChildren).catch(() => {});
  }, [onError]);
  useEffect(load, [load]);

  if (!settings) return null;
  const set = (k) => (e) =>
    setSettings({ ...settings, [k]: e.target.type === 'checkbox' ? (e.target.checked ? '1' : '0') : e.target.value });

  async function save(e) {
    e.preventDefault();
    setError('');
    setNotice('');
    try {
      await api.admin.settings.save({
        daily_limit_minutes: settings.daily_limit_minutes,
        schedule_enabled: settings.schedule_enabled,
        schedule_start: settings.schedule_start,
        schedule_end: settings.schedule_end,
      });
      setNotice('Saved.');
    } catch (err) {
      setError(onError(err));
    }
  }

  async function grant(childId, minutes) {
    try {
      await api.admin.usage.grant({ childId, minutes });
      setNotice(`Added ${minutes} minutes for today.`);
      load();
    } catch (err) {
      setError(onError(err));
    }
  }

  return (
    <section>
      <div className="panel-header">
        <h1>Time limits</h1>
      </div>
      <form className="form card" onSubmit={save}>
        <label>
          Daily limit per child (minutes, 0 = no limit)
          <input
            type="number"
            min="0"
            max="1440"
            className="narrow-input"
            value={settings.daily_limit_minutes}
            onChange={set('daily_limit_minutes')}
          />
        </label>
        <label className="inline">
          <input type="checkbox" checked={settings.schedule_enabled === '1'} onChange={set('schedule_enabled')} />
          Only open the library between set hours
        </label>
        <div className="form-row">
          <label>
            Opens at
            <input type="time" value={settings.schedule_start} onChange={set('schedule_start')} disabled={settings.schedule_enabled !== '1'} />
          </label>
          <label>
            Closes at
            <input type="time" value={settings.schedule_end} onChange={set('schedule_end')} disabled={settings.schedule_enabled !== '1'} />
          </label>
        </div>
        {error && <p className="form-error">{error}</p>}
        {notice && <p className="form-success">{notice}</p>}
        <div className="form-actions">
          <button className="btn btn-primary">Save limits</button>
        </div>
      </form>

      <h2>Today</h2>
      <ul className="admin-list">
        {children.map((c) => (
          <li key={c.id} className="admin-row">
            <span className="row-thumb">{c.avatar || '🧒'}</span>
            <div className="row-main">
              <strong>{c.name}</strong>
              <span className="muted small">Used today: {formatMinutes(c.usedSecondsToday)}</span>
            </div>
            <div className="row-actions">
              <button className="btn btn-small" onClick={() => grant(c.id, 15)}>
                +15 min
              </button>
              <button className="btn btn-small" onClick={() => grant(c.id, 30)}>
                +30 min
              </button>
            </div>
          </li>
        ))}
      </ul>
      <p className="muted small">Time spent in the parent dashboard is not counted.</p>
    </section>
  );
}
