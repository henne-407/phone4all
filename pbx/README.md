# Phone4all-Telefonanlage

Telefonanlage für das SIP-Telefon und alle anderen SIP-Geräte: Asterisk 20 (LTS)
mit einer deutschsprachigen Weboberfläche, verpackt als ein Docker-Image. Läuft auf
jedem Linux-Server, in einer VM (Proxmox, VMware, Hyper-V, VirtualBox), auf einem
NAS mit Docker oder einem Raspberry Pi 4/5.

## Installation

Auf einem frischen Debian- oder Ubuntu-Server (auch als VM):

```sh
curl -fsSL https://raw.githubusercontent.com/henne-407/phone4all/main/pbx/install.sh | sudo sh
```

Das Skript installiert Docker, startet die Anlage in `/opt/phone4all` und zeigt
Adresse und erstes Passwort der Weboberfläche (Benutzer `admin`) an.

Mit vorhandenem Docker reicht die [docker-compose.yml](docker-compose.yml):

```sh
mkdir phone4all && cd phone4all
curl -fsSLO https://raw.githubusercontent.com/henne-407/phone4all/main/pbx/docker-compose.yml
docker compose up -d
docker compose logs pbx   # erstes Passwort
```

Die Anlage nutzt das Netzwerk des Rechners direkt (`network_mode: host`), weil SIP und
Sprache hinter Docker-NAT unzuverlässig sind. Benötigte Ports:

| Port | Zweck |
| --- | --- |
| 8080/tcp | Weboberfläche und Einrichtung der App |
| 5060/udp+tcp, 5061/tcp | SIP, SIP über TLS |
| 10000–10999/udp | Sprache (RTP) |
| 15060/udp | Suche der App im lokalen Netz |

Für Anrufe von außen ist bei den gängigen Anbietern keine Portfreigabe nötig, die
Anlage meldet sich selbst an. Telefone außerhalb des Büros brauchen eine Freigabe
von 5060/5061 und 10000–10999 im Router sowie die öffentliche Adresse unter
*System → Allgemein*.

## Funktionen

- **Nebenstellen** mit mehreren Geräten gleichzeitig, Voicemail (auch per E-Mail),
  Weiterleitung bei besetzt / nach Zeit, Berechtigungen (intern, Deutschland, weltweit),
  Sperre für Sonderrufnummern, Gesprächsaufzeichnung
- **Gruppen**: alle gleichzeitig, reihum oder Warteschlange mit Wartemusik,
  Ausweichziel und Namensvorsatz („Vertrieb: …“)
- **Rufabfolgen** als Ablaufdiagramm: Rufnummer → Zeitsteuerung (Öffnungszeiten,
  Feiertage je Bundesland, Betriebsferien, Nachtschaltung) → Sprachmenü → Gruppe →
  Voicemail; jeder Schritt ist anklickbar
- **Ansagen** hochladen oder im Browser aufnehmen, eigene Wartemusik
- **Konferenzräume** mit PIN
- **SIP-Konten** mit Vorlagen für Telekom (auch CompanyFlex), Vodafone (Kabel, DSL),
  1&1, o2, sipgate (basic und trunking), easybell, Placetel und FRITZ!Box;
  **Wahlregeln** mit Ausweichkonto
- **Zentrale Kontakte** (auch CSV-Import) für Anrufernamen, werden an die Apps verteilt
- **Zentrale Kalender** mit eigenen Terminen (z. B. Betriebsferien) oder den
  Feiertagen des Bundeslandes; erscheinen in jeder App
- **App-Profile**: legen fest, welche Bereiche, Startansicht und Startseiten-Karten
  die SIP-Telefon-App zeigt, und können Startseite und Kontodaten sperren
- **Anrufliste**, laufende Gespräche, Anmeldestatus aller Geräte
- **Funktionscodes**: \*97 Voicemail, \*76 Nicht stören, \*21 Rufumleitung,
  \*8 / \*\*Nr. Heranholen, \*28 Nachtschaltung, \*31 anonym, \*43 Echo-Test
- **Sicherheit**: Sperre nach Fehlanmeldungen, erlaubte Netze, TLS/SRTP
- **Konfiguration als Datei** exportieren und importieren (wahlweise mit Passwörtern
  und Ansagen), tägliche automatische Sicherung (30 Tage)
- **Online-Updates** aus der Weboberfläche (stabil oder Beta), auf Wunsch automatisch
  nachts, wenn niemand telefoniert

## SIP-Telefon automatisch einrichten

Jede Nebenstelle hat einen Einrichtungslink und eine Einrichtungs-PIN
(*Nebenstellen → Bearbeiten*). Drei Wege:

1. In der App unter *Einstellungen → Konto → Einrichten*: Die App findet die Anlage im
   lokalen Netz, Nebenstelle und PIN eingeben.
2. **Einladung per E-Mail** senden: Der Link darin öffnet die App (`sip-telefon://`).
3. Den Einrichtungslink kopieren und in der App einfügen.

Die App übernimmt Server, Benutzer, Passwort, die zentralen Kontakte und Kalender und
das App-Profil. Danach fragt sie alle zwei Minuten nach Änderungen. Ein erneuerter
Link macht den alten ungültig.

### Schnittstelle für die App

Alle Adressen hängen am Einrichtungslink der Nebenstelle (`/provision/<token>`), der
Token ist zugleich die Berechtigung.

| Anfrage | Ergebnis |
| --- | --- |
| `GET /provision/<token>` | Profil: Konto, Passwort, Kontakte, `app` (Ansichten oder `null`), `calendars`, `revision` |
| `GET /provision/<token>/revision` | `{ profile, events }` – ändert sich, sobald Profil oder Termine sich ändern |
| `GET /provision/<token>/events?start=…&end=…&calendar=…` | Termine im Zeitraum (höchstens 400 Tage) |
| `PUT /provision/<token>/events/<kalender>/<uid>` | Termin anlegen oder ändern (nur beschreibbare Kalender) |
| `DELETE /provision/<token>/events/<kalender>/<uid>` | Termin löschen |

Termine: `{ uid, summary, start, end, allDay, location, description }`. Ganztägige
Termine haben Datumsangaben (`2026-12-24`, Ende exklusiv), alle anderen ISO-Zeitpunkte.

Andere Telefone (Tischtelefone, Softphones) werden mit Nebenstelle als Benutzer,
SIP-Passwort und der Adresse der Anlage als Server angemeldet.

## Diagnose und Watchdog

Der Verwaltungsdienst prüft alle 30 Sekunden Asterisk, die Anmeldung der SIP-Konten
und den Speicherplatz und behebt Störungen selbst:

- Asterisk abgestürzt → sofortiger Neustart (mit wachsender Wartezeit bei Dauerabsturz)
- Steuerverbindung (AMI) weg → neu verbinden; Asterisk antwortet dreimal nicht → Neustart
  (höchstens alle 5 Minuten)
- SIP-Konto länger als die Wartezeit (Standard 3 Minuten) abgemeldet → neu anmelden,
  danach mit wachsendem Abstand bis 30 Minuten

Zustand, Einstellungen und Ereignisprotokoll unter *System → Diagnose*, auf Wunsch
Störungsmeldungen per E-Mail. `GET /health` liefert ohne Anmeldung eine Kurzfassung
(`{"status":"ok|warning|error","checks":{…}}`, HTTP 503 wenn Asterisk ausgefallen ist) –
für den Docker-Healthcheck und Überwachung von außen (z. B. Home Assistant).

## Daten

Alles liegt im Ordner `data/` neben der `docker-compose.yml`:

| Datei / Ordner | Inhalt |
| --- | --- |
| `config.json` | gesamte Konfiguration |
| `backups/` | automatische Sicherungen |
| `voicemail/`, `recordings/` | Nachrichten, Aufzeichnungen |
| `sounds/` | eigene Ansagen und Wartemusik |
| `calendars/` | Termine der zentralen Kalender |
| `log/` | Anrufliste (CDR) und Protokoll |
| `watchdog.json` | Ereignisse des Watchdogs |

Umziehen: `data/` kopieren und auf dem neuen Rechner `docker compose up -d` – oder
die Konfiguration unter *System → Sicherung* exportieren und dort importieren.

## Updates

Neue Versionen erscheinen als GitHub-Release `pbx-v…` und als Image
`ghcr.io/henne-407/phone4all-pbx`. Die Weboberfläche zeigt sie unter
*System → Aktualisierung* an und installiert sie per Klick. Dafür bindet die
`docker-compose.yml` den Docker-Socket ein; ohne ihn von Hand:

```sh
docker compose pull && docker compose up -d
```

Vor jedem Update wird automatisch gesichert.

## Entwicklung

```sh
cd pbx
npm install
npm run dev:server   # Verwaltungsdienst mit Neustart bei Änderungen (braucht Asterisk)
npm run dev:web      # Weboberfläche mit Hot Reload auf http://localhost:5173
npm test
docker build -t phone4all-pbx .
```

Aufbau: Der Node-Dienst (`server/`) hält die Konfiguration als JSON, erzeugt daraus
die Asterisk-Dateien (`server/generate/`) und startet Asterisk als Kindprozess.
Der Wählplan ist schlank: Asterisk fragt den Dienst bei jedem Anruf über
`http://127.0.0.1:8080/internal/…`, wohin es geht (`server/routing.ts`). So
greifen Änderungen sofort, ohne den Wählplan neu zu laden. Die Weboberfläche
(`web/`) ist React mit Material Design 3.

Neue Version veröffentlichen: Tag `pbx-v1.2.3` pushen (Beta: `pbx-v1.3.0-beta.1`).
Der Workflow `.github/workflows/pbx.yml` baut das Image für amd64 und arm64 und legt
das Release an.
