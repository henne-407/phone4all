#!/bin/sh
# Installiert die Phone4all-Telefonanlage auf einem frischen Debian/Ubuntu-Server oder in einer VM:
#   curl -fsSL https://raw.githubusercontent.com/henne-407/phone4all/main/pbx/install.sh | sudo sh
set -eu

DIR=${PHONE4ALL_DIR:-/opt/phone4all}
RAW=https://raw.githubusercontent.com/henne-407/phone4all/main/pbx

if [ "$(id -u)" -ne 0 ]; then
  echo "Bitte mit sudo ausführen." >&2
  exit 1
fi

if ! command -v docker >/dev/null 2>&1; then
  echo "Docker wird installiert …"
  curl -fsSL https://get.docker.com | sh
fi
systemctl enable --now docker >/dev/null 2>&1 || true

mkdir -p "$DIR/data"
cd "$DIR"
if [ ! -f docker-compose.yml ]; then
  curl -fsSL "$RAW/docker-compose.yml" -o docker-compose.yml
fi

docker compose pull
docker compose up -d

echo "Warte auf den Start …"
for _ in $(seq 1 60); do
  if docker compose logs pbx 2>/dev/null | grep -q "Weboberfläche auf Port"; then break; fi
  sleep 2
done

ADDR=$(hostname -I 2>/dev/null | awk '{print $1}')
PASS=$(docker compose logs pbx 2>/dev/null | sed -n 's/.*Erstes Passwort für die Weboberfläche (Benutzer admin): //p' | tail -1)
echo
echo "Phone4all läuft: http://${ADDR:-<adresse>}:8080"
if [ -n "$PASS" ]; then
  echo "Erstes Passwort: $PASS (bitte nach der Anmeldung ändern)"
fi
echo "Daten und Sicherungen: $DIR/data"
