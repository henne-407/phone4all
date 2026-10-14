"""Steuerung einer baresip-Instanz als SIP-/Audio-Engine.

baresip wird als Kindprozess mit einer eigenen, generierten Konfiguration
gestartet und über das ctrl_tcp-Modul (JSON in Netstrings) gesteuert.
"""

import json
import os
import shutil
import socket

from gi.repository import Gio, GLib, GObject

MODULE_DIRS = [
    "/usr/lib64/baresip/modules",
    "/usr/lib/baresip/modules",
    "/usr/local/lib64/baresip/modules",
    "/usr/local/lib/baresip/modules",
    "/usr/lib/x86_64-linux-gnu/baresip/modules",
]
AUDIO_DIRS = ["/usr/share/baresip", "/usr/local/share/baresip"]

CODECS = ["opus", "g722", "g711"]
AUDIO_DRIVERS = ["pipewire", "pulse", "alsa"]
OPTIONAL_MODULES = ["auconv", "auresamp", "stun", "turn", "ice", "srtp", "dtls_srtp"]
APP_MODULES = ["account", "menu", "ctrl_tcp"]


def find_binary():
    return os.environ.get("SIP_TELEFON_BARESIP") or shutil.which("baresip")


def find_module_dir():
    env = os.environ.get("SIP_TELEFON_MODULE_PATH")
    candidates = [env] if env else MODULE_DIRS
    for d in candidates:
        if d and os.path.isfile(os.path.join(d, "ctrl_tcp.so")):
            return d
    return None


def find_audio_dir():
    env = os.environ.get("SIP_TELEFON_AUDIO_PATH")
    for d in ([env] if env else []) + AUDIO_DIRS:
        if d and os.path.isfile(os.path.join(d, "ring.wav")):
            return d
    return None


def _quote(value):
    return '"' + value.replace('"', "") + '"'


def account_line(acc, password):
    """Erzeugt eine Zeile für die baresip-accounts-Datei."""
    user = acc.get("user", "").strip()
    domain = acc.get("domain", "").strip()
    if not user or not domain:
        return None

    transport = acc.get("transport", "udp")
    port = int(acc.get("port") or 0)
    hostport = f"{domain}:{port}" if port else domain
    uri = f"sip:{user}@{hostport}"
    if transport != "udp":
        uri += f";transport={transport}"

    name = acc.get("display_name", "").strip()
    line = f"{_quote(name)} <{uri}>" if name else f"<{uri}>"

    params = [f"auth_user={acc.get('auth_user', '').strip() or user}"]
    if password:
        params.append(f"auth_pass={password}")
    outbound = acc.get("outbound", "").strip()
    if outbound:
        if not outbound.startswith("sip:"):
            outbound = "sip:" + outbound
        params.append(f"outbound={_quote(outbound)}")
    stun = acc.get("stun", "").strip()
    if stun:
        if not stun.startswith("stun:"):
            stun = "stun:" + stun
        params.append(f"stunserver={stun}")
        params.append("medianat=stun")
    mediaenc = acc.get("mediaenc", "")
    if mediaenc:
        params.append(f"mediaenc={mediaenc}")
    params.append(f"regint={int(acc.get('regint') or 600)}")
    params.append("answermode=manual")
    return line + ";" + ";".join(params)


class Baresip(GObject.Object):
    """Startet baresip und reicht dessen Events als GObject-Signale weiter."""

    __gsignals__ = {
        "event": (GObject.SignalFlags.RUN_FIRST, None, (object,)),
        # "starting", "running", "stopped", "error"
        "engine-state": (GObject.SignalFlags.RUN_FIRST, None, (str, str)),
    }

    def __init__(self, runtime_dir, log_path):
        super().__init__()
        self.runtime_dir = runtime_dir
        self.log_path = log_path
        self.proc = None
        self.sock = None
        self.watch_id = 0
        self.buffer = b""
        self.token = 0
        self.callbacks = {}
        self.port = 0
        self.driver = "pipewire"
        self.pending_start = None
        self.stopping = False

    # -- Prozess -----------------------------------------------------------

    def _free_port(self):
        with socket.socket() as s:
            s.bind(("127.0.0.1", 0))
            return s.getsockname()[1]

    def _write_config(self, acc_line, local_port, audio):
        module_dir = find_module_dir()
        available = set(f[:-3] for f in os.listdir(module_dir) if f.endswith(".so"))
        missing = [m for m in APP_MODULES if m not in available]
        if missing:
            raise RuntimeError("baresip-Module fehlen: " + ", ".join(missing))
        driver = next((d for d in AUDIO_DRIVERS if d in available), None)
        if driver is None:
            raise RuntimeError(
                "Kein Audio-Modul gefunden (z. B. Paket baresip-pipewire installieren)"
            )
        self.driver = driver
        audio = audio or {}
        if driver == "alsa":  # ALSA kennt die PipeWire-Gerätenamen nicht
            player = source = alert = "default"
        else:
            player, source = audio.get("sink", ""), audio.get("source", "")
            alert = audio.get("alert") or player

        lines = [
            "poll_method epoll",
            f"module_path {module_dir}",
            f"audio_player {driver},{player}",
            f"audio_source {driver},{source}",
            f"audio_alert {driver},{alert}",
            "call_max_calls 4",
            f"ctrl_tcp_listen 127.0.0.1:{self.port}",
        ]
        if local_port:
            lines.append(f"sip_listen 0.0.0.0:{local_port}")
        audio_dir = find_audio_dir()
        if audio_dir:
            lines.append(f"audio_path {audio_dir}")
        for m in CODECS + [driver] + OPTIONAL_MODULES:
            if m in available:
                lines.append(f"module {m}.so")
        for m in APP_MODULES:
            lines.append(f"module_app {m}.so")

        os.makedirs(self.runtime_dir, mode=0o700, exist_ok=True)
        os.chmod(self.runtime_dir, 0o700)
        with open(os.path.join(self.runtime_dir, "config"), "w") as f:
            f.write("\n".join(lines) + "\n")
        acc_path = os.path.join(self.runtime_dir, "accounts")
        fd = os.open(acc_path, os.O_WRONLY | os.O_CREAT | os.O_TRUNC, 0o600)
        with os.fdopen(fd, "w") as f:
            if acc_line:
                f.write(acc_line + "\n")
        # baresip legt sonst eine Kontaktdatei mit Beispielen an
        open(os.path.join(self.runtime_dir, "contacts"), "a").close()

    def start(self, acc_line, local_port=0, audio=None):
        """Startet baresip (neu) mit der angegebenen Kontozeile."""
        if self.proc is not None:
            # Erst nach dem Beenden der alten Instanz neu starten
            self.pending_start = (acc_line, local_port, audio)
            self.stop()
            return

        binary = find_binary()
        if not binary or not find_module_dir():
            self.emit(
                "engine-state",
                "error",
                "baresip ist nicht installiert (sudo dnf install baresip baresip-pipewire)",
            )
            return
        try:
            self.port = self._free_port()
            self._write_config(acc_line, local_port, audio)
        except (OSError, RuntimeError) as e:
            self.emit("engine-state", "error", str(e))
            return

        os.makedirs(os.path.dirname(self.log_path), exist_ok=True)
        launcher = Gio.SubprocessLauncher.new(Gio.SubprocessFlags.STDERR_MERGE)
        launcher.set_stdout_file_path(self.log_path)
        try:
            self.proc = launcher.spawnv([binary, "-f", self.runtime_dir])
        except GLib.Error as e:
            self.emit("engine-state", "error", e.message)
            return
        self.stopping = False
        self.proc.wait_async(None, self._on_exit, self.proc)
        self.emit("engine-state", "starting", "")
        self._connect_attempts = 0
        GLib.timeout_add(150, self._try_connect)

    def stop(self):
        if self.proc is None:
            return
        self.stopping = True
        if self.sock is not None:
            self.send("quit")
            proc = self.proc
            GLib.timeout_add(1500, lambda: proc.force_exit() or False)
        else:
            self.proc.force_exit()

    def stop_sync(self):
        """Beim Programmende: baresip sauber abmelden lassen und warten."""
        if self.proc is None:
            return
        self.pending_start = None
        self.stopping = True
        if self.sock is not None:
            try:
                self.sock.setblocking(True)
                self._raw_send({"command": "quit", "params": "", "token": "quit"})
            except OSError:
                pass
        # _on_exit setzt self.proc auf None, sobald baresip beendet ist
        for _ in range(30):
            if self.proc is None:
                return
            GLib.usleep(50_000)
            GLib.MainContext.default().iteration(False)
        if self.proc is not None:
            self.proc.force_exit()

    def _on_exit(self, proc, result, _data):
        if proc is not self.proc:
            return
        self._close_socket()
        self.proc = None
        if self.pending_start is not None:
            args, self.pending_start = self.pending_start, None
            self.start(*args)
        elif self.stopping:
            self.emit("engine-state", "stopped", "")
        else:
            self.emit(
                "engine-state", "error", f"baresip wurde unerwartet beendet (siehe {self.log_path})"
            )

    # -- Steuerverbindung --------------------------------------------------

    def _try_connect(self):
        if self.proc is None:
            return False
        try:
            sock = socket.create_connection(("127.0.0.1", self.port), timeout=0.2)
        except OSError:
            self._connect_attempts += 1
            if self._connect_attempts > 60:
                self.emit("engine-state", "error", "Keine Verbindung zu baresip")
                return False
            return True
        sock.setblocking(False)
        self.sock = sock
        self.buffer = b""
        self.watch_id = GLib.io_add_watch(
            sock.fileno(),
            GLib.PRIORITY_DEFAULT,
            GLib.IO_IN | GLib.IO_HUP | GLib.IO_ERR,
            self._on_readable,
        )
        self.emit("engine-state", "running", "")
        return False

    def _close_socket(self):
        if self.watch_id:
            GLib.source_remove(self.watch_id)
            self.watch_id = 0
        if self.sock is not None:
            self.sock.close()
            self.sock = None
        self.callbacks.clear()

    def _on_readable(self, _fd, condition):
        try:
            data = self.sock.recv(65536)
        except BlockingIOError:
            return True
        except OSError:
            data = b""
        if not data:
            self.watch_id = 0
            self._close_socket()
            return False
        self.buffer += data
        self._parse()
        return True

    def _parse(self):
        while True:
            colon = self.buffer.find(b":")
            if colon < 0:
                return
            try:
                length = int(self.buffer[:colon])
            except ValueError:
                self.buffer = b""
                return
            end = colon + 1 + length
            if len(self.buffer) < end + 1:
                return
            payload = self.buffer[colon + 1 : end]
            self.buffer = self.buffer[end + 1 :]
            try:
                msg = json.loads(payload)
            except ValueError:
                continue
            if msg.get("event"):
                self.emit("event", msg)
            elif msg.get("response"):
                cb = self.callbacks.pop(msg.get("token"), None)
                if cb:
                    cb(bool(msg.get("ok")), msg.get("data", ""))

    def _raw_send(self, obj):
        payload = json.dumps(obj).encode()
        self.sock.sendall(str(len(payload)).encode() + b":" + payload + b",")

    def send(self, command, params="", callback=None):
        if self.sock is None:
            if callback:
                callback(False, "SIP-Engine läuft nicht")
            return
        self.token += 1
        token = str(self.token)
        if callback:
            self.callbacks[token] = callback
        try:
            self.sock.setblocking(True)
            self._raw_send({"command": command, "params": params, "token": token})
            self.sock.setblocking(False)
        except OSError as e:
            self.callbacks.pop(token, None)
            if callback:
                callback(False, str(e))

    def set_device(self, kind, node):
        """Mikrofon ("source") oder Lautsprecher ("sink") sofort umschalten, auch im Gespräch."""
        if getattr(self, "driver", "pipewire") == "alsa":
            return
        command = "ausrc" if kind == "source" else "auplay"
        self.send(command, f"{self.driver},{node}")

    def call_command(self, call_id, command, params="", callback=None):
        """Führt einen Befehl für einen bestimmten Anruf aus."""
        if call_id:
            self.send("callfind", call_id)
        self.send(command, params, callback)

    @property
    def running(self):
        return self.sock is not None
