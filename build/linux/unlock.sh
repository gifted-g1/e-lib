#!/usr/bin/env bash
# Child-Safe E-Library: password-protected unlock / uninstall. Installed as /usr/sbin/elibrary-unlock.
#
#   sudo elibrary-unlock status      Show the current kiosk configuration
#   sudo elibrary-unlock disable     Stop starting the library on boot (keeps app + data)
#   sudo elibrary-unlock enable      Turn kiosk mode back on with the previous settings
#   sudo elibrary-unlock uninstall   Remove kiosk mode and the app (optionally the kiosk user + data)
#
# Every action except `status` needs both sudo (the computer's admin) and the E-Library parent password.
set -euo pipefail

CONF=/etc/child-safe-elibrary.conf
SAVED_CONF=/etc/child-safe-elibrary.conf.disabled
SETUP=/usr/sbin/elibrary-setup-kiosk

die() { printf '\033[1;31mERROR:\033[0m %s\n' "$*" >&2; exit 1; }
log() { printf '\033[1;35m==>\033[0m %s\n' "$*"; }

usage() {
  sed -n '2,10p' "$0" | sed 's/^# \{0,1\}//'
  exit "${1:-0}"
}

ACTION="${1:-}"
[ -n "$ACTION" ] || usage 1
case "$ACTION" in status|disable|enable|uninstall) ;; -h|--help) usage 0 ;; *) usage 1 ;; esac

if [ "$(id -u)" -ne 0 ]; then
  exec sudo -- "$0" "$@"
fi

KIOSK_USER=""
if [ -f "$CONF" ]; then . "$CONF"; elif [ -f "$SAVED_CONF" ]; then . "$SAVED_CONF"; fi
APP_BIN="${APP_BIN:-$(readlink -f /usr/bin/child-safe-elibrary 2>/dev/null || true)}"

verify_password() {
  [ -n "$APP_BIN" ] && [ -x "$APP_BIN" ] || die "The E-Library app is not installed; nothing to verify against."
  local cli user home pw
  cli="$(dirname "$APP_BIN")/resources/app/electron/cli.js"
  [ -f "$cli" ] || die "Missing $cli"
  user="${KIOSK_USER:-${SUDO_USER:-root}}"
  id "$user" >/dev/null 2>&1 || die "User '$user' does not exist."
  home=$(getent passwd "$user" | cut -d: -f6)

  read -r -s -p "E-Library parent password: " pw
  echo
  # Runs the app's own Node runtime (no window) against the kiosk user's database.
  if printf '%s\n' "$pw" | sudo -u "$user" env -i HOME="$home" ELECTRON_RUN_AS_NODE=1 "$APP_BIN" "$cli" verify-admin; then
    unset pw
    return 0
  fi
  unset pw
  die "Wrong password."
}

case "$ACTION" in
  status)
    if [ -f "$CONF" ]; then
      echo "Kiosk mode: ENABLED"
      cat "$CONF"
    elif [ -f "$SAVED_CONF" ]; then
      echo "Kiosk mode: DISABLED (run 'elibrary-unlock enable' to restore)"
      cat "$SAVED_CONF"
    else
      echo "Kiosk mode: not configured (run 'sudo elibrary-setup-kiosk')"
    fi
    echo "App: ${APP_BIN:-not installed}"
    ;;

  disable)
    [ -f "$CONF" ] || die "Kiosk mode is not enabled."
    verify_password
    cp "$CONF" "$SAVED_CONF"
    "$SETUP" --remove
    log "Kiosk mode disabled. Reboot (or log out) to use the normal desktop."
    ;;

  enable)
    [ -f "$SAVED_CONF" ] || die "No saved kiosk settings. Run: sudo elibrary-setup-kiosk --user <name>"
    verify_password
    . "$SAVED_CONF"
    args=(--user "$KIOSK_USER" --mode "$MODE")
    [ "${AUTOLOGIN:-1}" = 1 ] || args+=(--no-autologin)
    "$SETUP" "${args[@]}"
    rm -f "$SAVED_CONF"
    ;;

  uninstall)
    verify_password
    [ -x "$SETUP" ] && "$SETUP" --remove || true
    rm -f "$SAVED_CONF"
    if dpkg -s child-safe-elibrary >/dev/null 2>&1; then
      log "Removing the child-safe-elibrary package"
      apt-get remove -y child-safe-elibrary
    else
      log "Removing /opt/child-safe-elibrary"
      rm -rf /opt/child-safe-elibrary
      rm -f /usr/bin/child-safe-elibrary /usr/lib/systemd/user/child-safe-elibrary.service
      rm -f /usr/sbin/elibrary-setup-kiosk /usr/sbin/elibrary-unlock
    fi
    if [ -n "$KIOSK_USER" ] && id "$KIOSK_USER" >/dev/null 2>&1; then
      read -r -p "Also delete the user '$KIOSK_USER' and ALL library data (videos, PDFs, logs)? [y/N] " answer
      if [ "${answer:-n}" = y ] || [ "${answer:-n}" = Y ]; then
        loginctl terminate-user "$KIOSK_USER" 2>/dev/null || true
        userdel -r "$KIOSK_USER" 2>/dev/null || userdel "$KIOSK_USER"
        rm -f "/var/lib/AccountsService/users/$KIOSK_USER"
        log "User '$KIOSK_USER' deleted."
      fi
    fi
    log "Uninstalled. Reboot to finish."
    ;;
esac
