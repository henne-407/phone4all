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
npm run typecheck && npm test
docker build -t phone4all-pbx .

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
| `homeassistant.yml` | Änderungen an Integration, Tests, Blueprint | pytest, HACS- und hassfest-Prüfung |

## Releases

Jeder Teil hat eine eigene Version:

| Teil | Version in | Tag |
| --- | --- | --- |
| Desktop-App | `package.json` | `v1.2.3` |
| Telefonanlage | `pbx/package.json` | `pbx-v1.2.3` (Beta: `pbx-v1.3.0-beta.1`) |
| Mobil-App | `mobile/package.json` und `mobile/app.json` | `mobile-v1.2.3` |
| Home-Assistant-Integration | `custom_components/phone4all/manifest.json` | – (HACS nimmt den Stand von `main`) |

Ablauf: Version mit `npm version <x> --no-git-tag-version` erhöhen, per Pull Request nach
`main` bringen, danach den annotierten Tag auf dem Merge-Commit pushen. Die Workflows
bauen und veröffentlichen das Release. Die Telefonanlage findet neue Versionen über die
GitHub-Releases (stabil) bzw. Beta-Tags selbst.
