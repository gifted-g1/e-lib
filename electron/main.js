'use strict';

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

const FILE_FILTERS = {
  video: [{ name: 'Videos', extensions: ['mp4', 'm4v', 'webm', 'ogv', 'mov', 'mkv'] }],
  pdf: [{ name: 'PDF documents', extensions: ['pdf'] }],
  image: [{ name: 'Images', extensions: ['png', 'jpg', 'jpeg', 'webp', 'gif'] }],
};
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
}

function createWindow() {
  win = new BrowserWindow({
    width: 1280,
    height: 840,
    minWidth: 960,
    minHeight: 640,
    show: false,
    backgroundColor: '#f6f3fb',
    title: 'E-Library Parent',
    autoHideMenuBar: true,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      webSecurity: true,
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
