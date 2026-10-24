# Phone4all Telefonanlage: Asterisk 20 (LTS) aus Ubuntu 24.04 plus Verwaltungsdienst (Node.js)

FROM node:24-slim AS build
WORKDIR /src
COPY package.json package-lock.json ./
RUN npm ci --no-audit --no-fund
COPY . .
RUN npm run typecheck && npm test && npm run build

FROM node:24-slim AS node

FROM ubuntu:24.04
ARG PBX_VERSION=dev
ENV DEBIAN_FRONTEND=noninteractive
RUN apt-get update \
 && apt-get install -y --no-install-recommends \
      asterisk asterisk-modules asterisk-prompt-de asterisk-core-sounds-en-wav asterisk-moh-opsound-wav \
      coturn msmtp ca-certificates openssl tzdata tini \
 && rm -rf /var/lib/apt/lists/* /etc/asterisk/* /usr/share/doc/*
COPY --from=node /usr/local/bin/node /usr/local/bin/node
WORKDIR /opt/phone4all
COPY --from=build /src/dist ./
ENV PBX_DATA=/data \
    PBX_ASTERISK_USER=asterisk \
    PBX_VERSION=${PBX_VERSION} \
    TZ=Europe/Berlin \
    NODE_ENV=production
VOLUME /data
# Weboberfläche (auch SIP über WebSocket für die Mobil-App), SIP, SIP-TLS, Suche der App im LAN,
# TURN für die Mobil-App, Sprache (RTP)
EXPOSE 8080/tcp 5060/udp 5060/tcp 5061/tcp 15060/udp 3478/tcp 3478/udp 10000-10999/udp
HEALTHCHECK --interval=60s --timeout=5s --start-period=60s CMD node -e "fetch('http://127.0.0.1:'+(process.env.PBX_HTTP_PORT||8080)+'/health').then(r=>process.exit(r.ok?0:1),()=>process.exit(1))"
LABEL org.opencontainers.image.title="Phone4all PBX" \
      org.opencontainers.image.description="Telefonanlage mit Weboberfläche und automatischer Einrichtung der SIP-Telefon-App" \
      org.opencontainers.image.source="https://github.com/henne-407/phone4all" \
      org.opencontainers.image.licenses="MIT"
ENTRYPOINT ["/usr/bin/tini", "--"]
CMD ["node", "/opt/phone4all/server.mjs"]
