#!/bin/sh
# Baut SIP-Telefon und installiert es für den aktuellen Benutzer (ohne sudo):
#   ~/.local/lib/sip-telefon, Befehl "sip-telefon", Startmenü-Eintrag.
# Voraussetzung: Node.js 22+ und baresip (z. B. sudo dnf install baresip baresip-pipewire)
set -e
DIR="$(cd "$(dirname "$0")/.." && pwd)"
LIB="$HOME/.local/lib/sip-telefon"
BIN="$HOME/.local/bin"
DATA="${XDG_DATA_HOME:-$HOME/.local/share}"
APPS="$DATA/applications"
ICONS="$DATA/icons/hicolor/256x256/apps"

if ! command -v baresip >/dev/null 2>&1; then
    echo "baresip fehlt. Bitte zuerst installieren:"
    echo "  sudo dnf install baresip baresip-pipewire baresip-opus baresip-g722"
    exit 1
fi

cd "$DIR"
[ -d node_modules ] || npm ci
npm run build
npx electron-builder --linux dir --publish never

rm -rf "$LIB"
mkdir -p "$LIB" "$BIN" "$APPS" "$ICONS"
cp -a dist/linux-unpacked/. "$LIB/"
ln -sf "$LIB/sip-telefon" "$BIN/sip-telefon"
cp resources/icons/icon-256.png "$ICONS/sip-telefon.png"

# Eintrag der früheren GTK-Version ersetzen
rm -f "$APPS/de.hpieper.SipTelefon.desktop"
cat > "$APPS/sip-telefon.desktop" <<DESKTOP
[Desktop Entry]
Type=Application
Name=SIP-Telefon
GenericName=Softphone
Comment=Telefonieren über deine SIP-Telefonanlage
Exec=$LIB/sip-telefon %U
Icon=sip-telefon
Terminal=false
Categories=Network;Telephony;
Keywords=SIP;VoIP;Telefon;Anruf;Softphone;
StartupNotify=true
StartupWMClass=sip-telefon
X-GNOME-UsesNotifications=true
MimeType=x-scheme-handler/sip-telefon;
DESKTOP

command -v update-desktop-database >/dev/null 2>&1 && update-desktop-database "$APPS" || true
# Einrichtungslinks der Telefonanlage (sip-telefon://…) mit der App öffnen
command -v xdg-mime >/dev/null 2>&1 && xdg-mime default sip-telefon.desktop x-scheme-handler/sip-telefon || true
command -v gtk-update-icon-cache >/dev/null 2>&1 && gtk-update-icon-cache -q "$DATA/icons/hicolor" || true
echo "Installiert. Starten mit 'sip-telefon' oder über das Startmenü."
