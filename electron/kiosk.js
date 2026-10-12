'use strict';

// Kiosk lockdown. Electron can only intercept keys that reach its own windows; shortcuts the desktop
// environment grabs first (Super, Alt+Tab, Ctrl+Alt+T, VT switching) are handled by running the app in
// its own X session -- see build/linux/setup-kiosk.sh.
const { globalShortcut } = require('electron');

// Best-effort global grabs (X11 only; silently ignored when the desktop already owns the key).
const GLOBAL_BLOCK = [
  'Alt+Tab', 'Alt+Shift+Tab', 'Alt+F4', 'Alt+F2', 'Alt+Escape', 'Alt+Space',
  'Ctrl+Alt+T', 'Ctrl+Alt+Delete', 'Ctrl+Alt+Backspace', 'Ctrl+Escape', 'F11',
  'Super+Tab', 'Super+A', 'Super+D', 'Super+E', 'Super+L', 'Super+S', 'Super+V', 'Super+Space',
  'Super+Up', 'Super+Down', 'Super+Left', 'Super+Right',
];

// Ctrl combos that editing text in the admin forms still needs.
const CTRL_ALLOWED = new Set(['a', 'c', 'v', 'x', 'z', 'y', 'arrowleft', 'arrowright', 'arrowup', 'arrowdown',
  'home', 'end', 'backspace', 'delete', 'enter', 'control', 'shift']);
const CTRL_SHIFT_ALLOWED = new Set(['z', 'arrowleft', 'arrowright', 'arrowup', 'arrowdown', 'home', 'end',
  'control', 'shift']);
const ALT_BLOCKED = new Set(['tab', 'f4', 'arrowleft', 'arrowright', 'home', 'escape', ' ', 'space', 'enter']);
const BROWSER_KEYS = new Set(['browserback', 'browserforward', 'browserrefresh', 'browserhome', 'browsersearch',
  'browserfavorites', 'browserstop', 'contextmenu', 'printscreen']);

function isBlockedInput(input) {
  if (input.type !== 'keyDown') return false;
  const key = String(input.key || '').toLowerCase();

  if (input.meta || key === 'meta' || key === 'os' || key === 'super' || key === 'hyper') return true;
  if (/^f\d{1,2}$/.test(key)) return true; // F1 help, F5 reload, F7 caret browsing, F11 fullscreen, F12 devtools
  if (BROWSER_KEYS.has(key)) return true;

  if (input.control) {
    if (input.alt && (key === 't' || key === 'delete' || key === 'backspace' || key.startsWith('arrow'))) return true;
    if (input.shift) return !CTRL_SHIFT_ALLOWED.has(key);
    if (input.alt) return false; // AltGr on some layouts reports Ctrl+Alt
    return !CTRL_ALLOWED.has(key); // Ctrl+Q/W/R/N/T/P/S/O/L/F, zoom, Ctrl+Tab ...
  }
  if (input.alt && ALT_BLOCKED.has(key)) return true;
  return false;
}

function hardenWebContents(wc, { kioskEnabled, allowDevTools }) {
  if (kioskEnabled) {
    wc.on('before-input-event', (event, input) => {
      if (isBlockedInput(input)) event.preventDefault();
    });
  }
  wc.on('context-menu', (event) => event.preventDefault());
  wc.on('will-attach-webview', (event) => event.preventDefault());
  wc.on('zoom-changed', () => wc.setZoomFactor(1));
  wc.setVisualZoomLevelLimits(1, 1).catch(() => {});
  if (!allowDevTools) {
    wc.on('devtools-opened', () => wc.closeDevTools());
  }
}

function reassert(win) {
  if (!win || win.isDestroyed()) return;
  if (win.isMinimized()) win.restore();
  if (!win.isKiosk()) win.setKiosk(true);
  if (!win.isFullScreen()) win.setFullScreen(true);
  win.show();
  win.moveTop();
  win.focus();
}

// state: { allowQuit, suspendFocusGuard } shared with main.js
function lockWindow(win, state) {
  win.setAlwaysOnTop(true, 'screen-saver');
  win.on('close', (event) => {
    if (!state.allowQuit) event.preventDefault();
  });
  win.on('minimize', () => {
    if (!state.allowQuit) setTimeout(() => reassert(win), 50);
  });
  win.on('leave-full-screen', () => {
    if (!state.allowQuit) setTimeout(() => reassert(win), 50);
  });
  win.on('blur', () => {
    if (state.suspendFocusGuard || state.allowQuit) return;
    setTimeout(() => {
      if (!state.suspendFocusGuard && !state.allowQuit && !win.isDestroyed() && !win.isFocused()) reassert(win);
    }, 400);
  });
}

// Native dialogs (admin file picker) need the window to stop fighting for focus while they are open.
async function withDialog(win, state, fn) {
  state.suspendFocusGuard = true;
  const wasOnTop = win.isAlwaysOnTop();
  if (wasOnTop) win.setAlwaysOnTop(false);
  try {
    return await fn();
  } finally {
    if (wasOnTop) win.setAlwaysOnTop(true, 'screen-saver');
    state.suspendFocusGuard = false;
    if (!win.isDestroyed()) win.focus();
  }
}

function registerGlobalShortcuts() {
  for (const accelerator of GLOBAL_BLOCK) {
    try {
      globalShortcut.register(accelerator, () => {});
    } catch {
      // Unsupported accelerator on this platform -- ignore.
    }
  }
}

function unregisterGlobalShortcuts() {
  globalShortcut.unregisterAll();
}

module.exports = {
  isBlockedInput,
  hardenWebContents,
  lockWindow,
  withDialog,
  registerGlobalShortcuts,
  unregisterGlobalShortcuts,
};
