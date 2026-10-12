'use strict';

// Sandboxed in-app browser for approved external sites. One WebContentsView at a time, placed over the
// area the renderer reserves for it. No address bar; every top-level navigation is checked against the
// item's approved domains.
const { WebContentsView, session } = require('electron');
const kiosk = require('./kiosk');

const PARTITION = 'persist:sites';
const ALLOWED_SCHEMES = new Set(['http:', 'https:', 'data:', 'blob:', 'ws:', 'wss:']);
const YOUTUBE_HOST = /(^|\.)(youtube\.com|youtube-nocookie\.com|youtubei\.googleapis\.com)$/;
const ERR_ABORTED = -3;
const ERR_BLOCKED_BY_CLIENT = -20;

function normalizeHost(h) {
  return String(h || '').trim().toLowerCase().replace(/^\*\./, '').replace(/^www\./, '').replace(/\.$/, '');
}

function allowedHosts(item) {
  const hosts = new Set();
  const add = (value) => {
    if (!value) return;
    try {
      const host = value.includes('://') ? new URL(value).hostname : value.split('/')[0];
      const n = normalizeHost(host);
      if (n) hosts.add(n);
    } catch {
      // ignore malformed entries
    }
  };
  add(item.source_url);
  for (const d of String(item.allowed_domains || '').split(/[\s,]+/)) add(d);
  return [...hosts];
}

function isUrlAllowed(url, item) {
  if (!item) return false;
  if (url === 'about:blank') return true;
  let u;
  try {
    u = new URL(url);
  } catch {
    return false;
  }
  if (u.protocol !== 'https:' && u.protocol !== 'http:') return false;
  const host = u.hostname.toLowerCase().replace(/\.$/, '');
  return allowedHosts(item).some((h) => host === h || host.endsWith('.' + h));
}

class SiteManager {
  constructor({ getWindow, kioskEnabled, allowDevTools, send, onBlocked }) {
    this.getWindow = getWindow;
    this.kioskEnabled = kioskEnabled;
    this.allowDevTools = allowDevTools;
    this.send = send;
    this.onBlocked = onBlocked;
    this.view = null;
    this.item = null;
    this.visible = true;
    this.cursorKey = null;
    this.lastBlocked = { url: '', at: 0 };
    this.session = session.fromPartition(PARTITION);
    this.hardenSession();
  }

  hardenSession() {
    const ses = this.session;
    ses.setPermissionRequestHandler((_wc, _permission, callback) => callback(false));
    ses.setPermissionCheckHandler(() => false);
    ses.on('will-download', (event) => event.preventDefault());
    // Some sites refuse Electron's UA; present as plain Chrome.
    ses.setUserAgent(
      ses.getUserAgent().replace(/\sElectron\/\S+/i, '').replace(/\schild-safe-elibrary\/\S+/i, '')
    );

    // Backstop for anything will-navigate misses (server redirects, form posts, history tricks).
    ses.webRequest.onBeforeRequest((details, callback) => {
      let u;
      try {
        u = new URL(details.url);
      } catch {
        return callback({ cancel: true });
      }
      if (!ALLOWED_SCHEMES.has(u.protocol)) return callback({ cancel: true });
      if (details.resourceType === 'mainFrame' && !isUrlAllowed(details.url, this.item)) {
        this.reportBlocked(details.url);
        return callback({ cancel: true });
      }
      callback({});
    });

    // YouTube Restricted Mode for any embedded or approved YouTube content.
    ses.webRequest.onBeforeSendHeaders((details, callback) => {
      const headers = details.requestHeaders;
      try {
        if (YOUTUBE_HOST.test(new URL(details.url).hostname)) headers['YouTube-Restrict'] = 'Strict';
      } catch {
        // ignore
      }
      callback({ requestHeaders: headers });
    });
  }

  open(item, bounds) {
    const win = this.getWindow();
    if (!win || win.isDestroyed()) return;
    this.close();
    this.item = item;
    this.visible = true;

    const view = new WebContentsView({
      webPreferences: {
        partition: PARTITION,
        sandbox: true,
        contextIsolation: true,
        nodeIntegration: false,
        webSecurity: true,
        devTools: this.allowDevTools,
        spellcheck: false,
        navigateOnDragDrop: false,
        safeDialogs: true,
      },
    });
    this.view = view;
    const wc = view.webContents;
    kiosk.hardenWebContents(wc, { kioskEnabled: this.kioskEnabled, allowDevTools: this.allowDevTools });

    // Popups never open new windows; allowed targets load in place.
    wc.setWindowOpenHandler(({ url }) => {
      if (isUrlAllowed(url, this.item)) wc.loadURL(url).catch(() => {});
      else this.reportBlocked(url);
      return { action: 'deny' };
    });
    const guard = (event, url) => {
      if (!isUrlAllowed(url, this.item)) {
        event.preventDefault();
        this.reportBlocked(url);
      }
    };
    wc.on('will-navigate', guard);
    wc.on('will-redirect', guard);
    wc.on('will-prevent-unload', (event) => event.preventDefault());

    const sendState = () => {
      if (wc.isDestroyed()) return;
      this.send('site:state', { canGoBack: wc.navigationHistory.canGoBack(), title: wc.getTitle(), loading: wc.isLoading() });
    };
    wc.on('did-start-loading', sendState);
    wc.on('did-stop-loading', sendState);
    wc.on('did-navigate', () => {
      this.cursorKey = null;
      sendState();
    });
    wc.on('did-navigate-in-page', sendState);
    wc.on('page-title-updated', sendState);
    wc.on('did-fail-load', (_e, code, description, _url, isMainFrame) => {
      if (isMainFrame && code !== ERR_ABORTED && code !== ERR_BLOCKED_BY_CLIENT) {
        this.send('site:error', { code, description });
      }
    });
    wc.on('render-process-gone', () => this.send('site:error', { code: -1, description: 'The page stopped working.' }));

    view.setBackgroundColor('#ffffff');
    win.contentView.addChildView(view);
    this.setBounds(bounds);
    wc.loadURL(item.source_url).catch(() => {});
  }

  close() {
    if (!this.view) return;
    const view = this.view;
    this.view = null;
    this.item = null;
    this.cursorKey = null;
    const win = this.getWindow();
    try {
      if (win && !win.isDestroyed()) win.contentView.removeChildView(view);
    } catch {
      // window already gone
    }
    if (!view.webContents.isDestroyed()) view.webContents.close();
  }

  setBounds(bounds) {
    if (!this.view || !bounds) return;
    this.view.setBounds({
      x: Math.round(bounds.x),
      y: Math.round(bounds.y),
      width: Math.max(0, Math.round(bounds.width)),
      height: Math.max(0, Math.round(bounds.height)),
    });
  }

  setVisible(visible) {
    this.visible = !!visible;
    if (this.view) this.view.setVisible(this.visible);
  }

  back() {
    const wc = this.view?.webContents;
    if (wc && !wc.isDestroyed() && wc.navigationHistory.canGoBack()) wc.navigationHistory.goBack();
  }

  reload() {
    const wc = this.view?.webContents;
    if (wc && !wc.isDestroyed()) wc.reload();
  }

  reportBlocked(url) {
    const now = Date.now();
    if (this.lastBlocked.url === url && now - this.lastBlocked.at < 2000) return;
    this.lastBlocked = { url, at: now };
    let host = '';
    try {
      host = new URL(url).hostname;
    } catch {
      // ignore
    }
    const isWeb = /^https?:/i.test(url);
    this.send('site:blocked', { url: isWeb ? url : null, host });
    if (this.onBlocked) this.onBlocked(url, this.item);
  }

  setCursorHidden(hidden) {
    const wc = this.view?.webContents;
    if (!wc || wc.isDestroyed()) return;
    if (hidden && !this.cursorKey) {
      this.cursorKey = 'pending';
      wc.insertCSS('* { cursor: none !important; }')
        .then((key) => {
          this.cursorKey = key;
        })
        .catch(() => {
          this.cursorKey = null;
        });
    } else if (!hidden && this.cursorKey && this.cursorKey !== 'pending') {
      wc.removeInsertedCSS(this.cursorKey).catch(() => {});
      this.cursorKey = null;
    }
  }

  async clearData() {
    await this.session.clearStorageData();
    await this.session.clearCache();
  }

  get currentItem() {
    return this.item;
  }
}

module.exports = { SiteManager, isUrlAllowed, allowedHosts };
