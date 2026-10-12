import { useCallback, useEffect, useMemo, useState } from 'react';
import { api, TYPE_META } from '../../api';
import { useElibEvent } from '../../hooks';
import ConfirmButton from '../ConfirmButton';
import ContentForm from './ContentForm';

function StatusChips({ item }) {
  return (
    <div className="chips">
      {item.is_approved ? <span className="chip chip-ok">Visible</span> : <span className="chip chip-warn">Locked</span>}
      {item.type === 'site' && <span className="chip">Online only</span>}
      {item.type !== 'site' && item.cached && <span className="chip chip-ok">Offline ready</span>}
      {item.type !== 'site' && !item.cached && !item.sync_error && <span className="chip">Downloading when online</span>}
      {item.type !== 'site' && !item.cached && item.sync_error && (
        <span className="chip chip-err" title={item.sync_error}>
          Download failed
        </span>
      )}
      {item.remote_id && <span className="chip">Synced</span>}
    </div>
  );
}

export default function ContentManager({ onError }) {
  const [data, setData] = useState({ categories: [], items: [] });
  const [filter, setFilter] = useState('all');
  const [editing, setEditing] = useState(null); // null | {} (new) | item
  const [error, setError] = useState('');

  const load = useCallback(() => {
    api.admin.content.list().then(setData).catch((e) => setError(onError(e)));
  }, [onError]);
  useEffect(load, [load]);
  useElibEvent('content:changed', load);

  const groups = useMemo(() => {
    const cats = [...data.categories, { id: null, name: 'No category', icon: '❔' }];
    return cats
      .map((c) => ({ ...c, items: data.items.filter((i) => (i.category_id ?? null) === c.id) }))
      .filter((g) => g.items.length && (filter === 'all' || filter === String(g.id)));
  }, [data, filter]);

  async function move(group, index, delta) {
    const ids = group.items.map((i) => i.id);
    const j = index + delta;
    if (j < 0 || j >= ids.length) return;
    [ids[index], ids[j]] = [ids[j], ids[index]];
    try {
      await api.admin.content.reorder(ids);
      load();
    } catch (e) {
      setError(onError(e));
    }
  }

  async function remove(item) {
    try {
      await api.admin.content.delete(item.id);
      load();
    } catch (e) {
      setError(onError(e));
    }
  }

  async function toggleApproved(item) {
    try {
      await api.admin.content.save({ ...item, is_approved: !item.is_approved });
      load();
    } catch (e) {
      setError(onError(e));
    }
  }

  return (
    <section>
      <div className="panel-header">
        <h1>Content</h1>
        <select value={filter} onChange={(e) => setFilter(e.target.value)}>
          <option value="all">All categories</option>
          {data.categories.map((c) => (
            <option key={c.id} value={String(c.id)}>
              {c.icon} {c.name}
            </option>
          ))}
        </select>
        <button className="btn btn-primary" onClick={() => setEditing({})}>
          ＋ Add content
        </button>
      </div>
      {error && <p className="form-error">{error}</p>}
      {data.items.length === 0 && (
        <div className="empty-admin">
          <p>No content yet. Add a video, a PDF or a website to get started.</p>
        </div>
      )}

      {groups.map((group) => (
        <div key={group.id ?? 'none'} className="content-group">
          <h2>
            {group.icon} {group.name}
          </h2>
          <ul className="admin-list">
            {group.items.map((item, i) => (
              <li key={item.id} className="admin-row">
                <div className="row-thumb">
                  {item.thumbnail_url ? <img src={item.thumbnail_url} alt="" /> : TYPE_META[item.type].icon}
                </div>
                <div className="row-main">
                  <strong>{item.title}</strong>
                  <span className="muted small">
                    {TYPE_META[item.type].label}
                    {item.source_url ? ` · ${item.source_url}` : item.local_path ? ' · uploaded file' : ''}
                  </span>
                  <StatusChips item={item} />
                </div>
                <div className="row-actions">
                  <button className="btn btn-small" onClick={() => move(group, i, -1)} disabled={i === 0} aria-label="Move up">
                    ↑
                  </button>
                  <button
                    className="btn btn-small"
                    onClick={() => move(group, i, 1)}
                    disabled={i === group.items.length - 1}
                    aria-label="Move down"
                  >
                    ↓
                  </button>
                  <button className="btn btn-small" onClick={() => toggleApproved(item)}>
                    {item.is_approved ? 'Lock' : 'Unlock'}
                  </button>
                  <button className="btn btn-small" onClick={() => setEditing(item)}>
                    Edit
                  </button>
                  <ConfirmButton onConfirm={() => remove(item)} confirmLabel="Delete">
                    Delete
                  </ConfirmButton>
                </div>
              </li>
            ))}
          </ul>
        </div>
      ))}

      {editing && (
        <ContentForm
          item={editing}
          categories={data.categories}
          onError={onError}
          onClose={() => setEditing(null)}
          onSaved={() => {
            setEditing(null);
            load();
          }}
        />
      )}
    </section>
  );
}
