'use strict';

// SQLite storage. Must not require('electron'): electron/cli.js uses it in ELECTRON_RUN_AS_NODE mode.
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const Database = require('better-sqlite3');
const bcrypt = require('bcryptjs');

const BCRYPT_ROUNDS = 10;
const MIN_PASSWORD_LENGTH = 6;
const CONTENT_TYPES = ['video', 'pdf', 'site'];

const SCHEMA = `
CREATE TABLE IF NOT EXISTS users (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  username TEXT UNIQUE NOT NULL,
  password_hash TEXT NOT NULL,
  role TEXT NOT NULL DEFAULT 'admin',
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS children (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  age INTEGER,
  avatar TEXT,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS categories (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  icon TEXT,
  sort_order INTEGER DEFAULT 0,
  remote_id TEXT UNIQUE
);

CREATE TABLE IF NOT EXISTS content (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  category_id INTEGER REFERENCES categories(id) ON DELETE SET NULL,
  title TEXT NOT NULL,
  type TEXT NOT NULL CHECK (type IN ('video', 'pdf', 'site')),
  source_url TEXT,
  local_path TEXT,
  thumbnail TEXT,
  thumbnail_path TEXT,
  description TEXT,
  allowed_domains TEXT,
  is_offline INTEGER DEFAULT 0,
  is_approved INTEGER DEFAULT 1,
  sort_order INTEGER DEFAULT 0,
  remote_id TEXT UNIQUE,
  sync_error TEXT,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS requests (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  child_id INTEGER REFERENCES children(id) ON DELETE SET NULL,
  content_id INTEGER REFERENCES content(id) ON DELETE SET NULL,
  content_title TEXT NOT NULL,
  content_url TEXT,
  status TEXT DEFAULT 'pending',
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  resolved_at DATETIME,
  synced INTEGER DEFAULT 0
);

CREATE TABLE IF NOT EXISTS activity_log (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  child_id INTEGER REFERENCES children(id) ON DELETE SET NULL,
  content_id INTEGER REFERENCES content(id) ON DELETE SET NULL,
  content_title TEXT,
  action TEXT NOT NULL,
  detail TEXT,
  timestamp DATETIME DEFAULT CURRENT_TIMESTAMP,
  synced INTEGER DEFAULT 0
);

CREATE TABLE IF NOT EXISTS settings (
  key TEXT PRIMARY KEY,
  value TEXT
);

CREATE TABLE IF NOT EXISTS usage (
  child_id INTEGER NOT NULL,
  day TEXT NOT NULL,
  seconds INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (child_id, day)
);

CREATE INDEX IF NOT EXISTS idx_content_category ON content(category_id, sort_order);
CREATE INDEX IF NOT EXISTS idx_requests_status ON requests(status);
CREATE INDEX IF NOT EXISTS idx_activity_time ON activity_log(timestamp);
`;

const DEFAULT_CATEGORIES = [
  { name: 'Tutorial Videos', icon: '🎬' },
  { name: 'PDFs', icon: '📚' },
  { name: 'External Sites', icon: '🌍' },
];

// Settings an admin may change from the UI. Everything else is internal.
const PUBLIC_SETTINGS = [
  'daily_limit_minutes',
  'schedule_enabled',
  'schedule_start',
  'schedule_end',
  'sync_server_url',
  'sync_token',
];

const CONTENT_COLUMNS = [
  'category_id', 'title', 'type', 'source_url', 'local_path', 'thumbnail', 'thumbnail_path',
  'description', 'allowed_domains', 'is_offline', 'is_approved', 'sort_order', 'remote_id', 'sync_error',
];

function hostOf(url) {
  try {
    const u = new URL(url);
    if (u.protocol !== 'http:' && u.protocol !== 'https:') return null;
    return u.hostname.toLowerCase().replace(/^www\./, '');
  } catch {
    return null;
  }
}

function isHttpUrl(url) {
  return typeof url === 'string' && /^https?:\/\//i.test(url) && hostOf(url) !== null;
}

function createDb(dataDir) {
  fs.mkdirSync(dataDir, { recursive: true });
  const db = new Database(path.join(dataDir, 'elibrary.db'));
  db.pragma('journal_mode = WAL');
  db.pragma('synchronous = NORMAL');
  db.pragma('foreign_keys = ON');
  db.exec(SCHEMA);

  // ---- seed ----
  const seed = db.transaction(() => {
    const { n } = db.prepare('SELECT COUNT(*) AS n FROM categories').get();
    if (n === 0) {
      const ins = db.prepare('INSERT INTO categories (name, icon, sort_order) VALUES (?, ?, ?)');
      DEFAULT_CATEGORIES.forEach((c, i) => ins.run(c.name, c.icon, i));
    }
    const defaults = {
      daily_limit_minutes: '0',
      schedule_enabled: '0',
      schedule_start: '08:00',
      schedule_end: '20:00',
      sync_server_url: '',
      sync_token: '',
      device_id: crypto.randomUUID(),
      last_sync_at: '',
      last_sync_error: '',
      bundled_imported: '0',
    };
    const ins = db.prepare('INSERT OR IGNORE INTO settings (key, value) VALUES (?, ?)');
    for (const [k, v] of Object.entries(defaults)) ins.run(k, v);
  });
  seed();

  // ---- users ----
  function hasAdmin() {
    return !!db.prepare("SELECT 1 FROM users WHERE role = 'admin' LIMIT 1").get();
  }

  async function createAdmin(username, password) {
    username = String(username || '').trim() || 'admin';
    if (String(password || '').length < MIN_PASSWORD_LENGTH) {
      throw new Error(`Password must be at least ${MIN_PASSWORD_LENGTH} characters.`);
    }
    const hash = await bcrypt.hash(password, BCRYPT_ROUNDS);
    const info = db
      .prepare("INSERT INTO users (username, password_hash, role) VALUES (?, ?, 'admin')")
      .run(username, hash);
    return { id: info.lastInsertRowid, username };
  }

  async function verifyAdmin(password) {
    if (!password) return null;
    const admins = db.prepare("SELECT * FROM users WHERE role = 'admin'").all();
    for (const user of admins) {
      if (await bcrypt.compare(String(password), user.password_hash)) {
        return { id: user.id, username: user.username };
      }
    }
    return null;
  }

  async function changePassword(userId, current, next) {
    const user = db.prepare('SELECT * FROM users WHERE id = ?').get(userId);
    if (!user || !(await bcrypt.compare(String(current || ''), user.password_hash))) {
      throw new Error('Current password is incorrect.');
    }
    if (String(next || '').length < MIN_PASSWORD_LENGTH) {
      throw new Error(`New password must be at least ${MIN_PASSWORD_LENGTH} characters.`);
    }
    const hash = await bcrypt.hash(next, BCRYPT_ROUNDS);
    db.prepare('UPDATE users SET password_hash = ? WHERE id = ?').run(hash, userId);
  }

  // ---- children ----
  const listChildren = () => db.prepare('SELECT * FROM children ORDER BY name COLLATE NOCASE').all();
  const getChild = (id) => db.prepare('SELECT * FROM children WHERE id = ?').get(id);
  const countChildren = () => db.prepare('SELECT COUNT(*) AS n FROM children').get().n;

  function saveChild({ id, name, age, avatar }) {
    name = String(name || '').trim();
    if (!name) throw new Error('Please enter a name.');
    const ageNum = age === '' || age == null ? null : parseInt(age, 10);
    if (ageNum !== null && (Number.isNaN(ageNum) || ageNum < 0 || ageNum > 25)) {
      throw new Error('Age must be a number between 0 and 25.');
    }
    avatar = String(avatar || '').trim() || null;
    if (id) {
      db.prepare('UPDATE children SET name = ?, age = ?, avatar = ? WHERE id = ?').run(name, ageNum, avatar, id);
      return getChild(id);
    }
    const info = db.prepare('INSERT INTO children (name, age, avatar) VALUES (?, ?, ?)').run(name, ageNum, avatar);
    return getChild(info.lastInsertRowid);
  }

  const deleteChild = (id) => {
    db.prepare('DELETE FROM usage WHERE child_id = ?').run(id);
    db.prepare('DELETE FROM children WHERE id = ?').run(id);
  };

  // ---- categories ----
  const listCategories = () => db.prepare('SELECT * FROM categories ORDER BY sort_order, id').all();

  function saveCategory({ id, name, icon }) {
    name = String(name || '').trim();
    if (!name) throw new Error('Please enter a category name.');
    icon = String(icon || '').trim() || null;
    if (id) {
      db.prepare('UPDATE categories SET name = ?, icon = ? WHERE id = ?').run(name, icon, id);
      return id;
    }
    const { next } = db.prepare('SELECT COALESCE(MAX(sort_order), -1) + 1 AS next FROM categories').get();
    return db.prepare('INSERT INTO categories (name, icon, sort_order) VALUES (?, ?, ?)').run(name, icon, next)
      .lastInsertRowid;
  }

  const deleteCategory = (id) => db.prepare('DELETE FROM categories WHERE id = ?').run(id);

  const reorderCategories = db.transaction((ids) => {
    const upd = db.prepare('UPDATE categories SET sort_order = ? WHERE id = ?');
    ids.forEach((id, i) => upd.run(i, id));
  });

  function findSitesCategoryId() {
    const row =
      db.prepare("SELECT id FROM categories WHERE name LIKE '%site%' OR name LIKE '%web%' ORDER BY sort_order LIMIT 1").get() ||
      db.prepare('SELECT id FROM categories ORDER BY sort_order LIMIT 1').get();
    return row ? row.id : null;
  }

  // ---- content ----
  const CONTENT_SELECT = `
    SELECT c.*, cat.name AS category_name, cat.icon AS category_icon
    FROM content c LEFT JOIN categories cat ON cat.id = c.category_id`;
  const CONTENT_ORDER = 'ORDER BY COALESCE(cat.sort_order, 9999), c.category_id, c.sort_order, c.id';

  function listContent({ approvedOnly = false } = {}) {
    const where = approvedOnly ? 'WHERE c.is_approved = 1' : '';
    return db.prepare(`${CONTENT_SELECT} ${where} ${CONTENT_ORDER}`).all();
  }

  function searchContent(query) {
    const q = String(query || '').trim().slice(0, 100);
    if (!q) return [];
    const like = `%${q.replace(/[\\%_]/g, (m) => '\\' + m)}%`;
    return db
      .prepare(
        `${CONTENT_SELECT} WHERE c.is_approved = 1
         AND (c.title LIKE ? ESCAPE '\\' OR c.description LIKE ? ESCAPE '\\' OR cat.name LIKE ? ESCAPE '\\')
         ${CONTENT_ORDER} LIMIT 100`
      )
      .all(like, like, like);
  }

  const getContent = (id) => db.prepare(`${CONTENT_SELECT} WHERE c.id = ?`).get(id);
  const getContentByRemoteId = (rid) => db.prepare('SELECT * FROM content WHERE remote_id = ?').get(rid);

  function pick(fields) {
    const out = {};
    for (const k of CONTENT_COLUMNS) if (k in fields) out[k] = fields[k];
    return out;
  }

  function insertContent(fields) {
    const data = pick(fields);
    if (!CONTENT_TYPES.includes(data.type)) throw new Error('Unknown content type.');
    if (!('sort_order' in data)) {
      data.sort_order = db
        .prepare('SELECT COALESCE(MAX(sort_order), -1) + 1 AS next FROM content WHERE category_id IS ?')
        .get(data.category_id ?? null).next;
    }
    const keys = Object.keys(data);
    const sql = `INSERT INTO content (${keys.join(', ')}) VALUES (${keys.map(() => '?').join(', ')})`;
    return db.prepare(sql).run(...keys.map((k) => data[k])).lastInsertRowid;
  }

  function updateContent(id, fields) {
    const data = pick(fields);
    if ('type' in data && !CONTENT_TYPES.includes(data.type)) throw new Error('Unknown content type.');
    const keys = Object.keys(data);
    if (!keys.length) return;
    const sql = `UPDATE content SET ${keys.map((k) => `${k} = ?`).join(', ')}, updated_at = CURRENT_TIMESTAMP WHERE id = ?`;
    db.prepare(sql).run(...keys.map((k) => data[k]), id);
  }

  const deleteContent = (id) => db.prepare('DELETE FROM content WHERE id = ?').run(id);

  const reorderContent = db.transaction((ids) => {
    const upd = db.prepare('UPDATE content SET sort_order = ? WHERE id = ?');
    ids.forEach((id, i) => upd.run(i, id));
  });

  // Files a sync pass should (re)download: videos/PDFs with a link.
  const listCacheCandidates = () =>
    db.prepare("SELECT * FROM content WHERE type IN ('video', 'pdf') AND source_url IS NOT NULL AND source_url <> ''").all();

  const listThumbCandidates = () =>
    db.prepare("SELECT * FROM content WHERE thumbnail LIKE 'http%' AND (thumbnail_path IS NULL OR thumbnail_path = '')").all();

  const markCached = (id, localPath) =>
    db.prepare('UPDATE content SET local_path = ?, is_offline = 1, sync_error = NULL WHERE id = ?').run(localPath, id);
  const markThumbCached = (id, name) => db.prepare('UPDATE content SET thumbnail_path = ? WHERE id = ?').run(name, id);
  const markSyncError = (id, msg) => db.prepare('UPDATE content SET sync_error = ? WHERE id = ?').run(String(msg).slice(0, 300), id);

  // ---- requests ----
  function createRequest({ childId, contentId, title, url }) {
    let item = null;
    if (contentId) {
      item = getContent(contentId);
      if (!item) throw new Error('That item no longer exists.');
    }
    if (url != null && url !== '' && !isHttpUrl(url)) throw new Error('Only web pages can be requested.');
    url = url || null;
    if (item && url) title = `Visit ${hostOf(url)} (from "${item.title}")`;
    else if (item) title = item.title;
    title = String(title || '').trim().slice(0, 200);
    if (!title) throw new Error('Please say what you would like.');

    const existing = db
      .prepare(
        `SELECT * FROM requests WHERE status = 'pending' AND IFNULL(child_id, 0) = IFNULL(?, 0)
         AND IFNULL(content_id, 0) = IFNULL(?, 0) AND IFNULL(content_url, '') = IFNULL(?, '') AND content_title = ?`
      )
      .get(childId ?? null, contentId ?? null, url, title);
    if (existing) return { ...existing, duplicate: true };

    const info = db
      .prepare('INSERT INTO requests (child_id, content_id, content_title, content_url) VALUES (?, ?, ?, ?)')
      .run(childId ?? null, contentId ?? null, title, url);
    return db.prepare('SELECT * FROM requests WHERE id = ?').get(info.lastInsertRowid);
  }

  function listRequests(status) {
    const where = status && status !== 'all' ? 'WHERE r.status = ?' : '';
    const sql = `SELECT r.*, ch.name AS child_name, c.title AS current_title, c.type AS content_type
      FROM requests r
      LEFT JOIN children ch ON ch.id = r.child_id
      LEFT JOIN content c ON c.id = r.content_id
      ${where} ORDER BY (r.status = 'pending') DESC, r.created_at DESC LIMIT 500`;
    return where ? db.prepare(sql).all(status) : db.prepare(sql).all();
  }

  const pendingRequestCount = () => db.prepare("SELECT COUNT(*) AS n FROM requests WHERE status = 'pending'").get().n;

  // Approving a request also grants what was asked for. Returns a human-readable description of the effect.
  // For decisions from the sync server (`remote`), the server already applied the effect to its own items,
  // so only items that exist solely on this laptop are changed here.
  const resolveRequest = db.transaction((id, status, { remote = false } = {}) => {
    if (status !== 'approved' && status !== 'denied') throw new Error('Invalid status.');
    const req = db.prepare('SELECT * FROM requests WHERE id = ?').get(id);
    if (!req) throw new Error('Request not found.');
    db.prepare('UPDATE requests SET status = ?, resolved_at = CURRENT_TIMESTAMP, synced = 0 WHERE id = ?').run(status, id);
    if (status !== 'approved') return null;

    const item = req.content_id ? getContent(req.content_id) : null;
    if (remote && (!item || item.remote_id)) return null;
    const host = req.content_url ? hostOf(req.content_url) : null;
    if (item && host && item.type === 'site') {
      const domains = new Set(String(item.allowed_domains || '').split(/[\s,]+/).filter(Boolean));
      domains.add(host);
      updateContent(item.id, { allowed_domains: [...domains].join('\n') });
      return `${host} can now be opened from "${item.title}".`;
    }
    if (item) {
      if (!item.is_approved) updateContent(item.id, { is_approved: 1 });
      return `"${item.title}" is now unlocked.`;
    }
    if (host) {
      insertContent({
        category_id: findSitesCategoryId(),
        title: host,
        type: 'site',
        source_url: req.content_url,
        is_approved: 1,
      });
      return `Added ${host} as a new website.`;
    }
    return 'Approved. Add the requested item from the Content tab.';
  });

  // ---- activity ----
  function logActivity({ childId, contentId, title, action, detail }) {
    db.prepare(
      'INSERT INTO activity_log (child_id, content_id, content_title, action, detail) VALUES (?, ?, ?, ?, ?)'
    ).run(childId ?? null, contentId ?? null, title ?? null, action, detail ? String(detail).slice(0, 500) : null);
  }

  function listActivity({ limit = 300, childId } = {}) {
    const lim = Math.min(Math.max(parseInt(limit, 10) || 300, 1), 5000);
    const where = childId ? 'WHERE a.child_id = ?' : '';
    const sql = `SELECT a.*, ch.name AS child_name, c.type AS content_type
      FROM activity_log a
      LEFT JOIN children ch ON ch.id = a.child_id
      LEFT JOIN content c ON c.id = a.content_id
      ${where} ORDER BY a.timestamp DESC, a.id DESC LIMIT ${lim}`;
    return childId ? db.prepare(sql).all(childId) : db.prepare(sql).all();
  }

  const clearActivity = () => db.prepare('DELETE FROM activity_log').run();

  // ---- settings ----
  function getSettings() {
    const out = {};
    for (const { key, value } of db.prepare('SELECT key, value FROM settings').all()) out[key] = value;
    return out;
  }

  function setSettings(values, { internal = false } = {}) {
    const upsert = db.prepare(
      'INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value'
    );
    db.transaction(() => {
      for (const [k, v] of Object.entries(values || {})) {
        if (!internal && !PUBLIC_SETTINGS.includes(k)) continue;
        upsert.run(k, v == null ? '' : String(v));
      }
    })();
  }

  // ---- usage (time limits) ----
  const getUsage = (childId, day) =>
    db.prepare('SELECT seconds FROM usage WHERE child_id = ? AND day = ?').get(childId, day)?.seconds || 0;

  const addUsage = (childId, day, seconds) =>
    db.prepare(
      `INSERT INTO usage (child_id, day, seconds) VALUES (?, ?, ?)
       ON CONFLICT(child_id, day) DO UPDATE SET seconds = seconds + excluded.seconds`
    ).run(childId, day, seconds);

  const grantMinutes = (childId, day, minutes) =>
    db.prepare('UPDATE usage SET seconds = MAX(0, seconds - ?) WHERE child_id = ? AND day = ?').run(minutes * 60, childId, day);

  // ---- remote sync (parent app / sync server) ----
  // Returns { changed, limitsChanged, filesToDelete } so the caller can clean up cached files.
  // `day` is today's local date, used to apply extra-time grants.
  const applyRemoteManifest = db.transaction((manifest, { day } = {}) => {
    let changed = false;
    let limitsChanged = false;
    const filesToDelete = [];
    const catMap = new Map();

    // A full manifest is authoritative: server items it no longer lists were deleted by the parent.
    if (manifest.full) {
      const keepContent = new Set((manifest.content || []).filter((c) => c && c.remote_id).map((c) => String(c.remote_id)));
      for (const row of db.prepare('SELECT * FROM content WHERE remote_id IS NOT NULL').all()) {
        if (keepContent.has(row.remote_id)) continue;
        if (row.local_path) filesToDelete.push(row.local_path);
        if (row.thumbnail_path) filesToDelete.push(row.thumbnail_path);
        deleteContent(row.id);
        changed = true;
      }
      const keepCats = new Set((manifest.categories || []).filter((c) => c && c.remote_id).map((c) => String(c.remote_id)));
      for (const row of db.prepare('SELECT id, remote_id FROM categories WHERE remote_id IS NOT NULL').all()) {
        if (!keepCats.has(row.remote_id)) {
          deleteCategory(row.id);
          changed = true;
        }
      }
    }

    if (manifest.settings && typeof manifest.settings === 'object') {
      const current = getSettings();
      const next = {};
      for (const key of ['daily_limit_minutes', 'schedule_enabled', 'schedule_start', 'schedule_end']) {
        if (key in manifest.settings && String(manifest.settings[key]) !== current[key]) next[key] = String(manifest.settings[key]);
      }
      if (Object.keys(next).length) {
        setSettings(next);
        limitsChanged = true;
      }
    }

    if (Array.isArray(manifest.usage_grants) && day) {
      let lastGrant = parseInt(getSettings().last_grant_id || '0', 10) || 0;
      for (const g of manifest.usage_grants) {
        const gid = parseInt(g && g.id, 10);
        const minutes = parseInt(g && g.minutes, 10);
        if (!(gid > lastGrant) || !(minutes > 0)) continue;
        for (const child of listChildren()) grantMinutes(child.id, day, Math.min(minutes, 600));
        lastGrant = gid;
        limitsChanged = true;
      }
      setSettings({ last_grant_id: String(lastGrant) }, { internal: true });
    }

    for (const cat of manifest.categories || []) {
      if (!cat || !cat.remote_id || !cat.name) continue;
      const existing = db.prepare('SELECT * FROM categories WHERE remote_id = ?').get(String(cat.remote_id));
      if (existing) {
        db.prepare('UPDATE categories SET name = ?, icon = ?, sort_order = ? WHERE id = ?')
          .run(String(cat.name), cat.icon || null, cat.sort_order ?? existing.sort_order, existing.id);
        catMap.set(String(cat.remote_id), existing.id);
      } else {
        const id = db.prepare('INSERT INTO categories (name, icon, sort_order, remote_id) VALUES (?, ?, ?, ?)')
          .run(String(cat.name), cat.icon || null, cat.sort_order ?? 0, String(cat.remote_id)).lastInsertRowid;
        catMap.set(String(cat.remote_id), id);
      }
      changed = true;
    }

    for (const item of manifest.content || []) {
      if (!item || !item.remote_id) continue;
      const rid = String(item.remote_id);
      const existing = getContentByRemoteId(rid);
      if (item.deleted) {
        if (existing) {
          if (existing.local_path) filesToDelete.push(existing.local_path);
          if (existing.thumbnail_path) filesToDelete.push(existing.thumbnail_path);
          deleteContent(existing.id);
          changed = true;
        }
        continue;
      }
      if (!CONTENT_TYPES.includes(item.type) || !item.title) continue;
      if (item.source_url && !isHttpUrl(item.source_url)) continue;
      const fields = {
        title: String(item.title),
        type: item.type,
        source_url: item.source_url || null,
        thumbnail: isHttpUrl(item.thumbnail) ? item.thumbnail : null,
        description: item.description || null,
        allowed_domains: item.allowed_domains || null,
        is_approved: item.is_approved === false || item.is_approved === 0 ? 0 : 1,
        category_id: catMap.get(String(item.category_remote_id)) ?? existing?.category_id ?? null,
      };
      if (item.sort_order != null) fields.sort_order = item.sort_order;
      if (existing) {
        if ((existing.source_url || '') !== (fields.source_url || '') && existing.local_path) {
          filesToDelete.push(existing.local_path);
          fields.local_path = null;
          fields.is_offline = 0;
        }
        if ((existing.thumbnail || '') !== (fields.thumbnail || '') && existing.thumbnail_path) {
          filesToDelete.push(existing.thumbnail_path);
          fields.thumbnail_path = null;
        }
        updateContent(existing.id, fields);
      } else {
        insertContent({ ...fields, remote_id: rid });
      }
      changed = true;
    }

    for (const d of manifest.request_decisions || []) {
      const req = d && db.prepare("SELECT * FROM requests WHERE id = ? AND status = 'pending'").get(d.id);
      if (req && (d.status === 'approved' || d.status === 'denied')) {
        resolveRequest(req.id, d.status, { remote: true });
        changed = true;
      }
    }
    return { changed, limitsChanged, filesToDelete };
  });

  const unsyncedRequests = () =>
    db.prepare(
      `SELECT r.*, c.remote_id AS content_remote_id FROM requests r LEFT JOIN content c ON c.id = r.content_id
       WHERE r.synced = 0 ORDER BY r.id LIMIT 500`
    ).all();
  const unsyncedActivity = () =>
    db.prepare(
      `SELECT a.*, c.remote_id AS content_remote_id FROM activity_log a LEFT JOIN content c ON c.id = a.content_id
       WHERE a.synced = 0 ORDER BY a.id LIMIT 1000`
    ).all();
  const usageForDay = (day) => db.prepare('SELECT child_id, day, seconds FROM usage WHERE day = ?').all(day);
  const markSynced = db.transaction((requestIds, activityIds) => {
    const r = db.prepare('UPDATE requests SET synced = 1 WHERE id = ?');
    const a = db.prepare('UPDATE activity_log SET synced = 1 WHERE id = ?');
    requestIds.forEach((id) => r.run(id));
    activityIds.forEach((id) => a.run(id));
  });

  return {
    raw: db,
    close: () => db.close(),
    hasAdmin, createAdmin, verifyAdmin, changePassword,
    listChildren, getChild, countChildren, saveChild, deleteChild,
    listCategories, saveCategory, deleteCategory, reorderCategories, findSitesCategoryId,
    listContent, searchContent, getContent, insertContent, updateContent, deleteContent, reorderContent,
    listCacheCandidates, listThumbCandidates, markCached, markThumbCached, markSyncError,
    createRequest, listRequests, pendingRequestCount, resolveRequest,
    logActivity, listActivity, clearActivity,
    getSettings, setSettings,
    getUsage, addUsage, grantMinutes,
    applyRemoteManifest, unsyncedRequests, unsyncedActivity, usageForDay, markSynced,
  };
}

module.exports = { createDb, hostOf, isHttpUrl, CONTENT_TYPES };
