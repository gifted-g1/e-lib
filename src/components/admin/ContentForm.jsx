import { useState } from 'react';
import { api, formatBytes, TYPE_META } from '../../api';
import Modal from '../Modal';

const DEFAULT_CATEGORY_HINT = { video: /video/i, pdf: /pdf|book/i, site: /site|web/i };

function defaultCategory(categories, type) {
  return categories.find((c) => DEFAULT_CATEGORY_HINT[type].test(c.name))?.id ?? categories[0]?.id ?? '';
}

export default function ContentForm({ item, categories, onClose, onSaved, onError }) {
  const isNew = !item.id;
  const initialType = item.type || 'video';
  const [form, setForm] = useState({
    id: item.id,
    type: initialType,
    title: item.title || '',
    category_id: item.category_id ?? (isNew ? defaultCategory(categories, initialType) : ''),
    source_url: item.source_url || '',
    description: item.description || '',
    allowed_domains: item.allowed_domains || '',
    thumbnail: item.thumbnail || '',
    is_approved: isNew ? true : !!item.is_approved,
  });
  const [source, setSource] = useState(item.source_url || isNew ? 'url' : 'upload');
  const [upload, setUpload] = useState(null);
  const [thumbUpload, setThumbUpload] = useState(null);
  const [removeThumb, setRemoveThumb] = useState(false);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  const set = (k) => (e) => setForm({ ...form, [k]: e.target.type === 'checkbox' ? e.target.checked : e.target.value });

  function setType(type) {
    setForm({
      ...form,
      type,
      category_id: isNew ? defaultCategory(categories, type) : form.category_id,
    });
    setUpload(null);
    if (type === 'site') setSource('url');
  }

  async function pick(kind) {
    try {
      const file = await api.admin.pickFile(kind);
      if (!file) return;
      if (kind === 'image') {
        setThumbUpload(file);
        setRemoveThumb(false);
      } else {
        setUpload(file);
        if (!form.title) setForm((f) => ({ ...f, title: file.name.replace(/\.[^.]+$/, '').replace(/[_-]+/g, ' ') }));
      }
    } catch (e) {
      setError(onError(e));
    }
  }

  async function submit(e) {
    e.preventDefault();
    setBusy(true);
    setError('');
    try {
      await api.admin.content.save({
        ...form,
        source_url: source === 'url' ? form.source_url : '',
        uploadToken: source === 'upload' && upload ? upload.token : null,
        thumbnailToken: thumbUpload ? thumbUpload.token : null,
        thumbnail: thumbUpload || removeThumb ? '' : form.thumbnail,
        removeThumbnail: removeThumb,
      });
      onSaved();
    } catch (err) {
      setError(onError(err));
    } finally {
      setBusy(false);
    }
  }

  const hasExistingFile = !isNew && item.local_path && !item.source_url && item.type === form.type;

  return (
    <Modal title={isNew ? 'Add content' : `Edit “${item.title}”`} onClose={onClose} wide>
      <form className="form" onSubmit={submit}>
        <div className="type-picker">
          {Object.entries(TYPE_META).map(([type, meta]) => (
            <button
              type="button"
              key={type}
              className={`type-option ${form.type === type ? 'active' : ''}`}
              onClick={() => setType(type)}
            >
              <span>{meta.icon}</span> {meta.label}
            </button>
          ))}
        </div>

        <div className="form-row">
          <label>
            Title
            <input value={form.title} onChange={set('title')} maxLength={200} autoFocus />
          </label>
          <label>
            Category
            <select value={form.category_id ?? ''} onChange={set('category_id')}>
              <option value="">No category</option>
              {categories.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.icon} {c.name}
                </option>
              ))}
            </select>
          </label>
        </div>

        {form.type !== 'site' && (
          <div className="segmented">
            <label>
              <input type="radio" checked={source === 'upload'} onChange={() => setSource('upload')} /> Upload a file
            </label>
            <label>
              <input type="radio" checked={source === 'url'} onChange={() => setSource('url')} /> Download from a link
            </label>
          </div>
        )}

        {form.type !== 'site' && source === 'upload' ? (
          <div className="file-pick">
            <button type="button" className="btn" onClick={() => pick(form.type)}>
              📁 Choose {form.type === 'video' ? 'video' : 'PDF'} file…
            </button>
            <span className="muted">
              {upload
                ? `${upload.name} (${formatBytes(upload.size)})`
                : hasExistingFile
                  ? 'Keeping the current file'
                  : 'No file chosen'}
            </span>
          </div>
        ) : (
          <label>
            {form.type === 'site' ? 'Website address' : 'Link to the file'}
            <input
              value={form.source_url}
              onChange={set('source_url')}
              placeholder={
                form.type === 'site'
                  ? 'https://www.khanacademy.org'
                  : form.type === 'video'
                    ? 'https://example.org/lesson.mp4 (direct link to an MP4/WebM file)'
                    : 'https://example.org/worksheet.pdf'
              }
            />
            {form.type !== 'site' && (
              <span className="hint">
                The file is downloaded automatically when online so it works offline. For YouTube and similar pages,
                add a Website instead.
              </span>
            )}
          </label>
        )}

        {form.type === 'site' && (
          <label>
            Other allowed websites (optional, one per line)
            <textarea
              rows={3}
              value={form.allowed_domains}
              onChange={set('allowed_domains')}
              placeholder={'cdn.kastatic.org\nkhanacademy.zendesk.com'}
            />
            <span className="hint">
              The child can only visit pages on the main website and these domains (including their subdomains).
              Everything else is blocked and can be requested.
            </span>
          </label>
        )}

        <label>
          Short description (optional)
          <input value={form.description} onChange={set('description')} maxLength={1000} />
        </label>

        <div className="form-row">
          <label>
            Picture link (optional)
            <input
              value={thumbUpload || removeThumb ? '' : form.thumbnail}
              onChange={set('thumbnail')}
              disabled={!!thumbUpload || removeThumb}
              placeholder="https://…/cover.jpg"
            />
          </label>
          <div className="file-pick align-end">
            <button type="button" className="btn" onClick={() => pick('image')}>
              🖼 Upload picture…
            </button>
            {thumbUpload && <span className="muted">{thumbUpload.name}</span>}
            {!isNew && (item.thumbnail_url || item.thumbnail) && !thumbUpload && (
              <label className="inline">
                <input type="checkbox" checked={removeThumb} onChange={(e) => setRemoveThumb(e.target.checked)} /> Remove
                picture
              </label>
            )}
          </div>
        </div>

        <label className="inline">
          <input type="checkbox" checked={form.is_approved} onChange={set('is_approved')} />
          Approved — the child can open it. (Unchecked items appear locked with a “Request Access” button.)
        </label>

        {error && <p className="form-error">{error}</p>}
        <div className="form-actions">
          <button type="button" className="btn" onClick={onClose}>
            Cancel
          </button>
          <button className="btn btn-primary" disabled={busy}>
            {busy ? 'Saving…' : 'Save'}
          </button>
        </div>
      </form>
    </Modal>
  );
}
