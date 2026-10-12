'use strict';

// Online/offline sync engine.
//  1. Optional: pull the library manifest from the parent-dashboard API and push requests/activity.
//  2. Download every video/PDF that has a link into the local cache so the library works offline.
//  3. Cache remote thumbnails.
// Downloads run one at a time to stay gentle on low-spec laptops and slow school networks.
const fs = require('fs');
const path = require('path');
const { EventEmitter } = require('events');
const { Readable } = require('stream');
const { pipeline } = require('stream/promises');
const { net } = require('electron');
const { resolveInside } = require('./protocol');

const EXT_BY_MIME = {
  'video/mp4': '.mp4',
  'video/webm': '.webm',
  'video/ogg': '.ogv',
  'video/quicktime': '.mov',
  'video/x-matroska': '.mkv',
  'application/pdf': '.pdf',
  'image/png': '.png',
  'image/jpeg': '.jpg',
  'image/webp': '.webp',
  'image/gif': '.gif',
};

const NET_CHECK_MS = 10_000;
const SYNC_INTERVAL_MS = 15 * 60_000;
// With a sync server, check in every minute so parent decisions arrive quickly.
const SERVER_SYNC_INTERVAL_MS = 60_000;

class SyncEngine extends EventEmitter {
  constructor({ db, contentDir, appVersion, today }) {
    super();
    this.db = db;
    this.contentDir = contentDir;
    this.appVersion = appVersion;
    this.today = today;
    this.online = false;
    this.running = false;
    this.pending = false;
    this.lastRunAt = 0;
    this.status = { state: 'idle', message: 'Waiting for internet', at: null };
    this.timers = [];
  }

  start() {
    this.checkOnline(true);
    this.timers.push(setInterval(() => this.checkOnline(), NET_CHECK_MS));
    this.timers.push(setInterval(() => this.tick(), SERVER_SYNC_INTERVAL_MS));
  }

  tick() {
    const hasServer = !!this.db.getSettings().sync_server_url;
    const interval = hasServer ? SERVER_SYNC_INTERVAL_MS : SYNC_INTERVAL_MS;
    if (Date.now() - this.lastRunAt >= interval - 1000) this.kick();
  }

  stop() {
    this.timers.forEach(clearInterval);
    this.timers = [];
  }

  checkOnline(initial = false) {
    const online = net.isOnline();
    if (online !== this.online || initial) {
      this.online = online;
      this.emit('online', online);
      if (online) this.kick();
      else this.setStatus('offline', 'Offline - using saved content');
    }
  }

  setStatus(state, message) {
    this.status = { state, message, at: new Date().toISOString() };
    this.emit('status', this.status);
  }

  kick() {
    if (!this.online) return;
    if (this.running) {
      this.pending = true;
      return;
    }
    this.running = true;
    this.run()
      .catch((err) => this.setStatus('error', err.message))
      .finally(() => {
        this.running = false;
        if (this.pending) {
          this.pending = false;
          this.kick();
        }
      });
  }

  async run() {
    this.lastRunAt = Date.now();
    this.setStatus('syncing', 'Checking for updates...');
    const settings = this.db.getSettings();
    let remoteError = '';
    if (settings.sync_server_url) {
      try {
        // Push first so the server knows which decisions this laptop has already applied.
        await this.pushRemote(settings);
        await this.pullRemote(settings);
      } catch (err) {
        remoteError = `Sync server: ${err.message}`;
      }
    }
    const failures = await this.cacheContent();
    await this.cacheThumbnails();

    this.db.setSettings({ last_sync_at: new Date().toISOString(), last_sync_error: remoteError }, { internal: true });
    if (remoteError) this.setStatus('error', remoteError);
    else if (failures) this.setStatus('error', `${failures} item(s) could not be downloaded`);
    else this.setStatus('idle', 'Everything is saved for offline use');
  }

  hasFile(name) {
    if (!name) return false;
    const full = resolveInside(this.contentDir, name);
    return !!full && fs.existsSync(full);
  }

  removeFile(name) {
    const full = name && resolveInside(this.contentDir, name);
    if (full) fs.promises.unlink(full).catch(() => {});
  }

  async cacheContent() {
    let failures = 0;
    for (const item of this.db.listCacheCandidates()) {
      if (!this.online) break;
      if (item.is_offline && this.hasFile(item.local_path)) continue;
      try {
        this.setStatus('syncing', `Downloading "${item.title}"...`);
        const name = await this.download(item.source_url, `${item.type}-${item.id}`);
        const fresh = this.db.getContent(item.id);
        if (!fresh || fresh.source_url !== item.source_url) {
          this.removeFile(name); // edited or deleted while downloading
          continue;
        }
        if (fresh.local_path && fresh.local_path !== name) this.removeFile(fresh.local_path);
        this.db.markCached(item.id, name);
        this.emit('content-changed');
      } catch (err) {
        failures++;
        this.db.markSyncError(item.id, err.message);
      }
    }
    return failures;
  }

  async cacheThumbnails() {
    for (const item of this.db.listThumbCandidates()) {
      if (!this.online) break;
      try {
        const name = await this.download(item.thumbnail, `thumb-${item.id}`, 10 * 1024 * 1024);
        this.db.markThumbCached(item.id, name);
        this.emit('content-changed');
      } catch {
        // thumbnails are optional
      }
    }
  }

  async download(url, baseName, maxBytes = 0) {
    const res = await net.fetch(url, { redirect: 'follow' });
    if (!res.ok || !res.body) throw new Error(`Download failed (HTTP ${res.status})`);
    const size = parseInt(res.headers.get('content-length') || '0', 10);
    if (maxBytes && size > maxBytes) throw new Error('File too large');

    const mime = (res.headers.get('content-type') || '').split(';')[0].trim().toLowerCase();
    let ext = '';
    try {
      ext = path.extname(new URL(res.url || url).pathname).toLowerCase();
    } catch {
      // ignore
    }
    if (!/^\.[a-z0-9]{2,5}$/.test(ext)) ext = EXT_BY_MIME[mime] || '';

    const name = `${baseName}-${Date.now()}${ext}`;
    const finalPath = path.join(this.contentDir, name);
    const tmpPath = `${finalPath}.part`;
    try {
      await pipeline(Readable.fromWeb(res.body), fs.createWriteStream(tmpPath));
      await fs.promises.rename(tmpPath, finalPath);
    } catch (err) {
      fs.promises.unlink(tmpPath).catch(() => {});
      throw err;
    }
    return name;
  }

  // ---- optional parent-dashboard API (see README "Sync API") ----
  endpoint(settings, suffix) {
    const base = settings.sync_server_url.replace(/\/+$/, '');
    return `${base}/api/v1/devices/${encodeURIComponent(settings.device_id)}/${suffix}`;
  }

  headers(settings, extra = {}) {
    const h = { Accept: 'application/json', ...extra };
    if (settings.sync_token) h.Authorization = `Bearer ${settings.sync_token}`;
    return h;
  }

  async pullRemote(settings) {
    const res = await net.fetch(this.endpoint(settings, 'library'), { headers: this.headers(settings) });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const manifest = await res.json();
    const { changed, limitsChanged, filesToDelete } = this.db.applyRemoteManifest(manifest || {}, { day: this.today() });
    filesToDelete.forEach((f) => this.removeFile(f));
    if (changed) this.emit('content-changed');
    if (limitsChanged) this.emit('limits-changed');
  }

  // Also sends child profiles, today's usage and the app version so the parent app can show them.
  async pushRemote(settings) {
    const requests = this.db.unsyncedRequests();
    const activity = this.db.unsyncedActivity();
    const children = this.db.listChildren().map(({ id, name, age, avatar }) => ({ id, name, age, avatar }));
    const usage = this.db.usageForDay(this.today());
    const res = await net.fetch(this.endpoint(settings, 'events'), {
      method: 'POST',
      headers: this.headers(settings, { 'Content-Type': 'application/json' }),
      body: JSON.stringify({ requests, activity, children, usage, app: { version: this.appVersion } }),
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    this.db.markSynced(requests.map((r) => r.id), activity.map((a) => a.id));
  }
}

module.exports = { SyncEngine };
