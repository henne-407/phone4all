# Fake-Carrier: Asterisk als simulierter Telefonanbieter für die Testumgebung
FROM ubuntu:24.04
ENV DEBIAN_FRONTEND=noninteractive
RUN apt-get update \
 && apt-get install -y --no-install-recommends asterisk asterisk-modules asterisk-core-sounds-en-wav tini \
 && rm -rf /var/lib/apt/lists/* /etc/asterisk/*
COPY carrier/*.conf /etc/asterisk/
COPY carrier/entrypoint.sh /entrypoint.sh
EXPOSE 5060/udp 5060/tcp 30000-30099/udp
ENTRYPOINT ["/usr/bin/tini", "--", "sh", "/entrypoint.sh"]
