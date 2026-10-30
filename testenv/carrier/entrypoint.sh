#!/bin/sh
# Passwort des Kontos der Test-Anlage setzen, dann Asterisk im Vordergrund starten
set -e
: "${CARRIER_PASSWORD:?CARRIER_PASSWORD fehlt}"
sed -i "s|@CARRIER_PASSWORD@|${CARRIER_PASSWORD}|" /etc/asterisk/pjsip.conf
exec asterisk -f -U asterisk -G asterisk -vvv
