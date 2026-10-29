# Zugriff von unterwegs (HTTPS)

Damit Mobil-App und Home Assistant die Anlage auch außerhalb des Büros erreichen, braucht
es **eine HTTPS-Adresse** über einen Reverse-Proxy. SIP-Ports im Router zu öffnen ist
dafür nicht nötig und auch nicht ratsam.

```
Handy ──HTTPS / WSS──▶ Reverse-Proxy (z. B. Pangolin) ──HTTP──▶ Anlage :8080
      ──TURN 3478───▶ Reverse-Proxy (TCP+UDP)        ─────────▶ Anlage :3478
```

| Pfad | Wer | Geschützt durch |
| --- | --- | --- |
| `/provision/*`, `/setup/*` | Apps: Einrichtung, Telefonbuch, Kalender | geheimer Einrichtungslink bzw. PIN |
| `/ws` | Mobil-App: SIP über WebSocket | SIP-Passwort, Sperre nach Fehlversuchen |
| `/api/integration/status` | Home Assistant | Zugriffsschlüssel |
| alles andere | Weboberfläche | Anmeldung des Proxys **und** Passwort der Anlage |
| Port 3478 (TCP+UDP) | Sprache der Mobil-App (TURN) | zeitlich begrenzte Zugangsdaten |

Der TURN-Server (coturn) ist in der Anlage eingebaut. Er leitet nur zur SIP-Adresse der
Anlage weiter (nicht ins Internet, nicht zu anderen Diensten des Rechners oder in
Docker-Netze), nur per UDP, und vergibt Zugangsdaten, die nach acht Tagen ablaufen. Ist
unter *System → Allgemein* eine SIP-Adresse eingetragen, ist das genau diese Adresse.

## Mit Pangolin

1. **HTTP-Ressource** anlegen, z. B. `telefon.example.de` → `http://<anlage>:8080`.
   WebSockets reicht Pangolin automatisch durch.
2. In den **Regeln** der Ressource die Pangolin-Anmeldung für diese Pfade umgehen
   (*Bypass Auth*):
   - `/provision/*`
   - `/setup/*`
   - `/ws`
   - `/api/integration/status` (nur für Home Assistant)

   Die Weboberfläche bleibt hinter der Pangolin-Anmeldung.
3. **Raw-Ressource** für Port **3478** mit **TCP und UDP** → `<anlage>:3478` anlegen.
   Dafür müssen Raw-Ressourcen in Pangolin aktiviert und der Port am Pangolin-Server
   (Firewall des VPS) geöffnet sein.
4. In der Weboberfläche der Anlage unter *System → Fernzugriff* die öffentliche Adresse
   `https://telefon.example.de` eintragen. Einrichtungslinks, QR-Codes und Einladungen
   zeigen danach dorthin.
5. Testen: `https://telefon.example.de/health` im Browser des Handys (mobile Daten, nicht
   WLAN) muss `{"status":"ok",…}` liefern – oder die Pangolin-Anmeldung zeigen, wenn
   `/health` nicht freigegeben ist. Danach in der Mobil-App einen Testanruf auf \*43.

## Mit anderen Proxys

Jeder Proxy, der WebSockets durchreicht, funktioniert (Traefik, Caddy, Nginx Proxy
Manager, Cloudflare Tunnel für den HTTP-Teil). Wichtig:

- `X-Forwarded-For` setzen, damit die Sperre nach Fehlanmeldungen die Adresse des
  Handys trifft und nicht den Proxy. Die Anlage glaubt diese Kopfzeile nur Proxys aus
  *System → Sicherheit → Vertrauenswürdige Proxys* (Standard: 127.0.0.1 und die
  Docker-Netze 172.16.0.0/12). Läuft der Proxy bzw. Newt auf einem anderen Rechner,
  dessen Adresse dort eintragen; die Seite schlägt sie vor, sobald sie Anfragen sieht.
- Port 3478 TCP und UDP gesondert weiterleiten (Cloudflare Tunnel kann kein UDP; dort
  den Port direkt im Router freigeben).
- Eine eigene Anmeldung des Proxys für die Pfade aus der Tabelle oben abschalten.

Beispiel für Caddy:

```
telefon.example.de {
  reverse_proxy <anlage>:8080
}
```

## Home Assistant von außen

Home Assistant fragt `/api/integration/status` mit dem Zugriffsschlüssel ab. Steht in der
Integration die HTTPS-Adresse, funktioniert das auch, wenn Home Assistant woanders läuft
als die Anlage. Siehe [Home Assistant](home-assistant.md).
