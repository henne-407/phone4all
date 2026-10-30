# Mobil-App für Android und iPhone

Mit der Mobil-App telefoniert das Handy als weiteres Gerät der eigenen Nebenstelle: Anrufe
klingeln gleichzeitig am Schreibtisch und auf dem Handy, ausgehende Anrufe zeigen die
Büronummer. Telefonbuch, Kalender und App-Profil kommen von der Anlage – im Büro-WLAN wie
unterwegs.

Die App braucht die [Phone4all-Telefonanlage](telefonanlage.md). Andere SIP-Anlagen
werden nicht unterstützt, weil die App SIP über WebSocket und WebRTC nutzt.

## So funktioniert es

| Was | Wie |
| --- | --- |
| Einrichtung, Kontakte, Kalender, App-Profil | HTTPS, wie bei der Desktop-App |
| Anmeldung und Anrufe (SIP) | WebSocket über HTTPS (`wss://…/ws`) |
| Sprache | WebRTC, verschlüsselt (DTLS-SRTP), unterwegs über den TURN-Server der Anlage |

Die Anlage legt zu jeder Nebenstelle automatisch ein zweites Gerät `<nummer>-app` an.
*Nicht stören*, Weiterleitungen und Gruppen gelten für alle Geräte gleich.

## Installieren

Die Pakete stehen unter [Releases](https://github.com/henne-407/phone4all/releases)
(Tags `mobile-v…`):

- **Android:** `SIP-Telefon-<version>.apk` auf dem Handy öffnen und die Installation aus
  unbekannten Quellen erlauben. In den Android-Einstellungen danach die
  **Akku-Optimierung** für die App ausschalten, sonst beendet Android sie im Hintergrund.
- **iPhone:** `SIP-Telefon-<version>-unsigniert.ipa` lässt sich ohne Apple-Entwicklerkonto
  z. B. mit [Sideloadly](https://sideloadly.io) und der eigenen Apple-ID aufspielen. So
  installierte Apps laufen 7 Tage und müssen dann neu aufgespielt werden.

## Einrichten

1. Für die Nutzung unterwegs muss die Anlage per HTTPS erreichbar sein. Das ist einmalig
   einzurichten: [Zugriff von unterwegs](fernzugriff.md). Nur im Büro-WLAN geht es auch
   ohne.
2. App öffnen und einen der Wege wählen:
   - **QR-Code scannen** aus der Weboberfläche (*Nebenstellen → Bearbeiten*),
   - den Link aus der **Einladungs-E-Mail** antippen,
   - Adresse der Anlage, Nebenstelle und **Einrichtungs-PIN** eintippen.
3. Mikrofon und Benachrichtigungen erlauben.

Die App übernimmt Konto, Telefonbuch, Kalender und App-Profil und fragt alle zwei
Minuten nach Änderungen, solange sie geöffnet ist.

## Funktionen

- Startseite mit Status, *Nicht stören* (\*76), Voicemail (\*97), Favoriten, letzten
  Anrufen und nächsten Terminen
- Wähltastatur, Rufnummern werden mit Namen aus dem Telefonbuch angezeigt
- Karte *Kollegen*: wer frei ist, telefoniert oder umgeleitet ist, Status aus dem Kalender,
  geparkte Gespräche mit *Übernehmen*
- Karte *Erreichbarkeit*: je Gruppe an- und abmelden, *Handy klingelt mit* schalten,
  verpasste Gruppenanrufe gemeinsam abarbeiten (übernehmen, zurückrufen, erledigt),
  *Sekretariat nimmt an* für Chef und Sekretariat (wie \*83)
- Bei einem Kollegen, der telefoniert: **Rückruf, wenn frei** (wie \*37)
- **SMS senden** über die Anlage (Knopf *SMS* auf der Status-Karte, Recht *SMS*)
- Eingehende Anrufe zeigen, ob sie **intern, von außen oder über eine Gruppe** kommen,
  und vibrieren unterschiedlich (wenn *Klingelton je Herkunft* auf der Anlage an ist)
- Im Gespräch: Stumm, Lautsprecher, Halten, Tastentöne, Weiterleiten, Parken,
  **Rückfrage** (halten und jemand anderen anrufen, dann makeln, verbinden oder
  Dreierkonferenz), bei einer Türsprechstelle *Tür öffnen* und – wenn das App-Profil eine
  CRM-Adresse hat – *CRM*
- Durchsagen und Gegensprechen nimmt die App ohne Klingeln auf dem Lautsprecher an
  (abschaltbar in den Einstellungen)
- Voicemail im Verlauf: wer eine Nachricht hinterlassen hat, mit Text (falls *Voicemail als
  Text* an ist), abhaken, löschen, zurückrufen; abgehört wird per Anruf (\*97)
- Lange auf einen Anruf im Verlauf tippen sperrt die Nummer (mit dem Recht *Rufnummern sperren*)
- Kontakte der Anlage und auf Wunsch die des Handys, Suche, Favoriten
- Kalender der Anlage; in beschreibbaren Kalendern eigene Termine anlegen und löschen
- Anrufverlauf auf dem Gerät

## Grenzen

- **iPhone:** Anrufe kommen nur an, solange die App geöffnet ist. Für Anrufe bei
  geschlossener App braucht es VoIP-Push über Apple und damit ein Apple-Entwicklerkonto.
- **Android:** Die App bleibt über einen Hintergrunddienst mit dauerhafter
  Benachrichtigung erreichbar. Manche Hersteller (z. B. Xiaomi, Huawei) beenden solche
  Dienste trotzdem; dort zusätzlich *Autostart* erlauben.

Für Entwickler: Aufbau, Build und Tests stehen in [mobile/README.md](../mobile/README.md).
