# Erste Schritte

Vom leeren Server bis zum ersten Anruf. Am Ende klingeln Anrufe auf der Hauptnummer bei
allen im Büro, nach Feierabend läuft die Voicemail, und Desktop-App, Handy und
DECT-Telefone sind eingerichtet.

Die Übersicht der Weboberfläche zeigt die wichtigsten Schritte als Liste *Erste Schritte*
und hakt sie ab, sobald sie erledigt sind.

![Übersicht mit „Erste Schritte“](bilder/anlage-uebersicht.png)

## 1. Anlage installieren

Auf einem Debian- oder Ubuntu-Server (auch als VM oder Raspberry Pi 4/5):

```sh
curl -fsSL https://raw.githubusercontent.com/henne-407/phone4all/main/pbx/install.sh | sudo sh
```

Danach `http://<server>:8080` im Browser öffnen und mit Benutzer `admin` und dem
angezeigten Passwort anmelden. Das Passwort gleich unter *System → Zugang* ändern.

Läuft schon Docker (z. B. auf einem NAS), reicht die `docker-compose.yml`. Alle Wege
stehen unter [Installation](installation.md).

## 2. Grundeinstellungen

*System → Allgemein*: Name der Anlage, Bundesland (für Feiertage) und Ortsvorwahl.
*System → E-Mail*: ein Postfach für den Versand eintragen. Damit kommen
Voicemail-Nachrichten als Anhang und Einladungen an neue Nebenstellen an.

## 3. Nebenstellen anlegen

*Nebenstellen → Nebenstelle anlegen*: Für jede Person eine interne Nummer (z. B. `10`,
`11`), Name und E-Mail-Adresse. Wichtig sind:

- **Rufnummer nach außen** – welche eigene Nummer Angerufene sehen. Die Anlage telefoniert
  über das SIP-Konto, dem diese Nummer gehört.
- **Darf anrufen** – nur intern, Deutschland oder weltweit; Sonderrufnummern
  (0900, 0137, 118 …) sind getrennt freizugeben.
- **Voicemail** mit PIN und auf Wunsch *Nachricht als Anhang per E-Mail*.
- **Weiterleiten** bei besetzt oder ohne Antwort (nach der Klingeldauer).

Mehrere Personen unter einer Nummer werden zur **Gruppe** (*Gruppen*): alle gleichzeitig,
reihum oder als Warteschlange mit Wartemusik.

## 4. SIP-Konto beim Anbieter

*SIP-Konten → SIP-Konto anlegen* und den Anbieter wählen. Vorlagen gibt es für Telekom
(auch CompanyFlex), Vodafone Kabel und DSL, Deutsche Glasfaser, 1&1, o2, sipgate (basic und
trunking), easybell, Placetel und eine vorgeschaltete FRITZ!Box. Die Vorlage füllt Server,
Transport und Nummernformat aus; einzutragen sind nur die Zugangsdaten aus dem
Kundenportal des Anbieters und die Rufnummern des Kontos.

Die Karte zeigt nach wenigen Sekunden *Angemeldet*. Bleibt sie bei *Abgelehnt*, hilft
[Fehlersuche](fehlersuche.md#sip-konto-meldet-sich-nicht-an).

Ohne eigene Wahlregeln telefoniert die Anlage über das Konto, dem die *Rufnummer nach
außen* der Nebenstelle gehört, danach über die übrigen aktiven Konten. Wer mehrere Konten hat,
legt unter *Wahlregeln* fest, welche Anrufe über welches Konto gehen (mit Ausweichkonto).

## 5. Wohin eingehende Anrufe gehen

*Rufabfolgen → Rufnummer zuordnen*: die angerufene Nummer wählen und ein Ziel, z. B. die
Gruppe *Zentrale*. Jeder Schritt im Diagramm lässt sich anklicken und ändern; Ziele werden
per Auswahlmenü oder per Drag & Drop aus der Bausteinleiste gesetzt.

Typischer Aufbau für ein Büro:

1. *Zeitsteuerung* „Bürozeiten“ (Mo–Fr 8–17 Uhr, Feiertage geschlossen) anlegen.
2. Optional ein *Sprachmenü* („Vertrieb drücken Sie die 1 …“) mit einer Ansage unter
   *Ansagen und Musik* – hochladen oder direkt im Browser aufnehmen.
3. In der Rufabfolge: Hauptnummer → Bürozeiten → geöffnet: Sprachmenü oder Gruppe,
   geschlossen: Voicemail.

![Rufabfolgen als Diagramm](bilder/anlage-rufabfolgen.png)

Mehr dazu unter [Telefonanlage bedienen](telefonanlage.md#rufabfolgen).

## 6. Telefone verbinden

- **Desktop-App** ([Download](https://github.com/henne-407/phone4all/releases/latest)):
  *Einstellungen → Konto → Einrichten*. Die App findet die Anlage im lokalen Netz,
  Nebenstelle und Einrichtungs-PIN genügen. Oder unter *Nebenstellen* eine Einladung per
  E-Mail schicken – der Link darin öffnet die App. Details: [Desktop-App](desktop-app.md).
- **Handy**: Mobil-App installieren und den QR-Code der Nebenstelle scannen. Für unterwegs
  muss die Anlage per HTTPS erreichbar sein: [Zugriff von unterwegs](fernzugriff.md),
  [Mobil-App](mobil-app.md).
- **DECT-Telefone** (Gigaset N610/N670/N870 IP PRO): unter *DECT-Telefone* die Basis
  anlegen und deren Provisioning-Adresse eintragen. Schritt für Schritt: [DECT](dect.md).
- **Andere Tisch- und Softphones**: Benutzer = Nebenstelle, Passwort = SIP-Passwort,
  Server = Adresse der Anlage.

Zum Testen \*43 wählen (Echo-Test) und danach einen Kollegen intern anrufen.

## 7. Zusammenarbeit (optional)

- *Kontakte*: zentrales Telefonbuch (auch CSV-Import). Anrufer werden mit Namen angezeigt,
  alle Apps übernehmen es, DECT- und Tischtelefone lesen es per LDAP.
- *Kalender*: gemeinsame Kalender (Betriebsferien, Schichtplan, Feiertage), die in den Apps
  erscheinen.
- *App-Profile*: legen fest, was die Apps zeigen (z. B. ein schlankes Profil für den
  Empfang).
- *Konferenzräume* mit PIN.

## 8. Absichern und überwachen

- *System → Sicherung*: tägliche Sicherungen laufen automatisch. Einmal die
  Konfiguration exportieren und an einem anderen Ort ablegen.
- *System → Diagnose*: Watchdog mit Störungsmeldung per E-Mail.
- *System → Home Assistant*: Störungen und verpasste Anrufe ins Smart Home
  ([Anleitung](home-assistant.md)).
- *System → Aktualisierung*: Updates per Klick oder automatisch nachts.
