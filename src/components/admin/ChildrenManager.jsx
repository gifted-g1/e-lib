import { useCallback, useEffect, useState } from 'react';
import { api, formatMinutes } from '../../api';
import ConfirmButton from '../ConfirmButton';

const EMPTY = { name: '', age: '', avatar: '' };

export default function ChildrenManager({ onError }) {
  const [children, setChildren] = useState([]);
  const [form, setForm] = useState(EMPTY);
  const [error, setError] = useState('');

  const load = useCallback(() => {
    api.admin.children.list().then(setChildren).catch((e) => setError(onError(e)));
  }, [onError]);
  useEffect(load, [load]);

  const run = async (fn) => {
    setError('');
    try {
      await fn();
      load();
    } catch (e) {
      setError(onError(e));
    }
  };

  const set = (k) => (e) => setForm({ ...form, [k]: e.target.value });

  return (
    <section>
      <div className="panel-header">
        <h1>Children</h1>
      </div>
      <p className="muted">
        The <strong>active</strong> profile is the one using the library now. With several profiles, the child picks
        one at start-up; switching afterwards needs a parent.
      </p>
      {error && <p className="form-error">{error}</p>}

      <ul className="admin-list">
        {children.map((c) => (
          <li key={c.id} className="admin-row">
            <span className="row-thumb">{c.avatar || '🧒'}</span>
            <div className="row-main">
              <strong>
                {c.name} {c.age != null && <span className="muted">· age {c.age}</span>}
              </strong>
              <span className="muted small">Used today: {formatMinutes(c.usedSecondsToday)}</span>
            </div>
            <div className="row-actions">
              {c.active ? (
                <span className="chip chip-ok">Active</span>
              ) : (
                <button className="btn btn-small" onClick={() => run(() => api.admin.children.setActive(c.id))}>
                  Make active
                </button>
              )}
              <button className="btn btn-small" onClick={() => setForm({ id: c.id, name: c.name, age: c.age ?? '', avatar: c.avatar || '' })}>
                Edit
              </button>
              <ConfirmButton onConfirm={() => run(() => api.admin.children.delete(c.id))} confirmLabel="Delete">
                Delete
              </ConfirmButton>
            </div>
          </li>
        ))}
      </ul>

      <form
        className="inline-form"
        onSubmit={(e) => {
          e.preventDefault();
          run(async () => {
            await api.admin.children.save(form);
            setForm(EMPTY);
          });
        }}
      >
        <input className="emoji-input" placeholder="🦊" value={form.avatar} onChange={set('avatar')} maxLength={4} />
        <input className="grow" placeholder="Name" value={form.name} onChange={set('name')} />
        <input className="narrow-input" type="number" min="3" max="18" placeholder="Age" value={form.age} onChange={set('age')} />
        <button className="btn btn-primary" disabled={!form.name.trim()}>
          {form.id ? 'Save changes' : '＋ Add child'}
        </button>
        {form.id && (
          <button type="button" className="btn" onClick={() => setForm(EMPTY)}>
            Cancel
          </button>
        )}
      </form>
    </section>
  );
}
