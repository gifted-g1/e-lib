'use strict';

<<<<<<< HEAD
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { app, BrowserWindow, ipcMain, dialog, session, Menu, net, powerMonitor } = require('electron');

const paths = require('./paths');
const { createDb, isHttpUrl } = require('./db');
const { registerSchemes, registerAppProtocol, contentUrl, isAppUrl, resolveInside, ORIGIN } = require('./protocol');
const kiosk = require('./kiosk');
const limits = require('./limits');
const { SyncEngine } = require('./sync');
const { SiteManager } = require('./sites');

// ---------------------------------------------------------------------------
// Configuration
// ---------------------------------------------------------------------------
const DEV_SERVER = process.env.ELIB_DEV_SERVER || '';
// Kiosk lockdown is on for packaged builds; ELIB_KIOSK=1/0 overrides (e.g. `npm run start:kiosk`).
const KIOSK = process.env.ELIB_KIOSK ? process.env.ELIB_KIOSK === '1' : app.isPackaged;
const ALLOW_DEVTOOLS = !app.isPackaged && process.env.ELIB_DEVTOOLS !== '0';
const ADMIN_SESSION_MS = 15 * 60_000;
const USAGE_TICK_SECONDS = 30;
const CURSOR_IDLE_SECONDS = 3;
const MAX_LOGIN_FAILURES = 5;
const LOGIN_LOCKOUT_MS = 60_000;
=======
// E-Library Parent: main process. All server traffic goes through here so the session token never
// reaches the renderer, and uploads stream straight from disk.
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { Readable } = require('stream');
const { app, BrowserWindow, ipcMain, dialog, protocol, safeStorage, shell, Menu } = require('electron');

const DEV_SERVER = process.env.ELIB_DEV_SERVER || '';
const ORIGIN = 'app://parent';
const distDir = path.join(__dirname, '..', 'dist');
const REQUEST_TIMEOUT_MS = 30_000;
>>>>>>> 9cdb3b1a4e77639efe6a102895d504764a0cff37

const FILE_FILTERS = {
  video: [{ name: 'Videos', extensions: ['mp4', 'm4v', 'webm', 'ogv', 'mov', 'mkv'] }],
  pdf: [{ name: 'PDF documents', extensions: ['pdf'] }],
  image: [{ name: 'Images', extensions: ['png', 'jpg', 'jpeg', 'webp', 'gif'] }],
};
<<<<<<< HEAD

const dataDir = paths.getDataDir();
const contentDir = paths.getContentDir(dataDir);
const distDir = path.join(__dirname, '..', 'dist');
const bundledContentDir = app.isPackaged
  ? path.join(process.resourcesPath, 'content')
  : path.join(__dirname, '..', 'assets', 'content');

app.setPath('userData', dataDir);
registerSchemes();
Menu.setApplicationMenu(null);
app.commandLine.appendSwitch('disable-pinch');
app.commandLine.appendSwitch('overscroll-history-navigation', '0');

const state = {
  allowQuit: false,
  suspendFocusGuard: false,
  adminUntil: 0,
  adminUserId: null,
  loginFailures: 0,
  loginLockedUntil: 0,
  childId: null,
  locked: false,
  lockReason: '',
  lockMessage: '',
  remainingMinutes: null,
};

let win = null;
let db = null;
let sync = null;
let sites = null;
let cursorHidden = false;
const pendingUploads = new Map(); // token -> { path, kind }

// ---------------------------------------------------------------------------
// Startup
// ---------------------------------------------------------------------------
if (!app.requestSingleInstanceLock()) {
  app.quit();
} else {
  app.on('second-instance', () => {
    if (win && !win.isDestroyed()) {
      if (win.isMinimized()) win.restore();
      win.focus();
    }
  });
  app.whenReady().then(start);
}

function allowQuitAndExit(code = 0) {
  state.allowQuit = true;
  kiosk.unregisterGlobalShortcuts();
  app.exit(code);
}

// System shutdown / logout must not be blocked by the close guard.
process.on('SIGTERM', () => allowQuitAndExit(0));
process.on('SIGINT', () => allowQuitAndExit(0));

async function start() {
  fs.mkdirSync(contentDir, { recursive: true });
  db = createDb(dataDir);
  await importBundledContent();
  registerAppProtocol({ distDir, contentDir });
  hardenDefaultSession();

  sync = new SyncEngine({ db, contentDir, appVersion: app.getVersion(), today: limits.localDay });
  sync.on('online', (online) => {
    send('net:status', { online });
    if (!online) sites?.close();
    sendState();
  });
  sync.on('status', (status) => send('sync:status', status));
  sync.on('content-changed', () => send('content:changed'));
  sync.on('limits-changed', () => {
    evaluateLimits();
    sendState();
  });

  sites = new SiteManager({
    getWindow: () => win,
    kioskEnabled: KIOSK,
    allowDevTools: ALLOW_DEVTOOLS,
    send,
    onBlocked: (url, item) => {
      if (!state.childId) return;
      db.logActivity({ childId: state.childId, contentId: item?.id, title: item?.title, action: 'blocked', detail: url });
    },
  });

  registerIpc();
  createWindow();
  if (KIOSK) kiosk.registerGlobalShortcuts();

  powerMonitor.on('shutdown', () => allowQuitAndExit(0));
  app.on('will-quit', () => kiosk.unregisterGlobalShortcuts());
  app.on('window-all-closed', () => {
    if (state.allowQuit || !KIOSK) app.quit();
  });

  autoSelectChild();
  evaluateLimits();
  sync.start();
  setInterval(tickUsage, USAGE_TICK_SECONDS * 1000);
  setInterval(tickCursor, 1000);
}

function hardenDefaultSession() {
  const ses = session.defaultSession;
  ses.setPermissionRequestHandler((_wc, permission, callback) => callback(permission === 'fullscreen'));
  ses.on('will-download', (event) => event.preventDefault());
  app.on('web-contents-created', (_e, wc) => {
    wc.setWindowOpenHandler(() => ({ action: 'deny' }));
    wc.on('will-attach-webview', (event) => event.preventDefault());
  });
}

function loadUi() {
  if (DEV_SERVER) win.loadURL(DEV_SERVER);
  else win.loadURL(`${ORIGIN}/index.html`);
}

function isTrustedUiUrl(url) {
  return isAppUrl(url) || (!!DEV_SERVER && typeof url === 'string' && url.startsWith(DEV_SERVER));
=======
const MIME = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8',
  '.svg': 'image/svg+xml', '.png': 'image/png', '.json': 'application/json', '.woff2': 'font/woff2',
};
const CSP = [
  "default-src 'self'", "script-src 'self'", "style-src 'self' 'unsafe-inline'",
  "img-src 'self' data: https: http:", "connect-src 'self'", "object-src 'none'", "frame-src 'none'",
  "base-uri 'none'", "form-action 'none'",
].join('; ');

protocol.registerSchemesAsPrivileged([
  { scheme: 'app', privileges: { standard: true, secure: true, supportFetchAPI: true, codeCache: true } },
]);

let win = null;
const session = { server: '', email: '', token: '' };
const pendingFiles = new Map(); // token -> { path, kind, name, size }

// ---------------------------------------------------------------------------
// Session persistence (token encrypted with the OS keychain when available)
// ---------------------------------------------------------------------------
const sessionFile = () => path.join(app.getPath('userData'), 'session.json');

function loadSession() {
  try {
    const raw = JSON.parse(fs.readFileSync(sessionFile(), 'utf8'));
    session.server = raw.server || '';
    session.email = raw.email || '';
    if (raw.token && raw.encrypted && safeStorage.isEncryptionAvailable()) {
      session.token = safeStorage.decryptString(Buffer.from(raw.token, 'base64'));
    } else if (raw.token && !raw.encrypted) {
      session.token = raw.token;
    }
  } catch {
    // first run or unreadable file: start signed out
  }
}

function saveSession() {
  const encrypted = safeStorage.isEncryptionAvailable();
  let token = '';
  if (session.token) token = encrypted ? safeStorage.encryptString(session.token).toString('base64') : session.token;
  fs.mkdirSync(path.dirname(sessionFile()), { recursive: true });
  fs.writeFileSync(sessionFile(), JSON.stringify({ server: session.server, email: session.email, token, encrypted }), { mode: 0o600 });
}

function publicState() {
  return { server: session.server, email: session.email, signedIn: !!session.token };
}

// https everywhere, except plain http on this computer or the local network (for testing).
function normalizeServer(input) {
  let u;
  try {
    u = new URL(String(input || '').trim());
  } catch {
    throw new Error('Enter the server address, e.g. https://library.example.org');
  }
  const local = /^(localhost|127\.\d+\.\d+\.\d+|10\.\d+\.\d+\.\d+|192\.168\.\d+\.\d+|172\.(1[6-9]|2\d|3[01])\.\d+\.\d+)$/.test(u.hostname);
  if (u.protocol !== 'https:' && !(u.protocol === 'http:' && local)) {
    throw new Error('The server address must start with https:// (plain http is only allowed on a local network).');
  }
  return `${u.protocol}//${u.host}`;
}

// ---------------------------------------------------------------------------
// HTTP
// ---------------------------------------------------------------------------
function send(channel, payload) {
  if (win && !win.isDestroyed()) win.webContents.send(channel, payload);
}

async function parseResponse(res, { auth }) {
  const text = await res.text();
  let data = null;
  try {
    data = text ? JSON.parse(text) : null;
  } catch {
    // non-JSON body (e.g. proxy error page)
  }
  if (res.status === 401 && auth) {
    session.token = '';
    saveSession();
    send('auth:expired');
  }
  if (!res.ok) throw new Error((data && data.error) || `Server error (${res.status}).`);
  return data;
}

async function serverFetch(method, pathname, body, { auth = true, server = session.server } = {}) {
  if (!server) throw new Error('Not connected to a server.');
  const headers = { Accept: 'application/json' };
  if (body !== undefined) headers['Content-Type'] = 'application/json';
  if (auth) {
    if (!session.token) throw new Error('Please sign in.');
    headers.Authorization = `Bearer ${session.token}`;
  }
  let res;
  try {
    res = await fetch(server + pathname, {
      method,
      headers,
      body: body !== undefined ? JSON.stringify(body) : undefined,
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    });
  } catch (err) {
    const why = err.name === 'TimeoutError' ? 'timed out' : err.cause?.code || err.message;
    throw new Error(`Can't reach the server (${why}).`);
  }
  return parseResponse(res, { auth });
}

const API_PATH = /^\/api\/v1\/[A-Za-z0-9/_\-]*(\?[A-Za-z0-9_=&%.\-]*)?$/;

async function uploadFile(token) {
  const file = pendingFiles.get(token);
  if (!file) throw new Error('Please choose the file again.');
  if (!session.token) throw new Error('Please sign in.');
  const boundary = `----elib${crypto.randomBytes(12).toString('hex')}`;
  const safeName = file.name.replace(/["\r\n\\]/g, '_');
  const head = Buffer.from(
    `--${boundary}\r\nContent-Disposition: form-data; name="file"; filename="${safeName}"\r\n` +
      'Content-Type: application/octet-stream\r\n\r\n'
  );
  const tail = Buffer.from(`\r\n--${boundary}--\r\n`);
  let sent = 0;
  let lastReport = 0;
  async function* body() {
    yield head;
    for await (const chunk of fs.createReadStream(file.path, { highWaterMark: 1 << 20 })) {
      sent += chunk.length;
      const now = Date.now();
      if (now - lastReport > 200) {
        lastReport = now;
        send('upload:progress', { token, percent: Math.floor((sent / file.size) * 100) });
      }
      yield chunk;
    }
    yield tail;
  }
  let res;
  try {
    res = await fetch(`${session.server}/api/v1/files`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${session.token}`, 'Content-Type': `multipart/form-data; boundary=${boundary}` },
      body: Readable.toWeb(Readable.from(body())),
      duplex: 'half',
    });
  } catch (err) {
    throw new Error(`Upload failed (${err.cause?.code || err.message}).`);
  }
  const data = await parseResponse(res, { auth: true });
  pendingFiles.delete(token);
  send('upload:progress', { token, percent: 100 });
  return data;
}

// ---------------------------------------------------------------------------
// IPC (explicit allow-list, mirrored in preload.js)
// ---------------------------------------------------------------------------
function isTrustedSender(event) {
  const url = event.senderFrame?.url || '';
  return win && event.sender === win.webContents && (url.startsWith(`${ORIGIN}/`) || (!!DEV_SERVER && url.startsWith(DEV_SERVER)));
}

function handle(channel, fn) {
  ipcMain.handle(channel, (event, ...args) => {
    if (!isTrustedSender(event)) throw new Error('Blocked: untrusted sender');
    return fn(...args);
  });
}

function registerIpc() {
  handle('config:get', () => publicState());

  handle('auth:status', async (server) => serverFetch('GET', '/api/v1/auth/status', undefined, { auth: false, server: normalizeServer(server) }));

  const signIn = (route) => async ({ server, email, password }) => {
    const base = normalizeServer(server);
    const data = await serverFetch('POST', route, { email, password }, { auth: false, server: base });
    Object.assign(session, { server: base, email: data.email, token: data.token });
    saveSession();
    return publicState();
  };
  handle('auth:login', signIn('/api/v1/auth/login'));
  handle('auth:register', signIn('/api/v1/auth/register'));

  handle('auth:logout', async () => {
    try {
      if (session.token) await serverFetch('POST', '/api/v1/auth/logout', {});
    } catch {
      // signing out locally is enough if the server can't be reached
    }
    session.token = '';
    saveSession();
    return publicState();
  });

  handle('api:request', (method, pathname, body) => {
    if (!['GET', 'POST', 'PATCH', 'DELETE'].includes(method)) throw new Error('Bad method');
    if (typeof pathname !== 'string' || !API_PATH.test(pathname) || pathname.includes('..')) throw new Error('Bad path');
    return serverFetch(method, pathname, method === 'GET' || method === 'DELETE' ? undefined : body ?? {});
  });

  handle('files:pick', async (kind) => {
    const filters = FILE_FILTERS[kind];
    if (!filters) throw new Error('Unknown file type.');
    const result = await dialog.showOpenDialog(win, { title: 'Choose a file', properties: ['openFile'], filters });
    if (result.canceled || !result.filePaths[0]) return null;
    const filePath = result.filePaths[0];
    const token = crypto.randomUUID();
    const info = { path: filePath, kind, name: path.basename(filePath), size: fs.statSync(filePath).size };
    pendingFiles.set(token, info);
    return { token, name: info.name, size: info.size };
  });

  handle('files:upload', (token) => uploadFile(token));

  // Only links to the connected server (file previews) or normal web pages.
  handle('shell:open', (url) => {
    if (typeof url === 'string' && /^https?:\/\//i.test(url)) return shell.openExternal(url);
    return false;
  });
}

// ---------------------------------------------------------------------------
// Window
// ---------------------------------------------------------------------------
function resolveInside(base, rel) {
  const root = path.resolve(base);
  const full = path.resolve(root, String(rel).replace(/^[/\\]+/, ''));
  return full.startsWith(root + path.sep) ? full : null;
}

function registerAppProtocol() {
  protocol.handle('app', async (request) => {
    const url = new URL(request.url);
    if (url.host !== 'parent') return new Response('Not found', { status: 404 });
    const rel = url.pathname === '/' ? 'index.html' : decodeURIComponent(url.pathname);
    const file = resolveInside(distDir, rel);
    if (!file) return new Response('Forbidden', { status: 403 });
    try {
      const data = await fs.promises.readFile(file);
      return new Response(data, {
        headers: {
          'Content-Type': MIME[path.extname(file).toLowerCase()] || 'application/octet-stream',
          'Content-Security-Policy': CSP,
          'X-Content-Type-Options': 'nosniff',
        },
      });
    } catch {
      return new Response('Not found', { status: 404 });
    }
  });
>>>>>>> 9cdb3b1a4e77639efe6a102895d504764a0cff37
}

function createWindow() {
  win = new BrowserWindow({
    width: 1280,
<<<<<<< HEAD
    height: 800,
    minWidth: 800,
    minHeight: 600,
    show: false,
    backgroundColor: '#fff7ea',
    title: 'Child-Safe E-Library',
    kiosk: KIOSK,
    fullscreen: KIOSK,
=======
    height: 840,
    minWidth: 960,
    minHeight: 640,
    show: false,
    backgroundColor: '#f6f3fb',
    title: 'E-Library Parent',
>>>>>>> 9cdb3b1a4e77639efe6a102895d504764a0cff37
    autoHideMenuBar: true,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      webSecurity: true,
<<<<<<< HEAD
      devTools: ALLOW_DEVTOOLS,
      spellcheck: false,
      navigateOnDragDrop: false,
      safeDialogs: true,
    },
  });

  const wc = win.webContents;
  kiosk.hardenWebContents(wc, { kioskEnabled: KIOSK, allowDevTools: ALLOW_DEVTOOLS });
  if (KIOSK) kiosk.lockWindow(win, state);

  wc.on('will-navigate', (event, url) => {
    if (!isTrustedUiUrl(url)) event.preventDefault();
  });
  wc.on('render-process-gone', () => {
    sites?.close();
    setTimeout(() => win && !win.isDestroyed() && loadUi(), 1000);
  });
  win.once('ready-to-show', () => {
    win.show();
    if (KIOSK) win.setKiosk(true);
  });
  win.on('closed', () => {
    sites?.close();
    win = null;
    if (KIOSK && !state.allowQuit) createWindow();
  });
  if (!app.isPackaged) attachDevDiagnostics(wc);
  loadUi();
}

// Development only: surface renderer warnings in the terminal. ELIB_SMOKE_SHOT=<file.png> saves a
// screenshot after load and exits; ELIB_SMOKE_JS=<script> runs first to drive the UI.
function attachDevDiagnostics(wc) {
  wc.on('console-message', (_e, level, message, line, sourceId) => {
    if (level >= 2) console.log(`[renderer] ${message} (${sourceId}:${line})`);
  });
  const shot = process.env.ELIB_SMOKE_SHOT;
  if (shot) {
    wc.once('did-finish-load', () => {
      setTimeout(async () => {
        if (process.env.ELIB_SMOKE_JS) {
          await wc.executeJavaScript(process.env.ELIB_SMOKE_JS).catch((e) => console.log('[smoke]', e.message));
          await new Promise((r) => setTimeout(r, 1000));
        }
        fs.writeFileSync(shot, (await wc.capturePage()).toPNG());
        allowQuitAndExit(0);
      }, 2000);
    });
  }
}

// ---------------------------------------------------------------------------
// Session state, time limits, idle cursor
// ---------------------------------------------------------------------------
function send(channel, payload) {
  if (win && !win.isDestroyed()) win.webContents.send(channel, payload);
}

function adminActive() {
  return Date.now() < state.adminUntil;
}

function requireAdmin() {
  if (!adminActive()) throw new Error('Your parent session has ended. Please unlock again.');
  state.adminUntil = Date.now() + ADMIN_SESSION_MS;
}

function sessionState() {
  const child = state.childId ? db.getChild(state.childId) : null;
  return {
    hasAdmin: db.hasAdmin(),
    childId: child ? child.id : null,
    childName: child ? child.name : null,
    childAvatar: child ? child.avatar : null,
    childCount: db.countChildren(),
    locked: state.locked,
    lockReason: state.lockReason,
    lockMessage: state.lockMessage,
    remainingMinutes: state.remainingMinutes,
    online: sync ? sync.online : false,
    kiosk: KIOSK,
  };
}

function sendState() {
  send('session:state', sessionState());
}

function autoSelectChild() {
  if (state.childId && !db.getChild(state.childId)) state.childId = null;
  if (!state.childId) {
    const children = db.listChildren();
    if (children.length === 1) state.childId = children[0].id;
  }
}

function evaluateLimits() {
  if (!state.childId) {
    Object.assign(state, { locked: false, lockReason: '', lockMessage: '', remainingMinutes: null });
    return;
  }
  const result = limits.evaluate({
    settings: db.getSettings(),
    usedSeconds: db.getUsage(state.childId, limits.localDay()),
    now: new Date(),
  });
  if (!result.allowed && !state.locked) {
    sites.close();
    db.logActivity({ childId: state.childId, action: 'time_lock', detail: result.reason });
  }
  state.locked = !result.allowed;
  state.lockReason = result.reason;
  state.lockMessage = result.message;
  state.remainingMinutes = result.remainingMinutes;
}

function tickUsage() {
  if (state.childId && !state.locked && !adminActive()) {
    db.addUsage(state.childId, limits.localDay(), USAGE_TICK_SECONDS);
  }
  evaluateLimits();
  sendState();
}

function tickCursor() {
  if (!sites) return;
  const idle = powerMonitor.getSystemIdleTime() >= CURSOR_IDLE_SECONDS;
  if (idle !== cursorHidden) {
    cursorHidden = idle;
    sites.setCursorHidden(idle);
  }
}

// ---------------------------------------------------------------------------
// Content helpers
// ---------------------------------------------------------------------------
function hasLocalFile(name) {
  if (!name) return false;
  const full = resolveInside(contentDir, name);
  return !!full && fs.existsSync(full);
}

function removeContentFile(name) {
  const full = name && resolveInside(contentDir, name);
  if (full) fs.promises.unlink(full).catch(() => {});
}

async function importFile(src, prefix) {
  const ext = path.extname(src).toLowerCase().replace(/[^.a-z0-9]/g, '');
  const name = `${prefix}-${crypto.randomUUID()}${ext}`;
  await fs.promises.copyFile(src, path.join(contentDir, name));
  return name;
}

function thumbnailUrl(item) {
  if (hasLocalFile(item.thumbnail_path)) return contentUrl(item.thumbnail_path);
  if (item.thumbnail && sync.online && isHttpUrl(item.thumbnail)) return item.thumbnail;
  return null;
}

function toChildItem(item) {
  const cached = item.type !== 'site' && hasLocalFile(item.local_path);
  return {
    id: item.id,
    title: item.title,
    type: item.type,
    description: item.description || '',
    category_id: item.category_id,
    category_name: item.category_name || null,
    is_approved: !!item.is_approved,
    available_offline: cached,
    needs_internet: item.type === 'site' || (!cached && !!item.source_url),
    thumbnail_url: thumbnailUrl(item),
  };
}

function toAdminItem(item) {
  return {
    ...item,
    is_approved: !!item.is_approved,
    cached: item.type !== 'site' && hasLocalFile(item.local_path),
    thumbnail_url: thumbnailUrl(item),
  };
}

function requireChildItem(id) {
  const item = db.getContent(id);
  if (!item || !item.is_approved) throw new Error('This item is not available.');
  if (state.locked && !adminActive()) throw new Error('Library time is over for now.');
  return item;
}

function normalizeDomains(value) {
  const out = new Set();
  for (const raw of String(value || '').split(/[\s,]+/)) {
    if (!raw) continue;
    try {
      const host = (raw.includes('://') ? new URL(raw).hostname : raw.split('/')[0]).toLowerCase();
      if (/^[a-z0-9.*-]+$/.test(host)) out.add(host.replace(/^\*\./, ''));
    } catch {
      // skip invalid entries
    }
  }
  return out.size ? [...out].join('\n') : null;
}

function takeUpload(token, kind) {
  const upload = pendingUploads.get(token);
  pendingUploads.delete(token);
  if (!upload || upload.kind !== kind) throw new Error('Please choose the file again.');
  return upload;
}

async function saveContent(input) {
  const type = input.type;
  if (!['video', 'pdf', 'site'].includes(type)) throw new Error('Choose a content type.');
  const title = String(input.title || '').trim();
  if (!title) throw new Error('Please enter a title.');
  const sourceUrl = String(input.source_url || '').trim();
  if (sourceUrl && !isHttpUrl(sourceUrl)) throw new Error('Links must start with http:// or https://');
  if (type === 'site' && !sourceUrl) throw new Error('Please enter the website address.');

  const existing = input.id ? db.getContent(input.id) : null;
  if (input.id && !existing) throw new Error('This item no longer exists.');
  const upload = type !== 'site' && input.uploadToken ? takeUpload(input.uploadToken, type) : null;
  const keepsFile = existing && existing.type === type && existing.local_path && !existing.source_url;
  if (type !== 'site' && !upload && !sourceUrl && !keepsFile) {
    throw new Error('Upload a file or enter a link.');
  }

  const fields = {
    title: title.slice(0, 200),
    type,
    category_id: input.category_id ? Number(input.category_id) : null,
    source_url: sourceUrl || null,
    description: String(input.description || '').trim().slice(0, 1000) || null,
    allowed_domains: type === 'site' ? normalizeDomains(input.allowed_domains) : null,
    is_approved: input.is_approved ? 1 : 0,
  };
  const toDelete = [];

  if (upload) {
    fields.local_path = await importFile(upload.path, type);
    fields.is_offline = 1;
    fields.sync_error = null;
    if (existing?.local_path) toDelete.push(existing.local_path);
  } else if (existing && existing.local_path) {
    const linkChanged = (existing.source_url || '') !== (fields.source_url || '') && !!fields.source_url;
    if (type === 'site' || existing.type !== type || linkChanged) {
      toDelete.push(existing.local_path);
      fields.local_path = null;
      fields.is_offline = 0;
    }
  }
  if (existing && existing.type !== type) fields.sort_order = existing.sort_order;

  const thumbUrl = String(input.thumbnail || '').trim();
  if (input.thumbnailToken) {
    fields.thumbnail_path = await importFile(takeUpload(input.thumbnailToken, 'image').path, 'thumb');
    fields.thumbnail = null;
    if (existing?.thumbnail_path) toDelete.push(existing.thumbnail_path);
  } else if (input.removeThumbnail) {
    fields.thumbnail = null;
    fields.thumbnail_path = null;
    if (existing?.thumbnail_path) toDelete.push(existing.thumbnail_path);
  } else if (thumbUrl && thumbUrl !== (existing?.thumbnail || '')) {
    if (!isHttpUrl(thumbUrl)) throw new Error('Picture links must start with http:// or https://');
    fields.thumbnail = thumbUrl;
    fields.thumbnail_path = null;
    if (existing?.thumbnail_path) toDelete.push(existing.thumbnail_path);
  }

  let id;
  if (existing) {
    db.updateContent(existing.id, fields);
    id = existing.id;
  } else {
    id = db.insertContent(fields);
  }
  toDelete.forEach(removeContentFile);
  sync.kick();
  send('content:changed');
  return toAdminItem(db.getContent(id));
}

// Optional starter pack shipped in assets/content/manifest.json (copied into resources/content on build).
async function importBundledContent() {
  if (db.getSettings().bundled_imported === '1') return;
  const manifestPath = path.join(bundledContentDir, 'manifest.json');
  try {
    if (!fs.existsSync(manifestPath)) return;
    const manifest = JSON.parse(await fs.promises.readFile(manifestPath, 'utf8'));
    const categories = db.listCategories();
    for (const entry of manifest.items || []) {
      if (!entry.title || !['video', 'pdf', 'site'].includes(entry.type)) continue;
      const category = categories.find((c) => c.name.toLowerCase() === String(entry.category || '').toLowerCase());
      const fields = {
        title: entry.title,
        type: entry.type,
        category_id: category ? category.id : null,
        source_url: isHttpUrl(entry.url) ? entry.url : null,
        description: entry.description || null,
        allowed_domains: entry.allowed_domains || null,
        is_approved: entry.approved === false ? 0 : 1,
      };
      if (entry.file && entry.type !== 'site') {
        const src = resolveInside(bundledContentDir, entry.file);
        if (!src || !fs.existsSync(src)) continue;
        fields.local_path = await importFile(src, entry.type);
        fields.is_offline = 1;
      } else if (!fields.source_url) {
        continue;
      }
      db.insertContent(fields);
    }
  } catch (err) {
    console.error('Bundled content import failed:', err);
  }
  db.setSettings({ bundled_imported: '1' }, { internal: true });
}

// ---------------------------------------------------------------------------
// IPC -- every channel is explicitly registered here and exposed by name in preload.js
// ---------------------------------------------------------------------------
function handle(channel, fn, { admin = false } = {}) {
  ipcMain.handle(channel, async (event, ...args) => {
    if (!win || event.sender !== win.webContents || !isTrustedUiUrl(event.senderFrame?.url)) {
      throw new Error('Blocked: untrusted sender');
    }
    if (admin) requireAdmin();
    return fn(...args);
  });
}

function registerIpc() {
  // ----- child-facing -----
  handle('session:getState', () => sessionState());

  handle('children:list', () => db.listChildren().map(({ id, name, avatar }) => ({ id, name, avatar })));

  handle('children:select', (id) => {
    if (state.childId && !adminActive()) throw new Error('Ask a grown-up to switch profiles.');
    const child = db.getChild(Number(id));
    if (!child) throw new Error('Profile not found.');
    state.childId = child.id;
    db.logActivity({ childId: child.id, action: 'login' });
    evaluateLimits();
    sendState();
    return sessionState();
  });

  handle('content:list', () => ({
    categories: db.listCategories(),
    items: db.listContent().map(toChildItem),
  }));

  handle('content:search', (query) => db.searchContent(query).map(toChildItem));

  handle('content:open', (id) => {
    const item = requireChildItem(Number(id));
    db.logActivity({ childId: state.childId, contentId: item.id, title: item.title, action: 'open' });
    return toChildItem(item);
  });

  handle('content:getMediaUrl', (id) => {
    const item = requireChildItem(Number(id));
    if (hasLocalFile(item.local_path)) return { url: contentUrl(item.local_path), offline: true };
    if (item.source_url && sync.online) {
      sync.kick();
      return { url: item.source_url, offline: false };
    }
    return {
      url: null,
      message: sync.online
        ? "This one isn't ready yet. Please try again later."
        : 'This will be ready after the computer connects to the internet.',
    };
  });

  handle('content:readPdf', async (id) => {
    const item = requireChildItem(Number(id));
    if (item.type !== 'pdf') throw new Error('Not a PDF.');
    if (hasLocalFile(item.local_path)) {
      return fs.promises.readFile(resolveInside(contentDir, item.local_path));
    }
    if (item.source_url && sync.online) {
      const res = await net.fetch(item.source_url);
      if (!res.ok) throw new Error("This book couldn't be loaded right now.");
      sync.kick();
      return Buffer.from(await res.arrayBuffer());
    }
    throw new Error('This book will be ready after the computer connects to the internet.');
  });

  handle('requests:create', ({ contentId, title, url } = {}) => {
    const request = db.createRequest({ childId: state.childId, contentId: contentId || null, title, url: url || null });
    if (!request.duplicate) {
      db.logActivity({
        childId: state.childId,
        contentId: request.content_id,
        title: request.content_title,
        action: 'request',
        detail: request.content_url,
      });
      sync.kick(); // tell the parent app straight away
    }
    return { id: request.id, duplicate: !!request.duplicate };
  });

  handle('site:open', ({ id, bounds }) => {
    const item = requireChildItem(Number(id));
    if (item.type !== 'site') throw new Error('Not a website.');
    if (!sync.online) throw new Error('offline');
    sites.open(item, bounds);
    return true;
  });
  handle('site:close', () => sites.close());
  handle('site:setBounds', (bounds) => sites.setBounds(bounds));
  handle('site:setVisible', (visible) => sites.setVisible(visible));
  handle('site:back', () => sites.back());
  handle('site:reload', () => sites.reload());

  // ----- first run -----
  handle('setup:createAdmin', async ({ username, password, childName, childAge } = {}) => {
    if (db.hasAdmin()) throw new Error('Setup has already been completed.');
    const user = await db.createAdmin(username, password);
    if (childName) {
      const child = db.saveChild({ name: childName, age: childAge });
      state.childId = child.id;
    }
    db.logActivity({ action: 'setup', detail: `Admin "${user.username}" created` });
    evaluateLimits();
    sendState();
    return sessionState();
  });

  // ----- admin -----
  handle('admin:login', async (password) => {
    if (Date.now() < state.loginLockedUntil) {
      const secs = Math.ceil((state.loginLockedUntil - Date.now()) / 1000);
      throw new Error(`Too many tries. Please wait ${secs} seconds.`);
    }
    const user = await db.verifyAdmin(password);
    if (!user) {
      state.loginFailures++;
      if (state.loginFailures >= MAX_LOGIN_FAILURES) {
        state.loginFailures = 0;
        state.loginLockedUntil = Date.now() + LOGIN_LOCKOUT_MS;
      }
      db.logActivity({ childId: state.childId, action: 'admin_login_failed' });
      throw new Error('That password is not right.');
    }
    state.loginFailures = 0;
    state.adminUserId = user.id;
    state.adminUntil = Date.now() + ADMIN_SESSION_MS;
    sites.close();
    db.logActivity({ action: 'admin_login', detail: user.username });
    return { username: user.username };
  });

  handle('admin:logout', () => {
    state.adminUntil = 0;
    state.adminUserId = null;
    evaluateLimits();
    sendState();
    return true;
  });

  handle('admin:info', () => ({
    kiosk: KIOSK,
    dataDir,
    version: app.getVersion(),
    deviceId: db.getSettings().device_id,
    pendingRequests: db.pendingRequestCount(),
  }), { admin: true });

  handle('admin:changePassword', ({ current, next }) => db.changePassword(state.adminUserId, current, next), { admin: true });

  handle('admin:pickFile', async (kind) => {
    const filters = FILE_FILTERS[kind];
    if (!filters) throw new Error('Unknown file type.');
    const result = await kiosk.withDialog(win, state, () =>
      dialog.showOpenDialog(win, { title: 'Choose a file', properties: ['openFile'], filters })
    );
    if (result.canceled || !result.filePaths[0]) return null;
    const filePath = result.filePaths[0];
    const token = crypto.randomUUID();
    pendingUploads.set(token, { path: filePath, kind });
    return { token, name: path.basename(filePath), size: fs.statSync(filePath).size };
  }, { admin: true });

  handle('admin:content:list', () => ({
    categories: db.listCategories(),
    items: db.listContent().map(toAdminItem),
  }), { admin: true });

  handle('admin:content:save', (input) => saveContent(input || {}), { admin: true });

  handle('admin:content:delete', (id) => {
    const item = db.getContent(Number(id));
    if (!item) return true;
    db.deleteContent(item.id);
    removeContentFile(item.local_path);
    removeContentFile(item.thumbnail_path);
    send('content:changed');
    return true;
  }, { admin: true });

  handle('admin:content:reorder', (ids) => {
    db.reorderContent((ids || []).map(Number));
    send('content:changed');
    return true;
  }, { admin: true });

  handle('admin:categories:list', () => db.listCategories(), { admin: true });
  handle('admin:categories:save', (input) => {
    const id = db.saveCategory(input || {});
    send('content:changed');
    return id;
  }, { admin: true });
  handle('admin:categories:delete', (id) => {
    db.deleteCategory(Number(id));
    send('content:changed');
    return true;
  }, { admin: true });
  handle('admin:categories:reorder', (ids) => {
    db.reorderCategories((ids || []).map(Number));
    send('content:changed');
    return true;
  }, { admin: true });

  handle('admin:requests:list', (status) => db.listRequests(status), { admin: true });
  handle('admin:requests:resolve', ({ id, status }) => {
    const effect = db.resolveRequest(Number(id), status);
    send('content:changed');
    sync.kick();
    return { effect };
  }, { admin: true });

  handle('admin:activity:list', (opts) => db.listActivity(opts || {}), { admin: true });
  handle('admin:activity:clear', () => {
    db.clearActivity();
    return true;
  }, { admin: true });

  handle('admin:children:list', () => {
    const day = limits.localDay();
    return db.listChildren().map((c) => ({
      ...c,
      usedSecondsToday: db.getUsage(c.id, day),
      active: c.id === state.childId,
    }));
  }, { admin: true });
  handle('admin:children:save', (input) => {
    const child = db.saveChild(input || {});
    autoSelectChild();
    evaluateLimits();
    return child;
  }, { admin: true });
  handle('admin:children:delete', (id) => {
    db.deleteChild(Number(id));
    if (state.childId === Number(id)) state.childId = null;
    autoSelectChild();
    evaluateLimits();
    return true;
  }, { admin: true });
  handle('admin:children:setActive', (id) => {
    const child = id ? db.getChild(Number(id)) : null;
    if (id && !child) throw new Error('Profile not found.');
    state.childId = child ? child.id : null;
    evaluateLimits();
    return true;
  }, { admin: true });

  handle('admin:settings:get', () => db.getSettings(), { admin: true });
  handle('admin:settings:save', (values) => {
    const v = { ...(values || {}) };
    if ('daily_limit_minutes' in v) {
      const n = parseInt(v.daily_limit_minutes, 10);
      if (Number.isNaN(n) || n < 0 || n > 1440) throw new Error('Daily limit must be between 0 and 1440 minutes.');
      v.daily_limit_minutes = String(n);
    }
    for (const key of ['schedule_start', 'schedule_end']) {
      if (key in v && limits.parseHM(v[key]) === null) throw new Error('Times must look like 08:00.');
    }
    if (v.sync_server_url && !isHttpUrl(v.sync_server_url)) throw new Error('Sync server must be an http(s) address.');
    db.setSettings(v);
    evaluateLimits();
    sync.kick();
    return db.getSettings();
  }, { admin: true });

  handle('admin:usage:grant', ({ childId, minutes }) => {
    const m = Math.min(Math.max(parseInt(minutes, 10) || 0, 1), 600);
    db.grantMinutes(Number(childId || state.childId), limits.localDay(), m);
    evaluateLimits();
    return true;
  }, { admin: true });

  handle('admin:sync:now', () => {
    sync.checkOnline();
    sync.kick();
    return sync.status;
  }, { admin: true });
  handle('admin:sync:status', () => ({ ...sync.status, online: sync.online }), { admin: true });

  handle('admin:sites:clearData', async () => {
    sites.close();
    await sites.clearData();
    return true;
  }, { admin: true });

  handle('admin:quit', () => {
    db.logActivity({ action: 'admin_exit' });
    setTimeout(() => allowQuitAndExit(0), 100);
    return true;
  }, { admin: true });
}
=======
      devTools: !app.isPackaged,
      spellcheck: true,
    },
  });
  win.webContents.setWindowOpenHandler(({ url }) => {
    if (/^https?:\/\//i.test(url)) shell.openExternal(url);
    return { action: 'deny' };
  });
  win.webContents.on('will-navigate', (event, url) => {
    if (!url.startsWith(`${ORIGIN}/`) && !(DEV_SERVER && url.startsWith(DEV_SERVER))) event.preventDefault();
  });
  win.once('ready-to-show', () => win.show());
  win.on('closed', () => {
    win = null;
  });
  if (!app.isPackaged) attachDevDiagnostics(win.webContents);
  win.loadURL(DEV_SERVER || `${ORIGIN}/index.html`);
}

// Development only: renderer warnings in the terminal; ELIB_SMOKE_SHOT=<png> (+ ELIB_SMOKE_JS) screenshots and exits.
function attachDevDiagnostics(wc) {
  wc.on('console-message', (_e, level, message) => {
    if (level >= 2) console.log(`[renderer] ${message}`);
  });
  const shot = process.env.ELIB_SMOKE_SHOT;
  if (!shot) return;
  wc.once('did-finish-load', () => {
    setTimeout(async () => {
      if (process.env.ELIB_SMOKE_JS) {
        await wc.executeJavaScript(process.env.ELIB_SMOKE_JS).catch((e) => console.log('[smoke]', e.message));
        await new Promise((r) => setTimeout(r, 1000));
      }
      fs.writeFileSync(shot, (await wc.capturePage()).toPNG());
      app.exit(0);
    }, 1500);
  });
}

if (!app.requestSingleInstanceLock()) {
  app.quit();
} else {
  app.on('second-instance', () => {
    if (win) {
      if (win.isMinimized()) win.restore();
      win.focus();
    }
  });
  app.whenReady().then(() => {
    if (process.env.ELIB_PARENT_DATA_DIR) app.setPath('userData', path.resolve(process.env.ELIB_PARENT_DATA_DIR));
    Menu.setApplicationMenu(null);
    loadSession();
    registerAppProtocol();
    registerIpc();
    createWindow();
    app.on('activate', () => {
      if (!win) createWindow();
    });
  });
  app.on('window-all-closed', () => {
    if (process.platform !== 'darwin') app.quit();
  });
}
>>>>>>> 9cdb3b1a4e77639efe6a102895d504764a0cff37
