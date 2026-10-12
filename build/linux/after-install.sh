#!/bin/sh
# Debian post-install script. NOTE: electron-builder substitutes the dollar-brace macros in this file
# (executable, sanitizedProductName), so plain shell variables here must be written as $VAR, never with braces.
set -e

APP_DIR='/opt/${sanitizedProductName}'
BIN="$APP_DIR/${executable}"

# --- standard electron-builder steps: launcher on PATH + SUID sandbox (needed on Ubuntu 24.04+) ---
if type update-alternatives >/dev/null 2>&1; then
  if [ -L '/usr/bin/${executable}' ] && [ -e '/usr/bin/${executable}' ] && [ "$(readlink '/usr/bin/${executable}')" != '/etc/alternatives/${executable}' ]; then
    rm -f '/usr/bin/${executable}'
  fi
  update-alternatives --install '/usr/bin/${executable}' '${executable}' "$BIN" 100 || ln -sf "$BIN" '/usr/bin/${executable}'
else
  ln -sf "$BIN" '/usr/bin/${executable}'
fi
chmod 4755 "$APP_DIR/chrome-sandbox" || true
if hash update-mime-database 2>/dev/null; then update-mime-database /usr/share/mime || true; fi
if hash update-desktop-database 2>/dev/null; then update-desktop-database /usr/share/applications || true; fi

# --- kiosk helpers ---
install -m 0755 "$APP_DIR/resources/linux/setup-kiosk.sh" /usr/sbin/elibrary-setup-kiosk
install -m 0755 "$APP_DIR/resources/linux/unlock.sh" /usr/sbin/elibrary-unlock
install -d /usr/lib/systemd/user
install -m 0644 "$APP_DIR/resources/autostart/child-safe-elibrary.service" /usr/lib/systemd/user/child-safe-elibrary.service

if [ -f /etc/child-safe-elibrary.conf ]; then
  # Upgrade: keep the existing kiosk configuration in sync with the new files.
  /usr/sbin/elibrary-setup-kiosk --reapply || echo "Warning: could not re-apply kiosk settings. Run: sudo elibrary-setup-kiosk --reapply"
elif [ -n "$ELIB_KIOSK_USER" ]; then
  # One-step install:  sudo env ELIB_KIOSK_USER=learner apt install ./child-safe-elibrary_*.deb
  /usr/sbin/elibrary-setup-kiosk --user "$ELIB_KIOSK_USER" --mode "$(echo "$ELIB_KIOSK_MODE" | grep -E '^(session|autostart|systemd)$' || echo session)" \
    || echo "Warning: kiosk setup failed. Run: sudo elibrary-setup-kiosk --user $ELIB_KIOSK_USER"
else
  cat <<'EOF'

Child-Safe E-Library installed.
Finish setup so it starts on boot for your child's account:

    sudo elibrary-setup-kiosk --user learner

(creates the 'learner' account if needed, logs it in automatically, and runs the library as its
only program). See 'elibrary-setup-kiosk --help' for other modes.

EOF
fi
exit 0
