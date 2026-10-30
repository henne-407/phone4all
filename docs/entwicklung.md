# Entwicklung

Alle Teile von Phone4all liegen in diesem einen Repository.

## Aufbau

| Ordner | Inhalt | Technik |
| --- | --- | --- |
| `src/` | Desktop-App Phone4All (Hauptprozess, Oberfläche, gemeinsamer Code) | Electron, React, Material UI, baresip |
| `pbx/` | Telefonanlage: Verwaltungsdienst (`server/`), Weboberfläche (`web/`), Docker-Image | Node, Asterisk 20, React, Material UI |
| `mobile/` | Mobil-App für Android und iPhone | Expo / React Native, JsSIP, react-native-webrtc, Paper |
| `custom_components/phone4all/` | Home-Assistant-Integration | Python |
| `blueprints/` | Blueprint für Home-Assistant-Automationen | YAML |
| `tests/` | Tests der Home-Assistant-Integration | pytest |
| `test/` | Tests der Desktop-App | Vitest |
| `scripts/`, `native/`, `resources/` | Build der SIP-Engine, Linux-Installation, Icons | Shell, C |
| `docs/` | diese Dokumentation | Markdown |

Wie die Teile zusammenspielen:

```
           ┌──────────── Telefonanlage (Docker) ────────────┐
           │  Verwaltungsdienst (Node) ── steuert ── Asterisk │
           │   │ /provision, /ws, /dect, /api/integration     │
           └───┼──────────────────────────────────────────────┘
               │
  Desktop-App ─┤ Einrichtung, Profil, Kontakte, Kalender (HTTP), SIP (UDP/TCP)
  Mobil-App ───┤ dasselbe über HTTPS, SIP über WebSocket, Sprache per WebRTC/TURN
  Gigaset-Basis┤ Provisioning-XML, SIP, LDAP-Telefonbuch
  Home Assistant ─ Status alle 15 s (Bearer-Token)
```

Die Anlage ist die einzige Quelle für Konten, Telefonbuch, Kalender und App-Profile. Die
Apps fragen alle zwei Minuten `/provision/<token>/revision` ab und laden bei Änderungen
nach. Der Wählplan von Asterisk ist schlank: Bei jedem Anruf fragt Asterisk den
Verwaltungsdienst (`server/routing.ts`), wohin es geht. Änderungen greifen dadurch sofort.

## Loslegen

Voraussetzung: Node 24. Für die Home-Assistant-Tests Python 3.13.

```sh
# Desktop-App
npm install
npm run dev            # mit Hot Reload
npm run typecheck && npm test

# Telefonanlage
cd pbx
npm install
npm run dev:server     # braucht ein lokales Asterisk
npm run dev:web        # Weboberfläche auf http://localhost:5173
npm run dev:client     # Web-Client (Oberfläche der App im Browser) gegen die Anlage auf :8080
npm run typecheck && npm test
docker build -f Dockerfile -t phone4all-pbx ..   # Bau-Kontext ist der Hauptordner (Web-Client braucht src/)

# Mobil-App
cd mobile
npm install
npm run typecheck && npm test
npm run android        # Android SDK nötig; iOS nur auf dem Mac

# Home Assistant
pip install -r tests/requirements.txt
pytest
```

Weitere Hinweise je Teil: [Desktop-App](desktop-app.md#entwicklung),
[Telefonanlage](../pbx/README.md#entwicklung), [Mobil-App](../mobile/README.md#entwicklung).

## Testumgebung

[`testenv/`](../testenv/README.md) startet eine Test-Anlage mit simuliertem Anbieter und
spielt echte SIP-Anrufe durch (`podman compose run --rm e2e`). Auf Fedora richtet
`sudo bash testenv/setup-fedora.sh` dafür einen eigenen Benutzer ohne Administratorrechte ein.

## Code-Stil

- Oberflächen, Meldungen, Kommentare und Commit-Nachrichten auf Deutsch.
- TypeScript ohne Semikolons, einfache Anführungszeichen, zwei Leerzeichen Einrückung.
- Neue Seiten der Weboberfläche folgen dem bestehenden Aufbau (gruppierte Navigation,
  Karten, `PageHeader` mit einem erklärenden Satz).
- Neue Funktionen der Anlage, die Apps betreffen, nutzen den vorhandenen Weg über
  App-Profil und `/provision/<token>` statt eigener Schnittstellen.
- Überwachung hängt sich an den Watchdog (`watchdog.on('event')`, `/health`).

## Continuous Integration

| Workflow | Läuft bei | Macht |
| --- | --- | --- |
| `build.yml` | jedem Push, PRs, Tags `v*` | Tests der Desktop-App, Pakete für Linux, macOS, Windows; Release bei Tag |
| `pbx.yml` | Änderungen in `pbx/`, Tags `pbx-v*` | Tests der Anlage, Docker-Image (amd64, arm64) nach `ghcr.io`; Release bei Tag |
| `mobile.yml` | Änderungen in `mobile/`, Tags `mobile-v*` | Tests, Android-APK, unsignierte iOS-IPA; Release bei Tag |
| `release.yml` | neue Version in einer `package.json` auf `main` | setzt die fehlenden Tags und startet die Workflows darauf |
| `homeassistant.yml` | Änderungen an Integration, Tests, Blueprint | pytest, HACS- und hassfest-Prüfung |
| `e2e.yml` | Änderungen in `pbx/`, `src/`, `testenv/` | echte Anrufe gegen die [Testumgebung](../testenv/README.md); Logs, pcap und Diagnose-Paket als Artefakt |

## Releases

Jeder Teil hat eine eigene Version:

| Teil | Version in | Tag |
| --- | --- | --- |
| Desktop-App | `package.json` | `v1.2.3` |
| Telefonanlage | `pbx/package.json` | `pbx-v1.2.3` (Beta: `pbx-v1.3.0-beta.1`) |
| Mobil-App | `mobile/package.json` und `mobile/app.json` | `mobile-v1.2.3` |
| Home-Assistant-Integration | `custom_components/phone4all/manifest.json` | – (HACS nimmt den Stand von `main`) |

Ablauf: Version mit `npm version <x> --no-git-tag-version` erhöhen und per Pull Request nach
`main` bringen. `release.yml` setzt danach den annotierten Tag auf dem Merge-Commit (nur für
Teile, deren Version noch keinen Tag hat) und startet die Workflows, die das Release bauen
und veröffentlichen. Von Hand gepushte Tags funktionieren weiterhin. Die Telefonanlage findet neue Versionen über die
GitHub-Releases (stabil) bzw. Beta-Tags selbst.
