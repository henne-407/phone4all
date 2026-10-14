"""PipeWire-Audiogeräte auflisten, testen und überwachen (über GStreamer)."""

import gi
from gi.repository import GLib, GObject

try:
    gi.require_version("Gst", "1.0")
    from gi.repository import Gst

    Gst.init(None)
except (ImportError, ValueError):
    Gst = None


class Device:
    def __init__(self, node, name, default):
        self.node = node  # PipeWire node.name, wird an baresip übergeben
        self.name = name
        self.default = default


class AudioDevices(GObject.Object):
    """Liste der Mikrofone und Lautsprecher; meldet Änderungen (z. B. Headset eingesteckt)."""

    __gsignals__ = {"changed": (GObject.SignalFlags.RUN_FIRST, None, ())}

    def __init__(self):
        super().__init__()
        self.sources, self.sinks = [], []
        self.monitor = None
        self._pending = 0
        if Gst is None:
            return
        self.monitor = Gst.DeviceMonitor()
        self.monitor.add_filter("Audio/Source", None)
        self.monitor.add_filter("Audio/Sink", None)
        self.monitor.get_bus().add_watch(GLib.PRIORITY_DEFAULT, self._on_bus)
        self.monitor.start()
        self._scan()

    @property
    def available(self):
        return self.monitor is not None

    def _on_bus(self, _bus, message):
        if message.type in (Gst.MessageType.DEVICE_ADDED, Gst.MessageType.DEVICE_REMOVED,
                            Gst.MessageType.DEVICE_CHANGED):
            # Mehrere Meldungen beim Einstecken zusammenfassen
            if not self._pending:
                self._pending = GLib.timeout_add(300, self._rescan)
        return True

    def _rescan(self):
        self._pending = 0
        self._scan()
        self.emit("changed")
        return False

    def _scan(self):
        sources, sinks = [], []
        for dev in self.monitor.get_devices():
            props = dev.get_properties()
            if props is None or not props.has_field("node.name"):
                continue  # nur PipeWire-Geräte, sonst passen die Namen nicht zu baresip
            node = props.get_string("node.name")
            if node.endswith(".monitor"):
                continue
            default = props.has_field("is-default") and bool(props.get_value("is-default"))
            device = Device(node, dev.get_display_name(), default)
            if dev.has_classes("Audio/Source"):
                sources.append(device)
            elif dev.has_classes("Audio/Sink"):
                sinks.append(device)
        key = lambda d: (not d.default, d.name.lower())  # noqa: E731
        self.sources, self.sinks = sorted(sources, key=key), sorted(sinks, key=key)

    def name_of(self, node, kind):
        devices = self.sources if kind == "source" else self.sinks
        if not node:
            default = next((d for d in devices if d.default), None)
            return f"Standard ({default.name})" if default else "Systemstandard"
        return next((d.name for d in devices if d.node == node), "Nicht verbunden")


class ToneTest:
    """Spielt einen kurzen Testton auf einem Lautsprecher."""

    def __init__(self):
        self.pipeline = None

    def play(self, node):
        if Gst is None:
            return
        self.stop()
        target = f' target-object="{node}"' if node else ""
        self.pipeline = Gst.parse_launch(
            "audiotestsrc wave=sine freq=660 volume=0.25 num-buffers=60 ! "
            f"audioconvert ! audioresample ! pipewiresink{target}")
        self.pipeline.get_bus().add_watch(GLib.PRIORITY_DEFAULT, self._on_bus)
        self.pipeline.set_state(Gst.State.PLAYING)

    def _on_bus(self, _bus, message):
        if message.type in (Gst.MessageType.EOS, Gst.MessageType.ERROR):
            self.stop()
            return False
        return True

    def stop(self):
        if self.pipeline is not None:
            self.pipeline.set_state(Gst.State.NULL)
            self.pipeline = None


class LevelMeter:
    """Misst den Eingangspegel eines Mikrofons; callback(0.0 … 1.0)."""

    def __init__(self, callback):
        self.callback = callback
        self.pipeline = None

    def start(self, node):
        if Gst is None:
            return
        self.stop()
        target = f' target-object="{node}"' if node else ""
        self.pipeline = Gst.parse_launch(
            f"pipewiresrc{target} ! audioconvert ! level interval=80000000 post-messages=true ! fakesink sync=false")
        self.pipeline.get_bus().add_watch(GLib.PRIORITY_DEFAULT, self._on_bus)
        self.pipeline.set_state(Gst.State.PLAYING)

    def _on_bus(self, _bus, message):
        if self.pipeline is None:
            return False
        if message.type == Gst.MessageType.ELEMENT and message.get_structure().get_name() == "level":
            peaks = message.get_structure().get_value("peak")
            if peaks:
                db = max(peaks)
                # -80 dB … 0 dB auf 0 … 1 abbilden (leises Sprechen liegt um -40 dB)
                self.callback(min(1.0, max(0.0, (db + 80) / 80)))
        return True

    def stop(self):
        if self.pipeline is not None:
            self.pipeline.set_state(Gst.State.NULL)
            self.pipeline = None
            self.callback(0.0)
