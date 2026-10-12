import { useMemo, useState } from 'react';
import { api, bridge, errorMessage, formatBytes, TYPE_META, useServerData } from '../api';
import ConfirmButton from '../components/ConfirmButton';
import ContentForm from '../components/ContentForm';

function Chips({ item }) {
  return (
    <div className="chips">
      {item.is_approved ? <span className="chip chip-ok">Visible</span> : <span className="chip chip-warn">Locked</span>}
      {item.type === 'site' ? (
        <span className="chip">Online only</span>
      ) : item.file_key ? (
        <span className="chip">Uploaded · {formatBytes(item.file_size)}</span>
      ) : (
        <span className="chip">Link</span>
      )}
    </div>
  );
}

export default function Content() {
  const content = useServerData('/api/v1/content');
  const categories = useServerData('/api/v1/categories');
  const [filter, setFilter] = useState('all');
  const [editing, setEditing] = useState(null);
  const [error, setError] = useState('');

  const cats = categories.data || [];
  const items = content.data || [];
  const groups = useMemo(() => {
    const all = [...cats, { id: null, name: 'No category', icon: '❔' }];
    return all
      .map((c) => ({ ...c, items: items.filter((i) => (i.category_id ?? null) === c.id) }))
      .filter((g) => g.items.length && (filter === 'all' || filter === String(g.id)));
  }, [cats, items, filter]);

  const run = async (fn) => {
    setError('');
    try {
      await fn();
      content.reload();
    } catch (e) {
      setError(errorMessage(e));
    }
  };

  const move = (group, index, delta) =>
    run(() => {
      const ids = group.items.map((i) => i.id);
      const j = index + delta;
      [ids[index], ids[j]] = [ids[j], ids[index]];
      return api.post('/api/v1/content/reorder', { ids });
    });

  const toggle = (item) =>
    run(() =>
      api.patch(`/api/v1/content/${item.id}`, {
        title: item.title,
        type: item.type,
        category_id: item.category_id,
        source_url: item.source_url || '',
        file_key: item.file_key || '',
        thumbnail_url: item.thumbnail_url || '',
        thumb_file_key: item.thumb_file_key || '',
        description: item.description || '',
        allowed_domains: item.allowed_domains || '',
        is_approved: !item.is_approved,
      })
    );

  return (
    <section>
      <div className="panel-header">
        <h1>Content</h1>
        <select value={filter} onChange={(e) => setFilter(e.target.value)}>
          <option value="all">All categories</option>
          {cats.map((c) => (
            <option key={c.id} value={String(c.id)}>
              {c.icon} {c.name}
            </option>
          ))}
        </select>
        <button className="btn btn-primary" onClick={() => setEditing({})}>
          ＋ Add content
        </button>
      </div>
      <p className="muted">Everything here is sent to every connected laptop and saved there for offline use.</p>
      {(error || content.error) && <p className="form-error">{error || content.error}</p>}
      {content.data && items.length === 0 && (
        <div className="empty-admin">No content yet. Add a video, a PDF or a website to get started.</div>
      )}

      {groups.map((group) => (
        <div key={group.id ?? 'none'} className="content-group">
          <h2>
            {group.icon} {group.name}
          </h2>
          <ul className="admin-list">
            {group.items.map((item, i) => (
              <li key={item.id} className="admin-row">
                <div className="row-thumb">{item.thumb_url ? <img src={item.thumb_url} alt="" /> : TYPE_META[item.type].icon}</div>
                <div className="row-main">
                  <strong>{item.title}</strong>
                  <span className="muted small">
                    {TYPE_META[item.type].label}
                    {item.file_name ? ` · ${item.file_name}` : item.source_url ? ` · ${item.source_url}` : ''}
                  </span>
                  <Chips item={item} />
                </div>
                <div className="row-actions">
                  <button className="btn btn-small" disabled={i === 0} onClick={() => move(group, i, -1)} aria-label="Move up">
                    ↑
                  </button>
                  <button
                    className="btn btn-small"
                    disabled={i === group.items.length - 1}
                    onClick={() => move(group, i, 1)}
                    aria-label="Move down"
                  >
                    ↓
                  </button>
                  {(item.file_url || item.source_url) && (
                    <button className="btn btn-small" onClick={() => bridge.openExternal(item.file_url || item.source_url)}>
                      Open
                    </button>
                  )}
                  <button className="btn btn-small" onClick={() => toggle(item)}>
                    {item.is_approved ? 'Lock' : 'Unlock'}
                  </button>
                  <button className="btn btn-small" onClick={() => setEditing(item)}>
                    Edit
                  </button>
                  <ConfirmButton onConfirm={() => run(() => api.del(`/api/v1/content/${item.id}`))} confirmLabel="Delete">
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
          categories={cats}
          onClose={() => setEditing(null)}
          onSaved={() => {
            setEditing(null);
            content.reload();
          }}
        />
      )}
    </section>
  );
}
