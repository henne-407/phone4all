"""Hauptfenster: Wählen, Kontakte, Verlauf und die Ansicht für laufende Anrufe."""

from gi.repository import Adw, Gdk, Gio, GLib, Gtk

from .calendar_page import CalendarPage
from .function_bar import FunctionBar
from .home_page import HomePage
from .calls import format_duration
from .stats import format_talk, frequent, summary
from .store import contact_numbers, normalize_number, numbers_match
from .widgets import (
    ContactDialog,
    DialPad,
    TransferPopover,
    format_time,
    label,
    labeled_toggle,
    round_button,
)


def _scrolled_list(listbox):
    clamp = Adw.Clamp(maximum_size=560, child=listbox)
    clamp.set_margin_start(12)
    clamp.set_margin_end(12)
    clamp.set_margin_bottom(18)
    return Gtk.ScrolledWindow(child=clamp, vexpand=True, hscrollbar_policy=Gtk.PolicyType.NEVER)


def _scrolled(child):
    """Kleine Fenster nicht abschneiden, sondern scrollen."""
    return Gtk.ScrolledWindow(child=child, hscrollbar_policy=Gtk.PolicyType.NEVER, vexpand=True)


# -- Wählen ------------------------------------------------------------------


class DialPage(Gtk.Box):
    def __init__(self, app):
        super().__init__(orientation=Gtk.Orientation.VERTICAL, spacing=14, valign=Gtk.Align.CENTER)
        self.app = app
        self.set_margin_top(12)
        self.set_margin_bottom(18)

        entry_box = Gtk.Box(spacing=6, halign=Gtk.Align.CENTER)
        entry_box.set_size_request(320, -1)
        spacer = Gtk.Box()
        spacer.set_size_request(40, -1)
        entry_box.append(spacer)
        self.entry = Gtk.Entry(
            has_frame=False,
            xalign=0.5,
            hexpand=True,
            placeholder_text="Nummer",
            input_purpose=Gtk.InputPurpose.PHONE,
            css_classes=["dial-entry"],
        )
        self.entry.connect("activate", lambda *_: self.dial())
        self.entry.connect("changed", self._on_changed)
        entry_box.append(self.entry)
        self.backspace = Gtk.Button(
            icon_name="edit-clear-symbolic",
            tooltip_text="Löschen",
            valign=Gtk.Align.CENTER,
            css_classes=["flat", "circular"],
            opacity=0,
        )
        self.backspace.connect("clicked", self._backspace)
        press = Gtk.GestureLongPress()
        press.connect("pressed", lambda *_: self.entry.set_text(""))
        self.backspace.add_controller(press)
        entry_box.append(self.backspace)
        self.append(entry_box)

        # Kontaktvorschläge beim Tippen
        self.match_label = Gtk.Button(css_classes=["flat", "match-button"], halign=Gtk.Align.CENTER)
        self.match_label.connect("clicked", self._use_match)
        self.match_revealer = Gtk.Revealer(child=self.match_label)
        self.match_revealer.set_size_request(-1, 34)
        self.append(self.match_revealer)
        self.match_number = None

        self.append(DialPad(self.insert))

        call = round_button("call-start-symbolic", "call", "Anrufen")
        call.set_margin_top(10)
        call.connect("clicked", lambda *_: self.dial())
        self.append(call)

    def focus(self):
        self.entry.grab_focus_without_selecting()
        self.entry.set_position(-1)

    def insert(self, digit):
        pos = self.entry.get_position()
        self.entry.insert_text(digit, pos)
        self.entry.set_position(pos + len(digit))

    def set_number(self, number):
        self.entry.set_text(number)
        self.entry.set_position(-1)

    def _backspace(self, *_):
        text = self.entry.get_text()
        pos = self.entry.get_position()
        if pos > 0:
            self.entry.delete_text(pos - 1, pos)
        elif text:
            self.entry.set_text(text[:-1])

    def _on_changed(self, *_):
        text = self.entry.get_text()
        self.backspace.set_opacity(1 if text else 0)
        matches = self.app.store.search_contacts(text) if len(text) >= 2 else []
        if matches:
            c = matches[0]
            self.match_number = c.get("phone") or c.get("mobile")
            more = f"  (+{len(matches) - 1})" if len(matches) > 1 else ""
            self.match_label.set_label(f"{c['name']} · {self.match_number}{more}")
            self.match_revealer.set_reveal_child(True)
            return
        self.match_number = None
        self.match_revealer.set_reveal_child(False)

    def _use_match(self, *_):
        if self.match_number:
            self.set_number(self.match_number)

    def dial(self):
        number = self.entry.get_text().strip()
        if not number:
            # Wahlwiederholung: letzte gewählte Nummer eintragen
            for entry in self.app.store.history:
                if entry["direction"] == "out":
                    self.set_number(entry["number"])
                    break
            return
        if self.match_number and not any(ch.isdigit() for ch in number):
            number = self.match_number
        if self.app.dial(number):
            self.entry.set_text("")


class DialSuggestions(Gtk.Box):
    """Seitenleiste neben der Wähltastatur (nur in breiten Fenstern):
    beim Tippen passende Kontakte, sonst die zuletzt verwendeten Nummern."""

    def __init__(self, app, dialer):
        super().__init__(orientation=Gtk.Orientation.VERTICAL, spacing=10, css_classes=["side-panel"],
                         hexpand=True, visible=False)
        self.app = app
        self.dialer = dialer
        self.title = Gtk.Label(xalign=0, css_classes=["home-card-title"])
        self.append(self.title)
        self.listbox = Gtk.ListBox(css_classes=["boxed-list", "inner-list"], valign=Gtk.Align.START,
                                   selection_mode=Gtk.SelectionMode.NONE)
        self.append(Gtk.ScrolledWindow(child=self.listbox, vexpand=True, hscrollbar_policy=Gtk.PolicyType.NEVER))
        self.empty = label("", "dim-label", wrap=True, xalign=0)
        self.append(self.empty)
        dialer.entry.connect("changed", lambda *_: self.refresh())
        self.refresh()

    def refresh(self):
        if not self.get_visible():
            return
        self.listbox.remove_all()
        text = self.dialer.entry.get_text().strip()
        rows = []
        if text:
            self.title.set_label(f"Treffer für „{text}“")
            for c in self.app.store.search_contacts(text)[:50]:
                for number in contact_numbers(c):
                    rows.append((c["name"], number, c.get("company") or c.get("source", "")))
        else:
            self.title.set_label("Zuletzt gewählt und angerufen")
            seen = set()
            for e in self.app.store.history:
                if e["number"] in seen:
                    continue
                seen.add(e["number"])
                contact = self.app.store.find_contact(e["number"])
                name = (contact or {}).get("name") or e.get("name") or e["number"]
                rows.append((name, e["number"], format_time(e["time"])))
                if len(rows) >= 50:
                    break
        for name, number, extra in rows:
            subtitle = f"{number} · {extra}" if extra and name != number else (extra or "")
            row = Adw.ActionRow(title=name, subtitle=subtitle if name != number else extra, activatable=True,
                                use_markup=False, title_lines=1, subtitle_lines=1,
                                tooltip_text="Nummer übernehmen")
            row.add_prefix(Adw.Avatar(size=36, text=name if name != number else "", show_initials=True))
            call = Gtk.Button(icon_name="call-start-symbolic", tooltip_text=f"{number} anrufen",
                              valign=Gtk.Align.CENTER, css_classes=["flat", "circular", "row-call"])
            call.connect("clicked", lambda _b, n=number: self.app.dial(n))
            row.add_suffix(call)
            row.connect("activated", lambda _r, n=number: self.dialer.set_number(n))
            self.listbox.append(row)
        self.listbox.set_visible(bool(rows))
        self.empty.set_label("Keine passenden Kontakte." if text else "Noch keine Anrufe.")
        self.empty.set_visible(not rows)


# -- Kontakte ----------------------------------------------------------------

MAX_LIST = 200  # mehr Zeilen machen die Liste bei großen Datenbanken träge


class ContactsPage(Gtk.Box):
    def __init__(self, app, window):
        super().__init__(spacing=0)
        self.app = app
        self.window = window
        self.wide = False
        self.list_side = Gtk.Box(orientation=Gtk.Orientation.VERTICAL, hexpand=True)
        self.append(self.list_side)
        self.detail = ContactDetail(app, window, self)
        self.append(self.detail)

        bar = Gtk.Box(spacing=8)
        for side in ("start", "end"):
            getattr(bar, f"set_margin_{side}")(12)
        bar.set_margin_top(6)
        bar.set_margin_bottom(12)
        clamp = Adw.Clamp(maximum_size=560, child=bar)
        self.search = Gtk.SearchEntry(placeholder_text="Kontakte durchsuchen", hexpand=True)
        self.search.connect("search-changed", lambda *_: self.refresh())
        self.search.connect("activate", self._call_first)
        bar.append(self.search)
        menu = Gio.Menu()
        menu.append("Aus Datei importieren …", "app.import-contacts")
        menu.append("Adressbücher aktualisieren", "app.sync-contacts")
        menu.append("Adressbücher verwalten …", "app.addressbooks")
        bar.append(Gtk.MenuButton(icon_name="view-more-symbolic", menu_model=menu, valign=Gtk.Align.CENTER,
                                  tooltip_text="Importieren und Adressbücher", css_classes=["flat", "circular"]))
        self.list_side.append(clamp)

        self.listbox = Gtk.ListBox(css_classes=["boxed-list"], selection_mode=Gtk.SelectionMode.NONE,
                                   valign=Gtk.Align.START)
        self.stack = Gtk.Stack(vexpand=True)
        contacts_list = _scrolled_list(self.listbox)
        contacts_list.get_child().get_child().set_margin_bottom(96)  # Platz für den FAB
        self.stack.add_named(contacts_list, "list")
        empty = Adw.StatusPage(
            icon_name="x-office-address-book-symbolic",
            title="Noch keine Kontakte",
            description="Lege Kontakte an, importiere sie aus einer Datei (vCard, CSV) oder verbinde ein "
                        "Adressbuch, um Anrufer zu erkennen und mit einem Klick anzurufen.",
        )
        empty_buttons = Gtk.Box(orientation=Gtk.Orientation.VERTICAL, spacing=12, halign=Gtk.Align.CENTER)
        for text, css, action in (("Kontakt anlegen", "suggested-action", lambda *_: self.edit({})),
                                  ("Aus Datei importieren", "pill", lambda *_: self.app.import_contacts())):
            b = Gtk.Button(label=text, css_classes=["pill", css])
            b.connect("clicked", action)
            empty_buttons.append(b)
        empty.set_child(empty_buttons)
        self.stack.add_named(empty, "empty")
        self.stack.add_named(
            Adw.StatusPage(icon_name="system-search-symbolic", title="Keine Treffer"), "nomatch"
        )
        self.list_side.append(self.stack)
        self.refresh()

    def set_wide(self, wide):
        """Breit: Liste links (feste Breite), Details rechts."""
        self.wide = wide
        self.detail.set_visible(wide)
        self.list_side.set_hexpand(not wide)
        self.list_side.set_size_request(420 if wide else -1, -1)
        if wide and self.detail.contact is None and self.visible_contacts:
            self.detail.show(self.visible_contacts[0])

    def refresh(self):
        self.listbox.remove_all()
        contacts = self.app.store.search_contacts(self.search.get_text())
        self.visible_contacts = contacts
        for c in contacts[:MAX_LIST]:
            self.listbox.append(self._row(c))
        if len(contacts) > MAX_LIST:
            more = Adw.ActionRow(title=f"… und {len(contacts) - MAX_LIST} weitere",
                                 subtitle="Suchfeld verwenden, um sie zu finden", css_classes=["dim-label"])
            self.listbox.append(more)
        if contacts:
            self.stack.set_visible_child_name("list")
        else:
            has_any = self.app.store.contacts or self.app.store.external
            self.stack.set_visible_child_name("nomatch" if has_any else "empty")

    def _row(self, c):
        numbers = [(k, c[k]) for k in ("phone", "mobile") if c.get(k)]
        numbers += [("other", n) for n in c.get("other", [])]
        subtitle = " · ".join(n for _, n in numbers)
        if c.get("company"):
            subtitle = f"{c['company']} — {subtitle}"
        if c.get("source"):
            subtitle = f"{c['source']} — {subtitle}"
        row = Adw.ActionRow(title=c["name"], subtitle=subtitle, activatable=True,
                            use_markup=False, title_lines=1, subtitle_lines=1)
        row.add_prefix(Adw.Avatar(size=40, text=c["name"], show_initials=True))
        row.connect("activated", lambda *_: self.detail.show(c) if self.wide else self.edit(c))

        if len(numbers) == 1:
            btn = Gtk.Button(icon_name="call-start-symbolic", tooltip_text=f"{numbers[0][1]} anrufen",
                             valign=Gtk.Align.CENTER, css_classes=["flat", "circular", "row-call"])
            btn.connect("clicked", lambda *_: self.app.dial(numbers[0][1]))
        else:
            box = Gtk.Box(orientation=Gtk.Orientation.VERTICAL, spacing=2)
            pop = Gtk.Popover(child=box)
            for key, number in numbers:
                item = Gtk.Button(css_classes=["flat"])
                kind = {"phone": "Telefon", "mobile": "Mobil"}.get(key, "Weitere")
                item.set_child(Gtk.Label(label=f"{kind}:  {number}", xalign=0))
                item.connect("clicked", lambda _b, n=number: (pop.popdown(), self.app.dial(n)))
                box.append(item)
            btn = Gtk.MenuButton(icon_name="call-start-symbolic", popover=pop, tooltip_text="Anrufen",
                                 valign=Gtk.Align.CENTER, css_classes=["flat", "circular", "row-call"])
        if c.get("readonly"):
            row.add_suffix(Gtk.Image(icon_name="x-office-address-book-symbolic", css_classes=["dim-label"],
                                     tooltip_text=f"Aus Adressbuch: {c.get('source', '')}"))
        row.add_suffix(btn)
        return row

    def _call_first(self, *_):
        if self.visible_contacts:
            c = self.visible_contacts[0]
            self.app.dial(c.get("phone") or c.get("mobile") or (c.get("other") or [""])[0])

    def edit(self, contact):
        dialog = ContactDialog(contact, self._save, self._delete, on_call=self.app.dial)
        dialog.present(self.window)

    def _save(self, contact):
        self.app.store.upsert_contact(contact)
        self.window.contacts_changed()
        if self.wide:
            self.detail.show(contact)

    def _delete(self, contact):
        self.app.store.delete_contact(contact["id"])
        if self.detail.contact and self.detail.contact.get("id") == contact["id"]:
            self.detail.show(None)
        self.window.contacts_changed()
        self.window.toast(f"„{contact['name']}“ gelöscht")


class ContactDetail(Gtk.Box):
    """Detailansicht eines Kontakts (rechte Seite in breiten Fenstern)."""

    def __init__(self, app, window, page):
        super().__init__(orientation=Gtk.Orientation.VERTICAL, hexpand=True, visible=False,
                         css_classes=["detail-pane"])
        self.app = app
        self.window = window
        self.page = page
        self.contact = None
        self.stack = Gtk.Stack(vexpand=True)
        self.stack.add_named(Adw.StatusPage(icon_name="avatar-default-symbolic", title="Kontakt auswählen",
                                            description="Links einen Kontakt anklicken, um Details und "
                                                        "gemeinsame Anrufe zu sehen."), "empty")
        self.body = Gtk.Box(orientation=Gtk.Orientation.VERTICAL, spacing=18)
        self.body.set_margin_top(18)
        self.body.set_margin_bottom(96)
        self.body.set_margin_start(24)
        self.body.set_margin_end(24)
        clamp = Adw.Clamp(maximum_size=720, child=self.body)
        self.stack.add_named(Gtk.ScrolledWindow(child=clamp, hscrollbar_policy=Gtk.PolicyType.NEVER), "detail")
        self.append(self.stack)

    def refresh(self):
        if self.contact is None:
            return
        # Kontakt nach Änderungen neu nachschlagen (Bearbeiten, Sync)
        cid = self.contact.get("id")
        fresh = next((c for c in self.app.store.all_contacts() if c.get("id") == cid), None)
        self.show(fresh)

    def show(self, contact):
        self.contact = contact
        while child := self.body.get_first_child():
            self.body.remove(child)
        if contact is None:
            self.stack.set_visible_child_name("empty")
            return
        self.stack.set_visible_child_name("detail")
        numbers = contact_numbers(contact)

        head = Gtk.Box(spacing=20)
        head.append(Adw.Avatar(size=96, text=contact["name"], show_initials=True))
        info = Gtk.Box(orientation=Gtk.Orientation.VERTICAL, spacing=4, valign=Gtk.Align.CENTER, hexpand=True)
        info.append(label(contact["name"], "title-1", xalign=0))
        sub = " · ".join(x for x in (contact.get("company"), contact.get("source")) if x)
        if sub:
            info.append(label(sub, "dim-label", xalign=0))
        actions = Gtk.Box(spacing=8)
        actions.set_margin_top(10)
        if numbers:
            call = Gtk.Button(css_classes=["pill", "call-pill"])
            content = Gtk.Box(spacing=8)
            content.append(Gtk.Image(icon_name="call-start-symbolic"))
            content.append(Gtk.Label(label="Anrufen"))
            call.set_child(content)
            call.connect("clicked", lambda *_: self.app.dial(numbers[0]))
            actions.append(call)
        if contact.get("readonly"):
            edit = Gtk.Button(label="Als eigenen Kontakt übernehmen", css_classes=["pill"])
            edit.connect("clicked", lambda *_: self.page.edit(contact))
        else:
            edit = Gtk.Button(label="Bearbeiten", css_classes=["pill"])
            edit.connect("clicked", lambda *_: self.page.edit(contact))
            star = Gtk.ToggleButton(icon_name="starred-symbolic", active=bool(contact.get("favorite")),
                                    tooltip_text="Favorit auf der Startseite", css_classes=["circular", "star"])
            star.connect("toggled", lambda b: self._set_favorite(b.get_active()))
            actions.append(edit)
            actions.append(star)
            edit = None
        if edit is not None:
            actions.append(edit)
        info.append(actions)
        head.append(info)
        self.body.append(head)

        group = Adw.PreferencesGroup(title="Rufnummern")
        kinds = {contact.get("phone"): "Telefon", contact.get("mobile"): "Mobil"}
        for number in numbers:
            row = Adw.ActionRow(title=number, subtitle=kinds.get(number, "Weitere"), use_markup=False,
                                activatable=True)
            row.connect("activated", lambda _r, n=number: self.app.dial(n))
            plan = Gtk.Button(icon_name="appointment-new-symbolic", tooltip_text="Rückruf planen",
                              valign=Gtk.Align.CENTER, css_classes=["flat", "circular"])
            plan.connect("clicked", lambda _b, n=number: self.app.schedule_callback(n, contact["name"]))
            row.add_suffix(plan)
            call = Gtk.Button(icon_name="call-start-symbolic", tooltip_text=f"{number} anrufen",
                              valign=Gtk.Align.CENTER, css_classes=["flat", "circular", "row-call"])
            call.connect("clicked", lambda _b, n=number: self.app.dial(n))
            row.add_suffix(call)
            group.add(row)
        self.body.append(group)

        calls = [e for e in self.app.store.history
                 if any(numbers_match(e["number"], n) for n in numbers)][:20]
        hist = Adw.PreferencesGroup(title="Gemeinsame Anrufe")
        if calls:
            total = sum(e.get("duration", 0) for e in calls)
            hist.set_description(f"{len(calls)} Anrufe · {format_duration(total)} Gesprächszeit")
            for e in calls:
                hist.add(self.window.history._row(e))
        else:
            hist.add(Adw.ActionRow(title="Noch keine Anrufe mit diesem Kontakt"))
        self.body.append(hist)

    def _set_favorite(self, active):
        self.contact["favorite"] = active
        self.app.store.upsert_contact(self.contact)
        self.window.home.refresh()


# -- Verlauf -----------------------------------------------------------------


HISTORY_FILTERS = [
    ("all", "Alle", lambda e: True),
    ("missed", "Verpasst", lambda e: e["missed"]),
    ("in", "Eingehend", lambda e: e["direction"] == "in" and not e["missed"]),
    ("out", "Ausgehend", lambda e: e["direction"] == "out"),
]


class HistoryPage(Gtk.Box):
    def __init__(self, app, window):
        super().__init__(spacing=16)
        self.app = app
        self.window = window
        self.filter = "all"
        main = Gtk.Box(orientation=Gtk.Orientation.VERTICAL, hexpand=True)
        self.append(main)

        chips = Gtk.Box(spacing=8, halign=Gtk.Align.CENTER)
        chips.set_margin_top(6)
        chips.set_margin_bottom(10)
        first = None
        for key, text, _fn in HISTORY_FILTERS:
            chip = Gtk.ToggleButton(label=text, active=key == "all", css_classes=["filter-chip"])
            if first is None:
                first = chip
            else:
                chip.set_group(first)
            chip.connect("toggled", lambda b, k=key: b.get_active() and self._set_filter(k))
            chips.append(chip)
        main.append(chips)

        self.listbox = Gtk.ListBox(css_classes=["boxed-list"], selection_mode=Gtk.SelectionMode.NONE,
                                   valign=Gtk.Align.START)
        self.stack = Gtk.Stack(vexpand=True)
        self.list_scroller = _scrolled_list(self.listbox)
        self.stack.add_named(self.list_scroller, "list")
        self.stack.add_named(
            Adw.StatusPage(icon_name="document-open-recent-symbolic", title="Keine Anrufe",
                           description="Hier erscheinen deine ein- und ausgehenden Anrufe."),
            "empty",
        )
        main.append(self.stack)

        self.side = Gtk.Box(orientation=Gtk.Orientation.VERTICAL, spacing=14, css_classes=["side-panel"])
        # Bei niedrigen Fenstern scrollt die ganze Seitenleiste
        self.side_scroller = Gtk.ScrolledWindow(child=self.side, visible=False,
                                                hscrollbar_policy=Gtk.PolicyType.NEVER)
        self.side_scroller.set_size_request(360, -1)
        self.append(self.side_scroller)
        self.refresh()

    def set_wide(self, wide):
        self.side_scroller.set_visible(wide)
        self.list_scroller.get_child().get_child().set_maximum_size(900 if wide else 560)
        self._fill_side()

    def _set_filter(self, key):
        self.filter = key
        self.refresh()

    def refresh(self):
        self.listbox.remove_all()
        fn = next(f for k, _t, f in HISTORY_FILTERS if k == self.filter)
        entries = [e for e in self.app.store.history if fn(e)]
        for entry in entries:
            self.listbox.append(self._row(entry))
        self.stack.set_visible_child_name("list" if entries else "empty")
        self._fill_side()

    def _fill_side(self):
        if not self.side_scroller.get_visible():
            return
        while child := self.side.get_first_child():
            self.side.remove(child)
        history = self.app.store.history
        for title, days in (("Heute", 0), ("Letzte 7 Tage", 6)):
            data = summary(history, days)
            card = Gtk.Box(orientation=Gtk.Orientation.VERTICAL, spacing=8, css_classes=["home-card"])
            card.append(Gtk.Label(label=title, xalign=0, css_classes=["home-card-title"]))
            grid = Gtk.Grid(column_spacing=12, row_spacing=10, column_homogeneous=True)
            for i, (value, caption, css) in enumerate((
                (data["incoming"], "Angenommen", ""), (data["outgoing"], "Ausgehend", ""),
                (data["missed"], "Verpasst", "stat-missed" if data["missed"] else ""),
                (format_talk(data["talk"]), "Gesprächszeit", ""),
            )):
                tile = Gtk.Box(orientation=Gtk.Orientation.VERTICAL, css_classes=["stat-tile"])
                tile.append(Gtk.Label(label=str(value), xalign=0, css_classes=["stat-value"] + ([css] if css else [])))
                tile.append(Gtk.Label(label=caption, xalign=0, css_classes=["caption", "dim-label"]))
                grid.attach(tile, i % 2, i // 2, 1, 1)
            card.append(grid)
            self.side.append(card)

        top = frequent(history, self.app.store, limit=8, days=30)
        card = Gtk.Box(orientation=Gtk.Orientation.VERTICAL, spacing=8, css_classes=["home-card"])
        card.append(Gtk.Label(label="Häufigste Kontakte (30 Tage)", xalign=0, css_classes=["home-card-title"]))
        if top:
            listbox = Gtk.ListBox(css_classes=["boxed-list", "inner-list"], selection_mode=Gtk.SelectionMode.NONE)
            for name, number, count in top:
                row = Adw.ActionRow(title=name, subtitle=f"{count} Anruf{'e' if count != 1 else ''}",
                                    use_markup=False, title_lines=1)
                row.add_prefix(Adw.Avatar(size=32, text=name if name != number else "", show_initials=True))
                call = Gtk.Button(icon_name="call-start-symbolic", tooltip_text=f"{number} anrufen",
                                  valign=Gtk.Align.CENTER, css_classes=["flat", "circular", "row-call"])
                call.connect("clicked", lambda _b, n=number: self.app.dial(n))
                row.add_suffix(call)
                listbox.append(row)
            card.append(listbox)
        else:
            card.append(label("Noch keine Daten.", "dim-label", xalign=0))
        self.side.append(card)

    def _row(self, e):
        contact = self.app.store.find_contact(e["number"])
        name = contact["name"] if contact else (e.get("name") or e["number"])
        details = [format_time(e["time"])]
        if e["missed"]:
            icon, details = "call-missed-symbolic", details + ["Verpasst"]
        elif e["direction"] == "in":
            icon = "call-incoming-symbolic"
        else:
            icon = "call-outgoing-symbolic"
        if e["duration"]:
            details.append(format_duration(e["duration"]))
        if name != e["number"]:
            details.insert(0, e["number"])

        row = Adw.ActionRow(title=name, subtitle=" · ".join(details), activatable=True,
                            use_markup=False, title_lines=1, subtitle_lines=1)
        row.set_tooltip_text("Zurückrufen")
        img = Gtk.Image(icon_name=icon)
        if e["missed"]:
            img.add_css_class("error")
            row.add_css_class("missed")
        row.add_prefix(img)
        row.connect("activated", lambda *_: self.app.dial(e["number"]))
        row.add_suffix(self._menu(e, name, contact))
        return row

    def _menu(self, e, name, contact):
        box = Gtk.Box(orientation=Gtk.Orientation.VERTICAL, spacing=2)
        pop = Gtk.Popover(child=box, css_classes=["menu-popover"])
        items = [("appointment-new-symbolic", "Rückruf planen",
                  lambda: self.app.schedule_callback(e["number"], name if name != e["number"] else ""))]
        if not contact:
            items.append(("contact-new-symbolic", "Als Kontakt speichern",
                          lambda: self.window.contacts.edit({"name": e.get("name") or "", "phone": e["number"]})))
        for icon, text, action in items:
            item = Gtk.Button(css_classes=["flat"])
            content = Gtk.Box(spacing=12)
            content.append(Gtk.Image(icon_name=icon))
            content.append(Gtk.Label(label=text, xalign=0))
            item.set_child(content)
            item.connect("clicked", lambda _b, a=action: (pop.popdown(), a()))
            box.append(item)
        return Gtk.MenuButton(icon_name="view-more-symbolic", popover=pop, tooltip_text="Weitere Aktionen",
                              valign=Gtk.Align.CENTER, css_classes=["flat", "circular"])


# -- Laufender Anruf ---------------------------------------------------------


class CallView(Gtk.Box):
    def __init__(self, app):
        super().__init__(orientation=Gtk.Orientation.VERTICAL, spacing=6, valign=Gtk.Align.CENTER)
        self.app = app
        self.call = None
        self.set_margin_top(24)
        self.set_margin_bottom(24)

        self.avatar = Adw.Avatar(size=112, show_initials=True, halign=Gtk.Align.CENTER)
        self.avatar.set_margin_bottom(12)
        self.append(self.avatar)
        self.title = label("", "title-1", max_width_chars=22)
        self.append(self.title)
        self.number = label("", "dim-label")
        self.append(self.number)
        self.status = label("", "call-status", "numeric")
        self.status.set_margin_top(4)
        self.append(self.status)

        self.dtmf_label = label("", "dtmf-digits", "numeric")
        self.dtmf_pad = Gtk.Box(orientation=Gtk.Orientation.VERTICAL, spacing=8)
        self.dtmf_pad.append(self.dtmf_label)
        self.dtmf_pad.append(DialPad(self._dtmf, compact=True))
        self.dtmf_revealer = Gtk.Revealer(child=self.dtmf_pad,
                                          transition_type=Gtk.RevealerTransitionType.SLIDE_DOWN)
        self.dtmf_revealer.set_margin_top(12)
        self.append(self.dtmf_revealer)

        # Steuerelemente während des Gesprächs
        self.controls = Gtk.Box(spacing=14, halign=Gtk.Align.CENTER)
        self.controls.set_margin_top(28)
        box, self.mute = labeled_toggle("microphone-sensitivity-muted-symbolic", "Stumm")
        self.mute_handler = self.mute.connect("toggled", lambda *_: self.app.set_mute(self.mute.get_active()))
        self.controls.append(box)
        box, self.hold = labeled_toggle("media-playback-pause-symbolic", "Halten")
        self.hold_handler = self.hold.connect("toggled", lambda *_: self.app.set_hold(self.hold.get_active()))
        self.controls.append(box)
        box, self.keypad = labeled_toggle("input-dialpad-symbolic", "Tastatur")
        self.keypad.connect("toggled", self._on_keypad_toggled)
        self.controls.append(box)
        transfer = Gtk.MenuButton(icon_name="mail-forward-symbolic", css_classes=["call-toggle"],
                                  halign=Gtk.Align.CENTER, tooltip_text="Weiterleiten")
        transfer.set_popover(TransferPopover(app, lambda t: self.call and app.transfer(self.call.id, t)))
        box = Gtk.Box(orientation=Gtk.Orientation.VERTICAL, spacing=6)
        box.append(transfer)
        box.append(Gtk.Label(label="Weiterleiten", css_classes=["caption", "dim-label"]))
        self.controls.append(box)
        box, schedule = labeled_toggle("appointment-new-symbolic", "Termin", toggle=False)
        schedule.set_tooltip_text("Rückruf oder Folgetermin planen")
        schedule.connect("clicked", lambda *_: self.call and self.app.schedule_callback(
            self.call.number, self.call.name))
        self.controls.append(box)
        self.append(self.controls)

        buttons = Gtk.Box(spacing=48, halign=Gtk.Align.CENTER)
        buttons.set_margin_top(28)
        self.decline = round_button("call-stop-symbolic", "hangup", "Auflegen")
        self.decline.connect("clicked", lambda *_: self.app.hangup(self.call.id if self.call else None))
        buttons.append(self.decline)
        self.accept = round_button("call-start-symbolic", "call", "Annehmen")
        self.accept.connect("clicked", lambda *_: self.app.accept(self.call.id))
        buttons.append(self.accept)
        self.append(buttons)

    def set_call(self, call):
        new_call = call is not self.call
        self.call = call
        if call is None:
            return
        if new_call:
            self.keypad.set_active(False)
            self.dtmf_label.set_label("")
        self.avatar.set_text(call.name or "")
        self.title.set_label(call.title)
        self.number.set_label(call.number if call.name else "")
        self.number.set_visible(bool(call.name))
        self.update_status()

        incoming = call.state == "incoming"
        self.accept.set_visible(incoming)
        self.decline.set_tooltip_text("Ablehnen" if incoming else "Auflegen")
        self.controls.set_sensitive(call.state == "established")
        self.controls.set_visible(not incoming)
        for toggle, handler, value in ((self.mute, self.mute_handler, call.muted),
                                       (self.hold, self.hold_handler, call.held)):
            toggle.handler_block(handler)
            toggle.set_active(value)
            toggle.handler_unblock(handler)

    def _on_keypad_toggled(self, toggle):
        # Avatar ausblenden, damit die Tastatur ohne Scrollen Platz hat
        self.avatar.set_visible(not toggle.get_active())
        self.dtmf_revealer.set_reveal_child(toggle.get_active())

    def update_status(self):
        if self.call:
            self.status.set_label(self.call.status_text())

    def _dtmf(self, digit):
        self.dtmf_label.set_label((self.dtmf_label.get_label() + digit)[-24:])
        self.app.send_dtmf(digit)

    def handle_key(self, keyval):
        """Tastatureingaben während eines Gesprächs als DTMF senden."""
        char = chr(Gdk.keyval_to_unicode(keyval) or 0)
        if self.call and self.call.state == "established" and char in "0123456789*#":
            self._dtmf(char)
            return True
        return False


# -- Fenster -----------------------------------------------------------------


class MainWindow(Adw.ApplicationWindow):
    def __init__(self, app):
        super().__init__(application=app, title="SIP-Telefon", default_width=420, default_height=720)
        self.set_size_request(360, 560)
        self.app = app

        self.window_title = Adw.WindowTitle(title="SIP-Telefon")
        # Eine gemeinsame Leiste: Status und Bedienelemente sitzen direkt in der Titelleiste
        header = Adw.HeaderBar(title_widget=self.window_title, css_classes=["main-header"])
        self.function_bar = FunctionBar(app)
        header.pack_start(self.function_bar.start)
        # Status steht jetzt in der Funktionsleiste; der Punkt bleibt für set_status erhalten, aber unsichtbar
        self.status_dot = Gtk.Box(css_classes=["status-dot"], valign=Gtk.Align.CENTER, visible=False)
        header.pack_start(self.status_dot)
        menu = Gtk.Builder.new_from_string(
            """
            <interface><menu id="m">
              <section>
                <item><attribute name="label">Einstellungen</attribute>
                      <attribute name="action">app.preferences</attribute></item>
                <item><attribute name="label">Verlauf löschen</attribute>
                      <attribute name="action">app.clear-history</attribute></item>
                <item><attribute name="label">Neu verbinden</attribute>
                      <attribute name="action">app.reconnect</attribute></item>
              </section>
              <section>
                <item><attribute name="label">Über SIP-Telefon</attribute>
                      <attribute name="action">app.about</attribute></item>
                <item><attribute name="label">Beenden</attribute>
                      <attribute name="action">app.quit</attribute></item>
              </section>
            </menu></interface>""",
            -1,
        ).get_object("m")
        header.pack_end(Gtk.MenuButton(icon_name="open-menu-symbolic", menu_model=menu,
                                       primary=True, tooltip_text="Hauptmenü"))
        header.pack_end(self.function_bar.end)

        self.banner = Adw.Banner(button_label="Einrichten", action_name="app.preferences")

        self.dialer = DialPage(app)
        self.contacts = ContactsPage(app, self)
        contacts_page = Gtk.Overlay(child=self.contacts)
        fab = Gtk.Button(icon_name="contact-new-symbolic", tooltip_text="Neuer Kontakt",
                         halign=Gtk.Align.END, valign=Gtk.Align.END, css_classes=["fab"])
        fab.set_margin_end(18)
        fab.set_margin_bottom(18)
        fab.connect("clicked", lambda *_: self.contacts.edit({}))
        contacts_page.add_overlay(fab)
        self.calendar = CalendarPage(app, self)
        self.history = HistoryPage(app, self)
        self.home = HomePage(app, self)  # nutzt Zeilen aus Verlauf und Kalender, daher zuletzt
        self.views = Adw.ViewStack()
        self.views.add_titled_with_icon(self.home, "home", "Start", "go-home-symbolic")
        self.dial_suggestions = DialSuggestions(app, self.dialer)
        dial_view = Gtk.Box(spacing=16, css_classes=["wide-page"])
        dial_scroller = _scrolled(self.dialer)
        dial_scroller.set_hexpand(True)
        dial_view.append(dial_scroller)
        dial_view.append(self.dial_suggestions)
        self.views.add_titled_with_icon(dial_view, "dial", "Wählen", "input-dialpad-symbolic")
        self.views.add_titled_with_icon(contacts_page, "contacts", "Kontakte", "x-office-address-book-symbolic")
        self.views.add_titled_with_icon(self.calendar, "calendar", "Kalender", "x-office-calendar-symbolic")
        self.history_page = self.views.add_titled_with_icon(
            self.history, "history", "Verlauf", "document-open-recent-symbolic")
        self.views.set_visible_child_name(app.store.settings.get("home", {}).get("start_tab", "home"))
        self.views.connect("notify::visible-child-name", self._on_page_changed)

        self.call_view = CallView(app)
        self.main_stack = Gtk.Stack(transition_type=Gtk.StackTransitionType.CROSSFADE)
        self.main_stack.add_named(self.views, "pages")
        self.main_stack.add_named(_scrolled(self.call_view), "call")

        self.toasts = Adw.ToastOverlay(child=self.main_stack)
        self.switcher = Adw.ViewSwitcherBar(stack=self.views, reveal=True)

        view = Adw.ToolbarView(content=self.toasts)
        view.add_top_bar(header)
        view.add_top_bar(self.banner)
        view.add_bottom_bar(self.switcher)
        self.set_content(view)

        # Breakpoints: Funktionsleiste kompakt bzw. Startseite mehrspaltig
        self.layouts = {}
        for name, condition in (("narrow", "max-width: 560sp"), ("two", "min-width: 760sp"),
                                ("three", "min-width: 1160sp")):
            bp = Adw.Breakpoint.new(Adw.BreakpointCondition.parse(condition))
            self.add_breakpoint(bp)
            self.layouts[bp] = name
        self.connect("notify::current-breakpoint", lambda *_: self._apply_layout())
        self._apply_layout()

        keys = Gtk.EventControllerKey()
        keys.connect("key-pressed", self._on_key)
        self.add_controller(keys)
        self.connect("close-request", self._on_close)
        GLib.idle_add(self.dialer.focus)

    def _apply_layout(self):
        layout = self.layouts.get(self.get_current_breakpoint(), "normal")
        self.function_bar.set_compact(layout == "narrow")
        self.window_title.set_visible(layout != "narrow")  # im schmalen Fenster Platz für die Knöpfe
        self.home.set_columns({"two": 2, "three": 3}.get(layout, 1))
        wide = layout in ("two", "three")
        self.dial_suggestions.set_visible(wide)
        self.dial_suggestions.refresh()
        self.contacts.set_wide(wide)
        self.calendar.set_wide(wide)
        self.history.set_wide(wide)

    def _on_page_changed(self, *_):
        name = self.views.get_visible_child_name()
        if name == "dial":
            self.dialer.focus()
        elif name == "history":
            self.history_page.set_needs_attention(False)

    def _on_key(self, _ctrl, keyval, _code, state):
        if self.main_stack.get_visible_child_name() == "call":
            return self.call_view.handle_key(keyval)
        if state & (Gdk.ModifierType.CONTROL_MASK | Gdk.ModifierType.ALT_MASK):
            return False
        # Auf der Wählseite landen Ziffern immer im Eingabefeld
        char = chr(Gdk.keyval_to_unicode(keyval) or 0)
        if self.views.get_visible_child_name() == "dial" and char and char in "0123456789*#+" \
                and not self.dialer.entry.has_focus():
            self.dialer.focus()
            self.dialer.insert(char)
            return True
        return False

    def _on_close(self, *_):
        if self.app.store.settings.get("run_in_background", True):
            self.set_visible(False)
            return True
        self.app.quit()
        return False

    # -- von der App aufgerufen --------------------------------------------

    def set_status(self, text, kind):
        """kind: ok | busy | error | off"""
        # Der Status steht im Anmelde-Chip der Titelleiste, nicht mehr als Untertitel
        for k in ("ok", "busy", "error", "off", "dnd"):
            self.status_dot.remove_css_class(k)
        self.status_dot.add_css_class(kind)
        self.status_dot.set_tooltip_text(text)

    def show_banner(self, text, button=None, action=None):
        if text:
            self.banner.set_title(text)
            self.banner.set_button_label(button)
            self.banner.set_action_name(action)
        self.banner.set_revealed(bool(text))

    def show_call(self, call):
        self.call_view.set_call(call)
        if call is None:
            self.main_stack.set_visible_child_name("pages")
            self.switcher.set_reveal(True)
            self.dialer.focus()
        else:
            self.main_stack.set_visible_child_name("call")
            self.switcher.set_reveal(False)

    def update_call_status(self):
        self.call_view.update_status()

    def history_changed(self, missed=False):
        self.history.refresh()
        self.dial_suggestions.refresh()
        self.home.refresh()
        if missed and self.views.get_visible_child_name() != "history":
            self.history_page.set_needs_attention(True)

    def contacts_changed(self):
        self.contacts.refresh()
        self.contacts.detail.refresh()
        self.history.refresh()
        self.home.refresh()

    def toast(self, text):
        self.toasts.add_toast(Adw.Toast(title=text, timeout=3))

    def open_dialer(self, number=""):
        self.views.set_visible_child_name("dial")
        if number:
            self.dialer.set_number(normalize_number(number))
