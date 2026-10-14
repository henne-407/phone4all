"""Funktionsleiste unter der Titelleiste: Anmeldung, Nicht stören, Mikrofon, Lautsprecher."""

from gi.repository import Gtk

from .audio_devices import LevelMeter, ToneTest


def _icon_label(icon, text=""):
    box = Gtk.Box(spacing=6)
    box.append(Gtk.Image(icon_name=icon))
    lbl = Gtk.Label(label=text, max_width_chars=18, ellipsize=3, css_classes=["bar-label"])
    box.append(lbl)
    return box, lbl


def _heading(text):
    return Gtk.Label(label=text, xalign=0, css_classes=["heading", "popover-heading"])


class FunctionBar(Gtk.Box):
    def __init__(self, app):
        super().__init__(spacing=6, css_classes=["function-bar"])
        self.app = app
        self.labels = []

        # -- Anmeldung -----------------------------------------------------
        content = Gtk.Box(spacing=8)
        self.dot = Gtk.Box(css_classes=["status-dot", "off"], valign=Gtk.Align.CENTER)
        content.append(self.dot)
        self.account_label = Gtk.Label(label="", max_width_chars=22, ellipsize=3, css_classes=["bar-label"])
        content.append(self.account_label)
        self.labels.append(self.account_label)
        self.account = Gtk.MenuButton(child=content, css_classes=["flat", "bar-chip"],
                                      tooltip_text="Anmeldung an der Telefonanlage")
        self.account.set_popover(self._account_popover())
        self.append(self.account)

        # -- Nicht stören --------------------------------------------------
        dnd_content, dnd_label = _icon_label("notifications-disabled-symbolic", "Nicht stören")
        self.labels.append(dnd_label)
        self.dnd = Gtk.ToggleButton(child=dnd_content, css_classes=["flat", "bar-chip", "dnd-toggle"],
                                    tooltip_text="Nicht stören: Anrufe abweisen")
        self.dnd_handler = self.dnd.connect("toggled", lambda b: app.set_dnd(b.get_active()))
        self.append(self.dnd)

        self.append(Gtk.Box(hexpand=True))

        # -- Audio ---------------------------------------------------------
        self.tone = ToneTest()
        mic_content, self.mic_label = _icon_label("audio-input-microphone-symbolic")
        spk_content, self.spk_label = _icon_label("audio-speakers-symbolic")
        self.labels += [self.mic_label, self.spk_label]
        self.mic = Gtk.MenuButton(child=mic_content, css_classes=["flat", "bar-chip"], tooltip_text="Mikrofon")
        self.spk = Gtk.MenuButton(child=spk_content, css_classes=["flat", "bar-chip"],
                                  tooltip_text="Lautsprecher und Klingelton")
        self.mic.set_popover(self._device_popover(self._fill_mic))
        self.spk.set_popover(self._device_popover(self._fill_speaker))
        self.append(self.mic)
        self.append(self.spk)
        if not app.audio.available:
            self.mic.set_visible(False)
            self.spk.set_visible(False)
        app.audio.connect("changed", lambda *_: self.update())
        self.update()

    # -- Darstellung -------------------------------------------------------

    def set_compact(self, compact):
        """In schmalen Fenstern nur Symbole zeigen."""
        for lbl in self.labels:
            lbl.set_visible(not compact)

    def update(self):
        text, kind = self.app.reg_state
        for k in ("ok", "busy", "error", "off", "dnd"):
            self.dot.remove_css_class(k)
        self.dot.add_css_class(kind)
        acc = self.app.store.account
        user = acc.get("display_name") or acc.get("user") or "Kein Konto"
        short = {"ok": user, "busy": "Verbinde …", "error": "Fehler", "off": "Abgemeldet"}.get(kind, user)
        if not acc.get("domain"):
            short = "Kein Konto"
        self.account_label.set_label(short)
        self.account.set_tooltip_text(text)
        self.status_title.set_label(text)
        self.status_sub.set_label(f"{acc.get('user', '')}@{acc.get('domain', '')}" if acc.get("domain") else "")
        registered = self.app.store.settings.get("registered", True)
        self.register_button.set_label("Abmelden" if registered else "Anmelden")

        self.dnd.handler_block(self.dnd_handler)
        self.dnd.set_active(self.app.dnd)
        self.dnd.handler_unblock(self.dnd_handler)

        audio = self.app.store.settings.get("audio", {})
        self.mic_label.set_label(self._short(self.app.audio.name_of(audio.get("source", ""), "source")))
        self.spk_label.set_label(self._short(self.app.audio.name_of(audio.get("sink", ""), "sink")))

    @staticmethod
    def _short(name):
        return name.replace("Standard (", "").rstrip(")") if name.startswith("Standard (") else name

    # -- Anmelde-Popover -----------------------------------------------------

    def _account_popover(self):
        box = Gtk.Box(orientation=Gtk.Orientation.VERTICAL, spacing=4, css_classes=["bar-popover"])
        self.status_title = Gtk.Label(xalign=0, wrap=True, max_width_chars=32, css_classes=["heading"])
        self.status_sub = Gtk.Label(xalign=0, css_classes=["dim-label", "caption"])
        box.append(self.status_title)
        box.append(self.status_sub)
        box.append(Gtk.Separator(margin_top=6, margin_bottom=6))
        pop = Gtk.Popover(child=box)

        def item(icon, text, action):
            btn = Gtk.Button(css_classes=["flat"])
            content, lbl = _icon_label(icon, text)
            btn.set_child(content)
            btn.connect("clicked", lambda *_: (pop.popdown(), action()))
            box.append(btn)
            return btn, lbl

        item("view-refresh-symbolic", "Neu anmelden", self.app.restart_engine)
        reg_btn, self.register_button = item(
            "system-log-out-symbolic", "Abmelden",
            lambda: self.app.set_registered(not self.app.store.settings.get("registered", True)))
        self.register_button.set_max_width_chars(-1)
        item("avatar-default-symbolic", "Konto bearbeiten …", lambda: self.app.show_preferences("account"))
        return pop

    # -- Geräte-Popover ------------------------------------------------------

    def _device_popover(self, fill):
        box = Gtk.Box(orientation=Gtk.Orientation.VERTICAL, spacing=2, css_classes=["bar-popover"])
        pop = Gtk.Popover(child=box)
        pop.connect("show", lambda *_: fill(box, pop))
        pop.connect("closed", lambda *_: self._on_closed(box))
        return pop

    def _on_closed(self, box):
        meter = getattr(box, "meter", None)
        if meter:
            meter.stop()
        self.tone.stop()

    def _radio_list(self, box, pop, kind, devices, current, default_label):
        first = None
        entries = [("", default_label)] + [(d.node, d.name) for d in devices]
        for node, name in entries:
            check = Gtk.CheckButton(label=name, active=node == current)
            if first is None:
                first = check
            else:
                check.set_group(first)
            check.connect("toggled", lambda c, n=node: c.get_active() and self.app.set_audio(kind, n))
            box.append(check)

    def _clear(self, box):
        while child := box.get_first_child():
            box.remove(child)

    def _fill_mic(self, box, pop):
        self._clear(box)
        audio = self.app.store.settings.get("audio", {})
        current = audio.get("source", "")
        default = next((d.name for d in self.app.audio.sources if d.default), "")
        box.append(_heading("Mikrofon"))
        self._radio_list(box, pop, "source", self.app.audio.sources, current,
                         f"Systemstandard ({default})" if default else "Systemstandard")
        box.append(Gtk.Separator(margin_top=6, margin_bottom=6))
        box.append(Gtk.Label(label="Pegel – sprich zum Testen", xalign=0, css_classes=["dim-label", "caption"]))
        level = Gtk.LevelBar(min_value=0, max_value=1, css_classes=["mic-level"])
        level.set_margin_top(4)
        level.set_margin_bottom(4)
        box.append(level)
        box.meter = LevelMeter(level.set_value)
        box.meter.start(current)

    def _fill_speaker(self, box, pop):
        self._clear(box)
        audio = self.app.store.settings.get("audio", {})
        default = next((d.name for d in self.app.audio.sinks if d.default), "")
        default_label = f"Systemstandard ({default})" if default else "Systemstandard"
        box.append(_heading("Lautsprecher (Gespräch)"))
        self._radio_list(box, pop, "sink", self.app.audio.sinks, audio.get("sink", ""), default_label)
        test = Gtk.Button(css_classes=["flat"], halign=Gtk.Align.START)
        content, _lbl = _icon_label("media-playback-start-symbolic", "Testton abspielen")
        test.set_child(content)
        test.connect("clicked", lambda *_: self.tone.play(self.app.store.settings.get("audio", {}).get("sink", "")))
        box.append(test)

        box.append(Gtk.Separator(margin_top=6, margin_bottom=6))
        box.append(_heading("Klingeln auf"))
        self._radio_list(box, pop, "alert", self.app.audio.sinks, audio.get("alert", ""),
                         "Wie Lautsprecher")
        test2 = Gtk.Button(css_classes=["flat"], halign=Gtk.Align.START)
        content, _lbl = _icon_label("media-playback-start-symbolic", "Testton abspielen")
        test2.set_child(content)
        test2.connect("clicked", lambda *_: self.tone.play(
            self.app.store.settings.get("audio", {}).get("alert", "")
            or self.app.store.settings.get("audio", {}).get("sink", "")))
        box.append(test2)
