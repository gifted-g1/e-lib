import { useEffect, useState } from 'react';
import { api, bridge, errorMessage, formatBytes, TYPE_META } from '../api';
import Modal from './Modal';

const CATEGORY_HINT = { video: /video/i, pdf: /pdf|book/i, site: /site|web/i };
const defaultCategory = (categories, type) =>
  categories.find((c) => CATEGORY_HINT[type].test(c.name))?.id ?? categories[0]?.id ?? '';

export default function ContentForm({ item, categories, onClose, onSaved }) {
  const isNew = !item.id;
  const initialType = item.type || 'video';
  const [form, setForm] = useState({
    type: initialType,
    title: item.title || '',
    category_id: item.category_id ?? (isNew ? defaultCategory(categories, initialType) : ''),
    source_url: item.source_url || '',
    description: item.description || '',
    allowed_domains: item.allowed_domains || '',
    thumbnail_url: item.thumbnail_url || '',
    is_approved: isNew ? true : !!item.is_approved,
  });
  const [source, setSource] = useState(item.file_key ? 'upload' : 'url');
  const [file, setFile] = useState(null); // newly picked file
  const [thumb, setThumb] = useState(null); // newly picked picture
  const [removeThumb, setRemoveThumb] = useState(false);
  const [progress, setProgress] = useState(null);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  useEffect(
    () =>
      bridge.on('upload:progress', (p) => {
        if (p.token === file?.token || p.token === thumb?.token) setProgress(p.percent);
      }),
    [file, thumb]
  );

  const set = (k) => (e) => setForm({ ...form, [k]: e.target.type === 'checkbox' ? e.target.checked : e.target.value });

  function setType(type) {
    setForm({ ...form, type, category_id: isNew ? defaultCategory(categories, type) : form.category_id });
    setFile(null);
    if (type === 'site') setSource('url');
  }

  async function pick(kind) {
    try {
      const picked = await bridge.files.pick(kind);
      if (!picked) return;
      if (kind === 'image') {
        setThumb(picked);
        setRemoveThumb(false);
      } else {
        setFile(picked);
        if (!form.title) setForm((f) => ({ ...f, title: picked.name.replace(/\.[^.]+$/, '').replace(/[_-]+/g, ' ') }));
      }
    } catch (e) {
      setError(errorMessage(e));
    }
  }

  async function submit(e) {
    e.preventDefault();
    setBusy(true);
    setError('');
    try {
      let fileKey = form.type !== 'site' && source === 'upload' ? item.file_key || '' : '';
      if (form.type !== 'site' && source === 'upload') {
        if (file) {
          setProgress(0);
          fileKey = (await bridge.files.upload(file.token)).key;
        } else if (!fileKey || item.type !== form.type) {
          throw new Error('Choose a file to upload.');
        }
      }
      let thumbKey = removeThumb ? '' : item.thumb_file_key || '';
      if (thumb) {
        setProgress(0);
        thumbKey = (await bridge.files.upload(thumb.token)).key;
      }
      const body = {
        ...form,
        category_id: form.category_id === '' ? null : Number(form.category_id),
        source_url: form.type === 'site' || source === 'url' ? form.source_url : '',
        file_key: fileKey,
        thumb_file_key: thumbKey,
        thumbnail_url: thumbKey || removeThumb ? '' : form.thumbnail_url,
      };
      if (isNew) await api.post('/api/v1/content', body);
      else await api.patch(`/api/v1/content/${item.id}`, body);
      onSaved();
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setBusy(false);
      setProgress(null);
    }
  }

  const keepsFile = !isNew && item.file_key && item.type === form.type;

  return (
    <Modal title={isNew ? 'Add content' : `Edit “${item.title}”`} onClose={busy ? undefined : onClose} wide>
      <form className="form" onSubmit={submit}>
        <div className="type-picker">
          {Object.entries(TYPE_META).map(([type, meta]) => (
            <button type="button" key={type} className={`type-option ${form.type === type ? 'active' : ''}`} onClick={() => setType(type)}>
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
              <input type="radio" checked={source === 'url'} onChange={() => setSource('url')} /> Link to a file online
            </label>
          </div>
        )}

        {form.type !== 'site' && source === 'upload' ? (
          <div className="file-pick">
            <button type="button" className="btn" onClick={() => pick(form.type)} disabled={busy}>
              📁 Choose {form.type === 'video' ? 'video' : 'PDF'} file…
            </button>
            <span className="muted">
              {file ? `${file.name} (${formatBytes(file.size)})` : keepsFile ? `Keeping ${item.file_name || 'the current file'}` : 'No file chosen'}
            </span>
          </div>
        ) : (
          <label>
            {form.type === 'site' ? 'Website address' : 'Link to the file'}
            <input
              value={form.source_url}
              onChange={set('source_url')}
              placeholder={form.type === 'site' ? 'https://www.khanacademy.org' : 'https://example.org/lesson.mp4'}
            />
            {form.type !== 'site' && (
              <span className="hint">Must link straight to an MP4/WebM or PDF file. For YouTube pages, add a Website instead.</span>
            )}
          </label>
        )}

        {form.type === 'site' && (
          <label>
            Other allowed websites (optional, one per line)
            <textarea rows={3} value={form.allowed_domains} onChange={set('allowed_domains')} placeholder={'kastatic.org\nkhanacademy.zendesk.com'} />
            <span className="hint">
              The child can visit the main website and these domains (with their subdomains). Anything else is blocked and
              can be requested.
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
              value={thumb || removeThumb ? '' : form.thumbnail_url}
              onChange={set('thumbnail_url')}
              disabled={!!thumb || removeThumb || (!!item.thumb_file_key && !removeThumb)}
              placeholder={item.thumb_file_key && !removeThumb ? 'Using an uploaded picture' : 'https://…/cover.jpg'}
            />
          </label>
          <div className="file-pick align-end">
            <button type="button" className="btn" onClick={() => pick('image')} disabled={busy}>
              🖼 Upload picture…
            </button>
            {thumb && <span className="muted">{thumb.name}</span>}
            {!isNew && (item.thumb_url || item.thumbnail_url) && !thumb && (
              <label className="inline">
                <input type="checkbox" checked={removeThumb} onChange={(e) => setRemoveThumb(e.target.checked)} /> Remove picture
              </label>
            )}
          </div>
        </div>

        <label className="inline">
          <input type="checkbox" checked={form.is_approved} onChange={set('is_approved')} />
          Approved — children can open it. (Unchecked items appear locked with a “Request Access” button.)
        </label>

        {progress != null && (
          <div>
            <div className="progress">
              <div style={{ width: `${progress}%` }} />
            </div>
            <span className="muted small">Uploading… {progress}%</span>
          </div>
        )}
        {error && <p className="form-error">{error}</p>}
        <div className="form-actions">
          <button type="button" className="btn" onClick={onClose} disabled={busy}>
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
