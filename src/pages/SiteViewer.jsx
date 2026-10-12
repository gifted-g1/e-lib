import { useEffect, useRef, useState } from 'react';
import { api, errorMessage, TYPE_META } from '../api';
import { useElibEvent } from '../hooks';
import ViewerBar from '../components/ViewerBar';

// The page itself is a native WebContentsView owned by the main process, positioned over `frameRef`.
export default function SiteViewer({ item, session, online, overlayOpen, onBack, onAdmin }) {
  const frameRef = useRef(null);
  const [opened, setOpened] = useState(false);
  const [error, setError] = useState('');
  const [blocked, setBlocked] = useState(null);
  const [requestState, setRequestState] = useState('');
  const [nav, setNav] = useState({ canGoBack: false, loading: true });

  const bounds = () => {
    const r = frameRef.current.getBoundingClientRect();
    return { x: r.left, y: r.top, width: r.width, height: r.height };
  };

  useEffect(() => {
    if (!online) return undefined;
    let alive = true;
    setError('');
    api.site
      .open({ id: item.id, bounds: bounds() })
      .then(() => alive && setOpened(true))
      .catch((e) => alive && setError(errorMessage(e) === 'offline' ? '' : errorMessage(e)));
    return () => {
      alive = false;
      setOpened(false);
      api.site.close();
    };
  }, [item.id, online]);

  // Keep the native view glued to the placeholder.
  useEffect(() => {
    const el = frameRef.current;
    if (!el) return undefined;
    const update = () => api.site.setBounds(bounds());
    const ro = new ResizeObserver(update);
    ro.observe(el);
    window.addEventListener('resize', update);
    return () => {
      ro.disconnect();
      window.removeEventListener('resize', update);
    };
  }, [opened]);

  useEffect(() => {
    if (opened) api.site.setBounds(bounds());
  }, [blocked, opened]);

  // Native views draw above HTML, so hide it while a modal (e.g. parent login) is open or on error.
  useEffect(() => {
    if (opened) api.site.setVisible(!overlayOpen && !error);
  }, [overlayOpen, error, opened]);

  useElibEvent('site:blocked', (b) => {
    setBlocked(b);
    setRequestState('');
  });
  useElibEvent('site:error', (e) => setError(`We couldn't open this page (${e.description || 'error'}).`));
  useElibEvent('site:state', setNav);

  async function requestBlocked() {
    try {
      const r = await api.requests.create({ contentId: item.id, url: blocked.url });
      setRequestState(r.duplicate ? 'You already asked — a grown-up will check soon!' : 'Request sent! 💌');
    } catch (e) {
      setRequestState(errorMessage(e));
    }
  }

  return (
    <div className="viewer">
      <ViewerBar
        title={item.title}
        icon={TYPE_META.site.icon}
        onBack={onBack}
        onAdmin={onAdmin}
        session={session}
        online={online}
      >
        <button className="btn" disabled={!nav.canGoBack} onClick={() => api.site.back()} aria-label="Previous page">
          ↩ Back a page
        </button>
      </ViewerBar>

      {blocked && (
        <div className="blocked-banner" role="alert">
          <span>
            🚧 That page {blocked.host ? <strong>({blocked.host})</strong> : null} isn't in your library yet.
          </span>
          {blocked.url && !requestState && (
            <button className="btn btn-request" onClick={requestBlocked}>
              🙋 Request Access
            </button>
          )}
          {requestState && <span className="banner-note">{requestState}</span>}
          <button className="icon-btn" onClick={() => setBlocked(null)} aria-label="Dismiss">
            ✕
          </button>
        </div>
      )}

      <div className="site-frame" ref={frameRef}>
        {!online && (
          <div className="viewer-message">
            <div className="empty-icon">📡</div>
            <p>Websites need the internet, and we're offline right now.</p>
            <p className="muted">Your videos and books still work — go back to the library to find them!</p>
          </div>
        )}
        {online && error && (
          <div className="viewer-message">
            <div className="empty-icon">🙈</div>
            <p>{error}</p>
            <button
              className="btn btn-primary"
              onClick={() => {
                setError('');
                api.site.reload();
              }}
            >
              Try again
            </button>
          </div>
        )}
        {online && !error && nav.loading && <div className="viewer-message">Loading…</div>}
      </div>
    </div>
  );
}
