"""Einstellungsdialog: SIP-Konto und Programmverhalten."""

from gi.repository import Adw, Gtk

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

        page = Adw.PreferencesPage(title="Konto", icon_name="avatar-default-symbolic")
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

        general = Adw.PreferencesPage(title="Allgemein", icon_name="emblem-system-symbolic")
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
