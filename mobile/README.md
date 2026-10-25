# SIP-Telefon für Android und iOS

Die Mobil-App zur [Phone4all-Telefonanlage](../pbx/README.md): telefonieren mit der
eigenen Nebenstelle, das zentrale Telefonbuch und die Kalender der Anlage – im Büro
und unterwegs. Alles läuft über **eine HTTPS-Adresse** (z. B. hinter Pangolin):

| Was | Wie |
| --- | --- |
| Einrichtung, Kontakte, Kalender, App-Profil | HTTPS, `/provision/<token>` wie bei der Desktop-App |
| SIP (Anmeldung, Anrufe) | WebSocket über HTTPS, `wss://…/ws` |
| Sprache | WebRTC, verschlüsselt mit DTLS-SRTP, bei Bedarf über den TURN-Server der Anlage (Port 3478) |

Die Anlage legt dafür zu jeder Nebenstelle ein zweites Gerät `<nummer>-app` an. Anrufe
an die Nebenstelle klingeln am Tischtelefon, in der Desktop-App und auf dem Handy
gleichzeitig.

## Einrichten

1. In der Weboberfläche der Anlage unter *System → Fernzugriff* die öffentliche Adresse
   eintragen (und dort die Schritte für Pangolin befolgen).
2. App installieren und öffnen.
3. Unter *Nebenstellen → Bearbeiten* den **QR-Code** scannen – oder den Link aus der
   Einladungs-E-Mail antippen, oder Adresse, Nebenstelle und Einrichtungs-PIN eingeben.

Die App übernimmt Konto, Telefonbuch, Kalender und das App-Profil (sichtbare Bereiche,
Startseite) und fragt alle zwei Minuten nach Änderungen, solange sie geöffnet ist.

## Funktionen

- Start mit Status, *Nicht stören* (\*76), Voicemail (\*97), Favoriten, letzten Anrufen
  und nächsten Terminen
- Wähltastatur, Rufnummern mit Namen aus dem Telefonbuch
- Gespräch: Stumm, Lautsprecher, Halten, Tasten (DTMF), Weiterleiten
- Kontakte der Anlage und auf Wunsch die des Geräts, Suche, Favoriten
- Kalender der Anlage, eigene Termine in beschreibbaren Kalendern anlegen und löschen
- Anrufverlauf auf dem Gerät
- **Android:** bleibt im Hintergrund erreichbar (Dienst mit dauerhafter Benachrichtigung);
  in den Einstellungen die Akku-Optimierung für die App ausschalten
- **iPhone:** Anrufe kommen an, solange die App geöffnet ist. Anrufe bei geschlossener
  App brauchen VoIP-Push über Apple (Apple-Entwicklerkonto), das ist der nächste Schritt.

## Installieren

GitHub Actions baut bei jeder Änderung (Artefakte) bzw. für jeden Tag `mobile-v*`
(Release):

- **Android:** `SIP-Telefon-<version>.apk` – direkt auf dem Handy installieren
  („Unbekannte Apps installieren“ erlauben).
- **iPhone:** `SIP-Telefon-<version>-unsigniert.ipa` – ohne Apple-Entwicklerkonto z. B.
  mit [Sideloadly](https://sideloadly.io) und der eigenen Apple-ID aufspielen (gilt dann
  7 Tage). Für TestFlight oder den App Store braucht es ein Entwicklerkonto.

## Entwicklung

React Native mit [Expo](https://expo.dev) (SDK 58), TypeScript, Oberfläche mit
[React Native Paper](https://reactnativepaper.com) (Material Design 3), SIP mit
[JsSIP](https://jssip.net), Sprache mit [react-native-webrtc](https://github.com/react-native-webrtc/react-native-webrtc).
Die Ordner `android/` und `ios/` erzeugt `expo prebuild` aus `app.json`; sie gehören
nicht ins Repository.

```sh
cd mobile
npm install
npm test             # Logik (Einrichtung, Rufnummern, Termine)
npm run typecheck
npm run android      # baut und startet die App (Android Studio / SDK nötig)
npm run ios          # nur auf dem Mac mit Xcode
```

Expo Go reicht nicht, weil WebRTC eigenen nativen Code braucht. Der Hintergrunddienst
für Android liegt als lokales Expo-Modul in `modules/call-service`.

Aufbau:

| Datei | Inhalt |
| --- | --- |
| `src/provisioning.ts` | Einrichtungslinks erkennen, Profil, Termine (Schnittstelle der Anlage) |
| `src/phone.ts` | Telefon: JsSIP über WebSocket, WebRTC, Klingeln und Audio-Weg |
| `src/state.tsx` | Zustand der App, Abgleich mit der Anlage, Benachrichtigungen |
| `src/ui/` | Ansichten |
