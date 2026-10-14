"""Wiederverwendbare Bausteine: Wähltastatur, runde Buttons, Kontaktdialog."""

from datetime import date, datetime

from gi.repository import Adw, Gtk, Pango

KEYS = [
    ("1", ""), ("2", "ABC"), ("3", "DEF"),
    ("4", "GHI"), ("5", "JKL"), ("6", "MNO"),
    ("7", "PQRS"), ("8", "TUV"), ("9", "WXYZ"),
    ("*", ""), ("0", "+"), ("#", ""),
]


class DialPad(Gtk.Grid):
    def __init__(self, on_digit, compact=False):
        super().__init__(
            row_spacing=10 if compact else 12,
            column_spacing=22 if compact else 26,
            halign=Gtk.Align.CENTER,
        )
        for i, (digit, letters) in enumerate(KEYS):
            box = Gtk.Box(orientation=Gtk.Orientation.VERTICAL, valign=Gtk.Align.CENTER)
            box.append(Gtk.Label(label=digit, css_classes=["digit"]))
            box.append(Gtk.Label(label=letters or " ", css_classes=["letters"]))
            button = Gtk.Button(child=box, css_classes=["dial-key"])
            if compact:
                button.add_css_class("compact")
            button.connect("clicked", lambda _b, d=digit: on_digit(d))
            self.attach(button, i % 3, i // 3, 1, 1)


def round_button(icon, css_class, tooltip, size="large"):
    button = Gtk.Button(
        icon_name=icon,
        tooltip_text=tooltip,
        halign=Gtk.Align.CENTER,
        css_classes=["round-action", css_class, size],
    )
    return button


def labeled_toggle(icon, label, toggle=True):
    """Runder (Umschalt-)Knopf mit Beschriftung darunter (für die Anrufansicht)."""
    cls = Gtk.ToggleButton if toggle else Gtk.Button
    toggle = cls(icon_name=icon, css_classes=["call-toggle"], halign=Gtk.Align.CENTER)
    box = Gtk.Box(orientation=Gtk.Orientation.VERTICAL, spacing=6)
    box.append(toggle)
    box.append(Gtk.Label(label=label, css_classes=["caption", "dim-label"]))
    return box, toggle


def format_time(ts):
    dt = datetime.fromtimestamp(ts)
    hm = dt.strftime("%H:%M")
    days = (date.today() - dt.date()).days
    if days <= 0:
        return f"Heute, {hm}"
    if days == 1:
        return f"Gestern, {hm}"
    if days < 7:
        weekday = ["Mo", "Di", "Mi", "Do", "Fr", "Sa", "So"][dt.weekday()]
        return f"{weekday}, {hm}"
    return dt.strftime("%d.%m.%Y, %H:%M")


def label(text, *css, **kwargs):
    lbl = Gtk.Label(label=text, css_classes=list(css), **kwargs)
    lbl.set_ellipsize(Pango.EllipsizeMode.END)
    return lbl


class ContactDialog(Adw.Dialog):
    """Kontakt anlegen oder bearbeiten."""

    def __init__(self, contact, on_save, on_delete=None):
        super().__init__(content_width=420, content_height=520)
        self.contact = dict(contact or {})
        self.on_save = on_save
        is_new = not self.contact.get("id")
        self.set_title("Neuer Kontakt" if is_new else "Kontakt bearbeiten")

        header = Adw.HeaderBar(show_end_title_buttons=False, show_start_title_buttons=False)
        cancel = Gtk.Button(label="Abbrechen")
        cancel.connect("clicked", lambda *_: self.close())
        header.pack_start(cancel)
        self.save_button = Gtk.Button(label="Speichern", css_classes=["suggested-action"])
        self.save_button.connect("clicked", self._save)
        header.pack_end(self.save_button)

        page = Adw.PreferencesPage()
        avatar_group = Adw.PreferencesGroup()
        self.avatar = Adw.Avatar(size=88, text=self.contact.get("name", ""), show_initials=True)
        self.avatar.set_margin_bottom(6)
        avatar_group.add(self.avatar)
        page.add(avatar_group)

        group = Adw.PreferencesGroup()
        self.rows = {}
        for key, title, purpose in [
            ("name", "Name", Gtk.InputPurpose.NAME),
            ("phone", "Telefon", Gtk.InputPurpose.PHONE),
            ("mobile", "Mobil", Gtk.InputPurpose.PHONE),
            ("company", "Firma", Gtk.InputPurpose.FREE_FORM),
        ]:
            row = Adw.EntryRow(title=title, input_purpose=purpose)
            row.set_text(self.contact.get(key, ""))
            row.connect("changed", self._validate)
            row.connect("entry-activated", self._save)
            group.add(row)
            self.rows[key] = row
        page.add(group)

        if not is_new and on_delete:
            del_group = Adw.PreferencesGroup()
            delete = Gtk.Button(label="Kontakt löschen", css_classes=["destructive-action", "pill"],
                                halign=Gtk.Align.CENTER)
            delete.connect("clicked", lambda *_: (on_delete(self.contact), self.close()))
            del_group.add(delete)
            page.add(del_group)

        view = Adw.ToolbarView(content=page)
        view.add_top_bar(header)
        self.set_child(view)
        self._validate()
        self.set_focus(self.rows["name"])

    def _validate(self, *_):
        name = self.rows["name"].get_text().strip()
        self.avatar.set_text(name)
        has_number = any(self.rows[k].get_text().strip() for k in ("phone", "mobile"))
        self.save_button.set_sensitive(bool(name and has_number))

    def _save(self, *_):
        if not self.save_button.get_sensitive():
            return
        for key, row in self.rows.items():
            self.contact[key] = row.get_text().strip()
        self.on_save(self.contact)
        self.close()
