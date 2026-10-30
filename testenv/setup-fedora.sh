#!/bin/bash
# Phone4all Testumgebung auf Fedora einrichten
#
#   sudo bash testenv/setup-fedora.sh [--lan] [benutzer]
#
# Legt einen eigenen Benutzer (Standard: p4test) ohne Administratorrechte an, in dem die
# Testumgebung mit Podman ohne Root läuft. Der Benutzer hat kein Passwort; anmelden kann man
# sich nur per SSH-Schlüssel und nur von diesem Rechner aus (ssh p4test). Claude nutzt diesen
# Weg über Remote Control und arbeitet so nie mit den Rechten des eigenen Kontos.
#
# --lan  öffnet in der Firewall die Ports der Test-Anlage (18080, 5070, 20000-20099), damit
#        echte Telefone im LAN (DECT, Handy) sie nutzen können.
#
# Mehrfach ausführbar: Vorhandenes bleibt, Fehlendes wird ergänzt.

set -euo pipefail

LAN=0
if [ "${1:-}" = "--lan" ]; then LAN=1; shift; fi
TESTUSER=${1:-p4test}
OWNER=${SUDO_USER:-}
REPO=https://github.com/henne-407/phone4all.git

[ "$(id -u)" = 0 ] || { echo "Bitte mit sudo starten: sudo bash $0"; exit 1; }
[ -n "$OWNER" ] && [ "$OWNER" != root ] || { echo "Bitte aus dem eigenen Konto mit sudo starten (nicht als root anmelden)."; exit 1; }
OWNER_HOME=$(getent passwd "$OWNER" | cut -d: -f6)

step() { printf '\n== %s\n' "$*"; }

step "Pakete"
# podman + compose: Container ohne Root; sipp/sngrep/tshark: SIP testen und mitlesen;
# android-tools: adb für die Mobil-App (Handy per WLAN-Debugging); baresip: SIP-Engine der App
PACKAGES=(podman podman-compose git nodejs npm python3 openssl
  sipp sngrep wireshark-cli android-tools openssh-server
  baresip baresip-pipewire xorg-x11-server-Xvfb)
# Fehlt ein Paket in dieser Fedora-Version, den Rest trotzdem installieren
dnf install -y --setopt=install_weak_deps=False --skip-unavailable "${PACKAGES[@]}" 2>/dev/null \
  || dnf install -y --setopt=install_weak_deps=False "${PACKAGES[@]}"

step "Benutzer $TESTUSER"
if ! id "$TESTUSER" >/dev/null 2>&1; then
  useradd --create-home --comment "Phone4all Testumgebung" --shell /bin/bash "$TESTUSER"
fi
# Keine Administratorrechte, kein Passwort (nur SSH-Schlüssel), keine Docker-Gruppe
for g in wheel docker; do gpasswd -d "$TESTUSER" "$g" >/dev/null 2>&1 || true; done
passwd -l "$TESTUSER" >/dev/null
TEST_HOME=$(getent passwd "$TESTUSER" | cut -d: -f6)
chmod 700 "$TEST_HOME"
# Podman ohne Root braucht eigene UID-Bereiche (legt useradd auf Fedora normalerweise an)
grep -q "^$TESTUSER:" /etc/subuid || usermod --add-subuids 300000-365535 --add-subgids 300000-365535 "$TESTUSER"
# Container laufen weiter, auch wenn niemand als $TESTUSER angemeldet ist
loginctl enable-linger "$TESTUSER"

step "SSH nur von diesem Rechner"
KEY="$OWNER_HOME/.ssh/p4test_ed25519"
if [ ! -f "$KEY" ]; then
  sudo -u "$OWNER" mkdir -p "$OWNER_HOME/.ssh"
  sudo -u "$OWNER" ssh-keygen -q -t ed25519 -N '' -C "phone4all-test" -f "$KEY"
fi
install -d -m 700 -o "$TESTUSER" -g "$TESTUSER" "$TEST_HOME/.ssh"
echo "from=\"127.0.0.1,::1\",no-agent-forwarding,no-X11-forwarding $(cat "$KEY.pub")" > "$TEST_HOME/.ssh/authorized_keys"
chown "$TESTUSER:$TESTUSER" "$TEST_HOME/.ssh/authorized_keys"
chmod 600 "$TEST_HOME/.ssh/authorized_keys"
restorecon -R "$TEST_HOME/.ssh" 2>/dev/null || true
if ! grep -qs "^Host p4test$" "$OWNER_HOME/.ssh/config"; then
  sudo -u "$OWNER" tee -a "$OWNER_HOME/.ssh/config" >/dev/null <<CONF

Host p4test
  HostName 127.0.0.1
  User $TESTUSER
  IdentityFile ~/.ssh/p4test_ed25519
  IdentitiesOnly yes
  StrictHostKeyChecking accept-new
CONF
  chmod 600 "$OWNER_HOME/.ssh/config"
fi
# Lief sshd vorher nicht, lauscht er nur lokal – so wird der Rechner im LAN nicht per SSH erreichbar
if ! systemctl is-enabled --quiet sshd 2>/dev/null; then
  printf 'ListenAddress 127.0.0.1\nListenAddress ::1\n' > /etc/ssh/sshd_config.d/40-phone4all-local.conf
fi
systemctl enable --now sshd
systemctl reload sshd

step "Repository und Zugangsdaten"
if [ ! -d "$TEST_HOME/phone4all/.git" ]; then
  sudo -iu "$TESTUSER" git clone "$REPO" phone4all
fi
ENVFILE="$TEST_HOME/phone4all/testenv/.env"
if [ ! -f "$ENVFILE" ]; then
  LANIP=$(ip -4 route get 1.1.1.1 2>/dev/null | awk '{for(i=1;i<=NF;i++) if($i=="src") print $(i+1)}')
  sudo -u "$TESTUSER" tee "$ENVFILE" >/dev/null <<CONF
PBX_ADMIN_PASSWORD=$(openssl rand -hex 12)
CARRIER_PASSWORD=$(openssl rand -hex 12)
# LAN-Adresse dieses Rechners für echte Telefone; leer lassen, wenn nur die Testtelefone laufen
PBX_EXTERNAL_ADDRESS=${LANIP}
CONF
  chmod 600 "$ENVFILE"
fi

if [ "$LAN" = 1 ] && command -v firewall-cmd >/dev/null; then
  step "Firewall: Ports der Test-Anlage im LAN öffnen"
  for p in 18080/tcp 5070/udp 5070/tcp 20000-20099/udp; do firewall-cmd --permanent --add-port="$p" >/dev/null; done
  firewall-cmd --reload >/dev/null
fi

step "Prüfen"
sudo -u "$OWNER" ssh -o BatchMode=yes p4test 'podman info --format "Podman {{.Version.Version}}, rootless={{.Host.Security.Rootless}}" && id'

cat <<DONE

Fertig. Testumgebung starten (als $OWNER):

  ssh p4test 'cd phone4all/testenv && podman compose up -d pbx carrier && podman compose run --rm e2e'

Weboberfläche der Test-Anlage: http://localhost:18080
Passwort: ssh p4test 'grep PBX_ADMIN_PASSWORD phone4all/testenv/.env'
DONE
