# Testumgebung

Eine vollständige Telefonanlage zum Testen und zur Fehlersuche, getrennt von der echten:

| Dienst | Was | Adresse im Testnetz |
| --- | --- | --- |
| `pbx` | Phone4all-Anlage, ausführliches Log dauerhaft an (`PBX_DEBUG=1`) | 172.30.40.10, Weboberfläche auf Port 18080 |
| `carrier` | Fake-Carrier: Asterisk als simulierter Telefonanbieter | 172.30.40.20:5060 |
| `e2e` | Testtelefone (sipp) und das Testprogramm `e2e/run.py` | 172.30.40.30 |

Die Anlage meldet sich beim Fake-Carrier mit den Rufnummern 030 555000 und 030 555001
an. Der Fake-Carrier verhält sich je nach gewählter Nummer:

| Nummer (von der Anlage aus) | Ergebnis |
| --- | --- |
| `0800666…` | besetzt (486) |
| `0800404…` | Nummer gibt es nicht (404) |
| `0800999…` | klingelt, nimmt nie ab |
| alles andere | nimmt an, Piepton, dann Echo |

## Starten

```sh
cd testenv
cp .env.example .env        # Passwörter eintragen
podman compose up -d pbx carrier
podman compose run --rm e2e # alle Anruftests
```

`docker compose` funktioniert genauso. Ohne `PBX_IMAGE` nutzt die Testumgebung das
veröffentlichte Abbild; `podman compose build pbx` baut es aus diesem Stand des Repos.

## Anruftests

`e2e/run.py` richtet die Anlage über die Verwaltungs-API ein (Nebenstellen 10–12, SIP-Konto
beim Fake-Carrier, Rufabfolgen) und spielt dann durch:

- Anmeldung einer Nebenstelle
- Interner Anruf 10 → 11
- Anruf nach außen über den Fake-Carrier und nach außen auf eine besetzte Nummer
- Anruf von außen an die Hauptnummer (→ 11) und an eine Durchwahl (→ 12)
- Voicemail bei nicht erreichbarer Nebenstelle
- Anrufliste und Diagnose-Paket

Einzelne Tests: `podman compose run --rm e2e voicemail`. Ein zweiter Lauf legt nichts doppelt
an. Ergebnisse in `results/`:

| Datei | Inhalt |
| --- | --- |
| `results.json` | Ergebnis je Test |
| `sipp/*-messages.log` | jede SIP-Nachricht eines Testtelefons |
| `debug.log` | ausführliches Asterisk-Log mit allen SIP-Nachrichten der Anlage |
| `capture.pcap` | Mitschnitt aller Tests für Wireshark |
| `diagnose.tar.gz` | Diagnose-Paket wie aus *System → Diagnose* |

Dieselben Tests laufen in GitHub Actions (`.github/workflows/e2e.yml`) bei jeder Änderung an
Anlage, App-Code oder Testumgebung; die Ergebnisse hängen als Artefakt am Lauf.

## Fehlersuche

```sh
podman exec -it p4a-test-pbx sngrep                        # SIP live mitlesen
podman exec -it p4a-test-pbx asterisk -rvvv                # Asterisk-Konsole
podman exec -it p4a-test-carrier asterisk -rvvv            # Konsole des Fake-Carriers
podman exec p4a-test-pbx tail -f /data/log/debug.log       # ausführliches Log
podman compose logs -f pbx
```

Ein Anruf von außen lässt sich auch von Hand auslösen, etwa aus dem `e2e`-Container:

```sh
podman compose run --rm --entrypoint sh e2e -c \
  'sipp -sf scenarios/uac.xml -s +4930555000 -key from 0301234567 -d 5000 -m 1 172.30.40.20:5060'
```

## Echte Geräte

Mit `PBX_EXTERNAL_ADDRESS` (LAN-Adresse des Rechners) in `.env` können echte Telefone die
Test-Anlage nutzen: SIP auf Port 5070, Sprache auf 20000–20099/udp, Weboberfläche auf 18080.
Die Desktop-App oder ein DECT-Mobilteil bekommt dazu eine der Testnebenstellen.

- **Desktop-App:** `sip-telefon --diagnose` startet mit SIP-Mitschnitt im baresip-Log und
  öffnet Chrome DevTools auf `127.0.0.1:9222` (Port mit `PHONE4ALL_DEBUG_PORT` änderbar).
- **Web-Client:** `http://<rechner>:18080/web/` im Browser, DevTools wie gewohnt.
- **Mobil-App (Android):** Auf dem Handy *Entwickleroptionen → Kabelloses Debugging*, dann
  `adb pair <adresse>` und `adb connect <adresse>`; `adb logcat` zeigt das Log der App.

## Auf Fedora mit eigenem Benutzer

```sh
sudo bash testenv/setup-fedora.sh          # mit --lan: Ports im LAN freigeben
```

Das Skript legt den Benutzer `p4test` ohne Administratorrechte und ohne Passwort an, installiert
Podman (ohne Root), sipp, sngrep, tshark, adb und baresip, klont das Repository nach
`/home/p4test/phone4all` und erzeugt `.env` mit zufälligen Passwörtern. Anmelden kann man sich
nur per SSH-Schlüssel und nur vom eigenen Rechner (`ssh p4test`); lief sshd vorher nicht, lauscht
er danach nur auf 127.0.0.1. Die Container laufen weiter, auch wenn niemand angemeldet ist.

```sh
ssh p4test 'cd phone4all/testenv && podman compose up -d pbx carrier && podman compose run --rm e2e'
```
