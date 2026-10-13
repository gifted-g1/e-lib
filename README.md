# E-Library Parent

The desktop app parents use to manage the Child-Safe E-Library from their own computer (Windows, Mac or
Linux). It talks to the sync server in [../server](../server). The child laptops talk to the same server.

## Run / build

```bash
npm install
npm start            # build + run
npm run dev          # hot reload
npm run dist:win     # Windows installer  → release/E-Library Parent Setup 1.0.0.exe
npm run dist:mac     # macOS .dmg (build on a Mac)
npm run dist:linux   # AppImage + .deb
```

## First use

1. Start the server and give it an `https://` address (see the server README).
2. Open E-Library Parent, enter the server address, and create your account. Only the first account can be
   created unless the server allows signups.
3. Go to **Laptops → Connect a laptop** and give it a name. The app shows the server address and a **device
   token**.
4. On the child's laptop, hold the 📖 logo for 3 s, enter the library password, then open **Settings → Parent
   app connection**. Paste both values and save.
5. Within a minute the laptop shows as online. From then on, these are managed from this app:
   - content and categories
   - time limits, plus "+15/+30 min today"
   - request approvals
   - the activity log

## How it works

- The session token stays in the main process and is encrypted with the OS keychain (Electron
  `safeStorage`). The page itself never sees it and can only reach `/api/v1/…` on the configured server.
- Uploads stream from disk to the server, with a progress bar.
- Changes reach a laptop at its next check-in, which is about once a minute while it is online. Laptops that
  are offline get them when they reconnect.
