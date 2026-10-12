import { useCallback, useEffect, useRef, useState } from 'react';

export const bridge = window.parentBridge;

// REST calls to the sync server (proxied through the main process, which holds the session token).
export const api = {
  get: (path) => bridge.request('GET', path),
  post: (path, body) => bridge.request('POST', path, body ?? {}),
  patch: (path, body) => bridge.request('PATCH', path, body ?? {}),
  del: (path) => bridge.request('DELETE', path),
};

export const TYPE_META = {
  video: { icon: '🎬', label: 'Video' },
  pdf: { icon: '📚', label: 'Book (PDF)' },
  site: { icon: '🌍', label: 'Website' },
};

export function errorMessage(err) {
  return (err && err.message) || String(err);
}

// Server times are ISO ("2026-10-12T10:00:00Z"); laptop times are UTC "2026-10-12 10:00:00".
export function parseTime(ts) {
  if (!ts) return null;
  const iso = ts.includes('T') ? ts : `${ts.replace(' ', 'T')}Z`;
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? null : d;
}

export function formatDateTime(ts) {
  const d = parseTime(ts);
  return d ? d.toLocaleString([], { dateStyle: 'medium', timeStyle: 'short' }) : '';
}

export function timeAgo(ts) {
  const d = parseTime(ts);
  if (!d) return 'never';
  const s = Math.max(0, Math.round((Date.now() - d.getTime()) / 1000));
  if (s < 60) return 'just now';
  if (s < 3600) return `${Math.floor(s / 60)} min ago`;
  if (s < 86400) return `${Math.floor(s / 3600)} h ago`;
  return `${Math.floor(s / 86400)} days ago`;
}

export const ONLINE_WINDOW_MS = 3 * 60_000;
export function isOnline(device) {
  const d = parseTime(device.last_seen_at);
  return !!d && Date.now() - d.getTime() < ONLINE_WINDOW_MS;
}

export function formatMinutes(seconds) {
  const m = Math.round((seconds || 0) / 60);
  if (m < 60) return `${m} min`;
  return `${Math.floor(m / 60)} h ${m % 60} min`;
}

export function formatBytes(bytes) {
  if (!bytes) return '';
  const units = ['B', 'KB', 'MB', 'GB'];
  let i = 0;
  let n = bytes;
  while (n >= 1024 && i < units.length - 1) {
    n /= 1024;
    i++;
  }
  return `${n.toFixed(i ? 1 : 0)} ${units[i]}`;
}

// Load data from the server; `reload` re-fetches. Optional polling interval in ms.
export function useServerData(path, { poll = 0 } = {}) {
  const [data, setData] = useState(null);
  const [error, setError] = useState('');
  const alive = useRef(true);
  const reload = useCallback(() => {
    if (!path) return Promise.resolve();
    return api
      .get(path)
      .then((d) => {
        if (alive.current) {
          setData(d);
          setError('');
        }
      })
      .catch((e) => alive.current && setError(errorMessage(e)));
  }, [path]);
  useEffect(() => {
    alive.current = true;
    reload();
    const t = poll ? setInterval(reload, poll) : null;
    return () => {
      alive.current = false;
      if (t) clearInterval(t);
    };
  }, [reload, poll]);
  return { data, error, reload, setError };
}
