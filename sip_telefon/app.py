"""Anwendung: verbindet baresip-Events mit Fenster, Pop-ups und Benachrichtigungen."""

import os
import re
import shlex
from datetime import datetime, timedelta

from gi.repository import Adw, Gdk, Gio, GLib, Gtk

from . import APP_ID, VERSION
from .audio_devices import AudioDevices
from .baresip import Baresip, account_line
from .calendars import CalendarManager
from .contact_import import parse_file
from .contact_sync import ContactSync
from .calls import Call
from .incoming import IncomingCallWindow
from .preferences import PreferencesDialog
from .store import RUNTIME_DIR, STATE_DIR, Store, normalize_number, number_from_uri
from .window import MainWindow

CSS_DIR = os.path.dirname(__file__)
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
        self._load_css()

        self.store = Store()
        self.calendar = CalendarManager(self.store)
        self.contact_sync = ContactSync(self.store, self.calendar.run)
        self.audio = AudioDevices()
        self.restart_after_call = False
        self.reminded = set()
        self.upcoming = []  # Termine mit Uhrzeit für Erinnerungen
        self.upcoming_week = []  # alle Termine der nächsten 7 Tage für die Startseite
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
            ("show-calendar", lambda *_: self.show_page("calendar"), None),
            ("import-contacts", lambda *_: self.import_contacts(), None),
            ("sync-contacts", lambda *_: self.sync_contacts(manual=True), None),
            ("addressbooks", lambda *_: self.show_preferences("contacts"), None),
        ]:
            action = Gio.SimpleAction.new(name, GLib.VariantType.new(ptype) if ptype else None)
            action.connect("activate", handler)
            self.add_action(action)
        self.set_accels_for_action("app.quit", ["<Control>q"])
        self.set_accels_for_action("app.preferences", ["<Control>comma"])
        self.set_accels_for_action("window.close", ["<Control>w"])

        self.window = MainWindow(self)
        self.calendar.connect("calendars-changed", lambda *_: self._refresh_upcoming())
        self.calendar.connect("events-changed", lambda *_: self._refresh_upcoming())
        self.calendar.reload()
        self.contact_sync.connect("synced", lambda *_: self._on_contacts_synced())
        self.contact_sync.sync()
        GLib.timeout_add_seconds(30, self._check_reminders)
        GLib.timeout_add_seconds(600, lambda: (self._refresh_upcoming(), True)[1])
        self.hold()  # auch ohne sichtbares Fenster erreichbar bleiben
        self.restart_engine()

    def _load_css(self):
        """Material-Stylesheet plus Farbpalette passend zum Hell/Dunkel-Modus."""
        display = Gdk.Display.get_default()
        prio = Gtk.STYLE_PROVIDER_PRIORITY_APPLICATION
        for name, offset in (("colors-light.css", 0), ("style.css", 2)):
            provider = Gtk.CssProvider()
            provider.load_from_path(os.path.join(CSS_DIR, name))
            Gtk.StyleContext.add_provider_for_display(display, provider, prio + offset)
        self.dark_provider = Gtk.CssProvider()
        self.dark_provider.load_from_path(os.path.join(CSS_DIR, "colors-dark.css"))
        style = Adw.StyleManager.get_default()
        style.connect("notify::dark", lambda *_: self._apply_color_scheme())
        self._apply_color_scheme()

    def _apply_color_scheme(self):
        display = Gdk.Display.get_default()
        if Adw.StyleManager.get_default().get_dark():
            Gtk.StyleContext.add_provider_for_display(
                display, self.dark_provider, Gtk.STYLE_PROVIDER_PRIORITY_APPLICATION + 1)
        else:
            Gtk.StyleContext.remove_provider_for_display(display, self.dark_provider)

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
        self.engine.start(line, int(acc.get("local_port") or 0), dict(self.store.settings.get("audio", {})))

    # -- Engine-Events -----------------------------------------------------

    def set_reg_state(self, text, kind):
        self.reg_state = (text, kind)
        shown = f"{text} · Nicht stören" if self.dnd and kind == "ok" else text
        self.window.set_status(shown, "dnd" if self.dnd and kind == "ok" else kind)
        self.window.function_bar.update()
        self.window.home.refresh()

    @property
    def dnd(self):
        return bool(self.store.settings.get("dnd", False))

    def set_registered(self, registered):
        """An der Telefonanlage ab- oder wieder anmelden (bleibt über Neustarts erhalten)."""
        self.store.settings["registered"] = registered
        self.store.save_settings()
        if registered:
            self.restart_engine()
        else:
            self.engine.send("uareg", "0")
            self.set_reg_state("Abgemeldet – keine Anrufe", "off")

    def set_audio(self, kind, node):
        """kind: "source" (Mikrofon), "sink" (Lautsprecher), "alert" (Klingeln)."""
        audio = self.store.settings.setdefault("audio", {})
        if audio.get(kind, "") == node:
            return
        audio[kind] = node
        self.store.save_settings()
        self.window.function_bar.update()
        if kind in ("source", "sink"):
            self.engine.set_device(kind, node)  # wirkt sofort, auch im laufenden Gespräch
        if kind == "alert" or (kind == "sink" and not audio.get("alert")):
            # Das Klingel-Gerät kann baresip nur beim Start setzen
            if self.calls:
                self.restart_after_call = True
            else:
                self.restart_engine()

    def set_dnd(self, active):
        if active == self.dnd:
            return
        self.store.settings["dnd"] = active
        self.store.save_settings()
        self.engine.send("dnd", "yes" if active else "no")
        self.set_reg_state(*self.reg_state)
        self.window.function_bar.update()
        self.window.toast("Nicht stören ist an – Anrufe werden abgewiesen" if active
                          else "Nicht stören ist aus")

    def on_engine_state(self, _engine, state, message):
        if state == "error":
            self.set_reg_state("Fehler", "error")
            self.window.show_banner(message, "Erneut versuchen", "app.reconnect")
            for call_id in list(self.calls):
                self._end_call(call_id, "")
        elif state == "running" and not self.store.account.get("domain"):
            self.set_reg_state("Kein Konto eingerichtet", "off")
        elif state == "running":
            # Die erste Anmeldung kann vor dem Verbindungsaufbau passiert sein
            self.engine.send("reginfo", "", self._on_reginfo)
        if state == "running" and self.dnd:
            self.engine.send("dnd", "yes")
        if state == "running" and not self.store.settings.get("registered", True):
            self.engine.send("uareg", "0")
            self.set_reg_state("Abgemeldet – keine Anrufe", "off")

    def _on_reginfo(self, ok, data):
        if ok and re.search(r"\sOK\s", re.sub(r"\x1b\[[0-9;]*m", "", data)):
            self._on_register("REGISTER_OK", "")

    def on_event(self, _engine, ev):
        cls, kind = ev.get("class"), ev.get("type", "")
        # baresip 4.x meldet Registrierungen in der Klasse "ua", ältere als "register"
        if kind in ("REGISTERING", "REGISTER_OK", "REGISTER_FAIL", "UNREGISTERING"):
            self._on_register(kind, ev.get("param", ""))
        elif cls == "call":
            self._on_call_event(kind, ev)
        elif cls == "sip" and ev.get("param", "").startswith("menu,rejected"):
            self._on_rejected(ev)

    def _on_rejected(self, ev):
        """Bei „Nicht stören“ abgewiesener Anruf: als verpasst eintragen."""
        number = number_from_uri(ev.get("from", ""))
        contact = self.store.find_contact(number)
        name = contact["name"] if contact else ""
        self.store.add_history("in", number, name, 0, True)
        self.window.history_changed(missed=True)
        n = Gio.Notification.new(f"Abgewiesen (Nicht stören): {name or number}")
        n.set_body(number if name else "")
        n.set_priority(Gio.NotificationPriority.LOW)
        n.set_icon(Gio.ThemedIcon.new("call-missed-symbolic"))
        n.add_button_with_target("Zurückrufen", "app.call-back", GLib.Variant.new_string(number))
        n.set_default_action("app.show")
        self.send_notification(f"rejected-{GLib.get_real_time()}", n)

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
        elif kind == "UNREGISTERING" and not self.engine.stopping:
            # Beim Neustart der Engine meldet die alte Instanz sich ab – das ist kein „Abgemeldet“
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
        if not self.calls and self.restart_after_call:
            self.restart_after_call = False
            self.restart_engine()

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

    def show_preferences(self, page=None):
        self.window.present()
        dialog = PreferencesDialog(self)
        if page:
            dialog.set_visible_page_name(page)
        dialog.present(self.window)

    def show_page(self, name):
        self.window.views.set_visible_child_name(name)
        self.window.present()

    # -- Kontakte ----------------------------------------------------------

    def import_contacts(self):
        dialog = Gtk.FileDialog(title="Kontakte importieren", modal=True)
        filters = Gio.ListStore.new(Gtk.FileFilter)
        for name, patterns in (("Kontakte (vCard, CSV)", ["*.vcf", "*.vcard", "*.csv"]),
                               ("vCard", ["*.vcf", "*.vcard"]), ("CSV", ["*.csv"])):
            f = Gtk.FileFilter(name=name)
            for pattern in patterns:
                f.add_suffix(pattern[2:])
            filters.append(f)
        dialog.set_filters(filters)
        self.window.present()
        dialog.open_multiple(self.window, None, self._on_import_chosen)

    def _on_import_chosen(self, dialog, result):
        try:
            files = dialog.open_multiple_finish(result)
        except GLib.Error:
            return  # abgebrochen
        self.import_files([files.get_item(i).get_path() for i in range(files.get_n_items())])

    def import_files(self, paths):
        imported, skipped, failed = [], 0, []
        for path in paths:
            try:
                contacts, without = parse_file(path)
            except (OSError, ValueError) as e:
                failed.append(f"{os.path.basename(path)}: {e}")
                continue
            imported += contacts
            skipped += without
        if failed:
            self.window.toast("Import fehlgeschlagen: " + "; ".join(failed))
        if not imported:
            if not failed:
                self.window.toast("Keine Kontakte mit Telefonnummer gefunden")
            return
        added, merged, _unchanged = self.store.import_contacts(imported)
        self.window.contacts_changed()
        if not added and not merged:
            self.window.toast("Alle Kontakte waren schon vorhanden")
        else:
            parts = [f"{added} neu", f"{merged} ergänzt"] + ([f"{skipped} ohne Nr."] if skipped else [])
            self.window.toast("Import: " + " · ".join(parts))
        self.show_page("contacts")

    def sync_contacts(self, manual=False):
        self.manual_sync = manual
        self.contact_sync.sync()

    def _on_contacts_synced(self):
        self.window.contacts_changed()
        if getattr(self, "manual_sync", False):
            self.manual_sync = False
            errors = self.contact_sync.errors
            n = len(self.store.external)
            self.window.toast("Adressbuch: " + errors[0] if errors else f"Adressbücher abgeglichen ({n} Kontakte)")

    # -- Kalender ----------------------------------------------------------

    def schedule_callback(self, number, name=""):
        """Rückruf-Termin für die nächste volle Stunde vorschlagen."""
        start = (datetime.now() + timedelta(hours=1)).replace(minute=0, second=0, microsecond=0)
        self.show_page("calendar")
        self.window.calendar.new_event(
            summary=f"Rückruf: {name or number}",
            description=f"Telefon: {number}",
            start=start,
            duration=timedelta(minutes=15),
        )

    def _refresh_upcoming(self):
        now = datetime.now()

        def done(events, _errors):
            self.upcoming_week = events
            self.upcoming = [e for e in events if not e.all_day and e.start < now + timedelta(days=1)]
            self._check_reminders()
            self.window.home.refresh()

        if self.calendar.enabled_calendars():
            self.calendar.fetch(now - timedelta(hours=1), now + timedelta(days=7), done)
        else:
            self.upcoming = self.upcoming_week = []
            self.window.home.refresh()

    def _check_reminders(self):
        minutes = int(self.store.settings["calendar"].get("reminder_minutes", 10))
        if minutes <= 0:
            return True
        now = datetime.now()
        for ev in self.upcoming:
            key = (ev.uid, ev.start)
            if key in self.reminded or not (now <= ev.start <= now + timedelta(minutes=minutes)):
                continue
            self.reminded.add(key)
            mins = max(1, round((ev.start - now).total_seconds() / 60))
            n = Gio.Notification.new(f"In {mins} Min.: {ev.summary}")
            body = ev.start.strftime("%H:%M") + (f" · {ev.location}" if ev.location else "")
            n.set_body(body)
            n.set_icon(Gio.ThemedIcon.new("x-office-calendar-symbolic"))
            n.set_default_action("app.show-calendar")
            numbers = ev.numbers
            if numbers:
                n.add_button_with_target(f"{numbers[0]} anrufen", "app.call-back",
                                         GLib.Variant.new_string(numbers[0]))
            self.send_notification(f"reminder-{hash(key)}", n)
        return True

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
