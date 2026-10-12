#!/usr/bin/env bash
# Child-Safe E-Library: configure this computer so the library starts on boot as the only thing a child
# can use. Installed as /usr/sbin/elibrary-setup-kiosk.
#
#   sudo elibrary-setup-kiosk [--user learner] [--mode session|autostart|systemd] [--app File.AppImage]
#                             [--no-autologin]
#   sudo elibrary-setup-kiosk --reapply     # re-run with the saved options (used on package upgrade)
#   sudo elibrary-setup-kiosk --remove      # undo everything (use `elibrary-unlock` for the password-gated way)
#
# Modes:
#   session   (recommended) A dedicated X session with no desktop at all. Super, Alt+Tab, Ctrl+Alt+T and
#             console switching have nothing to open. The kiosk user is logged in automatically.
#   autostart Normal desktop session + XDG autostart entry + GNOME shortcut lockdown (weaker).
#   systemd   Normal desktop session + systemd user service (restarts on crash) + GNOME lockdown (weaker).
set -euo pipefail

CONF=/etc/child-safe-elibrary.conf
INSTALL_DIR=/opt/child-safe-elibrary
SESSION_NAME=elibrary-kiosk
UNIT=child-safe-elibrary.service

KIOSK_USER=learner
MODE=session
APPIMAGE=""
AUTOLOGIN=1
ACTION=setup

log() { printf '\033[1;35m==>\033[0m %s\n' "$*"; }
warn() { printf '\033[1;33mWARNING:\033[0m %s\n' "$*" >&2; }
die() { printf '\033[1;31mERROR:\033[0m %s\n' "$*" >&2; exit 1; }

usage() {
  sed -n '2,20p' "$0" | sed 's/^# \{0,1\}//'
  exit "${1:-0}"
}

if [ "$(id -u)" -ne 0 ]; then
  exec sudo -- "$0" "$@"
fi

while [ $# -gt 0 ]; do
  case "$1" in
    --user) KIOSK_USER="${2:?--user needs a name}"; shift 2 ;;
    --mode) MODE="${2:?--mode needs a value}"; shift 2 ;;
    --app) APPIMAGE="${2:?--app needs a path}"; shift 2 ;;
    --no-autologin) AUTOLOGIN=0; shift ;;
    --reapply) ACTION=reapply; shift ;;
    --remove) ACTION=remove; shift ;;
    -h|--help) usage 0 ;;
    *) warn "Unknown option: $1"; usage 1 ;;
  esac
done

case "$MODE" in session|autostart|systemd) ;; *) die "--mode must be session, autostart or systemd" ;; esac

# ---------------------------------------------------------------------------
# helpers
# ---------------------------------------------------------------------------
ini_set() { # file section key value
  python3 - "$1" "$2" "$3" "$4" <<'PY'
import configparser, sys
path, section, key, value = sys.argv[1:5]
cp = configparser.ConfigParser(interpolation=None, strict=False)
cp.optionxform = str
cp.read(path)
if not cp.has_section(section):
    cp.add_section(section)
cp.set(section, key, value)
with open(path, "w") as f:
    cp.write(f, space_around_delimiters=False)
PY
}

ini_unset() { # file section key
  [ -f "$1" ] || return 0
  python3 - "$1" "$2" "$3" <<'PY'
import configparser, sys
path, section, key = sys.argv[1:4]
cp = configparser.ConfigParser(interpolation=None, strict=False)
cp.optionxform = str
cp.read(path)
if cp.has_section(section):
    cp.remove_option(section, key)
with open(path, "w") as f:
    cp.write(f, space_around_delimiters=False)
PY
}

ini_get() { # file section key
  [ -f "$1" ] || return 0
  python3 - "$1" "$2" "$3" <<'PY'
import configparser, sys
path, section, key = sys.argv[1:4]
cp = configparser.ConfigParser(interpolation=None, strict=False)
cp.optionxform = str
cp.read(path)
print(cp.get(section, key, fallback=""))
PY
}

detect_dm() {
  local dm=""
  if [ -f /etc/X11/default-display-manager ]; then
    dm=$(basename "$(cat /etc/X11/default-display-manager)")
  elif [ -L /etc/systemd/system/display-manager.service ]; then
    dm=$(basename "$(readlink -f /etc/systemd/system/display-manager.service)" .service)
  fi
  echo "$dm"
}

gdm_conf() {
  if [ -f /etc/gdm3/custom.conf ]; then echo /etc/gdm3/custom.conf; else echo /etc/gdm/custom.conf; fi
}

user_home() { getent passwd "$1" | cut -d: -f6; }
user_group() { id -gn "$1"; }

# ---------------------------------------------------------------------------
# remove
# ---------------------------------------------------------------------------
remove_kiosk() {
  [ -f "$CONF" ] && . "$CONF"
  log "Removing kiosk configuration${KIOSK_USER:+ for $KIOSK_USER}"
  rm -f "/usr/share/xsessions/$SESSION_NAME.desktop" /usr/local/bin/elibrary-session
  rm -f /etc/X11/xorg.conf.d/99-elibrary-kiosk.conf
  rm -f /etc/lightdm/lightdm.conf.d/50-elibrary-kiosk.conf /etc/sddm.conf.d/elibrary-kiosk.conf

  local gconf; gconf=$(gdm_conf)
  if [ -f "$gconf" ] && [ -n "${KIOSK_USER:-}" ] && [ "$(ini_get "$gconf" daemon AutomaticLogin)" = "$KIOSK_USER" ]; then
    ini_set "$gconf" daemon AutomaticLoginEnable false
    ini_unset "$gconf" daemon AutomaticLogin
  fi

  if [ -n "${KIOSK_USER:-}" ] && id "$KIOSK_USER" >/dev/null 2>&1; then
    local home; home=$(user_home "$KIOSK_USER")
    local acc="/var/lib/AccountsService/users/$KIOSK_USER"
    if [ -f "$acc" ] && [ "$(ini_get "$acc" User XSession)" = "$SESSION_NAME" ]; then
      ini_unset "$acc" User XSession
      ini_unset "$acc" User Session
    fi
    rm -f "$home/.config/autostart/child-safe-elibrary.desktop"
    rm -f "$home/.config/systemd/user/graphical-session.target.wants/$UNIT"
  fi
  rm -f "$CONF"
  log "Kiosk mode removed. Reboot to return to the normal login screen."
}

# ---------------------------------------------------------------------------
# setup steps
# ---------------------------------------------------------------------------
resolve_app() {
  if [ -n "$APPIMAGE" ]; then
    [ -f "$APPIMAGE" ] || die "AppImage not found: $APPIMAGE"
    log "Extracting $(basename "$APPIMAGE") to $INSTALL_DIR (faster start-up, no FUSE needed)"
    local tmp; tmp=$(mktemp -d)
    cp "$APPIMAGE" "$tmp/app.AppImage"
    chmod +x "$tmp/app.AppImage"
    (cd "$tmp" && ./app.AppImage --appimage-extract >/dev/null)
    rm -rf "$INSTALL_DIR"
    mv "$tmp/squashfs-root" "$INSTALL_DIR"
    rm -rf "$tmp"
    chmod -R go-w "$INSTALL_DIR"
    chown -R root:root "$INSTALL_DIR"
    chmod 4755 "$INSTALL_DIR/chrome-sandbox"
    ln -sf "$INSTALL_DIR/child-safe-elibrary" /usr/bin/child-safe-elibrary
    FROM_APPIMAGE=1
  fi
  [ -x /usr/bin/child-safe-elibrary ] || die "The E-Library is not installed. Install the .deb, or pass --app File.AppImage."
  APP_BIN=$(readlink -f /usr/bin/child-safe-elibrary)
  APP_DIR=$(dirname "$APP_BIN")
  RES_DIR="$APP_DIR/resources"
  [ -d "$RES_DIR/linux" ] || die "Missing $RES_DIR/linux - is this a Child-Safe E-Library build?"

  # Make sure the helper commands exist (the .deb does this too; AppImage installs need it here).
  install -m 0755 "$RES_DIR/linux/setup-kiosk.sh" /usr/sbin/elibrary-setup-kiosk
  install -m 0755 "$RES_DIR/linux/unlock.sh" /usr/sbin/elibrary-unlock
  install -d /usr/lib/systemd/user
  install -m 0644 "$RES_DIR/autostart/$UNIT" "/usr/lib/systemd/user/$UNIT"
}

ensure_user() {
  if id "$KIOSK_USER" >/dev/null 2>&1; then
    log "Using existing user '$KIOSK_USER'"
  else
    log "Creating kiosk user '$KIOSK_USER'"
    useradd --create-home --shell /bin/bash --comment "E-Library" "$KIOSK_USER"
    # A random password nobody knows: the account is only reachable through automatic login.
    echo "$KIOSK_USER:$(head -c 48 /dev/urandom | base64 | tr -d '\n')" | chpasswd
  fi
  if id -nG "$KIOSK_USER" | grep -qwE 'sudo|wheel|admin|adm'; then
    warn "'$KIOSK_USER' is an administrator. Remove that with: sudo deluser $KIOSK_USER sudo"
  fi
  if getent group autologin >/dev/null; then usermod -aG autologin "$KIOSK_USER"; fi
  KIOSK_HOME=$(user_home "$KIOSK_USER")
  KIOSK_GROUP=$(user_group "$KIOSK_USER")
}

install_session() {
  log "Installing the dedicated kiosk session"
  install -m 0755 "$RES_DIR/linux/elibrary-session.sh" /usr/local/bin/elibrary-session
  install -d /usr/share/xsessions
  cat > "/usr/share/xsessions/$SESSION_NAME.desktop" <<EOF
[Desktop Entry]
Name=Child-Safe E-Library (kiosk)
Comment=Only the E-Library - no desktop
Exec=/usr/local/bin/elibrary-session
Type=Application
DesktopNames=ElibraryKiosk
EOF
  install -d /etc/X11/xorg.conf.d
  install -m 0644 "$RES_DIR/linux/99-elibrary-kiosk.conf" /etc/X11/xorg.conf.d/99-elibrary-kiosk.conf

  if ! command -v matchbox-window-manager >/dev/null 2>&1; then
    if command -v apt-get >/dev/null 2>&1; then
      log "Installing matchbox-window-manager (tiny kiosk window manager)"
      apt-get install -y matchbox-window-manager x11-xserver-utils >/dev/null || warn "Could not install matchbox-window-manager; the session still works without it."
    else
      warn "Install 'matchbox-window-manager' for best results."
    fi
  fi
}

install_autostart() {
  log "Adding autostart entry for $KIOSK_USER"
  install -d -o "$KIOSK_USER" -g "$KIOSK_GROUP" "$KIOSK_HOME/.config" "$KIOSK_HOME/.config/autostart"
  install -m 0644 -o "$KIOSK_USER" -g "$KIOSK_GROUP" "$RES_DIR/autostart/child-safe-elibrary.desktop" \
    "$KIOSK_HOME/.config/autostart/child-safe-elibrary.desktop"
}

install_systemd() {
  log "Enabling systemd user service for $KIOSK_USER"
  local wants="$KIOSK_HOME/.config/systemd/user/graphical-session.target.wants"
  install -d -o "$KIOSK_USER" -g "$KIOSK_GROUP" "$KIOSK_HOME/.config" "$KIOSK_HOME/.config/systemd" \
    "$KIOSK_HOME/.config/systemd/user" "$wants"
  ln -sf "/usr/lib/systemd/user/$UNIT" "$wants/$UNIT"
  chown -h "$KIOSK_USER:$KIOSK_GROUP" "$wants/$UNIT"
}

# For autostart/systemd modes the full desktop is still running, so turn off its escape hatches.
apply_gnome_lockdown() {
  command -v gsettings >/dev/null 2>&1 || return 0
  command -v dbus-run-session >/dev/null 2>&1 || { warn "dbus-run-session missing; skipping GNOME lockdown"; return 0; }
  log "Disabling desktop shortcuts for $KIOSK_USER (Super, Alt+Tab, terminal, overview...)"
  sudo -u "$KIOSK_USER" -H dbus-run-session -- sh -c '
    s() { gsettings set "$@" 2>/dev/null || true; }
    s org.gnome.mutter overlay-key ""
    for k in switch-applications switch-applications-backward switch-windows switch-windows-backward \
             switch-group switch-panels close minimize maximize toggle-fullscreen panel-run-dialog \
             panel-main-menu activate-window-menu show-desktop; do
      s org.gnome.desktop.wm.keybindings "$k" "[]"
    done
    s org.gnome.shell.keybindings toggle-overview "[]"
    s org.gnome.shell.keybindings toggle-application-view "[]"
    s org.gnome.shell.keybindings toggle-message-tray "[]"
    s org.gnome.settings-daemon.plugins.media-keys terminal "[]"
    s org.gnome.desktop.lockdown disable-command-line true
    s org.gnome.desktop.lockdown disable-lock-screen true
    s org.gnome.desktop.screensaver lock-enabled false
    s org.gnome.desktop.notifications show-banners false
  ' || warn "Some GNOME settings could not be applied."
}

configure_autologin() {
  local session="$1"
  DM=$(detect_dm)
  if [ "$AUTOLOGIN" -ne 1 ]; then
    warn "Automatic login skipped (--no-autologin). Log in as '$KIOSK_USER' to start the library."
    return 0
  fi
  case "$DM" in
    gdm3|gdm)
      local gconf; gconf=$(gdm_conf)
      log "Configuring GDM automatic login ($gconf)"
      [ -f "$gconf" ] || printf '[daemon]\n' > "$gconf"
      [ -f "$gconf.elibrary-backup" ] || cp "$gconf" "$gconf.elibrary-backup"
      ini_set "$gconf" daemon AutomaticLoginEnable true
      ini_set "$gconf" daemon AutomaticLogin "$KIOSK_USER"
      if [ -n "$session" ]; then
        local acc="/var/lib/AccountsService/users/$KIOSK_USER"
        install -d /var/lib/AccountsService/users
        [ -f "$acc" ] || printf '[User]\n' > "$acc"
        chmod 0600 "$acc"
        ini_set "$acc" User XSession "$session"
        ini_set "$acc" User Session "$session"
      fi
      ;;
    lightdm)
      log "Configuring LightDM automatic login"
      install -d /etc/lightdm/lightdm.conf.d
      {
        echo "[Seat:*]"
        echo "autologin-user=$KIOSK_USER"
        echo "autologin-user-timeout=0"
        [ -n "$session" ] && echo "autologin-session=$session"
      } > /etc/lightdm/lightdm.conf.d/50-elibrary-kiosk.conf
      ;;
    sddm)
      log "Configuring SDDM automatic login"
      install -d /etc/sddm.conf.d
      {
        echo "[Autologin]"
        echo "User=$KIOSK_USER"
        [ -n "$session" ] && echo "Session=$session.desktop"
        echo "Relogin=false"
      } > /etc/sddm.conf.d/elibrary-kiosk.conf
      ;;
    *)
      warn "Unknown display manager '${DM:-none}'. Configure automatic login for '$KIOSK_USER' manually${session:+ with session '$session'}."
      ;;
  esac
}

write_conf() {
  cat > "$CONF" <<EOF
# Written by elibrary-setup-kiosk
KIOSK_USER=$KIOSK_USER
MODE=$MODE
AUTOLOGIN=$AUTOLOGIN
APP_BIN=$APP_BIN
APP_DIR=$APP_DIR
DM=${DM:-}
FROM_APPIMAGE=${FROM_APPIMAGE:-0}
EOF
  chmod 0644 "$CONF"
}

# ---------------------------------------------------------------------------
# main
# ---------------------------------------------------------------------------
if [ "$ACTION" = remove ]; then
  remove_kiosk
  exit 0
fi

FROM_APPIMAGE=0
if [ "$ACTION" = reapply ]; then
  [ -f "$CONF" ] || die "Nothing to re-apply: $CONF not found."
  . "$CONF"
fi

resolve_app
ensure_user

# Clear leftovers from a previous mode before applying the new one.
rm -f "$KIOSK_HOME/.config/autostart/child-safe-elibrary.desktop" \
      "$KIOSK_HOME/.config/systemd/user/graphical-session.target.wants/$UNIT"

case "$MODE" in
  session)
    install_session
    configure_autologin "$SESSION_NAME"
    ;;
  autostart)
    install_autostart
    apply_gnome_lockdown
    configure_autologin ""
    ;;
  systemd)
    install_systemd
    apply_gnome_lockdown
    configure_autologin ""
    ;;
esac

write_conf

cat <<EOF

$(log "Done.")
  Kiosk user : $KIOSK_USER
  Mode       : $MODE
  App        : $APP_BIN

Reboot to start the E-Library. On first start it asks you to create the parent password.
To get back to a normal desktop later, log in on another account (or press and hold the 📖 logo for
3 seconds, then "Exit app") and run:   sudo elibrary-unlock disable
EOF
