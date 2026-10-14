"""Anpassbare Startseite: Status, Überblick, Favoriten, letzte Anrufe und nächste Termine.

In breiten Fenstern stehen die Karten in Spalten nebeneinander und füllen die
ganze Höhe; Listen in den Karten scrollen dann intern und zeigen mehr Einträge.
"""

from datetime import date, datetime, timedelta

from gi.repository import Adw, GLib, Gtk

from .calendar_page import color_class, fmt_event_time
from .stats import format_talk, frequent, summary
from .store import contact_numbers
from .widgets import label

CARDS = {
    "status": ("Status & Schnellwahl", "network-wireless-symbolic"),
    "today": ("Heute", "x-office-spreadsheet-symbolic"),
    "favorites": ("Favoriten", "starred-symbolic"),
    "recent": ("Letzte Anrufe", "document-open-recent-symbolic"),
    "events": ("Nächste Termine", "x-office-calendar-symbolic"),
}
# Karten mit Listen dürfen in die Höhe wachsen, die anderen behalten ihre natürliche Größe
GROWS = {"recent", "events"}
# Ungefährer Platzbedarf, um die Karten gleichmäßig auf die Spalten zu verteilen
WEIGHT = {"status": 2, "today": 1, "favorites": 2, "recent": 3, "events": 3}
DEFAULT_LAYOUT = [["status", True], ["today", True], ["favorites", True], ["recent", True], ["events", True]]
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
        self.columns = 1
        # Spalten nebeneinander; Anzahl hängt von der Fensterbreite ab (siehe MainWindow._apply_layout)
        self.cards = Gtk.Box(spacing=16, homogeneous=True, vexpand=True)
        self.cards.set_margin_start(16)
        self.cards.set_margin_end(16)
        self.cards.set_margin_top(6)

        customize = Gtk.Button(halign=Gtk.Align.CENTER, css_classes=["flat", "pill-small"])
        content = Gtk.Box(spacing=8)
        content.append(Gtk.Image(icon_name="document-edit-symbolic"))
        content.append(Gtk.Label(label="Startseite anpassen"))
        customize.set_child(content)
        customize.connect("clicked", lambda *_: CustomizeDialog(self).present(self.window))
        customize.set_margin_top(12)
        customize.set_margin_bottom(12)

        outer = Gtk.Box(orientation=Gtk.Orientation.VERTICAL, vexpand=True)
        outer.append(self.cards)
        outer.append(customize)
        self.clamp = Adw.Clamp(maximum_size=1800, child=outer, vexpand=True)
        self.scroller = Gtk.ScrolledWindow(child=self.clamp, vexpand=True,
                                           hscrollbar_policy=Gtk.PolicyType.NEVER)
        self.append(self.scroller)
        # Zeitangaben („in 5 Min.“) und Termine aktuell halten
        GLib.timeout_add_seconds(60, lambda: (self.refresh(), True)[1])
        self.refresh()

    @property
    def settings(self):
        return self.app.store.settings.setdefault("home", {})

    @property
    def fill(self):
        """Mehrspaltig: Karten füllen die Höhe, Listen scrollen in der Karte."""
        return self.columns > 1

    def set_columns(self, columns):
        if columns != self.columns:
            self.columns = columns
            self.refresh()

    def refresh(self):
        while child := self.cards.get_first_child():
            self.cards.remove(child)
        builders = {"status": self._status, "today": self._today, "favorites": self._favorites,
                    "recent": self._recent, "events": self._events}
        cards = [(key, builders[key]()) for key, visible in layout(self.settings) if visible]
        n = max(1, min(self.columns, len(cards)))
        columns = [Gtk.Box(orientation=Gtk.Orientation.VERTICAL, spacing=16,
                           valign=Gtk.Align.FILL if self.fill else Gtk.Align.START) for _ in range(n)]
        placed = [[] for _ in range(n)]
        load = [0] * n
        # Reihenfolge beibehalten, aber jede Karte in die am wenigsten gefüllte Spalte setzen
        for key, card in cards:
            target = load.index(min(load))
            columns[target].append(card)
            placed[target].append((key, card))
            load[target] += WEIGHT.get(key, 1)
        if self.fill:
            for items in placed:
                growing = [card for key, card in items if key in GROWS]
                # Ohne wachsende Karte füllt die letzte Karte der Spalte den Rest
                for card in growing or [items[-1][1]]:
                    card.set_vexpand(True)
        for column in columns:
            self.cards.append(column)

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

    def _list(self, card, rows):
        """Liste in einer Karte; im Füllmodus scrollt sie innerhalb der Karte."""
        listbox = Gtk.ListBox(css_classes=["boxed-list", "inner-list"], selection_mode=Gtk.SelectionMode.NONE,
                              valign=Gtk.Align.START)
        for row in rows:
            listbox.append(row)
        if self.fill:
            card.append(Gtk.ScrolledWindow(child=listbox, vexpand=True, min_content_height=120,
                                           hscrollbar_policy=Gtk.PolicyType.NEVER))
        else:
            card.append(listbox)

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

    def _today(self):
        card = self._card("today")
        today = summary(self.app.store.history, 0)
        grid = Gtk.Box(spacing=8, homogeneous=True)
        for value, caption, css in (
            (today["incoming"] + today["outgoing"], "Gespräche", ""),
            (today["missed"], "Verpasst", "stat-missed" if today["missed"] else ""),
            (format_talk(today["talk"]), "Gesprächszeit", ""),
        ):
            tile = Gtk.Box(orientation=Gtk.Orientation.VERTICAL, spacing=2, css_classes=["stat-tile"])
            tile.append(Gtk.Label(label=str(value), xalign=0, css_classes=["stat-value"] + ([css] if css else [])))
            tile.append(Gtk.Label(label=caption, xalign=0, css_classes=["caption", "dim-label"]))
            grid.append(tile)
        card.append(grid)

        now = datetime.now()
        upcoming = [e for e in self.app.upcoming_week if not e.all_day and e.start > now]
        if upcoming:
            ev = upcoming[0]
            delta = ev.start - now
            if delta < timedelta(hours=1):
                when = f"in {max(1, int(delta.total_seconds() // 60))} Min."
            elif ev.start.date() == now.date():
                when = f"um {ev.start:%H:%M}"
            else:
                when = f"{day_label(ev.start.date())}, {ev.start:%H:%M}"
            card.append(label(f"Nächster Termin {when}: {ev.summary}", "caption", xalign=0))
        return card

    def _tile(self, name, number, size=56, caption_css="caption"):
        box = Gtk.Box(orientation=Gtk.Orientation.VERTICAL, spacing=6)
        box.append(Adw.Avatar(size=size, text=name, show_initials=True))
        box.append(label(name.split(" ")[0], caption_css, max_width_chars=10))
        btn = Gtk.Button(child=box, css_classes=["flat", "favorite-tile"],
                         tooltip_text=f"{name} – {number} anrufen" if number else name)
        btn.connect("clicked", lambda *_: number and self.app.dial(number))
        return btn

    def _flow(self, tiles):
        flow = Gtk.FlowBox(selection_mode=Gtk.SelectionMode.NONE, homogeneous=True, valign=Gtk.Align.START,
                           max_children_per_line=6, min_children_per_line=3, row_spacing=6, column_spacing=6)
        for tile in tiles:
            flow.append(tile)
        return flow

    def _favorites(self):
        card = self._card("favorites", ("Kontakte", lambda: self.window.views.set_visible_child_name("contacts")))
        favorites = [c for c in self.app.store.contacts if c.get("favorite")]
        if favorites:
            card.append(self._flow(self._tile(c["name"], (contact_numbers(c) or [""])[0]) for c in favorites))
        else:
            card.append(label("Öffne einen Kontakt und schalte „Favorit“ ein, um ihn hier anzuheften.",
                              "dim-label", wrap=True, xalign=0))
        # Im Füllmodus ist Platz für die häufigsten Gesprächspartner
        limit = 12 if self.fill else 4
        often = frequent(self.app.store.history, self.app.store, limit=limit,
                         exclude={c["id"] for c in favorites})
        if often:
            card.append(Gtk.Label(label="Häufig angerufen", xalign=0, css_classes=["heading", "home-subheading"]))
            card.append(self._flow(self._tile(name, number, size=44) for name, number, _n in often))
        return card

    def _recent(self):
        card = self._card("recent", ("Alle", lambda: self.window.views.set_visible_child_name("history")))
        history = self.app.store.history[:40 if self.fill else 5]
        if not history:
            card.append(label("Noch keine Anrufe.", "dim-label", xalign=0))
            return card
        self._list(card, (self.window.history._row(entry) for entry in history))
        return card

    def _events(self):
        card = self._card("events", ("Kalender", lambda: self.window.views.set_visible_child_name("calendar")))
        if not self.app.calendar.enabled_calendars():
            card.append(label("Kein Kalender verbunden – unter Einstellungen → Kalender einrichten.",
                              "dim-label", wrap=True, xalign=0))
            return card
        now = datetime.now()
        events = [e for e in self.app.upcoming_week if e.end > now][:40 if self.fill else 5]
        if not events:
            card.append(label("Keine Termine in den nächsten 7 Tagen.", "dim-label", xalign=0))
            return card
        self._list(card, (self._event_row(ev, now) for ev in events))
        return card

    def _event_row(self, ev, now):
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
        return row


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
