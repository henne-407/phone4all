"""Adressbücher synchronisieren: GNOME Online-Konten/Evolution (EDS) und CardDAV.

Die Kontakte werden nur gelesen; sie erscheinen in der Kontaktliste, werden für
die Anrufererkennung genutzt und lokal zwischengespeichert.
"""

import re
from dataclasses import dataclass
from urllib.parse import urljoin, urlparse
from xml.etree import ElementTree as ET

import gi
from gi.repository import GLib, GObject

from .calendars import CalDavBackend, CalendarError
from .contact_import import parse_vcards

try:
    gi.require_version("EBook", "1.2")
    gi.require_version("EBookContacts", "1.2")
    gi.require_version("EDataServer", "1.2")
    from gi.repository import EBook, EBookContacts, EDataServer
except (ImportError, ValueError):
    EBook = None

SYNC_INTERVAL = 30 * 60  # Sekunden

CARD = "urn:ietf:params:xml:ns:carddav"
NS = {"d": "DAV:", "card": CARD}
PROPFIND_HOME = """<?xml version="1.0" encoding="utf-8"?>
<d:propfind xmlns:d="DAV:" xmlns:card="urn:ietf:params:xml:ns:carddav">
  <d:prop><d:current-user-principal/><card:addressbook-home-set/><d:resourcetype/></d:prop>
</d:propfind>"""
PROPFIND_BOOKS = """<?xml version="1.0" encoding="utf-8"?>
<d:propfind xmlns:d="DAV:"><d:prop><d:resourcetype/><d:displayname/></d:prop></d:propfind>"""
REPORT_CARDS = """<?xml version="1.0" encoding="utf-8"?>
<card:addressbook-query xmlns:d="DAV:" xmlns:card="urn:ietf:params:xml:ns:carddav">
  <d:prop><d:getetag/><card:address-data/></d:prop>
</card:addressbook-query>"""


@dataclass(eq=False)
class AddressBook:
    id: str
    name: str
    group: str
    backend: object
    href: str = ""


def _tag(contacts, book):
    for i, c in enumerate(contacts):
        c["id"] = f"{book.id}#{i}"
        c["source"] = book.name if not book.group else f"{book.group} · {book.name}"
        c["readonly"] = True
    return contacts


class EdsAddressBooks:
    @staticmethod
    def available():
        return EBook is not None

    def __init__(self):
        self.registry = None

    def list_books(self):
        if self.registry is None:
            self.registry = EDataServer.SourceRegistry.new_sync(None)
        books = []
        for src in self.registry.list_enabled(EDataServer.SOURCE_EXTENSION_ADDRESS_BOOK):
            group = ""
            if src.get_parent():
                parent = self.registry.ref_source(src.get_parent())
                group = parent.get_display_name() if parent else ""
            books.append(AddressBook("eds:" + src.get_uid(), src.get_display_name(), group or "Evolution", self))
        return books

    def contacts(self, book):
        src = self.registry.ref_source(book.id[4:])
        if src is None:
            return []
        client = EBook.BookClient.connect_sync(src, 30, None)
        _ok, contacts = client.get_contacts_sync("", None)
        text = "\n".join(c.to_string(EBookContacts.VCardFormat.VCARD_30) for c in contacts)
        return _tag(parse_vcards(text), book)


class CardDavBackend(CalDavBackend):
    """CardDAV-Konto; nutzt Anmeldung und Requests des CalDAV-Clients."""

    def list_books(self):
        url = self.conf["url"].strip()
        if not re.match(r"^https?://", url):
            url = "https://" + url
        parsed = urlparse(url)
        home, last_error = None, None
        for candidate in (url, f"{parsed.scheme}://{parsed.netloc}/.well-known/carddav"):
            try:
                items = self._propfind(candidate, PROPFIND_HOME, 0)
            except CalendarError as e:
                last_error = e
                continue
            if not items:
                continue
            base, props = items[0]
            rtype = props.get("{DAV:}resourcetype")
            if rtype is not None and rtype.find("card:addressbook", NS) is not None:
                return self._books(base, 0)
            home = self._href(props.get(f"{{{CARD}}}addressbook-home-set"))
            principal = self._href(props.get("{DAV:}current-user-principal"))
            if not home and principal:
                p_items = self._propfind(urljoin(base, principal), PROPFIND_HOME, 0)
                if p_items:
                    home = self._href(p_items[0][1].get(f"{{{CARD}}}addressbook-home-set"))
            if home:
                home = urljoin(base, home)
                break
        if not home:
            raise last_error or CalendarError("Keine Adressbücher gefunden – bitte die URL prüfen")
        books = self._books(home, 1)
        if not books:
            raise CalendarError("Das Konto enthält keine Adressbücher")
        return books

    def _books(self, url, depth):
        books = []
        for href, props in self._propfind(url, PROPFIND_BOOKS, depth):
            rtype = props.get("{DAV:}resourcetype")
            if rtype is None or rtype.find("card:addressbook", NS) is None:
                continue
            name_el = props.get("{DAV:}displayname")
            name = name_el.text if name_el is not None and name_el.text else href.rstrip("/").rsplit("/", 1)[-1]
            books.append(AddressBook(f"carddav:{self.conf['id']}:{href}", name,
                                     self.conf.get("name") or urlparse(href).netloc, self,
                                     href if href.endswith("/") else href + "/"))
        return books

    def contacts(self, book):
        r = self._request("REPORT", book.href, REPORT_CARDS, depth=1)
        root = ET.fromstring(r.content)
        cards = [resp.findtext(".//card:address-data", "", NS) for resp in root.findall("d:response", NS)]
        return _tag(parse_vcards("\n".join(c for c in cards if c.strip())), book)


class ContactSync(GObject.Object):
    """Liest alle aktiven Adressbücher im Hintergrund und aktualisiert den Kontakt-Cache."""

    __gsignals__ = {"synced": (GObject.SignalFlags.RUN_FIRST, None, ())}

    def __init__(self, store, runner):
        super().__init__()
        self.store = store
        self.run = runner  # führt Aufgaben im Hintergrund-Thread aus (CalendarManager.run)
        self.eds = EdsAddressBooks() if EdsAddressBooks.available() else None
        self.books = []
        self.errors = []
        self.syncing = False
        GLib.timeout_add_seconds(SYNC_INTERVAL, lambda: (self.sync(), True)[1])

    @property
    def settings(self):
        return self.store.settings["addressbooks"]

    def is_enabled(self, book):
        return book.id not in self.settings.get("disabled", [])

    def set_enabled(self, book, enabled):
        disabled = set(self.settings.get("disabled", []))
        (disabled.discard if enabled else disabled.add)(book.id)
        self.settings["disabled"] = sorted(disabled)
        self.store.save_settings()
        self.sync()

    def sync(self):
        if self.syncing:
            return
        self.syncing = True
        settings = dict(self.settings)
        accounts = [dict(c) for c in settings.get("carddav", [])]
        passwords = {c["id"]: self.store.get_secret(f"carddav:{c['id']}") for c in accounts}
        sql_sources = [dict(c) for c in settings.get("sql", [])]
        sql_passwords = {c["id"]: self.store.get_secret(f"mssql:{c['id']}") for c in sql_sources}
        disabled = set(settings.get("disabled", []))

        def work():
            books, errors, contacts = [], [], []
            keep = []  # ID-Präfixe, deren alter Zwischenstand bei Fehlern erhalten bleibt
            if self.eds and settings.get("use_eds", True):
                try:
                    books += self.eds.list_books()
                except GLib.Error as e:
                    errors.append(f"Evolution-Adressbücher: {e.message}")
                    keep.append("eds:")
            for conf in accounts:
                try:
                    books += CardDavBackend(conf, passwords[conf["id"]]).list_books()
                except CalendarError as e:
                    errors.append(f"{conf.get('name') or conf['url']}: {e}")
                    keep.append(f"carddav:{conf['id']}:")
            from .sql_source import MsSqlSource  # hier importiert, um Zirkelimporte zu vermeiden

            for conf in sql_sources:
                books += MsSqlSource(conf, sql_passwords[conf["id"]]).list_books()
            for book in books:
                if book.id in disabled:
                    continue
                try:
                    contacts += book.backend.contacts(book)
                except (CalendarError, GLib.Error) as e:
                    errors.append(f"{book.name}: {getattr(e, 'message', e)}")
                    keep.append(book.id + "#")
            return books, errors, contacts, keep

        def done(result, error):
            self.syncing = False
            if result is None:
                self.errors = [error]
            else:
                self.books, self.errors, contacts, keep = result
                contacts += [c for c in self.store.external if c["id"].startswith(tuple(keep))] if keep else []
                self.store.set_external(contacts)
            self.emit("synced")

        self.run(work, done)
