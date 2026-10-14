"""Kalender-Tab: Monatsansicht, Terminliste und Termin-Dialog."""

import hashlib
from datetime import date, datetime, timedelta

from gi.repository import Adw, Gdk, GLib, Gtk

from .calendars import Event
from .widgets import label

WEEKDAYS = ["Mo", "Di", "Mi", "Do", "Fr", "Sa", "So"]

# -- Kalenderfarben als CSS-Klassen --------------------------------------------

_color_provider = None
_color_rules = {}


def color_class(color):
    """Liefert eine CSS-Klasse, die Hintergrund/Farbe auf `color` setzt."""
    global _color_provider
    name = "calcolor-" + hashlib.md5(color.encode()).hexdigest()[:8]
    if name not in _color_rules:
        _color_rules[name] = f".{name} {{ background-color: {color}; }}"
        if _color_provider is None:
            _color_provider = Gtk.CssProvider()
            Gtk.StyleContext.add_provider_for_display(
                Gdk.Display.get_default(), _color_provider, Gtk.STYLE_PROVIDER_PRIORITY_APPLICATION + 1)
        _color_provider.load_from_string("\n".join(_color_rules.values()))
    return name


def fmt_day(d, long=True):
    gdt = GLib.DateTime.new_local(d.year, d.month, d.day, 0, 0, 0)
    return gdt.format("%A, %-d. %B" if long else "%a, %-d. %b %Y")


def fmt_event_time(ev, day=None):
    if ev.all_day:
        days = (ev.end - ev.start).days
        return "Ganztägig" if days <= 1 else f"Ganztägig · bis {fmt_day((ev.end - timedelta(days=1)).date(), False)}"
    if day and ev.start.date() < day:
        start = "Seit " + ev.start.strftime("%d.%m. %H:%M")
    else:
        start = ev.start.strftime("%H:%M")
    end = ev.end.strftime("%H:%M") if ev.end.date() == ev.start.date() else ev.end.strftime("%d.%m. %H:%M")
    return f"{start} – {end}"


# -- Monatsansicht ---------------------------------------------------------------


class MonthView(Gtk.Box):
    def __init__(self, on_select, on_month_changed):
        super().__init__(orientation=Gtk.Orientation.VERTICAL, spacing=6, css_classes=["month-view"])
        self.on_select = on_select
        self.on_month_changed = on_month_changed
        self.selected = date.today()
        self.year, self.month = self.selected.year, self.selected.month
        self.marks = {}

        header = Gtk.Box(spacing=4)
        self.title = Gtk.Label(xalign=0, hexpand=True, css_classes=["month-title"])
        header.append(self.title)
        today = Gtk.Button(label="Heute", css_classes=["flat", "pill-small"], valign=Gtk.Align.CENTER)
        today.connect("clicked", lambda *_: self.select(date.today()))
        header.append(today)
        for icon, delta, tip in (("go-previous-symbolic", -1, "Voriger Monat"),
                                 ("go-next-symbolic", 1, "Nächster Monat")):
            b = Gtk.Button(icon_name=icon, tooltip_text=tip, css_classes=["flat", "circular"])
            b.connect("clicked", lambda _b, d=delta: self.shift(d))
            header.append(b)
        self.append(header)

        grid = Gtk.Grid(column_homogeneous=True, row_spacing=2, column_spacing=2)
        for i, name in enumerate(WEEKDAYS):
            grid.attach(Gtk.Label(label=name, css_classes=["weekday"]), i, 0, 1, 1)
        self.cells = []
        for row in range(6):
            for col in range(7):
                number = Gtk.Label(css_classes=["day-number"])
                dots = Gtk.Box(spacing=2, halign=Gtk.Align.CENTER, css_classes=["dots"])
                box = Gtk.Box(orientation=Gtk.Orientation.VERTICAL, spacing=2, valign=Gtk.Align.CENTER)
                box.append(number)
                box.append(dots)
                button = Gtk.Button(child=box, css_classes=["day"])
                button.connect("clicked", self._on_cell)
                grid.attach(button, col, row + 1, 1, 1)
                self.cells.append((button, number, dots))
        self.append(grid)

        swipe = Gtk.EventControllerScroll(flags=Gtk.EventControllerScrollFlags.VERTICAL
                                          | Gtk.EventControllerScrollFlags.DISCRETE)
        swipe.connect("scroll", lambda _c, _dx, dy: (self.shift(1 if dy > 0 else -1), True)[1])
        grid.add_controller(swipe)
        self._fill()

    @property
    def first_visible(self):
        first = date(self.year, self.month, 1)
        return first - timedelta(days=first.weekday())

    @property
    def last_visible(self):
        return self.first_visible + timedelta(days=42)

    def shift(self, delta):
        month = self.month + delta
        year = self.year + (month - 1) // 12
        month = (month - 1) % 12 + 1
        self.year, self.month = year, month
        self._fill()
        self.on_month_changed()

    def select(self, day):
        changed = (day.year, day.month) != (self.year, self.month)
        self.selected = day
        self.year, self.month = day.year, day.month
        self._fill()
        if changed:
            self.on_month_changed()
        self.on_select(day)

    def set_marks(self, marks):
        """marks: {date: [farbe, …]}"""
        self.marks = marks
        self._fill()

    def _fill(self):
        gdt = GLib.DateTime.new_local(self.year, self.month, 1, 0, 0, 0)
        self.title.set_label(gdt.format("%B %Y"))
        today = date.today()
        for i, (button, number, dots) in enumerate(self.cells):
            day = self.first_visible + timedelta(days=i)
            button.day = day
            number.set_label(str(day.day))
            for cls, active in (("other-month", day.month != self.month), ("today", day == today),
                                ("selected", day == self.selected)):
                (button.add_css_class if active else button.remove_css_class)(cls)
            while child := dots.get_first_child():
                dots.remove(child)
            for color in self.marks.get(day, [])[:3]:
                dots.append(Gtk.Box(css_classes=["event-dot", color_class(color)]))

    def _on_cell(self, button):
        self.select(button.day)


# -- Termin-Dialog -----------------------------------------------------------------


class TimeEditor(Gtk.Entry):
    """Uhrzeit-Eingabe; akzeptiert 14:30, 14.30, 1430 oder 14."""

    def __init__(self):
        super().__init__(max_width_chars=5, width_chars=5, xalign=0.5, valign=Gtk.Align.CENTER,
                         input_purpose=Gtk.InputPurpose.DIGITS, css_classes=["time-entry"])
        self.value = (0, 0)
        self.connect("activate", lambda *_: self._normalize())
        focus = Gtk.EventControllerFocus()
        focus.connect("leave", lambda *_: self._normalize())
        self.add_controller(focus)
        self.on_change = None

    @staticmethod
    def parse(text):
        digits = text.strip().replace(".", ":")
        if ":" in digits:
            h, _, m = digits.partition(":")
        elif len(digits) <= 2:
            h, m = digits, "0"
        else:
            h, m = digits[:-2], digits[-2:]
        try:
            h, m = int(h), int(m or 0)
        except ValueError:
            return None
        return (h, m) if 0 <= h < 24 and 0 <= m < 60 else None

    def _normalize(self):
        parsed = self.parse(self.get_text())
        if parsed is None:
            self.add_css_class("error")
            return
        self.remove_css_class("error")
        changed = parsed != self.value
        self.set(*parsed)
        if changed and self.on_change:
            self.on_change()

    def get(self):
        parsed = self.parse(self.get_text())
        return parsed if parsed is not None else self.value

    def set(self, h, m):
        self.value = (h, m)
        self.set_text(f"{h:02d}:{m:02d}")


class DateButton(Gtk.MenuButton):
    def __init__(self, day, on_change=None):
        super().__init__(valign=Gtk.Align.CENTER, css_classes=["flat", "date-button"])
        self.on_change = None
        self.calendar = Gtk.Calendar()
        self.calendar.connect("day-selected", self._on_selected)
        self.set_popover(Gtk.Popover(child=self.calendar))
        self.set_date(day)
        self.on_change = on_change  # erst nach der Initialisierung reagieren

    def set_date(self, day):
        self.day = day
        self.set_label(fmt_day(day, long=False))
        self._programmatic = True
        self.calendar.select_day(GLib.DateTime.new_local(day.year, day.month, day.day, 0, 0, 0))
        self._programmatic = False

    def _on_selected(self, cal):
        if self._programmatic:
            return
        d = cal.get_date()
        self.day = date(d.get_year(), d.get_month(), d.get_day_of_month())
        self.set_label(fmt_day(self.day, long=False))
        self.get_popover().popdown()
        if self.on_change:
            self.on_change()


class EventDialog(Adw.Dialog):
    def __init__(self, app, event, is_new):
        super().__init__(content_width=460, content_height=640)
        self.app = app
        self.event = event
        self.is_new = is_new
        editable = is_new or event.editable
        self.set_title("Neuer Termin" if is_new else ("Termin bearbeiten" if editable else "Termin"))

        header = Adw.HeaderBar(show_end_title_buttons=not editable, show_start_title_buttons=False)
        if editable:
            cancel = Gtk.Button(label="Abbrechen")
            cancel.connect("clicked", lambda *_: self.close())
            header.pack_start(cancel)
            self.save_button = Gtk.Button(label="Speichern", css_classes=["suggested-action"])
            self.save_button.connect("clicked", self._save)
            header.pack_end(self.save_button)
        self.toasts = Adw.ToastOverlay()
        page = Adw.PreferencesPage()
        self.toasts.set_child(page)

        if not editable:
            hint = Adw.PreferencesGroup()
            reason = ("Serientermine bitte in der Kalender-App bearbeiten." if event.recurring
                      else "Dieser Kalender ist schreibgeschützt.")
            hint.add(Adw.ActionRow(title=reason, icon_name="dialog-information-symbolic",
                                   css_classes=["hint-row"]))
            page.add(hint)

        numbers = event.numbers
        if numbers:
            calls = Adw.PreferencesGroup(title="Anrufen")
            for number in numbers:
                row = Adw.ActionRow(title=number, activatable=True, use_markup=False)
                row.add_prefix(Gtk.Image(icon_name="call-start-symbolic", css_classes=["row-call"]))
                row.connect("activated", lambda _r, n=number: (self.close(), self.app.dial(n)))
                calls.add(row)
            page.add(calls)

        main = Adw.PreferencesGroup()
        self.title_row = Adw.EntryRow(title="Titel", text=event.summary if not is_new or event.summary else "")
        self.title_row.connect("changed", self._validate)
        main.add(self.title_row)
        self.location_row = Adw.EntryRow(title="Ort oder Einwahlnummer", text=event.location)
        main.add(self.location_row)
        page.add(main)

        times = Adw.PreferencesGroup(title="Zeit")
        self.all_day = Adw.SwitchRow(title="Ganztägig", active=event.all_day)
        self.all_day.connect("notify::active", self._on_all_day)
        times.add(self.all_day)
        self.start_date = DateButton(event.start.date(), self._on_start_changed)
        self.start_time = TimeEditor()
        self.start_time.set(event.start.hour, event.start.minute)
        self.start_time.on_change = self._on_start_changed
        end = event.end - timedelta(days=1) if event.all_day else event.end
        self.end_date = DateButton(end.date())
        self.end_time = TimeEditor()
        self.end_time.set(end.hour, end.minute)
        for title, d, t in (("Beginn", self.start_date, self.start_time), ("Ende", self.end_date, self.end_time)):
            row = Adw.ActionRow(title=title)
            row.add_suffix(d)
            row.add_suffix(t)
            times.add(row)
        page.add(times)
        self._duration = event.end - event.start

        notes = Adw.PreferencesGroup(title="Notizen")
        self.notes = Gtk.TextView(wrap_mode=Gtk.WrapMode.WORD_CHAR, css_classes=["notes"],
                                  top_margin=12, bottom_margin=12, left_margin=12, right_margin=12)
        self.notes.get_buffer().set_text(event.description)
        self.notes.set_size_request(-1, 96)
        notes.add(self.notes)
        page.add(notes)

        cal_group = Adw.PreferencesGroup()
        self.calendars = app.calendar.writable_calendars() if is_new else [event.calendar]
        self.cal_row = Adw.ComboRow(
            title="Kalender",
            model=Gtk.StringList.new([f"{c.name}  ({c.group})" if c.group else c.name for c in self.calendars]),
        )
        if event.calendar in self.calendars:
            self.cal_row.set_selected(self.calendars.index(event.calendar))
        self.cal_row.set_sensitive(is_new and len(self.calendars) > 1)
        cal_group.add(self.cal_row)
        page.add(cal_group)

        if not is_new and editable:
            del_group = Adw.PreferencesGroup()
            delete = Gtk.Button(label="Termin löschen", halign=Gtk.Align.CENTER,
                                css_classes=["destructive-action", "pill"])
            delete.connect("clicked", self._delete)
            del_group.add(delete)
            page.add(del_group)

        for widget in (main, times, notes, cal_group):
            widget.set_sensitive(editable)
        if not editable:
            self.notes.set_editable(False)

        view = Adw.ToolbarView(content=self.toasts)
        view.add_top_bar(header)
        self.set_child(view)
        self._on_all_day()
        if editable:
            self._validate()
            self.set_focus(self.title_row)

    def _on_all_day(self, *_):
        timed = not self.all_day.get_active()
        self.start_time.set_visible(timed)
        self.end_time.set_visible(timed)

    def _on_start_changed(self, *_):
        # Ende mitverschieben, damit die Dauer erhalten bleibt
        start = self._read_start()
        end = start + max(self._duration, timedelta(0))
        if self.all_day.get_active():
            end -= timedelta(days=1)
        self.end_date.set_date(end.date())
        self.end_time.set(end.hour, end.minute)

    def _read_start(self):
        h, m = self.start_time.get()
        d = self.start_date.day
        return datetime(d.year, d.month, d.day, h, m)

    def _read_end(self):
        d = self.end_date.day
        if self.all_day.get_active():
            return datetime(d.year, d.month, d.day) + timedelta(days=1)
        h, m = self.end_time.get()
        return datetime(d.year, d.month, d.day, h, m)

    def _validate(self, *_):
        ok = bool(self.title_row.get_text().strip()) and bool(self.calendars)
        self.save_button.set_sensitive(ok)

    def _collect(self):
        ev = self.event
        ev.summary = self.title_row.get_text().strip()
        ev.location = self.location_row.get_text().strip()
        buf = self.notes.get_buffer()
        ev.description = buf.get_text(buf.get_start_iter(), buf.get_end_iter(), False).strip()
        ev.all_day = self.all_day.get_active()
        start = self._read_start()
        if ev.all_day:
            start = datetime(start.year, start.month, start.day)
        end = self._read_end()
        if end <= start:
            end = start + (timedelta(days=1) if ev.all_day else timedelta(minutes=30))
        ev.start, ev.end = start, end
        if self.is_new:
            ev.calendar = self.calendars[self.cal_row.get_selected()]

    def _busy(self, busy):
        self.save_button.set_sensitive(not busy)
        self.save_button.set_label("Speichert …" if busy else "Speichern")

    def _save(self, *_):
        if not self.save_button.get_sensitive():
            return
        self._collect()
        self._busy(True)
        self.app.calendar.save(self.event, self.is_new, self._finished)

    def _delete(self, *_):
        self.app.calendar.delete(self.event, self._finished)

    def _finished(self, error):
        if error:
            self._busy(False)
            self.toasts.add_toast(Adw.Toast(title=error, timeout=6))
        else:
            self.close()


# -- Seite -------------------------------------------------------------------------


class CalendarPage(Gtk.Box):
    def __init__(self, app, window):
        super().__init__()
        self.app = app
        self.window = window
        self.manager = app.calendar
        self.events = []
        self.request = 0

        self.stack = Gtk.Stack(transition_type=Gtk.StackTransitionType.CROSSFADE, hexpand=True, vexpand=True)
        self.append(self.stack)

        setup = Adw.StatusPage(
            icon_name="x-office-calendar-symbolic",
            title="Kein Kalender verbunden",
            description="Verbinde einen CalDAV-Kalender (z. B. Nextcloud, iCloud, mailbox.org) oder "
                        "nutze Kalender aus GNOME Online-Konten.",
        )
        btn = Gtk.Button(label="Kalender einrichten", halign=Gtk.Align.CENTER,
                         css_classes=["pill", "suggested-action"])
        btn.connect("clicked", lambda *_: app.show_preferences("calendar"))
        setup.set_child(btn)
        self.stack.add_named(setup, "setup")
        self.stack.add_named(Adw.Spinner(halign=Gtk.Align.CENTER, valign=Gtk.Align.CENTER,
                                         width_request=32, height_request=32), "loading")

        content = Gtk.Box(orientation=Gtk.Orientation.VERTICAL, spacing=12)
        content.set_margin_start(12)
        content.set_margin_end(12)
        content.set_margin_bottom(18)
        self.month = MonthView(self.show_day, self.load)
        content.append(self.month)

        day_header = Gtk.Box(spacing=8)
        day_header.set_margin_top(4)
        day_header.set_margin_start(4)
        self.day_title = Gtk.Label(xalign=0, hexpand=True, css_classes=["day-title"])
        day_header.append(self.day_title)
        self.spinner = Adw.Spinner(visible=False)
        day_header.append(self.spinner)
        refresh = Gtk.Button(icon_name="view-refresh-symbolic", tooltip_text="Aktualisieren",
                             css_classes=["flat", "circular"])
        refresh.connect("clicked", lambda *_: self.manager.refresh())
        day_header.append(refresh)
        self.add_button = Gtk.Button(css_classes=["pill", "tonal-small"], tooltip_text="Neuer Termin")
        add_content = Gtk.Box(spacing=6)
        add_content.append(Gtk.Image(icon_name="list-add-symbolic"))
        add_content.append(Gtk.Label(label="Termin"))
        self.add_button.set_child(add_content)
        self.add_button.connect("clicked", lambda *_: self.new_event())
        day_header.append(self.add_button)
        content.append(day_header)

        self.error = label("", "caption", "error", wrap=True, xalign=0, visible=False)
        content.append(self.error)

        self.listbox = Gtk.ListBox(css_classes=["boxed-list"], selection_mode=Gtk.SelectionMode.NONE)
        content.append(self.listbox)
        self.empty = Gtk.Label(label="Keine Termine", css_classes=["dim-label"])
        self.empty.set_margin_top(18)
        content.append(self.empty)

        clamp = Adw.Clamp(maximum_size=560, child=content)
        self.stack.add_named(Gtk.ScrolledWindow(child=clamp, hscrollbar_policy=Gtk.PolicyType.NEVER), "main")

        self.manager.connect("calendars-changed", lambda *_: self._on_calendars())
        self.manager.connect("events-changed", lambda *_: self.load())
        self._on_calendars()

    def _on_calendars(self):
        if self.manager.loading and not self.manager.calendars:
            self.stack.set_visible_child_name("loading")
            self.add_button.set_visible(False)
            return
        has = bool(self.manager.enabled_calendars())
        self.stack.set_visible_child_name("main" if has else "setup")
        self.add_button.set_visible(bool(self.manager.writable_calendars()))
        self._show_errors(self.manager.errors)
        if has:
            self.load()

    def _show_errors(self, errors):
        self.error.set_label("\n".join(errors))
        self.error.set_visible(bool(errors))

    def load(self):
        if not self.manager.enabled_calendars():
            self._on_calendars()
            return
        self.request += 1
        req = self.request
        self.spinner.set_visible(True)
        start = datetime.combine(self.month.first_visible, datetime.min.time())
        end = datetime.combine(self.month.last_visible, datetime.min.time())

        def done(events, errors):
            if req != self.request:
                return
            self.spinner.set_visible(False)
            self.events = events
            self._show_errors(self.manager.errors + errors)
            marks = {}
            day = self.month.first_visible
            while day < self.month.last_visible:
                colors = [e.calendar.color for e in events if e.covers(day)]
                if colors:
                    marks[day] = colors
                day += timedelta(days=1)
            self.month.set_marks(marks)
            self.show_day(self.month.selected)

        self.manager.fetch(start, end, done)

    def show_day(self, day):
        self.day_title.set_label(fmt_day(day))
        self.listbox.remove_all()
        events = [e for e in self.events if e.covers(day)]
        for ev in events:
            self.listbox.append(self._row(ev, day))
        self.listbox.set_visible(bool(events))
        self.empty.set_visible(not events)

    def _row(self, ev, day):
        subtitle = fmt_event_time(ev, day)
        if ev.location:
            subtitle += " · " + ev.location
        row = Adw.ActionRow(title=ev.summary, subtitle=subtitle, activatable=True, use_markup=False,
                            title_lines=1, subtitle_lines=1)
        row.add_prefix(Gtk.Box(css_classes=["cal-bar", color_class(ev.calendar.color)],
                               tooltip_text=ev.calendar.name))
        if ev.recurring:
            row.add_suffix(Gtk.Image(icon_name="view-refresh-symbolic", tooltip_text="Serientermin",
                                     css_classes=["dim-label"]))
        numbers = ev.numbers
        if numbers:
            btn = Gtk.Button(icon_name="call-start-symbolic", tooltip_text=f"{numbers[0]} anrufen",
                             valign=Gtk.Align.CENTER, css_classes=["flat", "circular", "row-call"])
            btn.connect("clicked", lambda *_: self.app.dial(numbers[0]))
            row.add_suffix(btn)
        row.connect("activated", lambda *_: self.open_event(ev))
        return row

    def open_event(self, ev):
        EventDialog(self.app, ev, is_new=False).present(self.window)

    def new_event(self, summary="", description="", start=None, duration=timedelta(hours=1)):
        cal = self.manager.default_calendar()
        if cal is None:
            self.window.toast("Kein beschreibbarer Kalender – bitte in den Einstellungen einrichten")
            self.app.show_preferences("calendar")
            return
        if start is None:
            sel = self.month.selected
            now = datetime.now()
            base = now if sel == now.date() else datetime(sel.year, sel.month, sel.day, 9)
            start = (base + timedelta(hours=1)).replace(minute=0, second=0, microsecond=0) \
                if sel == now.date() else base
        ev = Event(uid="", calendar=cal, summary=summary, start=start, end=start + duration,
                   description=description)
        EventDialog(self.app, ev, is_new=True).present(self.window)
