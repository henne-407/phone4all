# Fehlersuche

Erste Anlaufstellen in der Weboberfläche der Anlage:

- *System → Diagnose* – Zustand von Asterisk, SIP-Konten und Speicher, Ereignisse des
  Watchdogs
- *System → Protokoll* – Warnungen und Fehler von Asterisk
- `http://<anlage>:8080/health` – Kurzstatus ohne Anmeldung

In der Desktop-App: *Einstellungen → Diagnose* und das Log der SIP-Engine
(siehe [Desktop-App → Dateien](desktop-app.md#dateien)).

## Telefonanlage

### SIP-Konto meldet sich nicht an

Die Karte unter *SIP-Konten* zeigt *Abgelehnt* oder *Nicht angemeldet*.

- **Zugangsdaten prüfen.** Bei der Telekom ist der Benutzername die Rufnummer mit
  `+49…`, die Anmeldung die E-Mail-Adresse bzw. Zugangsnummer; bei sipgate SIP-ID und
  SIP-Passwort aus dem Kundenportal (nicht das Login-Passwort).
- **Nur ein Gerät pro Konto.** Ist dasselbe Konto noch in einer FRITZ!Box oder einem
  anderen Telefon eingetragen, dort entfernen.
- **Zu viele Fehlversuche.** Manche Anbieter sperren nach falschen Passwörtern für eine
  Weile. Nach der Korrektur 15–30 Minuten warten.
- *System → Protokoll* zeigt die Antwort des Anbieters (z. B. `403 Forbidden`).

Der Watchdog meldet abgemeldete Konten nach der Wartezeit neu an und meldet die Störung
per E-Mail oder an Home Assistant.

### Kein Ton oder nur in eine Richtung

- Die Anlage muss mit `network_mode: host` laufen (siehe [Installation](installation.md)).
- *System → Allgemein → Lokale Netze* muss das eigene Netz enthalten (z. B.
  `192.168.178.0/24`).
- Nur für Telefone außerhalb des Büros ohne Mobil-App: öffentliche Adresse eintragen und
  5060 sowie 10000–10999/udp im Router freigeben.
- „SIP-ALG“ oder „SIP-Helper“ im Router ausschalten, falls vorhanden.

### Anruf von außen kommt nicht an

- Gibt es unter *Rufabfolgen* eine Regel für die angerufene Nummer, oder ein Ziel unter
  *Alle übrigen Anrufe über …*?
- Schaltet gerade eine *Zeitsteuerung* auf geschlossen (Feiertag, manuell mit \*28)?
- Hat die angerufene Person *Nicht stören* (\*76) oder eine Umleitung (\*21) aktiv? Die
  Liste der Nebenstellen zeigt beides.

### Weboberfläche nicht erreichbar

```sh
docker compose ps
docker compose logs --tail 100 pbx
```

Belegt ein anderer Dienst Port 8080, `PBX_HTTP_PORT` in der `docker-compose.yml` setzen.

### Eigene Adresse gesperrt

Nach mehreren Fehlanmeldungen sperrt die Anlage die Adresse. Unter *System → Sicherheit
→ Gesperrte Adressen* entsperren und das eigene Netz bei *Nie sperren* eintragen.

## Desktop-App

- **Punkt in der Titelleiste bleibt rot:** Server, Benutzer und Passwort unter
  *Einstellungen → Konto* prüfen. Passwörter mit `;` unterstützt baresip nicht.
- **Linux: keine Geräte zur Auswahl:** `baresip-pipewire` (Fedora) bzw. das passende
  Audio-Modul der Distribution installieren.
- **macOS: „Entwickler kann nicht überprüft werden“:** *Systemeinstellungen →
  Datenschutz & Sicherheit → Dennoch öffnen*.
- **Windows: SmartScreen-Warnung:** *Weitere Informationen → Trotzdem ausführen*.
- **Anlage wird bei „Einrichten“ nicht gefunden:** Die Suche nutzt UDP-Port 15060 im
  lokalen Netz. In getrennten Netzen (VLAN, VPN) stattdessen den Einrichtungslink
  einfügen.

## Mobil-App

- **iPhone klingelt nicht bei geschlossener App:** Das ist derzeit so, siehe
  [Mobil-App → Grenzen](mobil-app.md#grenzen).
- **Android klingelt nach einiger Zeit nicht mehr:** Akku-Optimierung für die App
  ausschalten, bei manchen Herstellern zusätzlich *Autostart* erlauben.
- **Anruf verbindet, aber kein Ton (unterwegs):** Port 3478 muss über TCP **und** UDP
  zur Anlage durchgereicht werden ([Zugriff von unterwegs](fernzugriff.md)).
- **Einrichtung schlägt unterwegs fehl:** Steht unter *System → Fernzugriff* die
  HTTPS-Adresse? Sind `/provision/*`, `/setup/*` und `/ws` von der Anmeldung des Proxys
  ausgenommen?

## Home Assistant

- **Integration lässt sich nicht hinzufügen:** Ist die Schnittstelle unter *System → Home
  Assistant* eingeschaltet? Erreicht Home Assistant die Adresse? Test:

  ```sh
  curl -H "Authorization: Bearer <schlüssel>" https://telefon.example.de/api/integration/status
  ```

- **Entitäten „nicht verfügbar“:** Die Anlage ist nicht erreichbar; die Integration löst
  dann das Ereignis `phone4all_problem` mit `key: connection` aus.

## DECT

- **Basis holt die Einrichtung nicht ab:** Erreicht die Basis die Anlage unter der
  angezeigten Adresse? Unter *System → Allgemein → Adresse für Telefone* die LAN-Adresse
  der Anlage eintragen. *DECT-Telefone* zeigt, wann die Basis zuletzt abgerufen hat.
- **Mobilteil lässt sich nicht anmelden:** Die Anmeldung ist nur 15 Minuten nach einem
  Abruf offen. Auto-Konfiguration in der Basis neu starten und gleich anmelden.

Nicht gelöst? Bitte ein [Issue](https://github.com/henne-407/phone4all/issues/new/choose)
mit Version, Auszug aus *System → Protokoll* und einer kurzen Beschreibung anlegen.
