# Phone4all Telefonanlage: Asterisk 20 (LTS) aus Ubuntu 24.04 plus Verwaltungsdienst (Node.js)

FROM node:24-slim AS build
WORKDIR /src
COPY package.json package-lock.json ./
RUN npm ci --no-audit --no-fund
COPY . .
RUN npm run typecheck && npm test && npm run build

FROM node:24-slim AS node

# Spracherkennung für „Voicemail als Text“ (whisper.cpp). Läuft auf der Bau-Plattform und
# übersetzt für arm64 mit dem Cross-Compiler – unter Emulation würde das sehr lange dauern.
# Für amd64 zwei Fassungen: mit AVX2 und ohne (z. B. Celeron-Mini-PCs); die Anlage wählt beim Start.
FROM --platform=$BUILDPLATFORM ubuntu:24.04 AS whisper
ARG TARGETARCH
ARG BUILDARCH
ARG WHISPER_VERSION=v1.9.5
ENV DEBIAN_FRONTEND=noninteractive
RUN apt-get update \
 && apt-get install -y --no-install-recommends ca-certificates git cmake make g++ \
      $([ "$TARGETARCH" = arm64 ] && [ "$BUILDARCH" != arm64 ] && echo g++-aarch64-linux-gnu binutils-aarch64-linux-gnu) \
 && rm -rf /var/lib/apt/lists/*
RUN git clone --depth 1 -b "$WHISPER_VERSION" https://github.com/ggml-org/whisper.cpp /src
WORKDIR /src
RUN set -e; mkdir /out; \
    build() { \
      name=$1; shift; \
      cmake -B "build-$name" -DCMAKE_BUILD_TYPE=Release -DBUILD_SHARED_LIBS=OFF -DGGML_NATIVE=OFF -DGGML_OPENMP=OFF -DGGML_CCACHE=OFF \
        -DWHISPER_BUILD_TESTS=OFF -DWHISPER_BUILD_SERVER=OFF "-DCMAKE_EXE_LINKER_FLAGS=-static-libstdc++ -static-libgcc" "$@"; \
      cmake --build "build-$name" -j"$(nproc)" --target whisper-cli; \
      cp "build-$name/bin/whisper-cli" "/out/$name"; \
    }; \
    if [ "$TARGETARCH" = arm64 ] && [ "$BUILDARCH" != arm64 ]; then \
      build whisper-cli -DCMAKE_SYSTEM_NAME=Linux -DCMAKE_SYSTEM_PROCESSOR=aarch64 \
        -DCMAKE_C_COMPILER=aarch64-linux-gnu-gcc -DCMAKE_CXX_COMPILER=aarch64-linux-gnu-g++; \
      aarch64-linux-gnu-strip /out/*; \
    elif [ "$TARGETARCH" = amd64 ] && [ "$BUILDARCH" = amd64 ]; then \
      build whisper-cli -DGGML_AVX=OFF -DGGML_AVX2=OFF -DGGML_BMI2=OFF -DGGML_FMA=OFF -DGGML_F16C=OFF; \
      build whisper-cli-avx2; \
      strip /out/*; \
    elif [ "$TARGETARCH" = "$BUILDARCH" ]; then \
      build whisper-cli; \
      strip /out/*; \
    else \
      echo "whisper.cpp für $TARGETARCH auf $BUILDARCH wird nicht übersetzt (Voicemail als Text dann nur über eine Schnittstelle)"; \
    fi

FROM ubuntu:24.04
ARG PBX_VERSION=dev
ENV DEBIAN_FRONTEND=noninteractive
RUN apt-get update \
 && apt-get install -y --no-install-recommends \
      asterisk asterisk-modules asterisk-prompt-de asterisk-core-sounds-en-wav asterisk-moh-opsound-wav \
      coturn msmtp ca-certificates openssl tzdata tini \
 && rm -rf /var/lib/apt/lists/* /etc/asterisk/* /usr/share/doc/*
COPY --from=node /usr/local/bin/node /usr/local/bin/node
COPY --from=whisper /out/ /opt/whisper/
WORKDIR /opt/phone4all
COPY --from=build /src/dist ./
ENV PBX_DATA=/data \
    PBX_ASTERISK_USER=asterisk \
    PBX_VERSION=${PBX_VERSION} \
    TZ=Europe/Berlin \
    NODE_ENV=production
VOLUME /data
# Weboberfläche (auch SIP über WebSocket für die Mobil-App), dieselbe per HTTPS, SIP, SIP-TLS, Suche der App im LAN,
# Telefonbuch (LDAP), TURN für die Mobil-App, Sprache (RTP)
EXPOSE 8080/tcp 8443/tcp 5060/udp 5060/tcp 5061/tcp 15060/udp 389/tcp 3478/tcp 3478/udp 10000-10999/udp
HEALTHCHECK --interval=60s --timeout=5s --start-period=60s CMD node -e "fetch('http://127.0.0.1:'+(process.env.PBX_HTTP_PORT||8080)+'/health').then(r=>process.exit(r.ok?0:1),()=>process.exit(1))"
LABEL org.opencontainers.image.title="Phone4all PBX" \
      org.opencontainers.image.description="Telefonanlage mit Weboberfläche und automatischer Einrichtung der SIP-Telefon-App" \
      org.opencontainers.image.source="https://github.com/henne-407/phone4all" \
      org.opencontainers.image.licenses="MIT"
ENTRYPOINT ["/usr/bin/tini", "--"]
CMD ["node", "/opt/phone4all/server.mjs"]
