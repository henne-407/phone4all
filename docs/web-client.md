# Web-Client im Browser

Der Web-Client ist die Desktop-App im Browser: gleiche Oberfläche, gleiche Seiten, ohne
Installation. Die Telefonanlage liefert ihn selbst aus unter

```
https://<anlage>/web/
```

Telefoniert wird wie in der Mobil-App per WebRTC (SIP über `wss://…/ws`). Der Browser
ist dabei ein eigenes Gerät der Nebenstelle: Anrufe klingeln gleichzeitig am Tischtelefon,
in der Desktop-App, auf dem Handy und im Browser.

Der Web-Client braucht die [Phone4all-Telefonanlage](telefonanlage.md). Andere Anlagen
(FRITZ!Box, 3CX …) gehen nur mit der [Desktop-App](desktop-app.md).

## Voraussetzungen

- **HTTPS.** Browser geben das Mikrofon nur auf sicheren Seiten frei. Im Büro und
  unterwegs also über die HTTPS-Adresse aus [Zugriff von unterwegs](fernzugriff.md)
  öffnen. Über `http://<anlage>:8080/web/` gehen Kontakte, Messenger und Einstellungen,
  aber keine Anrufe; der Client zeigt dann einen Knopf zur HTTPS-Adresse.
- **Fernzugriff eingeschaltet** (*System → Fernzugriff*), denn der Browser nutzt dasselbe
  Konto `<nummer>-app` wie die Mobil-App.
- Ein aktueller Browser: Chrome, Edge, Firefox oder Safari.

## Anmelden

Eine der drei Möglichkeiten:

- **Nebenstelle und Einrichtungs-PIN** eingeben (Verwaltung: *Nebenstellen → Bearbeiten →
  App einrichten*, oder aus der Einladung).
- In der **Einladungs-E-Mail** bzw. auf der Einladungsseite auf *Im Browser* klicken.
- Den **Einladungslink** in das Feld der Anmeldeseite einfügen.

Danach fragt der Browser nach Mikrofon und Benachrichtigungen. Beides erlauben, sonst
gibt es keine Anrufe bzw. keine Hinweise bei eingehenden Anrufen, wenn der Tab im
Hintergrund liegt. Der Browser erscheint in der Verwaltung in der Geräteliste der
Nebenstelle, z. B. als „Browser (Firefox, Linux)“.

**Abmelden** (Hauptmenü oder *Einstellungen → Konto*) entfernt das Gerät wieder aus der
Anlage und löscht alle Daten im Browser.

## Funktionen

Alles, was die Desktop-App mit der Phone4all-Anlage kann:

- Wählen, Annehmen, Halten, Makeln, Rückfrage, Verbinden, Konferenz, DTMF, Durchsagen
- Verlauf, Kontakte (eigene und Telefonbuch der Anlage), Favoriten, Besetztanzeige
- Voicemail, Umleitungen, Gruppen, Chef/Sekretariat, Rückruf wenn frei, Parken
- Kalender der Anlage mit Erinnerungen, SMS und Fax (mit den Rechten aus dem App-Profil)
- Messenger mit Dateien und Videoanrufen inklusive Bildschirm teilen
- Klingeltöne (auch eigene), Wahl von Mikrofon und Lautsprecher, helles und dunkles Design
- `tel:`- und `sip:`-Links: *Einstellungen → Allgemein* meldet den Web-Client im Browser als
  Programm für Telefon-Links an.

**Mehrere Tabs:** Telefoniert wird nur in einem Tab. Ein zweiter Tab zeigt alles an und
bietet *Hier telefonieren* an, um das Telefon zu übernehmen.

## Grenzen

- Ohne offenen Tab klingelt nichts. Für ständige Erreichbarkeit die Desktop-App
  oder die Mobil-App nehmen.
- Gibt es nicht im Browser: CalDAV-/CardDAV-Konten, SQL-Kontakte, Anruf-Pop-up als eigenes
  Fenster, Autostart, Updates, andere SIP-Anlagen.
- Das Konto `<nummer>-app` nimmt höchstens **drei** Anmeldungen gleichzeitig an (Mobil-Apps
  und Browser zusammen). Eine vierte verdrängt die älteste. Nicht mehr genutzte Browser
  daher abmelden oder in der Verwaltung aus der Geräteliste löschen.
- Die Anmeldung liegt unverschlüsselt im Speicher des Browsers. An fremden Rechnern
  nach der Nutzung abmelden.

## Fehlersuche

| Problem | Lösung |
| --- | --- |
| „Telefonieren nur über HTTPS“ | Seite über die HTTPS-Adresse öffnen |
| „Fernzugriff ist aus“ | in der Verwaltung *System → Fernzugriff* einschalten |
| Verbindet, aber kein Ton | TURN-Port 3478 (TCP+UDP) prüfen, siehe [Zugriff von unterwegs](fernzugriff.md) |
| Kein Mikrofon | in den Seiteneinstellungen des Browsers das Mikrofon erlauben |
| „Neu anmelden“ | das Gerät wurde in der Verwaltung gelöscht; neu anmelden |

*Einstellungen → Diagnose* zeigt Verbindung, Anmeldung und Audiogeräte.
