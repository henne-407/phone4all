"""Klingeltöne: synthetisch erzeugt (kein Download, keine Lizenzfragen) oder eigene Datei.

baresip spielt Töne aus seinem audio_path und wiederholt sie in einer Schleife.
Wir legen deshalb ein eigenes Sound-Verzeichnis an: die Originaldateien von
baresip als Verweise, dazu unser Klingelton und ein deutsches Freizeichen.
"""

import array
import math
import os
import random
import wave

from gi.repository import GLib

from .store import DATA_DIR

CACHE_DIR = os.path.join(DATA_DIR, "ringtones")
RATE = 32000
PEAK = 0.55  # etwa -5 dBFS, damit es nicht übersteuert

RINGTONES = [
    ("marimba", "Marimba", "Sanfte, aufsteigende Melodie"),
    ("chime", "Glocken", "Warme Glockenklänge"),
    ("classic", "Klassisch", "Doppelklingeln wie ein altes Telefon"),
    ("pulse", "Dezent", "Leiser, kurzer Doppelton"),
    ("baresip", "baresip-Standard", "Der ursprüngliche Klingelton"),
    ("custom", "Eigene Datei", "Eine eigene Audiodatei (WAV, MP3, OGG …)"),
]


def _render(length, voices):
    """voices: [(start_s, freq, duration_s, partials[(ratio, amp)], decay_s, attack_s, gain)]"""
    n = int(length * RATE)
    buf = [0.0] * n
    for start, freq, dur, partials, decay, attack, gain in voices:
        s0 = int(start * RATE)
        count = min(int(dur * RATE), n - s0)
        fade = int(0.08 * RATE)  # sanft ausblenden statt abschneiden (sonst knackt es)
        for ratio, amp in partials:
            w = 2 * math.pi * freq * ratio / RATE
            # Höhere Teiltöne klingen schneller ab (wie bei echten Instrumenten)
            d = decay / (1 + (ratio - 1) * 0.6)
            for i in range(count):
                t = i / RATE
                env = (min(1.0, t / attack) if attack else 1.0) * math.exp(-t / d)
                if count - i < fade:
                    env *= (count - i) / fade
                buf[s0 + i] += gain * amp * env * math.sin(w * i)
    return buf


def _marimba():
    # C-Dur-Arpeggio, zweimal, dann Pause – angenehm, aber gut hörbar
    partials = [(1, 1.0), (4.0, 0.25), (10.0, 0.06)]
    notes = [523.25, 659.25, 783.99, 1046.5]
    voices = []
    for rep in range(2):
        for k, f in enumerate(notes):
            voices.append((rep * 0.9 + k * 0.16, f, 1.2, partials, 0.35, 0.004, 0.8))
    return _render(3.4, voices)


def _chime():
    # Glockenartige, leicht unharmonische Teiltöne
    partials = [(1, 1.0), (2.0, 0.5), (2.76, 0.35), (5.4, 0.15), (8.9, 0.06)]
    voices = [(0.0, 659.25, 2.5, partials, 0.9, 0.003, 0.6),
              (0.45, 880.0, 2.5, partials, 0.9, 0.003, 0.5),
              (0.9, 739.99, 2.2, partials, 0.9, 0.003, 0.5)]
    return _render(3.6, voices)


def _classic():
    # Zwei kurze Klingelstöße: Glockenton mit schnellem Klöppel (ca. 22 Hz)
    n = int(3.0 * RATE)
    buf = [0.0] * n
    for burst in (0.0, 0.55):
        s0, count = int(burst * RATE), int(0.4 * RATE)
        for i in range(count):
            t = i / RATE
            hammer = 0.6 + 0.4 * math.sin(2 * math.pi * 22 * t)
            fade = min(1.0, t / 0.01, (0.4 - t) / 0.03)
            v = (math.sin(2 * math.pi * 1300 * t) * 0.6 + math.sin(2 * math.pi * 1650 * t) * 0.4
                 + math.sin(2 * math.pi * 2600 * t) * 0.15)
            buf[s0 + i] += v * hammer * fade
    return buf


def _pulse():
    partials = [(1, 1.0), (2.0, 0.15)]
    voices = [(0.0, 880.0, 0.5, partials, 0.12, 0.005, 0.7),
              (0.18, 1174.66, 0.6, partials, 0.15, 0.005, 0.7)]
    return _render(2.6, voices)


def _ringback():
    """Deutsches Freizeichen: 425 Hz, 1 s Ton, 4 s Pause."""
    n = int(5.0 * RATE)
    buf = [0.0] * n
    for i in range(RATE):
        t = i / RATE
        buf[i] = math.sin(2 * math.pi * 425 * t) * min(1.0, t / 0.01, (1.0 - t) / 0.01) * 0.35
    return buf


GENERATORS = {"marimba": _marimba, "chime": _chime, "classic": _classic, "pulse": _pulse}


def _write(path, samples, peak=PEAK):
    top = max((abs(s) for s in samples), default=1.0) or 1.0
    scale = peak / top
    # Hauch von Dither gegen Quantisierungsrauschen bei leisen Ausklängen
    data = array.array("h", (max(-32767, min(32767, int(s * scale * 32767 + random.random() - 0.5)))
                             for s in samples))
    tmp = path + ".tmp"
    with wave.open(tmp, "wb") as w:
        w.setnchannels(1)
        w.setsampwidth(2)
        w.setframerate(RATE)
        w.writeframes(data.tobytes())
    os.replace(tmp, path)


def tone_file(key, cache_dir):
    """Pfad zur WAV-Datei des Klingeltons (wird bei Bedarf erzeugt)."""
    os.makedirs(cache_dir, exist_ok=True)
    path = os.path.join(cache_dir, f"ring-{key}.wav")
    if key in GENERATORS and not os.path.exists(path):
        _write(path, GENERATORS[key]())
    return path


def ringtone_path(key, cache_dir, baresip_dir):
    if key == "custom":
        path = os.path.join(cache_dir, "ring-custom.wav")
        return path if os.path.exists(path) else None
    if key in GENERATORS:
        return tone_file(key, cache_dir)
    return os.path.join(baresip_dir, "ring.wav") if baresip_dir else None


def prepare_sound_dir(target, baresip_dir, ringtone, cache_dir):
    """Sound-Verzeichnis für baresip anlegen und den gewählten Klingelton als ring.wav einsetzen."""
    os.makedirs(target, exist_ok=True)
    if baresip_dir:
        for name in os.listdir(baresip_dir):
            link = os.path.join(target, name)
            if name in ("ring.wav", "ringback.wav"):
                continue
            if not os.path.lexists(link):
                os.symlink(os.path.join(baresip_dir, name), link)

    ring = os.path.join(target, "ring.wav")
    source = None
    if ringtone == "custom":
        custom = os.path.join(cache_dir, "ring-custom.wav")
        source = custom if os.path.exists(custom) else None
    elif ringtone in GENERATORS:
        source = tone_file(ringtone, cache_dir)
    if source is None and baresip_dir:
        source = os.path.join(baresip_dir, "ring.wav")
    if os.path.lexists(ring):
        os.remove(ring)
    if source:
        os.symlink(source, ring)

    ringback = os.path.join(target, "ringback.wav")
    cached = os.path.join(cache_dir, "ringback-de.wav")
    if not os.path.exists(cached):
        _write(cached, _ringback(), peak=0.35)
    if os.path.lexists(ringback):
        os.remove(ringback)
    os.symlink(cached, ringback)
    return target


def convert_custom(path, cache_dir, done):
    """Beliebige Audiodatei per GStreamer in ein WAV für baresip umwandeln (max. 30 s)."""
    from .audio_devices import Gst

    if Gst is None:
        done("GStreamer nicht verfügbar")
        return
    os.makedirs(cache_dir, exist_ok=True)
    out = os.path.join(cache_dir, "ring-custom.wav")
    tmp = out + ".tmp.wav"
    pipeline = Gst.parse_launch(
        "filesrc name=src ! decodebin ! audioconvert ! audioresample ! "
        f"audio/x-raw,format=S16LE,channels=1,rate={RATE} ! wavenc ! filesink name=sink")
    pipeline.get_by_name("src").set_property("location", path)
    pipeline.get_by_name("sink").set_property("location", tmp)

    def finish(error):
        pipeline.set_state(Gst.State.NULL)
        if error:
            if os.path.exists(tmp):
                os.remove(tmp)
            done(error)
        else:
            os.replace(tmp, out)
            done(None)
        return False

    def on_bus(_bus, msg):
        if msg.type == Gst.MessageType.EOS:
            GLib.idle_add(finish, None)
            return False
        if msg.type == Gst.MessageType.ERROR:
            err, _dbg = msg.parse_error()
            GLib.idle_add(finish, f"Datei kann nicht gelesen werden: {err.message}")
            return False
        return True

    pipeline.get_bus().add_watch(GLib.PRIORITY_DEFAULT, on_bus)
    pipeline.set_state(Gst.State.PLAYING)
    # Sehr lange Dateien nach 30 s abschneiden (baresip spielt sie ohnehin in Schleife)
    GLib.timeout_add_seconds(30, lambda: pipeline.send_event(Gst.Event.new_eos()) and False)
