#!/bin/sh
# Installiert SIP-Telefon für den aktuellen Benutzer (Startmenü-Eintrag + Befehl).
set -e
DIR="$(cd "$(dirname "$0")" && pwd)"
APP_ID=de.hpieper.SipTelefon
BIN="$HOME/.local/bin"
APPS="${XDG_DATA_HOME:-$HOME/.local/share}/applications"

if ! command -v baresip >/dev/null 2>&1; then
    echo "baresip fehlt. Bitte zuerst installieren:"
    echo "  sudo dnf install baresip baresip-pipewire baresip-opus baresip-g722"
    exit 1
fi

mkdir -p "$BIN" "$APPS"
ln -sf "$DIR/sip-telefon" "$BIN/sip-telefon"

cat > "$APPS/$APP_ID.desktop" <<DESKTOP
[Desktop Entry]
Type=Application
Name=SIP-Telefon
GenericName=Softphone
Comment=Telefonieren über deine SIP-Telefonanlage
Exec=$DIR/sip-telefon
Icon=call-start-symbolic
Terminal=false
Categories=Network;Telephony;GTK;
Keywords=SIP;VoIP;Telefon;Anruf;Softphone;
StartupNotify=true
DBusActivatable=false
X-GNOME-UsesNotifications=true
DESKTOP

command -v update-desktop-database >/dev/null 2>&1 && update-desktop-database "$APPS" || true
echo "Installiert. Starten mit 'sip-telefon' oder über das Startmenü."
