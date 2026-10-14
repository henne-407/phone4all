"""Pop-up-Fenster für eingehende Anrufe."""

from gi.repository import Adw, Gtk

from .widgets import label, round_button


class IncomingCallWindow(Adw.Window):
    def __init__(self, app, call):
        super().__init__(
            application=app,
            title="Eingehender Anruf",
            default_width=340,
            default_height=420,
            resizable=False,
        )
        self.app = app
        self.call = call

        box = Gtk.Box(orientation=Gtk.Orientation.VERTICAL, spacing=6, valign=Gtk.Align.CENTER, vexpand=True)
        box.set_margin_start(24)
        box.set_margin_end(24)
        box.set_margin_bottom(28)

        box.append(label("Eingehender Anruf", "caption-heading", "dim-label"))
        avatar = Adw.Avatar(size=104, text=call.name or "", show_initials=True,
                            halign=Gtk.Align.CENTER, css_classes=["ringing"])
        avatar.set_margin_top(18)
        avatar.set_margin_bottom(18)
        box.append(avatar)
        box.append(label(call.title, "title-1", max_width_chars=20))
        number = label(call.number, "dim-label")
        number.set_visible(bool(call.name))
        box.append(number)
        if call.company:
            box.append(label(call.company, "dim-label", "caption"))

        if app.active_call(exclude=call.id):
            hint = label("Annehmen beendet das laufende Gespräch", "caption", "warning")
            hint.set_margin_top(8)
            box.append(hint)

        buttons = Gtk.Box(spacing=64, halign=Gtk.Align.CENTER)
        buttons.set_margin_top(32)
        for icon, css, text, handler in (
            ("call-stop-symbolic", "hangup", "Ablehnen", lambda *_: app.hangup(call.id)),
            ("call-start-symbolic", "call", "Annehmen", lambda *_: app.accept(call.id)),
        ):
            col = Gtk.Box(orientation=Gtk.Orientation.VERTICAL, spacing=8)
            btn = round_button(icon, css, text)
            btn.connect("clicked", handler)
            col.append(btn)
            col.append(Gtk.Label(label=text, css_classes=["caption"]))
            buttons.append(col)
            if css == "call":
                self.accept_button = btn
        box.append(buttons)

        view = Adw.ToolbarView(content=box)
        view.add_top_bar(Adw.HeaderBar(show_title=False, css_classes=["flat"]))
        self.set_content(view)
        # Schließen per Fensterknopf lehnt nicht ab, sondern blendet nur aus
        self.connect("close-request", lambda *_: (self.set_visible(False), True)[1])

    def popup(self):
        self.present()
        self.accept_button.grab_focus()
