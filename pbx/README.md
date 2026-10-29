# Phone4all-Telefonanlage

Telefonanlage für die Phone4All-App und alle anderen SIP-Geräte: Asterisk 20 (LTS)
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
| 8080/tcp | Weboberfläche, Einrichtung der App, SIP über WebSocket (`/ws`) für die Mobil-App |
| 8443/tcp | dieselbe Weboberfläche per HTTPS (Zertifikat aus `data/keys`, `PBX_HTTPS_PORT`, 0 = aus) |
| 5060/udp+tcp, 5061/tcp | SIP, SIP über TLS |
| 10000–10999/udp | Sprache (RTP) |
| 15060/udp | Suche der App im lokalen Netz |
| 3478/udp+tcp | TURN-Server für die Sprache der Mobil-App unterwegs |
| 389/tcp | Telefonbuch per LDAP (nur wenn eingeschaltet) |

Für Anrufe von außen ist bei den gängigen Anbietern keine Portfreigabe nötig, die
Anlage meldet sich selbst an. Für die Mobil-App unterwegs reicht ein Reverse-Proxy mit
HTTPS (siehe [Zugriff von unterwegs](#zugriff-von-unterwegs)). Andere Telefone außerhalb
des Büros brauchen eine Freigabe von 5060/5061 und 10000–10999 im Router sowie die
öffentliche Adresse unter *System → Allgemein*.

## Zugriff von unterwegs

Die [Mobil-App](../mobile/README.md) für Android und iPhone braucht von außen nur HTTPS:
Einrichtung, Kontakte und Kalender laufen wie bei der Desktop-App über `/provision/…`,
SIP als WebSocket über `/ws` (die Anlage reicht das an Asterisk weiter), die Sprache per
WebRTC mit DTLS-SRTP. Weil die Anlage hinter dem Proxy keine eigene öffentliche Adresse
hat, läuft die Sprache über den eingebauten TURN-Server (coturn, Port 3478). Er leitet
nur per UDP und nur zur SIP-Adresse der Anlage weiter (`no-tcp-relay`, keine Docker-
oder VPN-Netze), nicht ins Internet, und vergibt Zugangsdaten, die nach acht Tagen
ablaufen.

Mit **Pangolin** (oder einem anderen Proxy, der WebSockets durchreicht):

1. HTTP-Ressource anlegen, z. B. `telefon.example.de` → `http://<Anlage>:8080`.
2. In den Regeln der Ressource für `/provision/*`, `/setup/*` und `/ws` die Pangolin-Anmeldung
   umgehen. Die App weist sich dort mit dem geheimen Einrichtungslink bzw. dem
   SIP-Passwort aus; die Weboberfläche bleibt hinter der Pangolin-Anmeldung.
3. Raw-Ressource für TCP **und** UDP auf Port 3478 → `<Anlage>:3478` (Raw-Ressourcen in
   Pangolin aktivieren und den Port am Pangolin-Server öffnen).
4. In der Weboberfläche unter *System → Fernzugriff* die öffentliche Adresse
   `https://telefon.example.de` eintragen. Einrichtungslinks, QR-Codes und Einladungen
   zeigen dann dorthin.

Jede Nebenstelle bekommt dafür ein zweites Gerät `<nummer>-app` (gleiches Passwort).
Anrufe klingeln überall gleichzeitig, *Nicht stören*, Weiterleitungen und Gruppen gelten
für beide. `<nummer>-app` und `<nummer>-video` nehmen Anmeldungen nur über den
WebSocket-Proxy der Anlage an (127.0.0.1), nicht direkt per UDP/TCP. Fehlanmeldungen über
den WebSocket sperren die Adresse des Telefons (aus `X-Forwarded-For` des Proxys), nicht
den Proxy. `X-Forwarded-For` gilt nur von *vertrauenswürdigen Proxys* (Einstellung
`security.trusted_proxies`, Standard 127.0.0.1, ::1 und 172.16.0.0/12).

## Funktionen

- **Nebenstellen** mit mehreren Geräten gleichzeitig, Voicemail (auch per E-Mail),
  Weiterleitung bei besetzt / nach Zeit, Umleitungsregeln (Zeitplan, Zeitsteuerung, Termin im Kalender, Nicht stören), Berechtigungen (intern, Deutschland, weltweit),
  Sperre für Sonderrufnummern, Gesprächsaufzeichnung, **Handy klingelt mit**, Status aus dem Kalender
- **Gruppen**: alle gleichzeitig, reihum oder Warteschlange mit Wartemusik,
  Ausweichziel und Namensvorsatz („Vertrieb: …“); an- und abmelden (\*45, Apps, `/me`),
  verpasste Anrufe als gemeinsame Liste
- **Rückfrage** in den Apps mit Makeln, Verbinden und Dreierkonferenz (die Anlage führt
  die Gespräche zusammen)
- **Durchsage und Gegensprechen** (\*81, \*80): Telefone und Apps nehmen selbst an
- **Voicemail als Text** (whisper.cpp auf der Anlage oder ein OpenAI-kompatibler Dienst)
- **Fax per E-Mail**: Empfang als PDF, Senden aus Weboberfläche und Desktop-App, T.38
- **Tischtelefone** von Yealink und Snom richten sich selbst ein, mit Funktionstasten
- **Auswertungen**: Anrufe je Uhrzeit, Wochentag, Nummer und Nebenstelle, Warteschlangen, CSV
- **Mehrere Zugänge** mit Rollen (Verwaltung, Personen und Anrufe, Nur ansehen) und
  **Selbstbedienung** unter `/me` mit Nebenstelle und Voicemail-PIN
- **Rufabfolgen** als Ablaufdiagramm: Rufnummer → Zeitsteuerung (Öffnungszeiten,
  Feiertage je Bundesland, Betriebsferien, Nachtschaltung) → Sprachmenü → Gruppe →
  Voicemail; jeder Schritt ist anklickbar, Zweige lassen sich per Auswahlmenü oder
  Drag & Drop umhängen
- **Ansagen** hochladen, im Browser aufnehmen oder aus Text sprechen lassen (Piper,
  läuft lokal), eigene Wartemusik
- **Anrufsperren**: Nummern und Nummernbereiche (`+44*`), unterdrückte Nummern; sperren
  aus der Anrufliste und den Apps
- **Gespräche parken** (700, Parkplätze 701–708), Besetztanzeige der Kollegen in den Apps
- **Konferenzräume** mit PIN
- **SIP-Konten** mit Vorlagen für Telekom (auch CompanyFlex), Vodafone (Kabel, DSL),
  Deutsche Glasfaser, 1&1, o2, sipgate (basic und trunking), easybell, Placetel und FRITZ!Box;
  **Wahlregeln** mit Ausweichkonto
- **Zentrale Kontakte** (auch CSV-Import) für Anrufernamen, werden an die Apps verteilt
  und stehen per **LDAP** für DECT- und Tischtelefone bereit; dazu externe Quellen
  (CardDAV, vCard-/CSV-Datei im Netz, Microsoft SQL Server), die die Anlage regelmäßig liest
- **DECT-Telefone**: Gigaset N610, N670 und N870 IP PRO richten sich per Auto-Provisioning
  selbst ein (ein SIP-Konto je Mobilteil, Voicemail-Anzeige, Übergabe)
- **Zentrale Kalender** mit eigenen Terminen (z. B. Betriebsferien), den
  Feiertagen des Bundeslandes oder aus anderen Kalendern (ICS-Abo, CalDAV); erscheinen in jeder App
- **Messenger** für die Desktop-App: Einzel- und Gruppenchats mit Dateien und
  Videoanrufen (Konferenzraum je Chat, Bilder werden einzeln weitergeleitet)
- **Mobil-App** für Android und iPhone, auch unterwegs über HTTPS (SIP über WebSocket,
  WebRTC, eingebauter TURN-Server), Einrichtung per QR-Code
- **App-Profile**: legen fest, welche Bereiche, Startansicht und Startseiten-Karten
  die Phone4All-App zeigt, und können Startseite und Kontodaten sperren
- **Anrufliste**, laufende Gespräche, Anmeldestatus aller Geräte
- **Benachrichtigung bei Notrufen** (110/112) per E-Mail, Messenger, Home Assistant und Webhooks
- **Webhooks** (signiert) und **Anrufe über die Schnittstelle** für CRM und Automationen
- **Funktionscodes**: \*97 Voicemail, \*76 Nicht stören, \*21 Rufumleitung,
  \*8 / \*\*Nr. Heranholen, \*28 Nachtschaltung, \*31 anonym, \*43 Echo-Test,
  \*45 Gruppen an/ab, \*80 Gegensprechen, \*81 Durchsage
- **Sicherheit**: Sperre nach Fehlanmeldungen, erlaubte Netze, TLS/SRTP
- **Konfiguration als Datei** exportieren und importieren (wahlweise mit Passwörtern
  und Ansagen), tägliche automatische Sicherung (14 Tage, Sicherungen vor Import und Update getrennt davon),
  zusätzlich auf WebDAV oder S3 (auf Wunsch mit AES-256 verschlüsselt)
- **Home Assistant**: verpasste Anrufe, abgemeldete SIP-Konten und andere Störungen als
  Sensoren und Ereignisse, Türklingel, Schalter für *Nicht stören* und Zeitsteuerungen,
  Aktionen für Anrufe, Ansagen und Umleitungen; auch über HTTPS hinter einem Reverse-Proxy
- **Online-Updates** aus der Weboberfläche (stabil oder Beta), auf Wunsch automatisch
  nachts, wenn niemand telefoniert

## Phone4All automatisch einrichten

Jede Nebenstelle hat einen Einrichtungslink und eine Einrichtungs-PIN
(*Nebenstellen → Bearbeiten*). Drei Wege:

1. In der App unter *Einstellungen → Konto → Einrichten*: Die App findet die Anlage im
   lokalen Netz, Nebenstelle und PIN eingeben.
2. **Einladung per E-Mail** senden: Der Link darin öffnet die App (`sip-telefon://`).
3. Den Einrichtungslink kopieren und in der App einfügen.

Die App übernimmt Server, Benutzer, Passwort, die zentralen Kontakte und Kalender und
das App-Profil. Danach fragt sie alle zwei Minuten nach Änderungen.

Link und PIN gelten 72 Stunden, die PIN nur einmal und nur im Netz der Anlage
(Ausnahme: *Einrichtung per PIN auch von außerhalb* unter *System*). Jedes Gerät bekommt bei der Einrichtung
ein eigenes Token; die Liste *Eingerichtete Geräte* zeigt, wann es zuletzt von welcher
Adresse gefragt hat, und meldet einzelne oder alle Geräte ab. Ein erneuerter Link macht
nur den alten Link ungültig, eingerichtete Geräte bleiben angemeldet. Geräte aus
Versionen bis 0.8.1 erscheinen gemeinsam als *Bisher eingerichtete Geräte*.

### Schnittstelle für die App

`GET /provision/<einladung>` (Token aus Link, QR-Code oder E-Mail) und
`POST /provision` mit `{ extension, pin }` legen ein Gerät an und liefern das Profil.
Dessen `url` (`/provision/<geräte-token>`) ist die Adresse des Geräts; alle weiteren
Anfragen hängen daran, der Token ist zugleich die Berechtigung. Der Kopfeintrag
`X-Device-Name` (URL-kodiert) benennt das Gerät in der Liste. Ein abgelaufener Link
antwortet mit 410, ein abgemeldetes Gerät mit 404.

| Anfrage | Ergebnis |
| --- | --- |
| `GET /provision/<token>` | Profil (auch zum Auffrischen): Konto, Passwort, Kontakte, `app` (Ansichten oder `null`), `calendars`, `permissions`, `messenger`, `remote`, `video`, `parking` (`{ number, slots }` oder `null`), `crm` (`{ url, auto }` oder `null`), `voicemail`, `doors` (`{ number, name, dtmf }`: Türsprechstellen, `dtmf` öffnet im Gespräch), `revision` |
| `GET /provision/<token>/revision` | `{ profile, events }` – ändert sich, sobald Profil oder Termine sich ändern |
| `GET /provision/<token>/events?start=…&end=…&calendar=…` | Termine im Zeitraum (höchstens 400 Tage) |
| `PUT /provision/<token>/events/<kalender>/<uid>` | Termin anlegen oder ändern (nur beschreibbare Kalender) |
| `DELETE /provision/<token>/events/<kalender>/<uid>` | Termin löschen |
| `GET /provision/<token>/chat` (WebSocket) | Messenger, Nachrichten als JSON (siehe unten) |
| `POST /provision/<token>/chat/files?room=…&name=…` | Datei senden (Inhalt als Body, `Content-Type` setzen) |
| `GET /provision/<token>/chat/files/<raum>/<id>` | Datei abrufen (nur Mitglieder des Raums) |
| `GET /provision/<token>/forward` | Umleitungen: `cfu`, `active`, `busy`, `noanswer`, `rules` (`when` = `schedule`/`timecondition`/`dnd`/`calendar`, `action` = `forward`/`dnd`, bei Kalender `calendar` und `keyword`), `permissions`, interne `targets`, `timeconditions`, `calendars`, `mobile` (`{ enabled, number }` oder `null`) |
| `POST /provision/<token>/phonebook`, `PUT`/`DELETE …/phonebook/<id>` | Telefonbuch bearbeiten (Recht `phonebook_edit`; bearbeitbare Einträge haben im Profil eine `id`) |
| `GET /provision/<token>/presence` | Besetztanzeige: `extensions` (`number`, `name`, `state` = `idle`/`ringing`/`busy`/`offline`, `dnd`, `forward` = interne Nummer oder `extern`, `note` = Status aus dem Kalender), `parked` (`slot`, `number`, `name`, `by`, `since`, `until`), `voicemail` (`{ unread, revision }` oder `null`), `groups` (eigene Gruppen: `id`, `number`, `name`, `active`), `missed` (`{ open, revision }` oder `null` ohne gemeinsame Liste), `revision` – die Apps fragen alle paar Sekunden |
| `GET /provision/<token>/groups`, `PUT …/groups/<id>` | eigene Gruppen; `{ active }` meldet an bzw. ab (wie \*45) |
| `GET /provision/<token>/missed` | verpasste Gruppenanrufe: `id`, `group`, `group_name`, `time`, `number`, `name`, `claimed_by`, `done_by`, `done_how` (`callback`/`answered`/`manual`) |
| `PUT /provision/<token>/missed/<gruppe>/<id>` | `{ action }` = `claim`, `release`, `done` oder `reopen`; Antwort ist die neue Liste |
| `POST /provision/<token>/calls/join` | Rückfrage abschließen: `{ mode }` = `transfer` (die beiden Gegenüber verbinden) oder `conference` (Dreierkonferenz); braucht genau zwei Gespräche der Nebenstelle, sonst 409 |
| `GET /provision/<token>/fax`, `POST …/fax?box=…&number=…` | Faxgeräte und eigene gesendete Faxe bzw. PDF (Body) senden (Recht `fax_send`) |
| `GET /provision/<token>/voicemail` | Nachrichten: `id`, `folder` (`INBOX`/`Old`), `unread`, `time` (ms), `number`, `name`, `duration`, mit *Voicemail als Text* auch `text` oder `transcribing` |
| `GET /provision/<token>/voicemail/<id>` | Nachricht als WAV (8 kHz) |
| `PUT /provision/<token>/voicemail/<id>`, `DELETE …` | als gehört markieren bzw. löschen, Antwort ist die neue Liste |
| `POST /provision/<token>/blocklist`, `DELETE …/blocklist/<nummer>` | Nummer sperren (`{ number, note }`) bzw. freigeben (Recht `block_numbers`) |
| `PUT /provision/<token>/forward` | Änderungen davon (`cfu` braucht das Recht `forward`, der Rest `forward_rules`; externe Ziele `forward_external`) |

`remote` ist der Zugang für die Mobil-App (`null`, wenn der Fernzugriff aus ist):
`{ websocket: "wss://…/ws", user: "<nummer>-app", domain, ice_servers: [RTCIceServer …] }`.
Steht unter *System → Fernzugriff* eine öffentliche Adresse, zeigen `url` und
`websocket` immer dorthin.

`video` ist der Zugang für Videoanrufe im Messenger (gleicher Aufbau, Benutzer
`<nummer>-video`, `null` ohne Messenger oder Video). `websocket` zeigt hier auf die Adresse,
unter der die App das Profil abgerufen hat, im LAN also direkt auf die Anlage. Die App ruft
`sip:<raum-id>@<domain>` an; die Anlage prüft die Mitgliedschaft und legt alle in die
Konferenz `p4a-chat-<raum-id>` (ConfBridge, `video_mode=sfu`).

Termine: `{ uid, summary, start, end, allDay, location, description }`. Ganztägige
Termine haben Datumsangaben (`2026-12-24`, Ende exklusiv), alle anderen ISO-Zeitpunkte.

Messenger-Protokoll: Nach dem Verbinden schickt die Anlage `{ t: 'init', me, users, online,
rooms }`. Die App sendet `history` (`room`, `before`), `send` (`room`, `text`), `direct`
(`with`), `group` (`name`, `members`), `update` (`room`, `name`, `members`), `leave`, `read`
(`room`, `seq`), `typing` und `decline` (`room`, Videoanruf ablehnen); ein mitgeschicktes
`ref` kommt mit der Antwort zurück. Die Anlage meldet `message`, `room`, `removed`, `read`,
`typing`, `presence`, `users`, `call` (`room`, `call`: `{ since, by, participants }` oder
`null` am Ende), `declined` (`room`, `ext`) und `error`; `init` enthält zusätzlich die
laufenden `calls`. Nachrichten tragen eine je Raum fortlaufende `seq`.

Durchsagen und Gegensprechen kommen mit `Call-Info: <sip:phone4all>;answer-after=0` und
einem Anrufernamen, der mit „Durchsage “ bzw. „Gegensprechen “ beginnt; die Apps nehmen
solche Anrufe selbst an. Bei Anrufen von außen entfernt die Anlage diesen Vorsatz.

Andere Telefone (Softphones) werden mit Nebenstelle als Benutzer, SIP-Passwort und der
Adresse der Anlage als Server angemeldet; Yealink- und Snom-Tischtelefone richten sich
selbst ein (siehe unten).

## Tischtelefone (Yealink, Snom)

Unter *Tischtelefone* anlegen (Hersteller, MAC, Nebenstelle, Funktionstasten). Die
Provisioning-Adresse `http://<anlage>:8080/desk/<token>` kommt ins Telefon (Yealink: *Auto
Provision → Server URL*, Snom: *Setting URL*) oder per DHCP-Option 66:

| Datei | Inhalt |
| --- | --- |
| Yealink `y000000000000.cfg` (allgemein) | nur `#!version:1.0.0.1`, alles Weitere in der eigenen Datei |
| Yealink `<mac>.cfg` | Konto, Sprache, Zeitzone, LDAP, Intercom, Heranholen (`**`, `*8`), Leitungstasten ab Taste 2 |
| Snom `snom.xml` bzw. `…<MAC>.xml` | `phone-settings` und `functionKeys` |

Die MAC steht im Dateinamen bzw. im User-Agent; passt sie nicht zum angelegten Telefon,
antwortet die Anlage mit 404. Das Telefon fragt täglich neu nach.

## Selbstbedienung (`/me`)

Anmeldung mit Nebenstelle und Voicemail-PIN (Cookie `p4a_me`, gilt nur für `/me`),
standardmäßig nur aus den lokalen Netzen (*System → Zugang → Selbstbedienung*). Nach fünf
falschen PINs ist die Nebenstelle 15 Minuten gesperrt; schwache PINs (`1234`, `0000`,
die eigene Nebenstelle) lehnt die Anlage beim Ändern ab.

## DECT-Telefone (Gigaset N610 IP PRO)

Jedes Mobilteil ist eine eigene Nebenstelle. Unter *DECT-Telefone* eine Basis mit
MAC-Adresse anlegen und den Mobilteilen Nebenstellen zuordnen. *Einrichten* zeigt dann:

1. Den **Provisioning-Server** (`http://<anlage>:8080/dect/<schlüssel>/`), der in der
   Weboberfläche der Basis unter *Einstellungen → System → Provisioning und
   Konfiguration* eingetragen wird. Die Basis holt dort `<mac>.xml` mit dem SIP-Zugang
   der Anlage und einem Konto je Mobilteil, später auch jede Änderung. Wer den Eintrag
   nicht nutzen will, lädt die Datei herunter und spielt sie in der Basis ein.
2. Die **PIN** für die Anmeldung der Mobilteile. Nach jedem Abruf ist die Anmeldung
   15 Minuten lang offen (*Menü → Einstellungen → Anmeldung → Mobilteil anmelden*).
3. Die Werte für das **LDAP-Telefonbuch**, falls es unter *Kontakte* eingeschaltet ist.

Was über die Anlage läuft: Anrufernamen, Halten, Makeln, Übergeben (R-Taste oder
Auflegen), Anklopfen, Nachrichtenanzeige bei neuer Voicemail (*97), HD-Sprache (G.722),
\*8 Heranholen, \*76 Nicht stören, \*21 Rufumleitung. Besetztlampen (BLF) kennt die N610
nicht. Die Datei folgt dem Format der Gigaset-Firmware für N610/N670/N870
(`productID="e2"`); ältere Basen wie die N510 brauchen ein anderes Format und werden
von Hand eingerichtet.

## Telefonbuch per LDAP

Unter *Kontakte → Telefonbuch für DECT- und Tischtelefone* einschalten. Die Anlage
beantwortet LDAP-Suchen (nur lesen) auf Port 389 aus dem lokalen Netz bzw. den unter
*System → Sicherheit* erlaubten Netzen:

| Einstellung | Wert |
| --- | --- |
| Suchbasis | `dc=phone4all` |
| Anmeldung | ohne, oder `cn=telefonbuch,dc=phone4all` mit dem eingestellten Kennwort, oder Nebenstelle und SIP-Passwort |
| Namensfilter | `(\|(cn=%)(sn=%)(o=%))` |
| Nummernfilter | `(\|(telephoneNumber=%)(mobile=%))` |
| Attribute | `cn`, `givenName`, `sn`, `o`, `telephoneNumber`, `mobile` |

Enthalten sind Nebenstellen, Gruppen, Konferenzräume, die zentralen Kontakte und die externen Kontaktquellen.
Rufnummern werden unabhängig von der Schreibweise gefunden (`030 1234567`,
`+49301234567`). Test: `ldapsearch -x -H ldap://<anlage> -b dc=phone4all '(cn=*)'`.

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

## Home Assistant

Die Integration *Phone4all-Telefonanlage* zeigt verpasste Anrufe und Störungen der
Anlage in Home Assistant an, etwa ein SIP-Konto, das sich beim Anbieter abgemeldet hat.

1. In der Weboberfläche unter *System → Schnittstellen* die Schnittstelle einschalten
   und den Zugriffsschlüssel kopieren.
2. In Home Assistant über HACS installieren: *HACS → ⋮ → Benutzerdefinierte Repositories*,
   `https://github.com/henne-407/phone4all` als Typ *Integration* hinzufügen und
   *Phone4all-Telefonanlage* herunterladen. Ohne HACS den Ordner
   [`custom_components/phone4all`](../custom_components/phone4all) nach
   `config/custom_components/` kopieren. Danach Home Assistant neu starten.
3. *Einstellungen → Geräte & Dienste → Integration hinzufügen → Phone4all*: Adresse der
   Anlage und Zugriffsschlüssel eintragen.

Home Assistant fragt die Anlage alle 15 Sekunden ab. Das geht im lokalen Netz
(`http://<anlage>:8080`) oder von außen über HTTPS hinter einem Reverse-Proxy wie
Pangolin, Traefik oder Nginx. Verlangt der Proxy eine eigene Anmeldung (bei Pangolin die
Ressourcen-Authentifizierung), dort eine Regel anlegen, die den Pfad
`/api/integration/status` ohne Anmeldung durchlässt. Diesen Pfad schützt der
Zugriffsschlüssel, alles andere bleibt hinter der Anmeldung des Proxys.

| Entität | Bedeutung |
| --- | --- |
| `binary_sensor.<anlage>_sip_konto_<name>` | je SIP-Konto mit Anmeldung: an = angemeldet |
| `binary_sensor.<anlage>_problem` | an, solange die Anlage ein Problem meldet; Attribut `problems` listet sie |
| `sensor.<anlage>_verpasste_anrufe_heute` | verpasste Anrufe seit Mitternacht (auch auf die Voicemail gelaufene); Attribut `calls` mit den letzten zehn |
| `sensor.<anlage>_letzter_verpasster_anruf` | Zeitpunkt, Anrufer als Attribute `caller`, `caller_name`, `called`, `voicemail` |
| `sensor.<anlage>_laufende_gesprache` | laufende Gespräche |
| `event.<anlage>_verpasster_anruf`, `event.<anlage>_notruf`, `event.<anlage>_storungsmeldung`, `event.<anlage>_turklingel` | letztes Ereignis für Verlauf und Automationen |
| `switch.<anlage>_nicht_storen_<nebenstelle>` | *Nicht stören* je Nebenstelle (braucht *Schalten über die Schnittstelle*) |
| `select.<anlage>_zeitsteuerung_<name>` | `auto`, `open`, `closed` je Zeitsteuerung (ebenso) |
| `binary_sensor.<anlage>_asterisk`, `binary_sensor.<anlage>_update` | Diagnose: Asterisk läuft, neue Version verfügbar |

Für Automationen löst die Integration Ereignisse aus:

| Ereignis | Daten |
| --- | --- |
| `phone4all_missed_call` | `caller`, `caller_name`, `called`, `time`, `voicemail`, `pbx` |
| `phone4all_emergency_call` | `extension`, `name`, `number` (110 oder 112), `time`, `pbx` |
| `phone4all_problem` | `key` (`trunk:<id>`, `asterisk` oder `connection` = Anlage nicht erreichbar), `message`, `pbx` |
| `phone4all_problem_resolved` | wie oben, sobald das Problem behoben ist |
| `phone4all_door_ring` | `call_id`, `extension`, `name`, `time`, `pbx` – eine Türsprechstelle klingelt |

Aktionen: `phone4all.call` (`extension`, `number`), `phone4all.announce` (`target`,
`message`, `voice`) und `phone4all.set_forward` (`extension`, `target`, leer = aus); bei
mehreren Anlagen zusätzlich `config_entry_id`.

Fertige Automation als Blueprint (Benachrichtigung aufs Handy, kurze Aussetzer werden
übergangen):
[`blueprints/automation/phone4all/benachrichtigung.yaml`](../blueprints/automation/phone4all/benachrichtigung.yaml) –
in Home Assistant unter *Einstellungen → Automationen → Blueprints → Blueprint importieren*
die Adresse dieser Datei eintragen.

Schnittstelle für eigene Anbindungen (Node-RED, Skripte):
`GET /api/integration/status` mit `Authorization: Bearer <Zugriffsschlüssel>` liefert
SIP-Konten, Nebenstellen, laufende Gespräche, die letzten 25 verpassten Anrufe und die
aktuellen Probleme als JSON, außerdem `emergency` (die letzten zehn Notrufe seit dem Start).

`POST /api/integration/call` mit demselben Schlüssel und `{ "extension": "10", "number": "030123456" }`
löst einen Anruf aus (erst klingelt die Nebenstelle, dann wählt die Anlage); dafür unter
*System → Schnittstellen* *Anrufe und Ansagen über die Schnittstelle erlauben* einschalten.
Ebenso `POST /api/integration/announce` mit `{ target, text, voice }`: ruft die Nebenstelle
oder die angemeldeten Mitglieder einer Gruppe an und spricht den Text.

Mit *Schalten über die Schnittstelle erlauben*:

| Anfrage | Body |
| --- | --- |
| `POST /api/integration/dnd` | `{ extension, enabled }` |
| `POST /api/integration/forward` | `{ extension, target }` (leer = aus) |
| `POST /api/integration/timecondition` | `{ id, mode }` mit `auto`, `open` oder `closed` |

Der Status enthält dafür je Nebenstelle `dnd`, `forward` und `door`, die
`timeconditions` (`id`, `name`, `override`, `open`) und `door` (die letzten Klingeln an
Türsprechstellen).

### Webhooks

Unter *System → Schnittstellen → Webhooks* eingetragene Adressen bekommen Ereignisse per
`POST` als JSON: `{ event, time, data, pbx }`. Kopfzeilen: `X-Phone4all-Event` und
`X-Phone4all-Signature: sha256=<HMAC-SHA256 des Bodys mit dem Schlüssel des Webhooks>`.
Zeitlimit 5 Sekunden, keine Wiederholung, Umleitungen werden nicht verfolgt.

| Ereignis | `data` |
| --- | --- |
| `call.ringing` | `call`, `direction` (`in`/`out`/`internal`), `from`, `from_name`, `extension` |
| `call.answered` | wie oben, `extension` = wer angenommen hat (`extern` bei ausgehenden) |
| `call.ended` | `call`, `direction`, `from`, `from_name`, `answered`, `answered_by`, `duration` |
| `call.missed` | `call`, `from`, `from_name`, `extensions` (bei wem es geklingelt hat) |
| `voicemail.new` | `extension`, `new` (Anzahl neuer Nachrichten) |
| `voicemail.transcribed` | `extension`, `from`, `from_name`, `text`, `error` |
| `call.blocked` | `from`, `from_name`, `to` |
| `emergency` | `extension`, `name`, `number`, `time` |
| `door.ring` | `extension`, `name` |

## Daten

Alles liegt im Ordner `data/` neben der `docker-compose.yml`:

| Datei / Ordner | Inhalt |
| --- | --- |
| `config.json` | gesamte Konfiguration |
| `backups/` | automatische Sicherungen |
| `voicemail/`, `recordings/` | Nachrichten, Aufzeichnungen |
| `sounds/` | eigene Ansagen und Wartemusik |
| `calendars/` | Termine der zentralen Kalender |
| `messenger/` | Chats (`rooms.json`, `rooms/*.jsonl`) und Anhänge (`files/`) |
| `log/` | Anrufliste (CDR) und Protokoll |
| `watchdog.json` | Ereignisse des Watchdogs |
| `tts/` | Sprachausgabe (Piper und Stimmen, erst nach dem ersten Gebrauch) |
| `whisper/`, `transcripts/` | Modelle der Spracherkennung und Voicemail als Text |
| `fax/` | empfangene und gesendete Faxe als PDF (30 Tage) |
| `missed.json` | verpasste Gruppenanrufe |
| `users.json` | weitere Zugänge der Weboberfläche (Passwörter als scrypt-Hash) |

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

Vor jedem Update wird automatisch gesichert. Gibt es eine neue Version, erscheint
zusätzlich unten im Menü ein Hinweis „Update auf …“.

### TrueNAS

Als Custom App (*Apps → Discover Apps → ⋮ → Install via YAML*):

```yaml
services:
  pbx:
    image: ghcr.io/henne-407/phone4all-pbx:latest   # fester Tag, TrueNAS liest keine .env
    container_name: phone4all-pbx
    network_mode: host
    restart: unless-stopped
    volumes:
      - /mnt/POOL/apps/phone4all/data:/data         # absoluter Pfad auf einem Dataset
      # - /var/run/docker.sock:/var/run/docker.sock # optional: Updates per Knopf
    environment:
      TZ: Europe/Berlin
```

Aktualisiert wird über „Update“ in der TrueNAS-App-Übersicht. Mit eingebundenem
Docker-Socket geht auch der Knopf in der Weboberfläche; der Socket gibt der Anlage
aber volle Kontrolle über den Rechner (siehe [Installation](../docs/installation.md)).

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
