import { useCallback, useEffect, useState } from 'react';
import { api } from '../../api';
import ConfirmButton from '../ConfirmButton';

export default function CategoryManager({ onError }) {
  const [categories, setCategories] = useState([]);
  const [draft, setDraft] = useState({ name: '', icon: '' });
  const [editing, setEditing] = useState(null);
  const [error, setError] = useState('');

  const load = useCallback(() => {
    api.admin.categories.list().then(setCategories).catch((e) => setError(onError(e)));
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

  const move = (index, delta) =>
    run(async () => {
      const ids = categories.map((c) => c.id);
      const j = index + delta;
      [ids[index], ids[j]] = [ids[j], ids[index]];
      await api.admin.categories.reorder(ids);
    });

  return (
    <section>
      <div className="panel-header">
        <h1>Categories</h1>
      </div>
      <p className="muted">Categories are the tabs your child sees on the home screen. Empty categories are hidden. Deleting a
        category moves its items to “No category”.</p>
      {error && <p className="form-error">{error}</p>}

      <ul className="admin-list">
        {categories.map((c, i) => (
          <li key={c.id} className="admin-row">
            {editing?.id === c.id ? (
              <>
                <input
                  className="emoji-input"
                  value={editing.icon || ''}
                  onChange={(e) => setEditing({ ...editing, icon: e.target.value })}
                  maxLength={4}
                />
                <input
                  className="grow"
                  value={editing.name}
                  onChange={(e) => setEditing({ ...editing, name: e.target.value })}
                  autoFocus
                />
                <div className="row-actions">
                  <button
                    className="btn btn-small btn-primary"
                    onClick={() =>
                      run(async () => {
                        await api.admin.categories.save(editing);
                        setEditing(null);
                      })
                    }
                  >
                    Save
                  </button>
                  <button className="btn btn-small" onClick={() => setEditing(null)}>
                    Cancel
                  </button>
                </div>
              </>
            ) : (
              <>
                <span className="row-thumb">{c.icon || '📁'}</span>
                <strong className="grow">{c.name}</strong>
                <div className="row-actions">
                  <button className="btn btn-small" disabled={i === 0} onClick={() => move(i, -1)} aria-label="Move up">
                    ↑
                  </button>
                  <button
                    className="btn btn-small"
                    disabled={i === categories.length - 1}
                    onClick={() => move(i, 1)}
                    aria-label="Move down"
                  >
                    ↓
                  </button>
                  <button className="btn btn-small" onClick={() => setEditing(c)}>
                    Edit
                  </button>
                  <ConfirmButton onConfirm={() => run(() => api.admin.categories.delete(c.id))} confirmLabel="Delete">
                    Delete
                  </ConfirmButton>
                </div>
              </>
            )}
          </li>
        ))}
      </ul>

      <form
        className="inline-form"
        onSubmit={(e) => {
          e.preventDefault();
          run(async () => {
            await api.admin.categories.save(draft);
            setDraft({ name: '', icon: '' });
          });
        }}
      >
        <input
          className="emoji-input"
          placeholder="🎨"
          value={draft.icon}
          onChange={(e) => setDraft({ ...draft, icon: e.target.value })}
          maxLength={4}
        />
        <input
          className="grow"
          placeholder="New category name"
          value={draft.name}
          onChange={(e) => setDraft({ ...draft, name: e.target.value })}
        />
        <button className="btn btn-primary" disabled={!draft.name.trim()}>
          ＋ Add category
        </button>
      </form>
    </section>
  );
}
