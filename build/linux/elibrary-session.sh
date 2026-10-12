#!/bin/sh
# X session for the kiosk user: no desktop, no panels, no terminal, only the E-Library.
# Installed as /usr/local/bin/elibrary-session and referenced by /usr/share/xsessions/elibrary-kiosk.desktop.

APP=/usr/bin/child-safe-elibrary

xset s off 2>/dev/null || true
xset s noblank 2>/dev/null || true
# Disable X server keys (Ctrl+Alt+Fn console switching, Ctrl+Alt+Backspace).
setxkbmap -option srvrkeys:none 2>/dev/null || true

WM_PID=""
if command -v matchbox-window-manager >/dev/null 2>&1; then
  # Minimal kiosk window manager: one fullscreen window, no titlebars, no keybindings.
  matchbox-window-manager -use_titlebar no -use_cursor yes &
  WM_PID=$!
fi

if [ ! -x "$APP" ]; then
  echo "E-Library is not installed at $APP" >&2
  sleep 10
  exit 1
fi

while :; do
  "$APP" --ozone-platform=x11
  rc=$?
  # 0 = a parent chose "Exit app" (or the system is shutting down): end the session.
  [ "$rc" -eq 0 ] && break
  # Anything else = crash or kill: start again.
  sleep 2
done

[ -n "$WM_PID" ] && kill "$WM_PID" 2>/dev/null
exit 0
