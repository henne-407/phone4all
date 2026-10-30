# Testtelefone: sipp und das Testprogramm (nur Python-Standardbibliothek)
FROM ubuntu:24.04
ENV DEBIAN_FRONTEND=noninteractive
RUN apt-get update \
 && apt-get install -y --no-install-recommends sip-tester python3 tcpdump sngrep ca-certificates \
 && rm -rf /var/lib/apt/lists/*
WORKDIR /e2e
COPY e2e/ ./
ENTRYPOINT ["python3", "/e2e/run.py"]
