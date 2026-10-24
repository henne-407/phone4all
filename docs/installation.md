# Installation der Telefonanlage

Die Anlage ist ein einziges Docker-Image (`ghcr.io/henne-407/phone4all-pbx`, für amd64 und
arm64). Darin laufen Asterisk 20 (LTS) und ein Verwaltungsdienst mit der Weboberfläche,
der Asterisk startet, überwacht und konfiguriert. Alle Daten liegen in einem Ordner
`data/`.

**Voraussetzungen:** Linux mit Docker (amd64 oder arm64). Ein kleiner Server, eine VM mit
1–2 GB RAM oder ein Raspberry Pi 4/5 reichen für ein Büro.
Eine feste IP-Adresse im lokalen Netz ist sehr zu empfehlen, damit Telefone die Anlage
immer finden.

## Variante A: Installationsskript (Debian/Ubuntu)

Für einen frischen Server oder eine VM:

```sh
curl -fsSL https://raw.githubusercontent.com/henne-407/phone4all/main/pbx/install.sh | sudo sh
```

Das Skript installiert Docker (falls nötig), legt `/opt/phone4all` an (anderer Ordner:
`PHONE4ALL_DIR=/pfad`), startet die Anlage und zeigt Adresse und erstes Passwort der
Weboberfläche (Benutzer `admin`).

## Variante B: Docker Compose

Mit vorhandenem Docker:

```sh
mkdir phone4all && cd phone4all
curl -fsSLO https://raw.githubusercontent.com/henne-407/phone4all/main/pbx/docker-compose.yml
docker compose up -d
docker compose logs pbx   # erstes Passwort
```

Die [docker-compose.yml](../pbx/docker-compose.yml) im Überblick:

```yaml
services:
  pbx:
    image: ghcr.io/henne-407/phone4all-pbx:latest
    container_name: phone4all-pbx
    network_mode: host          # SIP und Sprache vertragen kein Docker-NAT
    restart: unless-stopped
    volumes:
      - ./data:/data
      - /var/run/docker.sock:/var/run/docker.sock   # für Updates aus der Weboberfläche
    environment:
      TZ: Europe/Berlin
      # PBX_HTTP_PORT: 8080          anderer Port für die Weboberfläche
      # PBX_ADMIN_PASSWORD: …        setzt das Passwort bei jedem Start
```

`network_mode: host` ist Absicht: SIP und RTP hinter Docker-NAT führen zu einseitiger
oder fehlender Sprache. Läuft auf dem Rechner schon etwas auf Port 8080, `PBX_HTTP_PORT`
setzen.

## Variante C: TrueNAS SCALE

Als Custom App unter *Apps → Discover Apps → ⋮ → Install via YAML*:

```yaml
services:
  pbx:
    image: ghcr.io/henne-407/phone4all-pbx:latest
    container_name: phone4all-pbx
    network_mode: host
    restart: unless-stopped
    volumes:
      - /mnt/<pool>/apps/phone4all/data:/data
      - /var/run/docker.sock:/var/run/docker.sock
    environment:
      TZ: Europe/Berlin
```

- Den Tag (`:latest`) fest eintragen, TrueNAS liest keine `.env`-Datei.
- Für `/data` einen absoluten Pfad auf ein eigenes Dataset angeben, damit Sicherungen und
  Snapshots greifen.
- Die Weboberfläche von TrueNAS belegt Port 80/443, nicht 8080 – das passt. Ist 8080
  belegt, `PBX_HTTP_PORT` setzen.
- Updates gehen auf beiden Wegen: über den Knopf in der Weboberfläche der Anlage (dafür
  der Docker-Socket) oder über *Update* in der App-Übersicht von TrueNAS. Zeigt TrueNAS
  trotz neuer Version „Up to date“, in *System → Shell*
  `sudo docker pull ghcr.io/henne-407/phone4all-pbx:latest` ausführen und die App
  stoppen und wieder starten.

## Variante D: VM (Proxmox, VMware, Hyper-V, VirtualBox)

Eine kleine Debian- oder Ubuntu-VM (1 vCPU, 1 GB RAM, 8 GB Platte) mit **Netzwerk-Bridge**
(nicht NAT) anlegen, damit die Anlage eine eigene Adresse im Netz bekommt. Dann
Variante A. Unter Proxmox geht auch ein LXC-Container mit aktiviertem *Nesting*.

## Variante E: Raspberry Pi 4/5

Raspberry Pi OS Lite (64 Bit) installieren, dann Variante A. Das Image gibt es für arm64.
Für die Daten ist eine SSD am USB-Port besser als die SD-Karte.

## Ports und Firewall

| Port | Zweck |
| --- | --- |
| 8080/tcp | Weboberfläche, Einrichtung der Apps, SIP über WebSocket (`/ws`) für die Mobil-App |
| 5060/udp+tcp, 5061/tcp | SIP, SIP über TLS |
| 10000–10999/udp | Sprache (RTP) |
| 15060/udp | Suche der Desktop-App im lokalen Netz |
| 3478/udp+tcp | TURN-Server für die Mobil-App unterwegs |
| 389/tcp | Telefonbuch per LDAP (nur wenn eingeschaltet) |

Für Anrufe von außen ist bei den gängigen Anbietern **keine Portfreigabe** im Router nötig:
Die Anlage meldet sich selbst beim Anbieter an. Für Handys unterwegs reicht HTTPS über
einen Reverse-Proxy, siehe [Zugriff von unterwegs](fernzugriff.md). SIP-Port 5060 sollte
nicht offen ins Internet zeigen.

## Updates

Neue Versionen erscheinen als Release `pbx-v…` und als Image-Tag. Die Weboberfläche zeigt
sie unter *System → Aktualisierung* an:

- **Kanal** *Stabil* oder *Beta*.
- Update **per Klick** oder **automatisch installieren** zu einer festen
  Uhrzeit, wenn gerade niemand telefoniert.
- Vor jedem Update sichert die Anlage ihre Konfiguration.

Gibt es eine neue Version, erscheint zusätzlich unten im Menü ein Hinweis „Update auf …“.
Für Updates aus der Weboberfläche braucht der Container den Docker-Socket. Ohne ihn:

```sh
cd /opt/phone4all        # bzw. der Ordner mit der docker-compose.yml
docker compose pull && docker compose up -d
```

## Sicherung und Umzug

- *System → Sicherung*: täglich automatisch, außerdem vor jedem Import, jeder
  Wiederherstellung und jedem Update; die letzten 30 bleiben.
- **Exportieren** erzeugt eine Datei mit der ganzen Einrichtung, wahlweise mit
  Passwörtern und Ansagen. **Importieren** ersetzt die Einrichtung (vorher wird gesichert).
- Umzug auf neue Hardware: den Ordner `data/` kopieren und dort `docker compose up -d` –
  oder exportieren und auf der neuen Anlage importieren.

Was in `data/` liegt, steht in der [Referenz](../pbx/README.md#daten).

## Passwort vergessen

In der `docker-compose.yml` unter `environment` die Zeile
`PBX_ADMIN_PASSWORD: neues-passwort` eintragen und `docker compose up -d` ausführen. Die
Anlage übernimmt das Passwort beim Start. Danach die Zeile wieder entfernen und das
Passwort in der Weboberfläche unter *System → Zugang* ändern.
