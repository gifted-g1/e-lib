# Child-Safe E-Library

A kiosk-style desktop e-library for children aged 5–18, built with **Electron + React (Vite) + SQLite**.
It starts automatically when the Linux laptop boots, is the only thing the child can use, and works
fully offline once content has been downloaded.

- **Child side:** big tiles for Tutorial Videos, PDFs and approved websites; search across approved items
  only; "Request Access" on locked items and blocked web pages; a friendly lock screen when time is up.
- **Parent side (hidden):** press and hold the 📖 logo for **3 seconds**, then enter the parent password.
  Add, edit, delete and reorder content (upload files or paste links); manage categories, children,
  time limits and schedules; approve or deny requests; read the activity log.

---

## Quick start (development)

Requires Node.js 20+.

```bash
npm install          # also rebuilds better-sqlite3 for Electron
npm run dev          # Vite dev server + Electron, windowed, DevTools allowed
npm start            # production renderer build in a normal window
npm run start:kiosk  # production build WITH kiosk lockdown (exit: hold logo → Exit app)
```

Development runs are windowed and allow DevTools. Packaged builds are always locked down. Override with
`ELIB_KIOSK=1|0`.

| Variable | Purpose |
|---|---|
| `ELIB_DATA_DIR` | Where the database and cached content live (default `~/.config/child-safe-elibrary`) |
| `ELIB_KIOSK` | `1` forces kiosk lockdown, `0` disables it |
| `ELIB_DEV_SERVER` | Load the renderer from a Vite dev server (set by `npm run dev`) |

> On Windows inside VS Code's terminal, `ELECTRON_RUN_AS_NODE` may be inherited and make Electron start as
> plain Node. If `npm start` fails with `Cannot read properties of undefined (reading 'isPackaged')`, unset it.

## Building the Linux packages

Build on Linux (Ubuntu/Debian). The `.deb` target needs `fpm`, which electron-builder downloads itself.

```bash
npm ci
npm run dist         # → release/child-safe-elibrary_1.0.0_amd64.deb and release/Child-Safe E-Library-1.0.0.AppImage
```

To ship starter content, put files in `assets/content/` and list them in `assets/content/manifest.json`.
They are imported once, on first run:

```json
{ "items": [
  { "title": "Times Tables", "type": "pdf", "category": "PDFs", "file": "times-tables.pdf" },
  { "title": "Volcanoes", "type": "video", "category": "Tutorial Videos", "url": "https://example.org/volcanoes.mp4" },
  { "title": "Khan Academy Kids", "type": "site", "category": "External Sites", "url": "https://learn.khanacademy.org", "allowed_domains": "khanacademy.org" }
] }
```

## Deploying on a laptop

### 1. Install

```bash
# .deb (recommended), one step: installs and turns kiosk mode on for user "learner"
sudo env ELIB_KIOSK_USER=learner apt install ./child-safe-elibrary_1.0.0_amd64.deb

# or install first, configure later
sudo apt install ./child-safe-elibrary_1.0.0_amd64.deb
sudo elibrary-setup-kiosk --user learner

# AppImage: extract once, then let the setup script install it to /opt/child-safe-elibrary
./Child-Safe*.AppImage --appimage-extract
sudo bash squashfs-root/resources/linux/setup-kiosk.sh --user learner --app ./Child-Safe*.AppImage
```

`elibrary-setup-kiosk` creates the `learner` account if needed, with a random password nobody knows. It then
turns on automatic login for that account (GDM, LightDM or SDDM) and registers the app to start on boot.

| `--mode` | What starts the app | Lockdown strength |
|---|---|---|
| `session` *(default)* | A dedicated X session (`/usr/share/xsessions/elibrary-kiosk.desktop`) that runs **only** the library under `matchbox-window-manager`, restarting it if it crashes | **Strongest.** No desktop, so Super, Alt+Tab, Ctrl+Alt+T and the dock have nothing to open. Console switching (Ctrl+Alt+F*n*) is disabled in Xorg. |
| `systemd` | Normal desktop plus the systemd user unit `child-safe-elibrary.service` (`Restart=on-failure`) | Weaker. GNOME shortcuts are turned off with gsettings. |
| `autostart` | Normal desktop plus the XDG autostart entry `~/.config/autostart/child-safe-elibrary.desktop` | Weaker. Same gsettings lockdown. |

The template files are in [build/autostart/](build/autostart/) and [build/linux/](build/linux/).

### 2. First boot

The laptop logs into `learner` and the library opens full screen. Create the parent password and the first
child profile, then press and hold the 📖 logo to add content.

### 3. Getting out again (password-protected)

- **From the library:** hold the logo, enter the password, then choose **Exit app**. In `session` mode this
  logs out to the login screen, where you can sign in to your own account.
- **From an admin account** (needs sudo **and** the library's parent password):

```bash
sudo elibrary-unlock status
sudo elibrary-unlock disable     # stop kiosk on boot (keeps app + data); `enable` restores it
sudo elibrary-unlock uninstall   # remove kiosk config + app; optionally delete the learner account and data
```

`elibrary-unlock` checks the password by running the app's own runtime headlessly
(`ELECTRON_RUN_AS_NODE=1 … electron/cli.js verify-admin`) against the kiosk user's database.

---

## How it works

```
electron/
  main.js      App lifecycle, window, IPC handlers (allow-listed), session/time-limit state
  preload.js   contextBridge API: the renderer's only door into the main process
  kiosk.js     Key blocking, focus/fullscreen guard, global shortcut grabs
  sites.js     Sandboxed WebContentsView for approved websites + navigation allow-list
  protocol.js  app:// protocol serving the UI and cached media (range requests for video seeking)
  sync.js      Online/offline detection, download cache, optional remote sync
  db.js        SQLite schema + queries (better-sqlite3), bcrypt password hashing
  limits.js    Daily limit and allowed-hours schedule
  cli.js       Headless password check used by elibrary-unlock
  paths.js     Data directory resolution
src/
  App.jsx      View routing: setup → profile picker → home / viewers, lock screen, admin
  pages/       Home, VideoPlayer, PdfViewer (pdf.js), SiteViewer, Admin, Setup, ProfilePicker, LockScreen
  components/  Tiles, modals, admin panels
build/
  autostart/   .desktop autostart entry, systemd user unit
  linux/       setup-kiosk.sh, unlock.sh, elibrary-session.sh, Xorg hardening, deb hooks
assets/content/  Optional starter content pack
```

### Lockdown layers

1. **Window:** `kiosk` and `fullscreen`, always on top, close and minimize blocked unless a parent chose
   *Exit app*, focus and fullscreen re-asserted on blur, and the window is recreated if it is somehow
   destroyed.
2. **Keys:** a `before-input-event` filter on every web contents blocks Alt+F4, Ctrl+Q/W/R/N/T/P/S/O/L,
   all F-keys, Super/Meta, Alt+Tab, Ctrl+Alt+T, zoom and browser keys. Editing keys (Ctrl+A/C/V/X/Z) still
   work. X11 global grabs are a best-effort extra.
3. **Session:** in `session` mode no desktop shell runs at all. Xorg `DontVTSwitch`/`DontZap` and
   `setxkbmap srvrkeys:none` stop console switching.
4. **Renderer:** `contextIsolation: true`, `nodeIntegration: false`, `sandbox: true`, and `webSecurity` is
   never disabled. DevTools are disabled in packaged builds. Context menus, drag-and-drop navigation and
   `<webview>` are blocked, and new windows are always denied. A strict CSP is sent on `app://`.
5. **IPC:** every channel is registered by name. Calls are rejected unless they come from the app's own
   window and origin, and admin channels also need an unlocked parent session. That session lasts 15 minutes
   from the last action, and the dashboard locks itself after 5 idle minutes. Five wrong passwords trigger a
   one-minute lockout.
6. **Websites:** each approved site runs in a separate sandboxed `persist:sites` session.
   - Top-level navigation is limited to the site's domain, its subdomains, and any extra domains the parent
     lists. This is enforced in `will-navigate`, `will-redirect`, the popup handler, and a `webRequest`
     backstop.
   - Blocked pages show a banner with **Request Access**.
   - Downloads and permissions (camera, microphone, location, notifications) are denied, and `file:` and
     other schemes are refused.
   - YouTube requests carry `YouTube-Restrict: Strict`.

### Offline support

- Uploaded files are copied into `<data dir>/content/` immediately.
- Videos, PDFs and thumbnails added **by link** are downloaded whenever the computer is online. The sync
  engine checks connectivity every 10 s, runs on reconnect and every 15 minutes, and downloads one file at a
  time.
- Offline, everything cached plays normally. Websites, and links that haven't downloaded yet, show a
  friendly "needs internet" message.
- Video links must point at a media file (MP4/WebM). For YouTube-style pages, add a **Website** item instead.

### Database

The SQLite file is at `<data dir>/elibrary.db` and runs in WAL mode. The tables from the specification are
`users`, `children`, `categories`, `content`, `requests` and `activity_log`. A few additions support the
features above:

- `content`: `description`, `allowed_domains`, `thumbnail_path`, `remote_id`, `sync_error`, `updated_at`
- `requests`: `content_id`
- `activity_log`: `content_title`, `detail`
- New tables: `settings` (key/value) and `usage` (seconds per child per day)

Foreign keys use `ON DELETE SET NULL`, so deleting content keeps its history.

### Optional sync API (parent dashboard / Go backend)

This app contains the client side only; the Go server is not part of this repository. To use it, enter a
server URL and device token under **Settings → Parent dashboard server**. Every request sends
`Authorization: Bearer <token>`.

`GET {server}/api/v1/devices/{deviceId}/library`

```json
{
  "categories": [{ "remote_id": "c1", "name": "Science", "icon": "🔬", "sort_order": 0 }],
  "content": [{
    "remote_id": "v42", "category_remote_id": "c1", "title": "Volcanoes", "type": "video",
    "source_url": "https://bucket.s3.amazonaws.com/volcanoes.mp4?X-Amz-Signature=…",
    "thumbnail": "https://…/volcanoes.jpg", "description": "…", "allowed_domains": null,
    "is_approved": true, "sort_order": 3, "deleted": false
  }],
  "request_decisions": [{ "id": 17, "status": "approved" }]
}
```

`POST {server}/api/v1/devices/{deviceId}/events` with `{ "requests": [...], "activity": [...] }` (rows not yet
synced). A `2xx` response marks them as synced.

**S3:** have the server return pre-signed S3 URLs as `source_url`. The device downloads them into its offline
cache like any other link.

## Known limitations

- **Wayland:** global shortcut grabs and idle detection need X11. `session` mode always uses Xorg. In
  `autostart`/`systemd` modes on a Wayland desktop, the gsettings lockdown does the work.
- **Physical access:** a child who can reach the GRUB menu, a recovery shell or a USB boot can get around any
  software kiosk. On shared machines, set a BIOS/GRUB password and disable USB boot.
- No icon is bundled yet. Add `build/icons/512x512.png` (and other sizes) to brand the package.
