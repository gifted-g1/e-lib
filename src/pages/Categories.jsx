import { useState } from 'react';
import { api, errorMessage, useServerData } from '../api';
import ConfirmButton from '../components/ConfirmButton';

export default function Categories() {
  const { data, error: loadError, reload } = useServerData('/api/v1/categories');
  const [draft, setDraft] = useState({ name: '', icon: '' });
  const [editing, setEditing] = useState(null);
  const [error, setError] = useState('');
  const categories = data || [];

  const run = async (fn) => {
    setError('');
    try {
      await fn();
      reload();
    } catch (e) {
      setError(errorMessage(e));
    }
  };

  const move = (index, delta) =>
    run(() => {
      const ids = categories.map((c) => c.id);
      const j = index + delta;
      [ids[index], ids[j]] = [ids[j], ids[index]];
      return api.post('/api/v1/categories/reorder', { ids });
    });

  return (
    <section>
      <div className="panel-header">
        <h1>Categories</h1>
      </div>
      <p className="muted">
        Categories are the tabs children see on the home screen. Deleting one moves its items to “No category”.
      </p>
      {(error || loadError) && <p className="form-error">{error || loadError}</p>}

      <ul className="admin-list">
        {categories.map((c, i) => (
          <li key={c.id} className="admin-row">
            {editing?.id === c.id ? (
              <>
                <input className="emoji-input" value={editing.icon || ''} onChange={(e) => setEditing({ ...editing, icon: e.target.value })} maxLength={4} />
                <input className="grow" value={editing.name} onChange={(e) => setEditing({ ...editing, name: e.target.value })} autoFocus />
                <div className="row-actions">
                  <button
                    className="btn btn-small btn-primary"
                    onClick={() =>
                      run(async () => {
                        await api.patch(`/api/v1/categories/${c.id}`, { name: editing.name, icon: editing.icon });
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
                  <button className="btn btn-small" disabled={i === categories.length - 1} onClick={() => move(i, 1)} aria-label="Move down">
                    ↓
                  </button>
                  <button className="btn btn-small" onClick={() => setEditing(c)}>
                    Edit
                  </button>
                  <ConfirmButton onConfirm={() => run(() => api.del(`/api/v1/categories/${c.id}`))} confirmLabel="Delete">
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
            await api.post('/api/v1/categories', draft);
            setDraft({ name: '', icon: '' });
          });
        }}
      >
        <input className="emoji-input" placeholder="🎨" value={draft.icon} onChange={(e) => setDraft({ ...draft, icon: e.target.value })} maxLength={4} />
        <input className="grow" placeholder="New category name" value={draft.name} onChange={(e) => setDraft({ ...draft, name: e.target.value })} />
        <button className="btn btn-primary" disabled={!draft.name.trim()}>
          ＋ Add category
        </button>
      </form>
    </section>
  );
}
