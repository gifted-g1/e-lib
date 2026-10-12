import { useCallback, useEffect, useMemo, useState } from 'react';
import { api, errorMessage } from '../api';
import { useElibEvent } from '../hooks';
import Logo from '../components/Logo';
import Modal from '../components/Modal';
import StatusPills from '../components/StatusPills';
import Tile from '../components/Tile';
import Toast from '../components/Toast';

export default function Home({ session, online, onOpen, onAdmin }) {
  const [categories, setCategories] = useState([]);
  const [items, setItems] = useState([]);
  const [activeCat, setActiveCat] = useState('all');
  const [query, setQuery] = useState('');
  const [results, setResults] = useState(null);
  const [toast, setToast] = useState('');
  const [askOpen, setAskOpen] = useState(false);
  const [askText, setAskText] = useState('');

  const load = useCallback(() => {
    api.content
      .list()
      .then((data) => {
        setCategories(data.categories);
        setItems(data.items);
      })
      .catch((e) => setToast(errorMessage(e)));
  }, []);

  useEffect(load, [load, online]);
  useElibEvent('content:changed', load);

  // Search is answered by the main process and only ever returns approved items.
  useEffect(() => {
    const q = query.trim();
    if (!q) {
      setResults(null);
      return undefined;
    }
    const t = setTimeout(() => api.content.search(q).then(setResults).catch(() => setResults([])), 200);
    return () => clearTimeout(t);
  }, [query, items]);

  const visibleCategories = useMemo(
    () => categories.filter((c) => items.some((i) => i.category_id === c.id)),
    [categories, items]
  );
  const shown = results ?? items.filter((i) => activeCat === 'all' || i.category_id === activeCat);

  async function open(item) {
    if (!item.is_approved) return;
    if (!online && item.needs_internet) {
      setToast(
        item.type === 'site'
          ? 'Websites need the internet. Try a video or book instead! 📚'
          : "This one hasn't been saved yet. It will be ready when we're back online."
      );
      return;
    }
    try {
      onOpen(await api.content.open(item.id));
    } catch (e) {
      setToast(errorMessage(e));
    }
  }

  async function request(item) {
    try {
      const r = await api.requests.create({ contentId: item.id });
      setToast(r.duplicate ? 'You already asked — a grown-up will check soon! ⏳' : 'Request sent to your grown-up! 💌');
    } catch (e) {
      setToast(errorMessage(e));
    }
  }

  async function sendAsk(e) {
    e.preventDefault();
    if (!askText.trim()) return;
    try {
      await api.requests.create({ title: askText.trim() });
      setAskOpen(false);
      setAskText('');
      setToast('Request sent to your grown-up! 💌');
    } catch (err) {
      setToast(errorMessage(err));
    }
  }

  return (
    <div className="home">
      <header className="home-header">
        <Logo onAdmin={onAdmin} />
        <div className="greeting">
          Hi, {session.childAvatar ? `${session.childAvatar} ` : ''}
          {session.childName}! 👋
        </div>
        <div className="search">
          <span aria-hidden="true">🔍</span>
          <input
            type="search"
            placeholder="Search my library…"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            maxLength={100}
          />
          {query && (
            <button className="icon-btn" onClick={() => setQuery('')} aria-label="Clear search">
              ✕
            </button>
          )}
        </div>
        <StatusPills online={online} remainingMinutes={session.remainingMinutes} />
      </header>

      {!results && (
        <nav className="cat-tabs">
          <button className={`cat-tab ${activeCat === 'all' ? 'active' : ''}`} onClick={() => setActiveCat('all')}>
            ⭐ Everything
          </button>
          {visibleCategories.map((c) => (
            <button
              key={c.id}
              className={`cat-tab ${activeCat === c.id ? 'active' : ''}`}
              onClick={() => setActiveCat(c.id)}
            >
              {c.icon} {c.name}
            </button>
          ))}
        </nav>
      )}

      <main className="tiles-area">
        {results && (
          <h2 className="section-title">
            {results.length ? `Found ${results.length} for “${query}”` : `Nothing found for “${query}”`}
          </h2>
        )}
        {!results && items.length === 0 && (
          <div className="empty">
            <div className="empty-icon">🧸</div>
            <p>Your library is empty for now. Ask a grown-up to add some videos, books and websites!</p>
          </div>
        )}
        <div className="tiles">
          {shown.map((item) => (
            <Tile key={item.id} item={item} online={online} onOpen={open} onRequest={request} />
          ))}
        </div>
      </main>

      <footer className="home-footer">
        <button className="btn btn-soft" onClick={() => setAskOpen(true)}>
          🙋 Ask for something new
        </button>
      </footer>

      {askOpen && (
        <Modal title="What would you like to learn about?" onClose={() => setAskOpen(false)}>
          <form className="form" onSubmit={sendAsk}>
            <label>
              Tell your grown-up what you'd like
              <input
                autoFocus
                maxLength={200}
                value={askText}
                onChange={(e) => setAskText(e.target.value)}
                placeholder="e.g. videos about dinosaurs"
              />
            </label>
            <div className="form-actions">
              <button type="button" className="btn" onClick={() => setAskOpen(false)}>
                Cancel
              </button>
              <button className="btn btn-primary" disabled={!askText.trim()}>
                Send request 💌
              </button>
            </div>
          </form>
        </Modal>
      )}
      <Toast message={toast} onDone={() => setToast('')} />
    </div>
  );
}
