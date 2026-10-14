"""Kleines Anruffenster: klingelnder Anruf und – ohne Hauptfenster – das ganze Gespräch.

Beim Klingeln: Annehmen, Ablehnen, Klingelton aus, Weiterleiten.
Im Gespräch: Stumm, Halten, Tastatur, Weiterleiten, Auflegen.
"""

from gi.repository import Adw, Gtk

from .widgets import DialPad, TransferPopover, label, labeled_toggle, round_button

TITLES = {"in": "Eingehender Anruf", "out": "Ausgehender Anruf"}


class IncomingCallWindow(Adw.Window):
    def __init__(self, app, call):
        super().__init__(
            application=app,
            title=TITLES.get(call.direction, "Anruf"),
            default_width=360,
            resizable=False,
        )
        self.app = app
        self.call = call

        box = Gtk.Box(orientation=Gtk.Orientation.VERTICAL, spacing=6, valign=Gtk.Align.CENTER, vexpand=True)
        box.set_margin_start(24)
        box.set_margin_end(24)
        box.set_margin_bottom(24)

        self.caption = label("", "caption-heading", "dim-label")
        box.append(self.caption)
        self.avatar = Adw.Avatar(size=96, text=call.name or "", show_initials=True, halign=Gtk.Align.CENTER)
        self.avatar.set_margin_top(14)
        self.avatar.set_margin_bottom(14)
        box.append(self.avatar)
        box.append(label(call.title, "title-1", max_width_chars=20))
        number = label(call.number, "dim-label")
        number.set_visible(bool(call.name))
        box.append(number)
        if call.company:
            box.append(label(call.company, "dim-label", "caption"))
        self.status = label("", "call-status", "numeric")
        self.status.set_margin_top(4)
        box.append(self.status)
        self.hint = label("Annehmen beendet das laufende Gespräch", "caption", "warning", visible=False)
        self.hint.set_margin_top(6)
        box.append(self.hint)

        # -- Klingeln --------------------------------------------------------
        self.ringing_box = Gtk.Box(orientation=Gtk.Orientation.VERTICAL, spacing=18)
        self.ringing_box.set_margin_top(20)
        extras = Gtk.Box(spacing=8, halign=Gtk.Align.CENTER)
        self.silence = Gtk.Button(css_classes=["pill", "small-pill"],
                                  tooltip_text="Klingelton aus, Anruf läuft weiter")
        self.silence.set_child(self._icon_text("audio-volume-muted-symbolic", "Stumm klingeln"))
        self.silence.connect("clicked", self._silence)
        extras.append(self.silence)
        forward = Gtk.MenuButton(css_classes=["pill", "small-pill"],
                                 tooltip_text="Anruf an eine andere Nummer weiterleiten")
        forward.set_child(self._icon_text("mail-forward-symbolic", "Weiterleiten"))
        forward.set_popover(TransferPopover(app, lambda target: app.transfer(call.id, target)))
        extras.append(forward)
        self.ringing_box.append(extras)

        buttons = Gtk.Box(spacing=64, halign=Gtk.Align.CENTER)
        for icon, css, text, handler in (
            ("call-stop-symbolic", "hangup", "Ablehnen", lambda *_: app.hangup(call.id)),
            ("call-start-symbolic", "call", "Annehmen", lambda *_: app.accept(call.id, via="popup")),
        ):
            col = Gtk.Box(orientation=Gtk.Orientation.VERTICAL, spacing=8)
            btn = round_button(icon, css, text)
            btn.connect("clicked", handler)
            col.append(btn)
            col.append(Gtk.Label(label=text, css_classes=["caption"]))
            buttons.append(col)
            if css == "call":
                self.accept_button = btn
        self.ringing_box.append(buttons)
        box.append(self.ringing_box)

        # -- Gespräch ---------------------------------------------------------
        self.call_box = Gtk.Box(orientation=Gtk.Orientation.VERTICAL, spacing=18, visible=False)
        self.call_box.set_margin_top(16)
        self.dtmf_label = label("", "dtmf-digits", "numeric")
        pad = Gtk.Box(orientation=Gtk.Orientation.VERTICAL, spacing=6)
        pad.append(self.dtmf_label)
        pad.append(DialPad(self._dtmf, compact=True))
        self.dtmf = Gtk.Revealer(child=pad, transition_type=Gtk.RevealerTransitionType.SLIDE_DOWN)
        self.call_box.append(self.dtmf)

        controls = Gtk.Box(spacing=14, halign=Gtk.Align.CENTER)
        col, self.mute = labeled_toggle("microphone-sensitivity-muted-symbolic", "Stumm")
        self.mute_handler = self.mute.connect("toggled", lambda b: app.set_mute(b.get_active(), call.id))
        controls.append(col)
        col, self.hold = labeled_toggle("media-playback-pause-symbolic", "Halten")
        self.hold_handler = self.hold.connect("toggled", lambda b: app.set_hold(b.get_active(), call.id))
        controls.append(col)
        col, self.keypad = labeled_toggle("input-dialpad-symbolic", "Tastatur")
        self.keypad.connect("toggled", self._on_keypad)
        controls.append(col)
        transfer = Gtk.MenuButton(icon_name="mail-forward-symbolic", css_classes=["call-toggle"],
                                  halign=Gtk.Align.CENTER, tooltip_text="Weiterleiten")
        transfer.set_popover(TransferPopover(app, lambda target: app.transfer(call.id, target)))
        col = Gtk.Box(orientation=Gtk.Orientation.VERTICAL, spacing=6)
        col.append(transfer)
        col.append(Gtk.Label(label="Weiterleiten", css_classes=["caption", "dim-label"]))
        controls.append(col)
        self.controls = controls
        self.call_box.append(controls)

        hangup = round_button("call-stop-symbolic", "hangup", "Auflegen")
        hangup.connect("clicked", lambda *_: app.hangup(call.id))
        self.call_box.append(hangup)
        box.append(self.call_box)

        header = Adw.HeaderBar(show_title=False, css_classes=["flat"])
        expand = Gtk.Button(icon_name="view-fullscreen-symbolic", tooltip_text="Im Hauptfenster öffnen",
                            css_classes=["flat"])
        expand.connect("clicked", lambda *_: app.open_call_in_window(call.id))
        header.pack_start(expand)
        view = Adw.ToolbarView(content=box)
        view.add_top_bar(header)
        self.set_content(view)
        self.connect("close-request", self._on_close)
        self.update()

    @staticmethod
    def _icon_text(icon, text):
        content = Gtk.Box(spacing=6)
        content.append(Gtk.Image(icon_name=icon))
        content.append(Gtk.Label(label=text))
        return content

    def _silence(self, *_):
        self.app.stop_ringing()
        self.silence.set_sensitive(False)

    def _dtmf(self, digit):
        self.dtmf_label.set_label((self.dtmf_label.get_label() + digit)[-20:])
        self.app.send_dtmf(digit, self.call.id)

    def _on_keypad(self, toggle):
        self.avatar.set_visible(not toggle.get_active())
        self.dtmf.set_reveal_child(toggle.get_active())

    def _on_close(self, *_):
        if self.call.state == "incoming":
            self.set_visible(False)  # Schließen lehnt nicht ab, sondern blendet nur aus
        else:
            # Das Gespräch läuft weiter – Steuerung im Hauptfenster anbieten
            self.app.open_call_in_window(self.call.id)
        return True

    def update(self):
        call = self.call
        ringing = call.state == "incoming"
        self.caption.set_label("Gespräch" if call.state == "established" else TITLES.get(call.direction, "Anruf"))
        self.ringing_box.set_visible(ringing)
        self.call_box.set_visible(not ringing)
        self.status.set_label("" if ringing else call.status_text())
        self.status.set_visible(not ringing)
        self.hint.set_visible(ringing and bool(self.app.active_call(exclude=call.id)))
        self.controls.set_sensitive(call.state == "established")
        for toggle, handler, value in ((self.mute, self.mute_handler, call.muted),
                                       (self.hold, self.hold_handler, call.held)):
            toggle.handler_block(handler)
            toggle.set_active(value)
            toggle.handler_unblock(handler)

    def popup(self):
        self.present()
        if self.call.state == "incoming":
            self.accept_button.grab_focus()
