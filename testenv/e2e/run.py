#!/usr/bin/env python3
"""End-to-End-Tests der Test-Anlage mit echten SIP-Anrufen (sipp).

Richtet die Anlage über die Verwaltungs-API ein (Nebenstellen 10–12, SIP-Konto beim
Fake-Carrier, Rufabfolge nach außen), schaltet das ausführliche Log ein und spielt dann
Anrufe durch: intern, nach außen, besetzt, von außen und Voicemail. Am Ende liegen
Diagnose-Paket, debug.log, pcap und die sipp-Logs im Ergebnisordner.

Nur Python-Standardbibliothek und sipp. Einstellungen über Umgebungsvariablen (ENV unten).
Aufruf: python3 run.py [Teil eines Testnamens …]   (ohne Angabe: alle)
"""

import http.cookiejar
import json
import os
import shutil
import socket
import subprocess
import sys
import time
import urllib.error
import urllib.request
from pathlib import Path

ENV = {
    'PBX_URL': 'http://pbx:8080',
    'PBX_SIP_HOST': 'pbx',
    'PBX_SIP_PORT': '5060',
    'PBX_ADMIN_PASSWORD': '',
    'CARRIER_HOST': 'carrier',
    'CARRIER_PORT': '5060',
    'CARRIER_PASSWORD': '',
    # Adresse, unter der Anlage und Carrier dieses Testprogramm erreichen (leer = automatisch)
    'E2E_LOCAL_IP': '',
    'E2E_RESULTS': '/results',
    'E2E_SCENARIOS': str(Path(__file__).parent / 'scenarios'),
    'E2E_PORT_BASE': '25070',
    # Optional: RTP-Bereich (z. B. 20000-20099), öffentliche Adresse für echte Telefone im LAN
    # und lokale Netze der Anlage; leer = Einstellung der Anlage bleibt
    'E2E_RTP': '',
    'PBX_EXTERNAL_ADDRESS': '',
    'E2E_LOCAL_NETS': '',
}
cfg = {k: os.environ.get(k, v) for k, v in ENV.items()}
SCEN = Path(cfg['E2E_SCENARIOS'])
RESULTS = Path(cfg['E2E_RESULTS'])
# Je Lauf andere Ports: Asterisk merkt sich nicht erreichbare Kontakte früherer Läufe
PORT = int(cfg['E2E_PORT_BASE']) + (int(time.time()) % 40) * 50

# Testnebenstellen: Nummer → SIP-Passwort (mindestens 12 Zeichen)
EXT = {'10': 'e2e-secret-0010', '11': 'e2e-secret-0011', '12': 'e2e-secret-0012'}
# Rufnummern der Anlage beim Fake-Carrier
MAIN = '+4930555000'
DIRECT = '+4930555001'


def log(msg: str) -> None:
    print(time.strftime('%H:%M:%S'), msg, flush=True)


def local_ip() -> str:
    if cfg['E2E_LOCAL_IP']:
        return cfg['E2E_LOCAL_IP']
    s = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
    try:
        s.connect((socket.gethostbyname(cfg['PBX_SIP_HOST']), int(cfg['PBX_SIP_PORT'])))
        return s.getsockname()[0]
    finally:
        s.close()


# -- Verwaltungs-API ------------------------------------------------------------------


class Api:
    def __init__(self, base: str):
        self.base = base.rstrip('/')
        self.opener = urllib.request.build_opener(urllib.request.HTTPCookieProcessor(http.cookiejar.CookieJar()))

    def call(self, method: str, path: str, body=None, raw=False):
        data = None if body is None else json.dumps(body).encode()
        req = urllib.request.Request(self.base + path, data=data, method=method)
        req.add_header('x-phone4all', '1')
        if data is not None:
            req.add_header('Content-Type', 'application/json')
        try:
            with self.opener.open(req, timeout=30) as r:
                content = r.read()
        except urllib.error.HTTPError as e:
            raise RuntimeError(f'{method} {path}: {e.code} {e.read().decode(errors="replace")}') from None
        return content if raw else json.loads(content or b'null')

    def get(self, path: str, raw=False):
        return self.call('GET', path, raw=raw)

    def wait_ready(self, seconds=300) -> None:
        end = time.time() + seconds
        while time.time() < end:
            try:
                health = json.loads(urllib.request.urlopen(self.base + '/health', timeout=5).read())
                if health.get('checks', {}).get('asterisk') == 'ok':
                    return
            except Exception:
                pass
            time.sleep(2)
        raise RuntimeError('Anlage nicht bereit: ' + self.base)


TRUNK = ''


def seed_system(api: Api) -> bool:
    """SIP-Port, RTP-Bereich und NAT der Anlage setzen; True, wenn Asterisk neu startet"""
    current = api.get('/api/config')['config']['system']
    want: dict = {'sip_port': int(cfg['PBX_SIP_PORT'])}
    if cfg['E2E_RTP']:
        start, end = cfg['E2E_RTP'].split('-')
        want.update(rtp_start=int(start), rtp_end=int(end))
    if cfg['E2E_LOCAL_NETS']:
        want['local_nets'] = cfg['E2E_LOCAL_NETS'].split(',')
        # Ohne öffentliche Adresse gelten auch die üblichen privaten Netze als lokal
        if not cfg['PBX_EXTERNAL_ADDRESS']:
            want['local_nets'] += ['10.0.0.0/8', '172.16.0.0/12', '192.168.0.0/16']
    want['external_address'] = cfg['PBX_EXTERNAL_ADDRESS']
    if all(current.get(k) == v for k, v in want.items()):
        return False
    api.call('PUT', '/api/config/system', want)
    return True


def seed(api: Api) -> None:
    """Testkonfiguration anlegen. Die IDs vergibt die Anlage; vorhandene Einträge (gleiche
    Nummer bzw. gleicher Name) werden aktualisiert, ein zweiter Lauf legt nichts doppelt an."""
    global TRUNK
    conf = api.get('/api/config')['config']

    def upsert(kind: str, item: dict, key: str) -> str:
        old = next((x for x in conf[kind] if x.get(key) == item[key]), None)
        return api.call('POST', f'/api/{kind}', {**item, 'id': old['id']} if old else item)['id']

    ids = {}
    for num, secret in EXT.items():
        ids[num] = upsert('extensions', {
            'number': num, 'name': f'Test {num}', 'secret': secret,
            'permission': 'international', 'ring_seconds': 8,
            'voicemail': {'enabled': True, 'pin': '1234', 'attach': False},
        }, 'number')
    TRUNK = upsert('trunks', {
        'name': 'Fake-Carrier', 'provider': 'generic', 'enabled': True, 'register': True,
        'registrar': cfg['CARRIER_HOST'], 'port': int(cfg['CARRIER_PORT']), 'transport': 'udp',
        'username': 'p4a', 'password': cfg['CARRIER_PASSWORD'], 'numbers': ['030 555000', '030 555001'],
        'number_format': 'e164', 'did_source': 'ruri',
        'inbound_default': {'type': 'extension', 'target': ids['11']},
    }, 'name')
    upsert('inbound', {
        'name': 'Test: Durchwahl 1 → 12', 'number': '030 555001', 'trunk': TRUNK,
        'caller': '', 'name_prefix': '', 'destination': {'type': 'extension', 'target': ids['12']},
    }, 'name')
    upsert('outbound', {'name': 'Test: alles über Fake-Carrier', 'prefixes': [], 'trunks': [TRUNK], 'extensions': []}, 'name')
    try:
        api.call('PUT', '/api/debug', {'verbose': True, 'minutes': 240})
    except RuntimeError as e:
        # Ältere Abbilder (vor 0.13) kennen die Fehlersuche noch nicht
        log(f'Kein ausführliches Log: {e}')


def wait_trunk(api: Api, seconds=60) -> None:
    end = time.time() + seconds
    regs = []
    while time.time() < end:
        regs = api.get('/api/status').get('registrations', [])
        if any(r['trunk'] == TRUNK and r['status'] == 'Registered' for r in regs):
            return
        time.sleep(2)
    raise AssertionError(f'SIP-Konto beim Fake-Carrier nicht angemeldet: {regs}')


# -- sipp -----------------------------------------------------------------------------

_port = PORT


def next_port() -> int:
    global _port
    _port += 2
    return _port


class Sipp:
    """Ein sipp-Lauf; Logs landen in RESULTS/sipp/<name>-*."""

    def __init__(self, name: str, scenario: str, target: str, args: list[str], port: int):
        self.name = name
        out = RESULTS / 'sipp'
        out.mkdir(parents=True, exist_ok=True)
        self.cmd = [
            'sipp', '-sf', str(SCEN / scenario), target, '-i', local_ip(), '-p', str(port), '-m', '1',
            '-nostdin', '-trace_err', '-trace_msg', '-message_file', str(out / f'{name}-messages.log'),
            '-error_file', str(out / f'{name}-errors.log'),
            '-min_rtp_port', str(port + 10000), '-max_rtp_port', str(port + 10001), *args,
        ]
        self.proc: subprocess.Popen | None = None

    def start(self) -> 'Sipp':
        self.proc = subprocess.Popen(self.cmd, stdout=subprocess.DEVNULL, stderr=subprocess.PIPE)
        return self

    def wait(self, timeout: float) -> None:
        assert self.proc
        try:
            _, err = self.proc.communicate(timeout=timeout)
        except subprocess.TimeoutExpired:
            self.proc.kill()
            self.proc.communicate()
            raise AssertionError(f'{self.name}: keine Antwort nach {timeout:.0f} s (siehe sipp/{self.name}-messages.log)') from None
        if self.proc.returncode != 0:
            raise AssertionError(f'{self.name}: sipp endete mit {self.proc.returncode} (siehe sipp/{self.name}-errors.log) {err.decode(errors="replace")[-300:]}')

    def run(self, timeout: float = 30) -> None:
        self.start().wait(timeout)


def pbx() -> str:
    return f"{cfg['PBX_SIP_HOST']}:{cfg['PBX_SIP_PORT']}"


def carrier() -> str:
    return f"{cfg['CARRIER_HOST']}:{cfg['CARRIER_PORT']}"


def register(num: str, port: int, expires=600) -> None:
    name = f'register-{num}' if expires else f'unregister-{num}'
    Sipp(name, 'register.xml', pbx(), ['-aa', '-s', num, '-au', num, '-ap', EXT[num], '-key', 'expires', str(expires)], port).run(15)


class Phone:
    """Angemeldetes Telefon, das den nächsten Anruf annimmt und sich danach abmeldet"""

    def __init__(self, num: str):
        self.num = num
        self.port = next_port()
        register(num, self.port)
        self.sipp = Sipp(f'answer-{num}', 'uas.xml', pbx(), ['-aa'], self.port).start()

    def wait(self, timeout: float = 15) -> None:
        try:
            self.sipp.wait(timeout)
        finally:
            register(self.num, self.port, expires=0)


def call(name: str, src: str | None, dest: str, target: str, hold_ms=2000, timeout=45) -> None:
    """Anruf von Nebenstelle src (None = Testanrufer beim Fake-Carrier) an dest"""
    args = ['-s', dest, '-d', str(hold_ms)]
    args += ['-key', 'from', src, '-au', src, '-ap', EXT[src]] if src else ['-key', 'from', '0301234567']
    Sipp(name, 'uac.xml', target, args, next_port()).run(timeout)


def expect_status(name: str, status: str, fn) -> None:
    """Der Anruf muss mit dieser SIP-Antwort scheitern (z. B. 486 besetzt)"""
    try:
        fn()
    except AssertionError:
        text = (RESULTS / 'sipp' / f'{name}-messages.log').read_text(errors='replace')
        if f'SIP/2.0 {status}' in text:
            return
        raise AssertionError(f'{name}: erwartet {status}, siehe sipp/{name}-messages.log') from None
    raise AssertionError(f'{name}: Anruf hätte mit {status} scheitern müssen')


# -- Tests ----------------------------------------------------------------------------


def t_register(api: Api) -> None:
    port = next_port()
    register('10', port)
    eps = {e['number']: e for e in api.get('/api/status')['endpoints']}
    assert '10' in eps and eps['10']['contacts'], f'Nebenstelle 10 nicht angemeldet: {eps}'
    register('10', port, expires=0)


def t_internal(api: Api) -> None:
    callee = Phone('11')
    call('intern-10-11', '10', '11', pbx())
    callee.wait()


def t_outbound(api: Api) -> None:
    call('extern-10-carrier', '10', '0301234567', pbx())


def t_outbound_busy(api: Api) -> None:
    expect_status('extern-besetzt', '486', lambda: call('extern-besetzt', '10', '0800666123', pbx(), timeout=20))


def t_inbound(api: Api) -> None:
    callee = Phone('11')
    call('von-aussen-an-11', None, MAIN, carrier())
    callee.wait()


def t_inbound_route(api: Api) -> None:
    callee = Phone('12')
    call('von-aussen-durchwahl-12', None, DIRECT, carrier())
    callee.wait()


def t_voicemail(api: Api) -> None:
    # 12 ist nicht angemeldet: die Voicemail nimmt an
    call('voicemail-12', '10', '12', pbx(), hold_ms=3000, timeout=40)


def t_calllist(api: Api) -> None:
    time.sleep(2)
    calls = api.get('/api/calls')
    items = calls if isinstance(calls, list) else calls.get('calls', calls.get('items', []))
    assert len(items) >= 3, f'Anrufliste zu kurz: {str(calls)[:300]}'


def t_diagnose(api: Api) -> None:
    (RESULTS / 'diagnose.tar.gz').write_bytes(api.get('/api/debug/bundle', raw=True))
    st = api.get('/api/debug')
    assert st['verbose'] and st['log_bytes'] > 0, f'ausführliches Log leer: {st}'
    text = api.get('/api/debug/log', raw=True)
    (RESULTS / 'debug.log').write_bytes(text)
    assert b'INVITE sip:' in text, 'debug.log enthält keine SIP-Nachrichten'


TESTS = [
    ('Anmeldung', t_register),
    ('Interner Anruf 10 → 11', t_internal),
    ('Nach außen über den Fake-Carrier', t_outbound),
    ('Nach außen: besetzt', t_outbound_busy),
    ('Von außen an die Hauptnummer → 11', t_inbound),
    ('Von außen an die Durchwahl → 12', t_inbound_route),
    ('Voicemail', t_voicemail),
    ('Anrufliste', t_calllist),
    ('Diagnose-Paket und Log', t_diagnose),
]


def main() -> int:
    if not shutil.which('sipp'):
        print('sipp fehlt (Paket sip-tester)', file=sys.stderr)
        return 2
    RESULTS.mkdir(parents=True, exist_ok=True)
    only = [a.lower() for a in sys.argv[1:]]
    api = Api(cfg['PBX_URL'])
    log(f"Warte auf die Anlage {cfg['PBX_URL']} …")
    api.wait_ready()
    api.call('POST', '/api/login', {'user': 'admin', 'password': cfg['PBX_ADMIN_PASSWORD']})
    if seed_system(api):
        log('SIP-Port/RTP/NAT geändert, Asterisk startet neu …')
        time.sleep(10)
        api.wait_ready()
    seed(api)
    log('Testkonfiguration angelegt, warte auf die Anmeldung beim Fake-Carrier …')
    # Die Anlage übernimmt Änderungen verzögert und lädt Asterisk neu
    time.sleep(6)
    wait_trunk(api)
    capture = False
    try:
        api.call('POST', '/api/debug/capture', {'seconds': 600})
        capture = True
    except RuntimeError as e:
        log(f'Kein Mitschnitt: {e}')
    failed = []
    results = []
    for name, fn in TESTS:
        if only and not any(o in name.lower() for o in only):
            continue
        start = time.time()
        try:
            fn(api)
            results.append({'name': name, 'ok': True, 'seconds': round(time.time() - start, 1)})
            log(f'✓ {name}')
        except Exception as e:  # noqa: BLE001 – jeder Fehler zählt als fehlgeschlagener Test
            failed.append(name)
            results.append({'name': name, 'ok': False, 'error': str(e), 'seconds': round(time.time() - start, 1)})
            log(f'✗ {name}: {e}')
        time.sleep(1)
    if capture:
        api.call('DELETE', '/api/debug/capture')
        time.sleep(2)
        try:
            (RESULTS / 'capture.pcap').write_bytes(api.get('/api/debug/capture', raw=True))
        except RuntimeError as e:
            log(f'pcap nicht abrufbar: {e}')
    (RESULTS / 'results.json').write_text(json.dumps(results, indent=2, ensure_ascii=False))
    log(f'{len(results) - len(failed)} von {len(results)} Tests bestanden. Ergebnisse: {RESULTS}')
    return 1 if failed else 0


if __name__ == '__main__':
    sys.exit(main())
