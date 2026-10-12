#!/bin/sh
# Debian post-remove script. electron-builder substitutes the dollar-brace macros; use $VAR for shell variables.
set -e

case "$1" in
  remove|purge|0) ;;
  *) exit 0 ;;  # upgrade etc.: keep everything
esac

# Never leave the computer auto-logging into a session whose program is gone.
if [ -x /usr/sbin/elibrary-setup-kiosk ]; then
  /usr/sbin/elibrary-setup-kiosk --remove || true
fi
rm -f /usr/sbin/elibrary-setup-kiosk /usr/sbin/elibrary-unlock
rm -f /usr/lib/systemd/user/child-safe-elibrary.service

if type update-alternatives >/dev/null 2>&1; then
  update-alternatives --remove '${executable}' '/opt/${sanitizedProductName}/${executable}' || true
fi
if [ -L '/usr/bin/${executable}' ] && [ ! -e '/usr/bin/${executable}' ]; then
  rm -f '/usr/bin/${executable}'
fi
exit 0
