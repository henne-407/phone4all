# SIP-Telefon

Schlanker SIP-Softphone-Client für Linux (GTK4/libadwaita). Verbindet sich mit
einer SIP-Telefonanlage (z. B. FRITZ!Box, Asterisk, 3CX, Starface, Sipgate),
wählt Nummern, verwaltet Kontakte und meldet eingehende Anrufe per Pop-up und
Desktop-Benachrichtigung.

Die SIP- und Audio-Arbeit macht [baresip](https://github.com/baresip/baresip),
das als Hintergrundprozess gestartet und über sein `ctrl_tcp`-Modul gesteuert wird.

## Installation (Fedora)

```sh
sudo dnf install baresip baresip-pipewire baresip-opus baresip-g722
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

- Wähltastatur mit Tastatureingabe, Kontaktvorschlägen und Wahlwiederholung
  (Anruftaste bei leerem Feld holt die letzte Nummer)
- Kontakte (Name, Telefon, Mobil, Firma) mit Suche; Anrufer werden erkannt
- Pop-up-Fenster und Benachrichtigung mit *Annehmen*/*Ablehnen* bei Anrufen,
  Benachrichtigung bei verpassten Anrufen mit *Zurückrufen*
- Während des Gesprächs: Stummschalten, Halten, DTMF-Tastatur (auch per Tastatur)
- Anrufverlauf (ein-/ausgehend/verpasst), Nummern direkt als Kontakt speichern
- Läuft beim Schließen im Hintergrund weiter (abschaltbar), optionaler Autostart
- Passwort im GNOME-Schlüsselbund (libsecret); ohne Schlüsselbund in
  `~/.config/sip-telefon/settings.json` mit Rechten 0600

## Dateien

| Pfad | Inhalt |
| --- | --- |
| `~/.config/sip-telefon/settings.json` | Kontoeinstellungen |
| `~/.local/share/sip-telefon/contacts.json` | Kontakte |
| `~/.local/share/sip-telefon/history.json` | Anrufverlauf |
| `~/.local/state/sip-telefon/baresip.log` | Log der SIP-Engine (Fehlersuche) |
| `$XDG_RUNTIME_DIR/sip-telefon/` | generierte baresip-Konfiguration |

## Hinweise

- Audio läuft über die PipeWire-Standardgeräte; umstellen z. B. mit `pavucontrol`.
- Passwörter mit `;` werden von baresip nicht unterstützt.
- Ist die Anlage nur über NAT erreichbar, in den erweiterten Einstellungen einen
  STUN-Server und ggf. einen festen lokalen SIP-Port eintragen.
