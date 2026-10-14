"""Einstellungsdialog: SIP-Konto, Kalender und Programmverhalten."""

import shutil
import uuid

from gi.repository import Adw, Gio, Gtk

from .calendar_page import color_class
from .calendars import CalDavBackend

TRANSPORTS = [("udp", "UDP"), ("tcp", "TCP"), ("tls", "TLS")]
MEDIAENC = [("", "Keine"), ("srtp", "SRTP (wenn möglich)"), ("srtp-mand", "SRTP (erzwingen)"),
            ("dtls_srtp", "DTLS-SRTP")]


def _combo(title, options, current, subtitle=None):
    row = Adw.ComboRow(title=title, model=Gtk.StringList.new([label for _, label in options]))
    if subtitle:
        row.set_subtitle(subtitle)
    keys = [key for key, _ in options]
    row.set_selected(keys.index(current) if current in keys else 0)
    return row, keys


class PreferencesDialog(Adw.PreferencesDialog):
    def __init__(self, app):
        super().__init__(title="Einstellungen", search_enabled=False)
        self.app = app
        store = app.store
        acc = store.account
        self.initial = (dict(acc), store.get_password())

        page = Adw.PreferencesPage(title="Konto", icon_name="avatar-default-symbolic", name="account")
        self.add(page)

        group = Adw.PreferencesGroup(
            title="SIP-Konto",
            description="Die Zugangsdaten findest du in der Oberfläche deiner Telefonanlage "
                        "(z. B. FRITZ!Box: Telefonie → Telefoniegeräte → IP-Telefon).",
        )
        page.add(group)
        self.rows = {}

        def entry(key, title, cls=Adw.EntryRow, target=group, **kw):
            row = cls(title=title, **kw)
            row.set_text(str(acc.get(key, "") or ""))
            if isinstance(target, Adw.ExpanderRow):
                target.add_row(row)
            else:
                target.add(row)
            self.rows[key] = row
            return row

        entry("domain", "Server / Domain  (z. B. fritz.box oder 192.168.178.1)")
        entry("user", "Benutzername / Durchwahl")
        self.password = Adw.PasswordEntryRow(title="Passwort")
        self.password.set_text(self.initial[1])
        self.password.connect("changed", self._check_password)
        group.add(self.password)
        entry("display_name", "Anzeigename (optional)")

        adv = Adw.PreferencesGroup(title="Erweitert")
        page.add(adv)
        expander = Adw.ExpanderRow(title="Erweiterte Kontoeinstellungen",
                                   subtitle="Nur nötig, wenn deine Anlage es verlangt")
        adv.add(expander)
        entry("auth_user", "Authentifizierungs-Benutzer (falls abweichend)", target=expander)
        entry("outbound", "Outbound-Proxy (optional)", target=expander)
        entry("stun", "STUN-Server (optional, z. B. stun.example.org)", target=expander)

        self.transport, self.transport_keys = _combo("Transport", TRANSPORTS, acc.get("transport", "udp"))
        expander.add_row(self.transport)
        self.port = Adw.SpinRow.new_with_range(0, 65535, 1)
        self.port.set_title("Port")
        self.port.set_subtitle("0 = Standard (5060, TLS 5061)")
        self.port.set_value(int(acc.get("port") or 0))
        expander.add_row(self.port)
        self.local_port = Adw.SpinRow.new_with_range(0, 65535, 1)
        self.local_port.set_title("Lokaler SIP-Port")
        self.local_port.set_subtitle("0 = automatisch")
        self.local_port.set_value(int(acc.get("local_port") or 0))
        expander.add_row(self.local_port)
        self.mediaenc, self.mediaenc_keys = _combo("Medienverschlüsselung", MEDIAENC, acc.get("mediaenc", ""))
        expander.add_row(self.mediaenc)
        self.regint = Adw.SpinRow.new_with_range(60, 3600, 60)
        self.regint.set_title("Registrierungsintervall (Sekunden)")
        self.regint.set_value(int(acc.get("regint") or 600))
        expander.add_row(self.regint)

        self._build_calendar_page()

        general = Adw.PreferencesPage(title="Allgemein", icon_name="emblem-system-symbolic", name="general")
        self.add(general)
        behaviour = Adw.PreferencesGroup(title="Verhalten")
        general.add(behaviour)
        self.background = Adw.SwitchRow(
            title="Im Hintergrund weiterlaufen",
            subtitle="Beim Schließen des Fensters bleibst du erreichbar",
            active=store.settings.get("run_in_background", True),
        )
        behaviour.add(self.background)
        self.autostart = Adw.SwitchRow(
            title="Beim Anmelden starten",
            subtitle="Startet unsichtbar im Hintergrund",
            active=store.settings.get("autostart", False),
        )
        behaviour.add(self.autostart)

        info = Adw.PreferencesGroup(title="Audio")
        general.add(info)
        info.add(Adw.ActionRow(
            title="Mikrofon und Lautsprecher",
            subtitle="Es werden die Standardgeräte von PipeWire verwendet. "
                     "Umstellen z. B. mit pavucontrol oder in den Systemeinstellungen.",
        ))

        self.connect("closed", self._on_closed)

    # -- Kalender ----------------------------------------------------------

    def _build_calendar_page(self):
        manager = self.app.calendar
        settings = manager.settings
        page = Adw.PreferencesPage(title="Kalender", icon_name="x-office-calendar-symbolic", name="calendar")
        self.add(page)

        self.cal_group = Adw.PreferencesGroup(
            title="Kalender", description="Ausgeschaltete Kalender werden im Kalender-Tab nicht angezeigt.")
        page.add(self.cal_group)
        self.cal_rows = []
        self._fill_calendars()
        self.cal_handler = manager.connect("calendars-changed", lambda *_: self._fill_calendars())

        goa = Adw.PreferencesGroup(
            title="GNOME Online-Konten",
            description="Google, Microsoft 365, Nextcloud u. a. – eingerichtet unter "
                        "GNOME-Einstellungen → Online-Konten. Auch lokale Evolution-Kalender erscheinen hier.",
        )
        page.add(goa)
        use_eds = Adw.SwitchRow(title="Kalender aus GNOME Online-Konten verwenden",
                                active=settings.get("use_eds", True))
        use_eds.set_sensitive(manager.eds is not None)
        use_eds.connect("notify::active", self._on_use_eds)
        goa.add(use_eds)
        if shutil.which("gnome-control-center"):
            row = Adw.ActionRow(title="Online-Konten verwalten", activatable=True)
            row.add_suffix(Gtk.Image(icon_name="adw-external-link-symbolic"))
            row.connect("activated", lambda *_: Gio.Subprocess.new(
                ["gnome-control-center", "online-accounts"], Gio.SubprocessFlags.NONE))
            goa.add(row)

        self.caldav_group = Adw.PreferencesGroup(title="CalDAV-Konten")
        add = Gtk.Button(icon_name="list-add-symbolic", tooltip_text="CalDAV-Konto hinzufügen",
                         css_classes=["flat"], valign=Gtk.Align.CENTER)
        add.connect("clicked", lambda *_: self._add_caldav())
        self.caldav_group.set_header_suffix(add)
        page.add(self.caldav_group)
        self.caldav_rows = []
        self._fill_caldav()

        rem = Adw.PreferencesGroup(title="Erinnerungen")
        page.add(rem)
        self.reminder = Adw.SpinRow.new_with_range(0, 240, 5)
        self.reminder.set_title("Vor Terminen erinnern (Minuten)")
        self.reminder.set_subtitle("Benachrichtigung mit Anrufknopf, wenn der Termin eine Nummer enthält. 0 = aus")
        self.reminder.set_value(settings.get("reminder_minutes", 10))
        rem.add(self.reminder)

    def _fill_calendars(self):
        manager = self.app.calendar
        for row in self.cal_rows:
            self.cal_group.remove(row)
        self.cal_rows = []
        if manager.loading and not manager.calendars:
            rows = [Adw.ActionRow(title="Lade Kalender …")]
        elif not manager.calendars:
            rows = [Adw.ActionRow(title="Noch keine Kalender", subtitle="Unten ein CalDAV-Konto hinzufügen")]
        else:
            rows = []
            for cal in manager.calendars:
                row = Adw.SwitchRow(title=cal.name, subtitle=cal.group + ("" if cal.writable else " · nur lesen"),
                                    active=manager.is_enabled(cal), use_markup=False)
                row.add_prefix(Gtk.Box(css_classes=["cal-dot", color_class(cal.color)], valign=Gtk.Align.CENTER))
                row.connect("notify::active", lambda r, _p, c=cal: manager.set_enabled(c, r.get_active()))
                rows.append(row)
            writable = [c for c in manager.calendars if c.writable]
            if writable:
                default = manager.default_calendar()
                combo = Adw.ComboRow(title="Kalender für neue Termine",
                                     model=Gtk.StringList.new([c.name for c in writable]))
                if default in writable:
                    combo.set_selected(writable.index(default))
                combo.connect("notify::selected", lambda r, _p: self._set_default(writable[r.get_selected()]))
                rows.append(combo)
        for err in manager.errors:
            rows.append(Adw.ActionRow(title="Fehler", subtitle=err, css_classes=["error-row"], use_markup=False))
        for row in rows:
            self.cal_group.add(row)
            self.cal_rows.append(row)

    def _set_default(self, cal):
        self.app.calendar.settings["default"] = cal.id
        self.app.store.save_settings()

    def _on_use_eds(self, row, _pspec):
        self.app.calendar.settings["use_eds"] = row.get_active()
        self.app.store.save_settings()
        self.app.calendar.reload()

    def _fill_caldav(self):
        for row in self.caldav_rows:
            self.caldav_group.remove(row)
        self.caldav_rows = []
        accounts = self.app.calendar.settings.get("caldav", [])
        if not accounts:
            empty = Adw.ActionRow(title="CalDAV-Konto hinzufügen", subtitle="Nextcloud, iCloud, mailbox.org, Radicale …",
                                  activatable=True)
            empty.add_suffix(Gtk.Image(icon_name="go-next-symbolic"))
            empty.connect("activated", lambda *_: self._add_caldav())
            accounts_rows = [empty]
        else:
            accounts_rows = []
            for conf in accounts:
                row = Adw.ActionRow(title=conf.get("name") or conf["url"], use_markup=False,
                                    subtitle=f"{conf['user']} · {conf['url']}")
                delete = Gtk.Button(icon_name="user-trash-symbolic", tooltip_text="Konto entfernen",
                                    valign=Gtk.Align.CENTER, css_classes=["flat", "circular"])
                delete.connect("clicked", lambda _b, c=conf: self._remove_caldav(c))
                row.add_suffix(delete)
                accounts_rows.append(row)
        for row in accounts_rows:
            self.caldav_group.add(row)
            self.caldav_rows.append(row)

    def _remove_caldav(self, conf):
        settings = self.app.calendar.settings
        settings["caldav"] = [c for c in settings.get("caldav", []) if c["id"] != conf["id"]]
        self.app.store.delete_secret(f"caldav:{conf['id']}")
        self.app.store.save_settings()
        self._fill_caldav()
        self.app.calendar.reload()

    def _add_caldav(self):
        page = CalDavAccountPage(self)
        self.push_subpage(page)

    def _check_password(self, *_):
        if ";" in self.password.get_text():
            self.password.add_css_class("error")
            self.password.set_tooltip_text("Das Zeichen „;“ wird von baresip nicht unterstützt")
        else:
            self.password.remove_css_class("error")
            self.password.set_tooltip_text(None)

    def _on_closed(self, *_):
        store = self.app.store
        acc = store.account
        for key, row in self.rows.items():
            acc[key] = row.get_text().strip()
        acc["transport"] = self.transport_keys[self.transport.get_selected()]
        acc["mediaenc"] = self.mediaenc_keys[self.mediaenc.get_selected()]
        acc["port"] = int(self.port.get_value())
        acc["local_port"] = int(self.local_port.get_value())
        acc["regint"] = int(self.regint.get_value())
        self.app.calendar.disconnect(self.cal_handler)
        store.settings["calendar"]["reminder_minutes"] = int(self.reminder.get_value())
        store.settings["run_in_background"] = self.background.get_active()
        store.settings["autostart"] = self.autostart.get_active()
        store.save_settings()
        self.app.update_autostart()

        password = self.password.get_text()
        changed = dict(acc) != self.initial[0] or password != self.initial[1]
        if password != self.initial[1] or (changed and password):
            if not store.set_password(password):
                self.app.window.toast("Kein Schlüsselbund verfügbar – Passwort in settings.json (nur für dich lesbar)")
        if changed:
            self.app.restart_engine()


class CalDavAccountPage(Adw.NavigationPage):
    """Unterseite zum Hinzufügen eines CalDAV-Kontos inkl. Verbindungstest."""

    def __init__(self, dialog):
        super().__init__(title="CalDAV-Konto")
        self.dialog = dialog
        self.app = dialog.app

        page = Adw.PreferencesPage()
        group = Adw.PreferencesGroup(
            description="Beispiele:\n"
                        "• Nextcloud: https://cloud.example.de/remote.php/dav\n"
                        "• iCloud: https://caldav.icloud.com (app-spezifisches Passwort)\n"
                        "• mailbox.org: https://dav.mailbox.org\n"
                        "Google-Kalender bitte über GNOME Online-Konten einbinden.",
        )
        self.url = Adw.EntryRow(title="Server-URL", input_purpose=Gtk.InputPurpose.URL)
        self.user = Adw.EntryRow(title="Benutzername")
        self.password = Adw.PasswordEntryRow(title="Passwort")
        self.name = Adw.EntryRow(title="Name (optional, z. B. Nextcloud)")
        for row in (self.url, self.user, self.password, self.name):
            row.connect("changed", self._validate)
            row.connect("entry-activated", self._connect)
            group.add(row)
        page.add(group)

        actions = Adw.PreferencesGroup()
        box = Gtk.Box(orientation=Gtk.Orientation.VERTICAL, spacing=12)
        self.button = Gtk.Button(label="Verbinden", halign=Gtk.Align.CENTER,
                                 css_classes=["pill", "suggested-action"])
        self.button.connect("clicked", self._connect)
        box.append(self.button)
        self.status = Gtk.Label(wrap=True, css_classes=["error"], visible=False)
        box.append(self.status)
        actions.add(box)
        page.add(actions)

        view = Adw.ToolbarView(content=page)
        view.add_top_bar(Adw.HeaderBar())
        self.set_child(view)
        self._validate()

    def _validate(self, *_):
        ok = all(r.get_text().strip() for r in (self.url, self.user, self.password))
        self.button.set_sensitive(ok)
        return ok

    def _connect(self, *_):
        if not self._validate():
            return
        conf = {
            "id": uuid.uuid4().hex[:8],
            "name": self.name.get_text().strip(),
            "url": self.url.get_text().strip(),
            "user": self.user.get_text().strip(),
        }
        password = self.password.get_text()
        self.button.set_sensitive(False)
        self.button.set_label("Verbinde …")
        self.status.set_visible(False)

        def done(calendars, error):
            self.button.set_label("Verbinden")
            self.button.set_sensitive(True)
            if error:
                self.status.set_label(error)
                self.status.set_visible(True)
                return
            store = self.app.store
            store.settings["calendar"].setdefault("caldav", []).append(conf)
            store.set_secret(f"caldav:{conf['id']}", password, f"SIP-Telefon CalDAV {conf['user']}")
            store.save_settings()
            self.dialog._fill_caldav()
            self.app.calendar.reload()
            self.dialog.pop_subpage()
            self.dialog.add_toast(Adw.Toast(title=f"{len(calendars)} Kalender gefunden", timeout=3))

        self.app.calendar.run(lambda: CalDavBackend(conf, password).discover(), done)
