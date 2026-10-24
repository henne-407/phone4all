# DECT-Telefone (Gigaset N610 IP PRO)

Gigaset-Basen der Reihe **N610, N670 und N870 IP PRO** richten sich per Auto-Provisioning
selbst ein: Die Basis holt von der Anlage eine Datei mit dem SIP-Zugang und einem Konto je
Mobilteil und später jede Änderung. Jedes Mobilteil ist eine eigene Nebenstelle.

Erprobt mit einer N610 IP PRO und handelsüblichen Mobilteilen (Gigaset AE690H, E630) über
GAP. Gigaset-Pro-Mobilteile (S700H PRO, R700H PRO …) können mehr, z. B. das
LDAP-Telefonbuch direkt durchsuchen.

## Einrichten

**Vorbereitung:** Basis ans Netz anschließen und ihre IP-Adresse herausfinden (im Router
oder mit der *Gigaset IP PRO*-Suche). Für jedes Mobilteil unter *Nebenstellen* eine
Nebenstelle anlegen.

1. In der Weboberfläche der Anlage *DECT-Telefone → DECT-Basis anlegen*: Name und
   **MAC-Adresse** der Basis (Typenschild auf der Unterseite).
2. Den Mobilteilen der Reihe nach Nebenstellen zuordnen. Die Mobilteile später am besten
   in dieser Reihenfolge anmelden, dann passt die Zuordnung. Optional setzt die Anlage
   beim nächsten Abruf auch ein neues Passwort für die Weboberfläche der Basis.
3. **Einrichten** öffnen. Dort stehen der Provisioning-Server
   (`http://<anlage>:8080/dect/<schlüssel>/`) und die PIN für die Anmeldung der Mobilteile.
4. In der Weboberfläche der Basis (`http://<ip-der-basis>`) unter *Einstellungen →
   System → Provisioning und Konfiguration* die Adresse als Provisioning-Server
   eintragen, speichern und die Auto-Konfiguration starten (oder die Basis neu starten).
   Anmeldung an der Basis mit `admin`, ab Werk Passwort `admin`. Die Basis lädt dann
   `<mac>.xml`.
5. **Mobilteile anmelden:** Nach jedem Abruf ist die Anmeldung 15 Minuten lang offen. Am
   Mobilteil *Menü → Einstellungen → Anmeldung → Mobilteil anmelden*, die PIN aus Schritt 3
   eingeben.
6. Testen: vom Mobilteil \*43 (Echo-Test) und eine andere Nebenstelle anrufen.

Wer den Provisioning-Server nicht eintragen möchte, lädt unter *Einrichten* die Datei
herunter und spielt sie in der Basis unter *Provisioning und Konfiguration* von Hand ein.

Änderungen (neue Nebenstelle, anderes Passwort) holt sich die Basis beim nächsten
Abruf. Ein neuer Link mit neuer PIN macht den alten ungültig.

## Was über die Anlage funktioniert

- Anrufernamen aus dem zentralen Telefonbuch
- Halten, Makeln, Übergeben (R-Taste oder Auflegen), Anklopfen
- Nachrichtenanzeige bei neuer Voicemail, Abhören mit \*97
- HD-Sprache (G.722)
- \*8 Heranholen, \*76 Nicht stören, \*21 Rufumleitung

Besetztlampen (BLF) kennt die N610 nicht.

## Telefonbuch per LDAP

Unter *Kontakte → Telefonbuch für DECT- und Tischtelefone* einschalten. *Einrichten* bei
der DECT-Basis zeigt dann auch die LDAP-Werte zum Kopieren, die in der Basis unter
*Einstellungen → Online-Telefonbücher → Firmen-Telefonbuch (LDAP)* eingetragen werden.
Die Werte im Einzelnen stehen in der
[Referenz](../pbx/README.md#telefonbuch-per-ldap).

Ob ein Mobilteil das LDAP-Telefonbuch durchsuchen kann, hängt vom Modell ab:
Gigaset-Pro-Mobilteile ja, einfache GAP-Mobilteile meist nicht. Anrufernamen zeigen aber
alle an, weil die Anlage den Namen mitschickt.

## Bekannte Eigenheiten

- Einfache GAP-Mobilteile übernehmen die Uhrzeit nicht immer von der Basis. Dann die Zeit
  einmal am Mobilteil selbst setzen.
- Mobilteile, die in der Anlage nicht (mehr) stehen, löscht die Basis nicht; das geht in
  ihrer Weboberfläche.
- Ältere Basen wie N510 IP PRO nutzen ein anderes Dateiformat und werden von Hand
  eingerichtet: Benutzer = Nebenstelle, Passwort = SIP-Passwort, Server = Adresse der
  Anlage.
- Die Basis muss die Anlage unter der Adresse aus *System → Allgemein → Adresse für
  Telefone* erreichen.
