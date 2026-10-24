# Phone4all

**Eine moderne Telefonanlage, die einfach bleibt.** Phone4all besteht aus einer
Telefonanlage im Docker-Container, einer Desktop-App für Linux, macOS und Windows, einer
Mobil-App für Android und iPhone und einer Integration für Home Assistant. Alles ist auf
Deutsch, richtet sich weitgehend selbst ein und funktioniert auf Wunsch auch unterwegs
über HTTPS.

[![Build](https://github.com/henne-407/phone4all/actions/workflows/build.yml/badge.svg)](https://github.com/henne-407/phone4all/actions/workflows/build.yml)
[![Telefonanlage](https://github.com/henne-407/phone4all/actions/workflows/pbx.yml/badge.svg)](https://github.com/henne-407/phone4all/actions/workflows/pbx.yml)
[![Home Assistant](https://github.com/henne-407/phone4all/actions/workflows/homeassistant.yml/badge.svg)](https://github.com/henne-407/phone4all/actions/workflows/homeassistant.yml)
[![Lizenz: MIT](https://img.shields.io/badge/Lizenz-MIT-blue.svg)](LICENSE)

<p align="center">
  <img src="docs/bilder/anlage-uebersicht.png" width="49%" alt="Weboberfläche der Telefonanlage: Übersicht">
  <img src="docs/bilder/app-hell.png" width="49%" alt="Desktop-App SIP-Telefon: Startseite">
</p>

## Was dazugehört

| Teil | Wofür | Läuft auf | Doku |
| --- | --- | --- | --- |
| **Telefonanlage** | Asterisk 20 mit deutscher Weboberfläche: Nebenstellen, Gruppen, Rufabfolgen, Sprachmenüs, Voicemail, SIP-Konten aller großen Anbieter | Docker auf Linux-Server, VM, NAS (z. B. TrueNAS), Raspberry Pi | [Bedienung](docs/telefonanlage.md) · [Referenz](pbx/README.md) |
| **SIP-Telefon (Desktop)** | Softphone mit Anruf-Pop-up, Kontakten, Kalender und Anrufverlauf | Linux, macOS, Windows | [Desktop-App](docs/desktop-app.md) |
| **SIP-Telefon (Mobil)** | Telefonieren mit der eigenen Nebenstelle im Büro und unterwegs | Android, iPhone | [Mobil-App](docs/mobil-app.md) |
| **DECT-Telefone** | Gigaset N610/N670/N870 IP PRO richten sich selbst ein, Telefonbuch per LDAP | Gigaset-Basis | [DECT-Anleitung](docs/dect.md) |
| **Home Assistant** | Verpasste Anrufe und Störungen als Sensoren, Ereignisse und Benachrichtigungen | Home Assistant (HACS) | [Home Assistant](docs/home-assistant.md) |

Die Telefonanlage ist das Herz: Sie verteilt Konten, Telefonbuch, Kalender und
App-Profile an alle Apps. Die Desktop-App funktioniert aber auch allein mit jeder anderen
SIP-Anlage (FRITZ!Box, 3CX, Starface, sipgate …).

## In fünf Minuten startklar

1. **Anlage installieren** – auf einem Debian- oder Ubuntu-Server:

   ```sh
   curl -fsSL https://raw.githubusercontent.com/henne-407/phone4all/main/pbx/install.sh | sudo sh
   ```

   Das Skript zeigt am Ende Adresse und erstes Passwort der Weboberfläche
   (`http://<server>:8080`, Benutzer `admin`). Andere Wege (Docker Compose, TrueNAS,
   Proxmox, Raspberry Pi) stehen unter [Installation](docs/installation.md).
2. **Einrichten** – die Übersicht führt mit *Erste Schritte* durch Nebenstellen,
   SIP-Konto beim Anbieter (Vorlagen für Telekom, Vodafone, Deutsche Glasfaser, 1&1, o2,
   sipgate, easybell, Placetel, FRITZ!Box) und die Rufabfolge für eingehende Anrufe.
3. **Telefone verbinden** – die [Desktop-App](https://github.com/henne-407/phone4all/releases/latest)
   findet die Anlage im Netz, Nebenstelle und PIN genügen. Handys scannen den QR-Code der
   Nebenstelle, Gigaset-Basen holen sich ihre Einrichtung selbst.

Die ausführliche Anleitung mit allen Schritten steht unter
[Erste Schritte](docs/erste-schritte.md).

## Dokumentation

- [Erste Schritte](docs/erste-schritte.md) – vom leeren Server zum ersten Anruf
- [Installation der Telefonanlage](docs/installation.md) – Docker, TrueNAS, VM, Raspberry Pi, Updates, Umzug
- [Telefonanlage bedienen](docs/telefonanlage.md) – die Weboberfläche Seite für Seite
- [Desktop-App](docs/desktop-app.md) – Installation, Einrichtung, Funktionen, Kalender, Adressbücher
- [Mobil-App](docs/mobil-app.md) – Android und iPhone
- [Zugriff von unterwegs](docs/fernzugriff.md) – HTTPS über einen Reverse-Proxy wie Pangolin
- [DECT-Telefone](docs/dect.md) – Gigaset N610 IP PRO Schritt für Schritt
- [Home Assistant](docs/home-assistant.md) – Integration, Blueprint, Beispiele
- [Fehlersuche](docs/fehlersuche.md) – häufige Probleme und ihre Lösung
- [Entwicklung](docs/entwicklung.md) – Aufbau des Repositorys, Tests, Releases
- [Referenz der Telefonanlage](pbx/README.md) – Ports, Schnittstellen, Datenablage

## Downloads und Versionen

Alle Pakete stehen unter [Releases](https://github.com/henne-407/phone4all/releases).
Jeder Teil hat eigene Versionen und Tags:

| Teil | Tag | Ergebnis |
| --- | --- | --- |
| Desktop-App | `v…` | `.rpm`, `.deb`, `.AppImage`, `.dmg`, `.exe` |
| Telefonanlage | `pbx-v…` | Docker-Image `ghcr.io/henne-407/phone4all-pbx` (amd64, arm64) |
| Mobil-App | `mobile-v…` | `.apk` für Android, unsignierte `.ipa` für iPhone |
| Home Assistant | – | über HACS direkt aus diesem Repository |

Die Telefonanlage meldet neue Versionen selbst und installiert sie per Klick
(*System → Aktualisierung*).

## Fehler melden und mitmachen

Fehler und Wünsche bitte als [Issue](https://github.com/henne-407/phone4all/issues/new/choose)
melden. Hinweise zum Aufbau, zu Tests und zum Code-Stil stehen unter
[Entwicklung](docs/entwicklung.md).

## Lizenz

[MIT](LICENSE). Phone4all nutzt unter anderem [Asterisk](https://www.asterisk.org)
(GPLv2, im Docker-Image), [baresip](https://github.com/baresip/baresip),
[JsSIP](https://jssip.net), [Electron](https://www.electronjs.org),
[React](https://react.dev) und [Material UI](https://mui.com).
