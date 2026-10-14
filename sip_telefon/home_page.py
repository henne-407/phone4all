"""Anpassbare Startseite: Status, Favoriten, letzte Anrufe und nächste Termine."""

from datetime import date, datetime, timedelta

from gi.repository import Adw, GLib, Gtk

from .calendar_page import color_class, fmt_event_time
from .store import contact_numbers
from .widgets import label

CARDS = {
    "status": ("Status & Schnellwahl", "network-wireless-symbolic"),
    "favorites": ("Favoriten", "starred-symbolic"),
    "recent": ("Letzte Anrufe", "document-open-recent-symbolic"),
    "events": ("Nächste Termine", "x-office-calendar-symbolic"),
}
DEFAULT_LAYOUT = [["status", True], ["favorites", True], ["recent", True], ["events", True]]
START_TABS = [("home", "Startseite"), ("dial", "Wählen"), ("contacts", "Kontakte"),
              ("calendar", "Kalender"), ("history", "Verlauf")]


def layout(settings):
    """Gespeicherte Kartenreihenfolge, ergänzt um neu hinzugekommene Karten."""
    saved = [[k, bool(v)] for k, v in settings.get("cards", DEFAULT_LAYOUT) if k in CARDS]
    known = {k for k, _ in saved}
    return saved + [[k, True] for k in CARDS if k not in known]


def day_label(d):
    today = date.today()
    if d == today:
        return "Heute"
    if d == today + timedelta(days=1):
        return "Morgen"
    return GLib.DateTime.new_local(d.year, d.month, d.day, 0, 0, 0).format("%a, %-d. %b")


class HomePage(Gtk.Box):
    def __init__(self, app, window):
        super().__init__(orientation=Gtk.Orientation.VERTICAL)
        self.app = app
        self.window = window
        self.cards = Gtk.Box(orientation=Gtk.Orientation.VERTICAL, spacing=16)
        self.cards.set_margin_start(12)
        self.cards.set_margin_end(12)
        self.cards.set_margin_top(6)

        customize = Gtk.Button(halign=Gtk.Align.CENTER, css_classes=["flat", "pill-small"])
        content = Gtk.Box(spacing=8)
        content.append(Gtk.Image(icon_name="document-edit-symbolic"))
        content.append(Gtk.Label(label="Startseite anpassen"))
        customize.set_child(content)
        customize.connect("clicked", lambda *_: CustomizeDialog(self).present(self.window))
        customize.set_margin_top(8)
        customize.set_margin_bottom(24)

        outer = Gtk.Box(orientation=Gtk.Orientation.VERTICAL)
        outer.append(self.cards)
        outer.append(customize)
        clamp = Adw.Clamp(maximum_size=560, child=outer)
        self.append(Gtk.ScrolledWindow(child=clamp, vexpand=True, hscrollbar_policy=Gtk.PolicyType.NEVER))
        # Zeitangaben („in 5 Min.“) und Termine aktuell halten
        GLib.timeout_add_seconds(60, lambda: (self.refresh(), True)[1])
        self.refresh()

    @property
    def settings(self):
        return self.app.store.settings.setdefault("home", {})

    def refresh(self):
        while child := self.cards.get_first_child():
            self.cards.remove(child)
        builders = {"status": self._status, "favorites": self._favorites,
                    "recent": self._recent, "events": self._events}
        for key, visible in layout(self.settings):
            if visible:
                self.cards.append(builders[key]())

    def _card(self, key, action=None):
        title, icon = CARDS[key]
        card = Gtk.Box(orientation=Gtk.Orientation.VERTICAL, spacing=10, css_classes=["home-card"])
        header = Gtk.Box(spacing=10)
        header.append(Gtk.Image(icon_name=icon, css_classes=["home-card-icon"]))
        header.append(Gtk.Label(label=title, xalign=0, hexpand=True, css_classes=["home-card-title"]))
        if action:
            text, callback = action
            btn = Gtk.Button(label=text, css_classes=["flat", "pill-small", "home-card-action"])
            btn.connect("clicked", lambda *_: callback())
            header.append(btn)
        card.append(header)
        return card

    # -- Karten ------------------------------------------------------------

    def _status(self):
        card = self._card("status")
        text, kind = self.app.reg_state
        row = Gtk.Box(spacing=10)
        dot = Gtk.Box(css_classes=["status-dot", kind], valign=Gtk.Align.CENTER)
        row.append(dot)
        row.append(label(text, xalign=0, hexpand=True))
        card.append(row)

        dnd_row = Gtk.Box(spacing=10)
        dnd_text = Gtk.Box(orientation=Gtk.Orientation.VERTICAL, hexpand=True)
        dnd_text.append(Gtk.Label(label="Nicht stören", xalign=0))
        dnd_text.append(label("Anrufe werden abgewiesen und als verpasst eingetragen", "caption", "dim-label",
                              xalign=0))
        dnd_row.append(dnd_text)
        dnd = Gtk.Switch(active=self.app.dnd, valign=Gtk.Align.CENTER)
        dnd.connect("notify::active", lambda s, _p: self.app.set_dnd(s.get_active()))
        dnd_row.append(dnd)
        card.append(dnd_row)

        dial = Gtk.Box(spacing=8, css_classes=["quick-dial"])
        entry = Gtk.Entry(placeholder_text="Nummer oder Name", hexpand=True,
                          input_purpose=Gtk.InputPurpose.PHONE)
        call = Gtk.Button(icon_name="call-start-symbolic", tooltip_text="Anrufen",
                          css_classes=["circular", "quick-call"])

        def do_dial(*_):
            text = entry.get_text().strip()
            if not any(ch.isdigit() for ch in text):
                matches = self.app.store.search_contacts(text) if text else []
                numbers = contact_numbers(matches[0]) if matches else []
                if not numbers:
                    self.window.toast("Kein passender Kontakt")
                    return
                text = numbers[0]
            if self.app.dial(text):
                entry.set_text("")

        entry.connect("activate", do_dial)
        call.connect("clicked", do_dial)
        dial.append(entry)
        dial.append(call)
        card.append(dial)
        return card

    def _favorites(self):
        card = self._card("favorites", ("Kontakte", lambda: self.window.views.set_visible_child_name("contacts")))
        favorites = [c for c in self.app.store.contacts if c.get("favorite")]
        if not favorites:
            card.append(label("Öffne einen Kontakt und schalte „Favorit“ ein, um ihn hier anzuheften.",
                              "dim-label", wrap=True, xalign=0))
            return card
        flow = Gtk.FlowBox(selection_mode=Gtk.SelectionMode.NONE, homogeneous=True,
                           max_children_per_line=4, min_children_per_line=3, row_spacing=6, column_spacing=6)
        for c in favorites:
            numbers = contact_numbers(c)
            box = Gtk.Box(orientation=Gtk.Orientation.VERTICAL, spacing=6)
            box.append(Adw.Avatar(size=56, text=c["name"], show_initials=True))
            box.append(label(c["name"].split(" ")[0], "caption", max_width_chars=10))
            btn = Gtk.Button(child=box, css_classes=["flat", "favorite-tile"],
                             tooltip_text=f"{c['name']} – {numbers[0]} anrufen" if numbers else c["name"])
            btn.connect("clicked", lambda _b, n=numbers: n and self.app.dial(n[0]))
            flow.append(btn)
        card.append(flow)
        return card

    def _recent(self):
        card = self._card("recent", ("Alle", lambda: self.window.views.set_visible_child_name("history")))
        history = self.app.store.history[:5]
        if not history:
            card.append(label("Noch keine Anrufe.", "dim-label", xalign=0))
            return card
        listbox = Gtk.ListBox(css_classes=["boxed-list", "inner-list"], selection_mode=Gtk.SelectionMode.NONE)
        for entry in history:
            listbox.append(self.window.history._row(entry))
        card.append(listbox)
        return card

    def _events(self):
        card = self._card("events", ("Kalender", lambda: self.window.views.set_visible_child_name("calendar")))
        if not self.app.calendar.enabled_calendars():
            card.append(label("Kein Kalender verbunden – unter Einstellungen → Kalender einrichten.",
                              "dim-label", wrap=True, xalign=0))
            return card
        now = datetime.now()
        events = [e for e in self.app.upcoming_week if e.end > now][:5]
        if not events:
            card.append(label("Keine Termine in den nächsten 7 Tagen.", "dim-label", xalign=0))
            return card
        listbox = Gtk.ListBox(css_classes=["boxed-list", "inner-list"], selection_mode=Gtk.SelectionMode.NONE)
        for ev in events:
            when = day_label(ev.start.date()) if ev.start > now else "Jetzt"
            subtitle = f"{when} · {fmt_event_time(ev, ev.start.date())}"
            if ev.start > now and ev.start - now < timedelta(hours=1):
                subtitle = f"In {max(1, int((ev.start - now).total_seconds() // 60))} Min. · " \
                           f"{fmt_event_time(ev, ev.start.date())}"
            row = Adw.ActionRow(title=ev.summary, subtitle=subtitle, activatable=True, use_markup=False,
                                title_lines=1, subtitle_lines=1)
            row.add_prefix(Gtk.Box(css_classes=["cal-bar", color_class(ev.calendar.color)]))
            numbers = ev.numbers
            if numbers:
                btn = Gtk.Button(icon_name="call-start-symbolic", tooltip_text=f"{numbers[0]} anrufen",
                                 valign=Gtk.Align.CENTER, css_classes=["flat", "circular", "row-call"])
                btn.connect("clicked", lambda _b, n=numbers[0]: self.app.dial(n))
                row.add_suffix(btn)
            row.connect("activated", lambda _r, e=ev: self.window.calendar.open_event(e))
            listbox.append(row)
        card.append(listbox)
        return card


class CustomizeDialog(Adw.Dialog):
    """Karten ein-/ausblenden, umsortieren und Startansicht wählen."""

    def __init__(self, home):
        super().__init__(title="Startseite anpassen", content_width=420, content_height=520)
        self.home = home
        self.settings = home.settings
        self.layout = layout(self.settings)

        page = Adw.PreferencesPage()
        self.group = Adw.PreferencesGroup(title="Karten",
                                          description="Ein- und ausblenden, mit den Pfeilen sortieren.")
        page.add(self.group)
        self.rows = []
        self._fill()

        start = Adw.PreferencesGroup(title="Beim Öffnen")
        keys = [k for k, _ in START_TABS]
        combo = Adw.ComboRow(title="Zuerst anzeigen", model=Gtk.StringList.new([t for _, t in START_TABS]))
        current = self.settings.get("start_tab", "home")
        combo.set_selected(keys.index(current) if current in keys else 0)
        combo.connect("notify::selected", lambda r, _p: self._set("start_tab", keys[r.get_selected()]))
        start.add(combo)
        page.add(start)

        view = Adw.ToolbarView(content=page)
        view.add_top_bar(Adw.HeaderBar())
        self.set_child(view)

    def _fill(self):
        for row in self.rows:
            self.group.remove(row)
        self.rows = []
        for i, (key, visible) in enumerate(self.layout):
            title, icon = CARDS[key]
            row = Adw.SwitchRow(title=title, active=visible, use_markup=False)
            row.add_prefix(Gtk.Image(icon_name=icon))
            row.connect("notify::active", lambda r, _p, i=i: self._toggle(i, r.get_active()))
            for direction, arrow, enabled in ((-1, "go-up-symbolic", i > 0),
                                              (1, "go-down-symbolic", i < len(self.layout) - 1)):
                btn = Gtk.Button(icon_name=arrow, valign=Gtk.Align.CENTER, sensitive=enabled,
                                 css_classes=["flat", "circular"],
                                 tooltip_text="Nach oben" if direction < 0 else "Nach unten")
                btn.connect("clicked", lambda _b, i=i, d=direction: self._move(i, d))
                row.add_suffix(btn)
            self.group.add(row)
            self.rows.append(row)

    def _set(self, key, value):
        self.settings[key] = value
        self.home.app.store.save_settings()

    def _save_layout(self):
        self._set("cards", self.layout)
        self.home.refresh()

    def _toggle(self, index, active):
        self.layout[index][1] = active
        self._save_layout()

    def _move(self, index, direction):
        target = index + direction
        self.layout[index], self.layout[target] = self.layout[target], self.layout[index]
        self._save_layout()
        self._fill()
