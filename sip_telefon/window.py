"""Hauptfenster: Wählen, Kontakte, Verlauf und die Ansicht für laufende Anrufe."""

from gi.repository import Adw, Gdk, Gio, GLib, Gtk

from .calendar_page import CalendarPage
from .calls import format_duration
from .store import normalize_number
from .widgets import (
    ContactDialog,
    DialPad,
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


# -- Kontakte ----------------------------------------------------------------


class ContactsPage(Gtk.Box):
    def __init__(self, app, window):
        super().__init__(orientation=Gtk.Orientation.VERTICAL)
        self.app = app
        self.window = window

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
        self.append(clamp)

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
        self.append(self.stack)
        self.refresh()

    def refresh(self):
        self.listbox.remove_all()
        contacts = self.app.store.search_contacts(self.search.get_text())
        self.visible_contacts = contacts
        for c in contacts:
            self.listbox.append(self._row(c))
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
        row.connect("activated", lambda *_: self.edit(c))

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

    def _delete(self, contact):
        self.app.store.delete_contact(contact["id"])
        self.window.contacts_changed()
        self.window.toast(f"„{contact['name']}“ gelöscht")


# -- Verlauf -----------------------------------------------------------------


class HistoryPage(Gtk.Box):
    def __init__(self, app, window):
        super().__init__(orientation=Gtk.Orientation.VERTICAL)
        self.app = app
        self.window = window

        self.listbox = Gtk.ListBox(css_classes=["boxed-list"], selection_mode=Gtk.SelectionMode.NONE,
                                   valign=Gtk.Align.START)
        self.listbox.set_margin_top(6)
        self.stack = Gtk.Stack(vexpand=True)
        self.stack.add_named(_scrolled_list(self.listbox), "list")
        self.stack.add_named(
            Adw.StatusPage(icon_name="document-open-recent-symbolic", title="Keine Anrufe",
                           description="Hier erscheinen deine ein- und ausgehenden Anrufe."),
            "empty",
        )
        self.append(self.stack)
        self.refresh()

    def refresh(self):
        self.listbox.remove_all()
        for entry in self.app.store.history:
            self.listbox.append(self._row(entry))
        self.stack.set_visible_child_name("list" if self.app.store.history else "empty")

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
        self.controls = Gtk.Box(spacing=20, halign=Gtk.Align.CENTER)
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
        header = Adw.HeaderBar(title_widget=self.window_title)
        self.status_dot = Gtk.Box(css_classes=["status-dot"], valign=Gtk.Align.CENTER)
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
        self.views = Adw.ViewStack()
        self.views.add_titled_with_icon(_scrolled(self.dialer), "dial", "Wählen", "input-dialpad-symbolic")
        self.views.add_titled_with_icon(contacts_page, "contacts", "Kontakte", "x-office-address-book-symbolic")
        self.views.add_titled_with_icon(self.calendar, "calendar", "Kalender", "x-office-calendar-symbolic")
        self.history_page = self.views.add_titled_with_icon(
            self.history, "history", "Verlauf", "document-open-recent-symbolic")
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

        keys = Gtk.EventControllerKey()
        keys.connect("key-pressed", self._on_key)
        self.add_controller(keys)
        self.connect("close-request", self._on_close)
        GLib.idle_add(self.dialer.focus)

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
        self.window_title.set_subtitle(text)
        for k in ("ok", "busy", "error", "off"):
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
        if missed and self.views.get_visible_child_name() != "history":
            self.history_page.set_needs_attention(True)

    def contacts_changed(self):
        self.contacts.refresh()
        self.history.refresh()

    def toast(self, text):
        self.toasts.add_toast(Adw.Toast(title=text, timeout=3))

    def open_dialer(self, number=""):
        self.views.set_visible_child_name("dial")
        if number:
            self.dialer.set_number(normalize_number(number))
