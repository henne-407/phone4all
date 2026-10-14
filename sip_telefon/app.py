"""Anwendung: verbindet baresip-Events mit Fenster, Pop-ups und Benachrichtigungen."""

import os
import shlex

from gi.repository import Adw, Gdk, Gio, GLib, Gtk

from . import APP_ID, VERSION
from .baresip import Baresip, account_line
from .calls import Call
from .incoming import IncomingCallWindow
from .preferences import PreferencesDialog
from .store import RUNTIME_DIR, STATE_DIR, Store, normalize_number, number_from_uri
from .window import MainWindow

CSS_PATH = os.path.join(os.path.dirname(__file__), "style.css")
LAUNCHER = os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), "sip-telefon")
AUTOSTART_PATH = os.path.join(GLib.get_user_config_dir(), "autostart", f"{APP_ID}.desktop")

CLOSE_REASONS = {
    "486": "Besetzt",
    "busy": "Besetzt",
    "603": "Abgelehnt",
    "decline": "Abgelehnt",
    "404": "Nummer nicht gefunden",
    "not found": "Nummer nicht gefunden",
    "480": "Nicht erreichbar",
    "408": "Keine Antwort",
}


class App(Adw.Application):
    def __init__(self):
        super().__init__(application_id=APP_ID, flags=Gio.ApplicationFlags.HANDLES_COMMAND_LINE)
        self.add_main_option("background", ord("b"), GLib.OptionFlags.NONE, GLib.OptionArg.NONE,
                             "Im Hintergrund starten (ohne Fenster)", None)
        self.window = None
        self.calls = {}
        self.popups = {}
        self.reg_state = ("Startet …", "busy")
        self.timer_id = 0

    # -- Lebenszyklus ------------------------------------------------------

    def do_startup(self):
        Adw.Application.do_startup(self)
        provider = Gtk.CssProvider()
        provider.load_from_path(CSS_PATH)
        Gtk.StyleContext.add_provider_for_display(
            Gdk.Display.get_default(), provider, Gtk.STYLE_PROVIDER_PRIORITY_APPLICATION
        )

        self.store = Store()
        self.engine = Baresip(RUNTIME_DIR, os.path.join(STATE_DIR, "baresip.log"))
        self.engine.connect("event", self.on_event)
        self.engine.connect("engine-state", self.on_engine_state)

        for name, handler, ptype in [
            ("preferences", lambda *_: self.show_preferences(), None),
            ("about", lambda *_: self.show_about(), None),
            ("quit", lambda *_: self.quit(), None),
            ("show", lambda *_: self.window.present(), None),
            ("reconnect", lambda *_: self.restart_engine(), None),
            ("clear-history", lambda *_: self.clear_history(), None),
            ("accept", lambda _a, p: self.accept(p.get_string()), "s"),
            ("decline", lambda _a, p: self.hangup(p.get_string()), "s"),
            ("call-back", lambda _a, p: self.dial(p.get_string()), "s"),
        ]:
            action = Gio.SimpleAction.new(name, GLib.VariantType.new(ptype) if ptype else None)
            action.connect("activate", handler)
            self.add_action(action)
        self.set_accels_for_action("app.quit", ["<Control>q"])
        self.set_accels_for_action("app.preferences", ["<Control>comma"])
        self.set_accels_for_action("window.close", ["<Control>w"])

        self.window = MainWindow(self)
        self.hold()  # auch ohne sichtbares Fenster erreichbar bleiben
        self.restart_engine()

    def do_command_line(self, cmdline):
        options = cmdline.get_options_dict().end().unpack()
        if not options.get("background") or self.window.get_visible():
            self.window.present()
        return 0

    def do_shutdown(self):
        self.engine.stop_sync()
        Adw.Application.do_shutdown(self)

    def restart_engine(self):
        acc = self.store.account
        line = account_line(acc, self.store.get_password())
        if line is None:
            self.set_reg_state("Kein Konto eingerichtet", "off")
            self.window.show_banner("Noch kein SIP-Konto eingerichtet", "Einrichten", "app.preferences")
        else:
            self.window.show_banner(None)
            self.set_reg_state("Verbinde …", "busy")
        self.engine.start(line, int(acc.get("local_port") or 0))

    # -- Engine-Events -----------------------------------------------------

    def set_reg_state(self, text, kind):
        self.reg_state = (text, kind)
        self.window.set_status(text, kind)

    def on_engine_state(self, _engine, state, message):
        if state == "error":
            self.set_reg_state("Fehler", "error")
            self.window.show_banner(message, "Erneut versuchen", "app.reconnect")
            for call_id in list(self.calls):
                self._end_call(call_id, "")
        elif state == "running" and not self.store.account.get("domain"):
            self.set_reg_state("Kein Konto eingerichtet", "off")

    def on_event(self, _engine, ev):
        cls, kind = ev.get("class"), ev.get("type", "")
        if cls == "register":
            self._on_register(kind, ev.get("param", ""))
        elif cls == "call":
            self._on_call_event(kind, ev)

    def _on_register(self, kind, param):
        if kind == "REGISTER_OK":
            acc = self.store.account
            self.set_reg_state(f"Angemeldet als {acc['user']}@{acc['domain']}", "ok")
            self.window.show_banner(None)
        elif kind == "REGISTERING":
            if self.reg_state[1] != "ok":
                self.set_reg_state("Verbinde …", "busy")
        elif kind == "REGISTER_FAIL":
            self.set_reg_state("Anmeldung fehlgeschlagen", "error")
            self.window.show_banner(f"Anmeldung fehlgeschlagen: {param}", "Einstellungen", "app.preferences")
        elif kind == "UNREGISTERING":
            self.set_reg_state("Abgemeldet", "off")

    def _on_call_event(self, kind, ev):
        call_id = ev.get("id")
        if not call_id:
            return
        call = self.calls.get(call_id)

        if kind in ("CALL_INCOMING", "CALL_OUTGOING") and call is None:
            number = number_from_uri(ev.get("peeruri", ""))
            contact = self.store.find_contact(number)
            name = contact["name"] if contact else ev.get("peerdisplayname", "")
            call = Call(call_id, "in" if kind == "CALL_INCOMING" else "out", number, name,
                        contact.get("company", "") if contact else "")
            self.calls[call_id] = call
            if call.direction == "in":
                self._ring(call)
            else:
                self.window.show_call(call)
            return
        if call is None:
            return

        if kind in ("CALL_RINGING", "CALL_PROGRESS") and call.state == "calling":
            call.state = "ringing"
        elif kind == "CALL_ESTABLISHED" and call.state != "established":
            call.state = "established"
            call.established = GLib.get_real_time() / 1e6
            self._close_popup(call_id)
            self._start_timer()
            self.window.show_call(call)
        elif kind == "CALL_HOLD":
            call.remote_held = True
        elif kind == "CALL_RESUME":
            call.remote_held = False
        elif kind == "CALL_CLOSED":
            self._end_call(call_id, ev.get("param", ""))
            return
        else:
            return
        if self.window.call_view.call is call:
            self.window.show_call(call)

    def _ring(self, call):
        popup = IncomingCallWindow(self, call)
        self.popups[call.id] = popup
        popup.popup()

        notification = Gio.Notification.new(f"Anruf von {call.title}")
        notification.set_body(call.number if call.name else "Eingehender Anruf")
        notification.set_priority(Gio.NotificationPriority.URGENT)
        notification.set_icon(Gio.ThemedIcon.new("call-start-symbolic"))
        notification.add_button_with_target("Ablehnen", "app.decline", GLib.Variant.new_string(call.id))
        notification.add_button_with_target("Annehmen", "app.accept", GLib.Variant.new_string(call.id))
        notification.set_default_action_and_target("app.accept", GLib.Variant.new_string(call.id))
        self.send_notification(f"call-{call.id}", notification)

        if not self.active_call(exclude=call.id):
            self.window.show_call(call)

    def _close_popup(self, call_id):
        popup = self.popups.pop(call_id, None)
        if popup:
            popup.destroy()
        self.withdraw_notification(f"call-{call_id}")

    def _end_call(self, call_id, reason):
        call = self.calls.pop(call_id, None)
        if call is None:
            return
        self._close_popup(call_id)
        missed = call.direction == "in" and call.established is None
        self.store.add_history(call.direction, call.number, call.name, call.duration, missed)
        self.window.history_changed(missed)

        if missed and call.state == "incoming" and not getattr(call, "declined", False):
            n = Gio.Notification.new(f"Verpasster Anruf von {call.title}")
            n.set_body(call.number if call.name else "")
            n.set_icon(Gio.ThemedIcon.new("call-missed-symbolic"))
            n.add_button_with_target("Zurückrufen", "app.call-back", GLib.Variant.new_string(call.number))
            n.set_default_action("app.show")
            self.send_notification(f"missed-{call_id}", n)
        elif call.direction == "out" and call.established is None:
            text = next((v for k, v in CLOSE_REASONS.items() if k in reason.lower()), None)
            if text or reason:
                self.window.toast(f"Anruf beendet: {text or reason}")

        if self.window.call_view.call is call:
            # Nächsten Anruf anzeigen (z. B. gehaltenes Gespräch), sonst zurück zur Übersicht
            self.window.show_call(self.active_call())
        if not any(c.state == "established" for c in self.calls.values()):
            self._stop_timer()

    def _start_timer(self):
        if not self.timer_id:
            self.timer_id = GLib.timeout_add_seconds(1, self._tick)

    def _stop_timer(self):
        if self.timer_id:
            GLib.source_remove(self.timer_id)
            self.timer_id = 0

    def _tick(self):
        self.window.update_call_status()
        return True

    # -- Aktionen (vom UI aufgerufen) --------------------------------------

    def active_call(self, exclude=None):
        """Das aktuelle Gespräch (nicht klingelnd), sonst ein klingelnder Anruf."""
        calls = [c for c in self.calls.values() if c.id != exclude]
        calls.sort(key=lambda c: (c.state == "incoming", -c.created))
        return calls[0] if calls else None

    def dial(self, number):
        number = normalize_number(number or "")
        if not number:
            return False
        if not self.engine.running or self.reg_state[1] == "off":
            self.window.present()
            self.window.toast("Keine Verbindung zur Telefonanlage")
            return False
        if self.active_call():
            self.window.toast("Es läuft bereits ein Gespräch")
            return False

        def done(ok, data):
            if not ok:
                self.window.toast("Anruf fehlgeschlagen: " + data.strip().splitlines()[-1] if data.strip()
                                  else "Anruf fehlgeschlagen")

        self.engine.send("dial", number, done)
        self.window.present()
        return True

    def accept(self, call_id):
        call = self.calls.get(call_id)
        if call is None or call.state != "incoming":
            return
        current = self.active_call(exclude=call_id)
        if current and current.state != "incoming":
            self.engine.call_command(current.id, "hangup")
        self.engine.call_command(call_id, "accept")
        self.window.show_call(call)
        self.window.present()

    def hangup(self, call_id=None):
        call = self.calls.get(call_id) if call_id else self.active_call()
        if call is None:
            return
        call.declined = call.state == "incoming"
        if call.declined:
            self.engine.call_command(call.id, "hangup", "486 Busy Here")
        else:
            self.engine.call_command(call.id, "hangup")

    def set_mute(self, muted):
        call = self.active_call()
        if call and call.muted != muted:
            call.muted = muted
            self.engine.call_command(call.id, "mute")  # baresip schaltet um

    def set_hold(self, held):
        call = self.active_call()
        if call and call.held != held:
            call.held = held
            self.engine.call_command(call.id, "hold" if held else "resume")
            self.window.update_call_status()

    def send_dtmf(self, digit):
        call = self.active_call()
        if call:
            self.engine.call_command(call.id, "sndcode", digit)

    # -- Sonstiges ---------------------------------------------------------

    def show_preferences(self):
        self.window.present()
        PreferencesDialog(self).present(self.window)

    def clear_history(self):
        self.store.clear_history()
        self.window.history_changed()

    def show_about(self):
        about = Adw.AboutDialog(
            application_name="SIP-Telefon",
            application_icon="call-start-symbolic",
            version=VERSION,
            comments="Einfacher SIP-Softphone-Client für Linux.\nSIP und Audio: baresip.",
            license_type=Gtk.License.MIT_X11,
        )
        about.present(self.window)

    def update_autostart(self):
        if self.store.settings.get("autostart"):
            os.makedirs(os.path.dirname(AUTOSTART_PATH), exist_ok=True)
            exe = shlex.quote(LAUNCHER)
            with open(AUTOSTART_PATH, "w") as f:
                f.write(
                    "[Desktop Entry]\nType=Application\nName=SIP-Telefon\n"
                    f"Exec={exe} --background\nIcon=call-start-symbolic\n"
                    "X-GNOME-Autostart-enabled=true\n"
                )
        elif os.path.exists(AUTOSTART_PATH):
            os.remove(AUTOSTART_PATH)
