# SIP-Telefon

Schlanker SIP-Softphone-Client für Linux (GTK4/libadwaita im Material-3-Design).
Verbindet sich mit einer SIP-Telefonanlage (z. B. FRITZ!Box, Asterisk, 3CX,
Starface, Sipgate), wählt Nummern, verwaltet Kontakte, meldet eingehende Anrufe
per Pop-up und Desktop-Benachrichtigung und zeigt deinen Kalender (CalDAV oder
GNOME Online-Konten) inklusive Einwahlnummern zum direkten Anrufen.

Die SIP- und Audio-Arbeit macht [baresip](https://github.com/baresip/baresip),
das als Hintergrundprozess gestartet und über sein `ctrl_tcp`-Modul gesteuert wird.

## Installation (Fedora)

```sh
sudo dnf install baresip baresip-pipewire baresip-opus baresip-g722
sudo dnf install google-roboto-fonts   # optional: Material-Schrift
./install.sh          # Startmenü-Eintrag + Befehl "sip-telefon"
```

GTK4, libadwaita und PyGObject sind auf Fedora Workstation bereits vorhanden
(sonst: `sudo dnf install python3-gobject gtk4 libadwaita`).

Ohne Installation direkt starten: `./sip-telefon`

## Einrichtung

Menü → **Einstellungen** → Server/Domain, Benutzername und Passwort eintragen.
Beim Schließen des Dialogs verbindet sich das Programm neu. Der Punkt links in
der Titelleiste zeigt den Status (grün = angemeldet).

FRITZ!Box: unter *Telefonie → Telefoniegeräte → Neues Gerät → Telefon (LAN/WLAN)*
ein IP-Telefon anlegen. Server ist `fritz.box`, Benutzername der dort vergebene
Name (z. B. `620`).

## Funktionen

- Anpassbare Startseite: Status mit „Nicht stören“ und Schnellwahl, Favoriten,
  letzte Anrufe, nächste Termine – Karten ein-/ausblenden und sortieren, Startansicht wählbar
- Wähltastatur mit Tastatureingabe, Kontaktvorschlägen und Wahlwiederholung
  (Anruftaste bei leerem Feld holt die letzte Nummer)
- Kontakte (Name, Telefon, Mobil, weitere Nummern, Firma) mit Suche; Anrufer werden erkannt
- Kontakt-Import aus vCard (.vcf) und CSV (Google, iCloud, Outlook, Thunderbird, Android);
  Dubletten (gleiche Nummer oder gleicher Name) werden ergänzt statt doppelt angelegt
- Adressbücher aus GNOME Online-Konten, per CardDAV und aus Microsoft-SQL-Server-Datenbanken
  (z. B. CRM/Warenwirtschaft) werden alle 30 Minuten abgeglichen (nur lesend) und für
  Kontaktliste und Anrufererkennung genutzt
- Pop-up-Fenster und Benachrichtigung mit *Annehmen*/*Ablehnen* bei Anrufen,
  Benachrichtigung bei verpassten Anrufen mit *Zurückrufen*
- Während des Gesprächs: Stummschalten, Halten, DTMF-Tastatur (auch per Tastatur)
- Anrufverlauf (ein-/ausgehend/verpasst), Nummern direkt als Kontakt speichern
- Kalender-Tab: Monatsansicht mit Terminpunkten, Termine anlegen/ändern/löschen,
  Telefonnummern in Terminen (z. B. Einwahlnummern) per Klick anrufen
- „Rückruf planen“ aus dem Verlauf (⋮-Menü) und während des Gesprächs
- Erinnerung vor Terminen als Benachrichtigung, mit Anrufknopf bei erkannter Nummer
- Material-3-Design mit hellem und dunklem Farbschema (folgt der Systemeinstellung)
- Läuft beim Schließen im Hintergrund weiter (abschaltbar), optionaler Autostart
- Passwort im GNOME-Schlüsselbund (libsecret); ohne Schlüsselbund in
  `~/.config/sip-telefon/settings.json` mit Rechten 0600

## Kalender

Menü → **Einstellungen** → **Kalender**:

- **CalDAV**: „+“ bei *CalDAV-Konten*, Server-URL, Benutzer und Passwort eintragen.
  Die Kalender werden automatisch gefunden. Beispiele: Nextcloud
  `https://cloud.example.de/remote.php/dav`, iCloud `https://caldav.icloud.com`
  (app-spezifisches Passwort), mailbox.org `https://dav.mailbox.org`.
- **GNOME Online-Konten** (Google, Microsoft 365, …): Konto in den
  GNOME-Einstellungen unter *Online-Konten* einrichten; die Kalender erscheinen
  dann automatisch (über den Evolution Data Server). Lokale Evolution-Kalender
  werden ebenfalls angezeigt.

Serientermine werden angezeigt, lassen sich aber nur in der Kalender-App des
Anbieters bearbeiten.

## Kontakte importieren

Kontakte-Tab → ⋮ → **Aus Datei importieren …** (vCard oder CSV, mehrere Dateien
möglich). Adressbücher verbindest du unter Einstellungen → **Kontakte**; für
Nextcloud & Co. lassen sich die Zugangsdaten eines vorhandenen Kalenderkontos
übernehmen. Kontakte aus Adressbüchern sind schreibgeschützt, können aber per
„Als eigenen Kontakt übernehmen“ kopiert werden.

## SQL-Server-Datenbank anbinden

```sh
sudo dnf install python3-pymssql
```

Einstellungen → **Kontakte** → *SQL-Server-Datenbanken* → „+“. Server, Port,
Datenbank und Zugangsdaten eintragen, **Verbinden**, Tabelle oder Sicht wählen –
Name-, Firma- und Telefonspalten werden anhand der Spaltennamen vorgeschlagen.
Alternativ eine eigene `SELECT`-Abfrage mit Spalten wie `name`, `company`,
`phone`, `mobile`. Es wird nur gelesen; am besten einen Datenbankbenutzer mit
reinen Leserechten (`db_datareader`) verwenden. Es werden höchstens 50 000 Zeilen
pro Quelle gelesen.

## Dateien

| Pfad | Inhalt |
| --- | --- |
| `~/.config/sip-telefon/settings.json` | Kontoeinstellungen |
| `~/.local/share/sip-telefon/contacts.json` | Kontakte |
| `~/.local/share/sip-telefon/history.json` | Anrufverlauf |
| `~/.local/share/sip-telefon/addressbooks.json` | Zwischenspeicher der Adressbuch-Kontakte |
| `~/.local/state/sip-telefon/baresip.log` | Log der SIP-Engine (Fehlersuche) |
| `$XDG_RUNTIME_DIR/sip-telefon/` | generierte baresip-Konfiguration |

## Hinweise

- Audio läuft über die PipeWire-Standardgeräte; umstellen z. B. mit `pavucontrol`.
- Passwörter mit `;` werden von baresip nicht unterstützt.
- Ist die Anlage nur über NAT erreichbar, in den erweiterten Einstellungen einen
  STUN-Server und ggf. einen festen lokalen SIP-Port eintragen.
