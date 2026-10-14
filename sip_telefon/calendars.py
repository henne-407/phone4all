"""Kalender: Evolution Data Server (GNOME Online-Konten, lokale Kalender) und CalDAV.

Alle Zugriffe auf Server und EDS laufen nacheinander in einem Hintergrund-Thread;
Ergebnisse werden per GLib.idle_add an den Hauptthread zurückgegeben.
"""

import queue
import re
import threading
import uuid
from dataclasses import dataclass, field
from datetime import datetime, timedelta, timezone
from urllib.parse import urljoin, urlparse
from xml.etree import ElementTree as ET
from zoneinfo import ZoneInfo

import gi

gi.require_version("ICalGLib", "3.0")
from gi.repository import GLib, GObject, ICalGLib  # noqa: E402

try:
    gi.require_version("ECal", "2.0")
    gi.require_version("EDataServer", "1.2")
    from gi.repository import ECal, EDataServer
except (ImportError, ValueError):
    ECal = EDataServer = None

try:
    import requests
except ImportError:
    requests = None

DEFAULT_COLOR = "#6750a4"
MAX_INSTANCES = 500

# -- Telefonnummern in Terminen -----------------------------------------------

PHONE_RE = re.compile(r"(?:tel:\s*)?(?<![\w+])(?:\+|00)?\d[\d \-/()]{4,22}\d(?!\w)")


def find_numbers(*texts):
    """Findet Telefonnummern in Freitext (z. B. Einwahlnummern in Terminen)."""
    found = []
    for text in texts:
        for m in PHONE_RE.finditer(text or ""):
            raw = m.group(0)
            if raw.lower().startswith("tel:"):
                raw = raw[4:]
            number = raw.strip()
            digits = re.sub(r"\D", "", number)
            # Datumsangaben wie 2026-10-15 oder Uhrzeiten ausschließen
            if len(digits) < 6 or re.fullmatch(r"\d{4}-\d{2}-\d{2}", number):
                continue
            if number not in found:
                found.append(number)
    return found


# -- Datenmodell ---------------------------------------------------------------


@dataclass(eq=False)
class Calendar:
    id: str
    name: str
    color: str
    backend: object
    writable: bool = True
    group: str = ""
    href: str = ""  # CalDAV-Collection


@dataclass(eq=False)
class Event:
    uid: str
    calendar: Calendar
    summary: str
    start: datetime  # lokale Zeit ohne tzinfo; ganztägig: 00:00
    end: datetime  # exklusiv
    all_day: bool = False
    location: str = ""
    description: str = ""
    recurring: bool = False
    href: str = ""  # CalDAV-Ressource
    extra: dict = field(default_factory=dict)

    @property
    def editable(self):
        return self.calendar.writable and not self.recurring

    @property
    def numbers(self):
        return find_numbers(self.summary, self.location, self.description)

    def covers(self, day):
        """Liegt der Termin (auch teilweise) auf dem Tag `day` (date)?"""
        day_start = datetime(day.year, day.month, day.day)
        day_end = day_start + timedelta(days=1)
        if self.start == self.end:
            return day_start <= self.start < day_end
        return self.start < day_end and self.end > day_start


class CalendarError(Exception):
    pass


# -- iCalendar-Hilfen ----------------------------------------------------------


def _zone_from_tzid(tzid):
    # libical-Zonen heißen z. B. /freeassociation.sourceforge.net/Europe/Berlin
    parts = (tzid or "").strip("/").split("/")
    for i in range(len(parts)):
        try:
            return ZoneInfo("/".join(parts[i:]))
        except (KeyError, ValueError):
            continue
    return None


def ical_to_datetime(t):
    """ICalGLib.Time -> (datetime in lokaler Zeit, ganztägig)"""
    if t is None or t.is_null_time():
        return None, False
    if t.is_date():
        return datetime(t.get_year(), t.get_month(), t.get_day()), True
    naive = datetime(t.get_year(), t.get_month(), t.get_day(), t.get_hour(), t.get_minute(), t.get_second())
    if t.is_utc():
        return naive.replace(tzinfo=timezone.utc).astimezone().replace(tzinfo=None), False
    zone = t.get_timezone()
    if zone is not None:
        tzid = zone.get_tzid() or ""
        if "UTC" in tzid.upper() and "/" not in tzid:
            return naive.replace(tzinfo=timezone.utc).astimezone().replace(tzinfo=None), False
        py_zone = _zone_from_tzid(zone.get_location() or tzid)
        if py_zone is not None:
            return naive.replace(tzinfo=py_zone).astimezone().replace(tzinfo=None), False
        return datetime.fromtimestamp(t.as_timet_with_zone(zone)), False
    py_zone = _zone_from_tzid(t.get_tzid())
    if py_zone is not None:
        return naive.replace(tzinfo=py_zone).astimezone().replace(tzinfo=None), False
    return naive, False  # "floating" Zeit


def datetime_to_ical(dt, all_day):
    if all_day:
        t = ICalGLib.Time.new_null_time()
        t.set_date(dt.year, dt.month, dt.day)
        t.set_is_date(True)
        return t
    return ICalGLib.Time.new_from_timet_with_zone(int(dt.timestamp()), 0, ICalGLib.Timezone.get_utc_timezone())


def _utc_stamp(dt):
    return dt.astimezone(timezone.utc).strftime("%Y%m%dT%H%M%SZ")


def _remove_props(comp, kind):
    prop = comp.get_first_property(kind)
    while prop is not None:
        comp.remove_property(prop)
        prop = comp.get_first_property(kind)


def apply_event(comp, ev):
    """Überträgt die Felder von `ev` in eine VEVENT-Komponente."""
    comp.set_summary(ev.summary)
    _remove_props(comp, ICalGLib.PropertyKind.DURATION_PROPERTY)
    comp.set_dtstart(datetime_to_ical(ev.start, ev.all_day))
    comp.set_dtend(datetime_to_ical(ev.end, ev.all_day))
    for kind, setter, value in (
        (ICalGLib.PropertyKind.LOCATION_PROPERTY, comp.set_location, ev.location),
        (ICalGLib.PropertyKind.DESCRIPTION_PROPERTY, comp.set_description, ev.description),
    ):
        _remove_props(comp, kind)
        if value:
            setter(value)
    comp.set_dtstamp(ICalGLib.Time.new_current_with_zone(ICalGLib.Timezone.get_utc_timezone()))


def new_vevent(ev):
    comp = ICalGLib.Component.new_vevent()
    comp.set_uid(ev.uid)
    apply_event(comp, ev)
    return comp


def wrap_vcalendar(vevent):
    cal = ICalGLib.Component.new_vcalendar()
    cal.add_property(ICalGLib.Property.new_version("2.0"))
    cal.add_property(ICalGLib.Property.new_prodid("-//SIP-Telefon//DE"))
    cal.add_component(vevent)
    return cal


def _text(comp, getter):
    try:
        return getter() or ""
    except (TypeError, GLib.Error):
        return ""


def event_from_comp(comp, calendar, start=None, end=None, **kw):
    """VEVENT -> Event. `start`/`end` überschreiben die Zeiten (für Serieninstanzen)."""
    s, all_day = ical_to_datetime(start if start is not None else comp.get_dtstart())
    if s is None:
        return None
    e, _ = ical_to_datetime(end if end is not None else comp.get_dtend())
    if e is None:
        duration = comp.get_duration()
        if duration is not None and not duration.is_null_duration():
            e = s + timedelta(seconds=duration.as_int())
        else:
            e = s + timedelta(days=1) if all_day else s
    recurring = (
        comp.get_first_property(ICalGLib.PropertyKind.RRULE_PROPERTY) is not None
        or comp.get_first_property(ICalGLib.PropertyKind.RECURRENCEID_PROPERTY) is not None
    )
    return Event(
        uid=comp.get_uid() or "",
        calendar=calendar,
        summary=_text(comp, comp.get_summary) or "(ohne Titel)",
        start=s,
        end=e,
        all_day=all_day,
        location=_text(comp, comp.get_location),
        description=_text(comp, comp.get_description),
        recurring=recurring,
        **kw,
    )


def _vevents(vcal):
    comp = vcal.get_first_component(ICalGLib.ComponentKind.VEVENT_COMPONENT)
    while comp is not None:
        yield comp
        comp = vcal.get_next_component(ICalGLib.ComponentKind.VEVENT_COMPONENT)


def expand_locally(comp, calendar, range_start, range_end, **kw):
    """Fallback, falls der Server Serien nicht selbst expandiert."""
    master = event_from_comp(comp, calendar, **kw)
    if master is None:
        return []
    rrule_prop = comp.get_first_property(ICalGLib.PropertyKind.RRULE_PROPERTY)
    if rrule_prop is None:
        return [master]
    duration = master.end - master.start
    exdates = set()
    prop = comp.get_first_property(ICalGLib.PropertyKind.EXDATE_PROPERTY)
    while prop is not None:
        d, _ = ical_to_datetime(prop.get_exdate())
        if d:
            exdates.add(d)
        prop = comp.get_next_property(ICalGLib.PropertyKind.EXDATE_PROPERTY)

    result = []
    it = ICalGLib.RecurIterator.new(rrule_prop.get_rrule(), comp.get_dtstart())
    for _ in range(MAX_INSTANCES * 4):
        t = it.next()
        if t is None or t.is_null_time():
            break
        s, _ = ical_to_datetime(t)
        if s is None or s >= range_end:
            break
        if s + duration > range_start and s not in exdates:
            inst = Event(**{**master.__dict__, "start": s, "end": s + duration})
            result.append(inst)
        if len(result) >= MAX_INSTANCES:
            break
    return result


# -- Evolution Data Server ------------------------------------------------------


class EdsBackend:
    """Kalender aus GNOME Online-Konten und lokale Evolution-Kalender."""

    def __init__(self):
        self.registry = None
        self.clients = {}

    @staticmethod
    def available():
        return ECal is not None

    def list_calendars(self):
        if self.registry is None:
            self.registry = EDataServer.SourceRegistry.new_sync(None)
        result = []
        for src in self.registry.list_enabled(EDataServer.SOURCE_EXTENSION_CALENDAR):
            ext = src.get_extension(EDataServer.SOURCE_EXTENSION_CALENDAR)
            group = ""
            parent_uid = src.get_parent()
            if parent_uid:
                parent = self.registry.ref_source(parent_uid)
                if parent is not None:
                    group = parent.get_display_name()
            readonly = ext.get_backend_name() == "contacts"  # Geburtstage aus dem Adressbuch
            if readonly:
                group = "Kontakte"
            result.append(Calendar(
                id="eds:" + src.get_uid(),
                name=src.get_display_name(),
                color=ext.get_color() or DEFAULT_COLOR,
                backend=self,
                writable=not readonly,  # genauer Wert erst nach dem Verbinden bekannt
                group=group or "Evolution",
            ))
        return result

    def _client(self, cal):
        client = self.clients.get(cal.id)
        if client is None:
            src = self.registry.ref_source(cal.id[4:])
            if src is None:
                raise CalendarError(f"Kalender „{cal.name}“ nicht gefunden")
            client = ECal.Client.connect_sync(src, ECal.ClientSourceType.EVENTS, 20, None)
            self.clients[cal.id] = client
        cal.writable = not client.is_readonly()
        return client

    def events(self, cal, start, end):
        client = self._client(cal)
        result = []

        def on_instance(icomp, istart, iend, *_args):
            ev = event_from_comp(icomp, cal, istart, iend)
            if ev is not None:
                result.append(ev)
            return len(result) < MAX_INSTANCES

        client.generate_instances_sync(int(start.timestamp()), int(end.timestamp()), None, on_instance)
        return result

    def save(self, ev, is_new):
        client = self._client(ev.calendar)
        if is_new:
            client.create_object_sync(new_vevent(ev), ECal.OperationFlags.NONE, None)
            return
        _ok, comp = client.get_object_sync(ev.uid, None, None)
        apply_event(comp, ev)
        client.modify_object_sync(comp, ECal.ObjModType.THIS, ECal.OperationFlags.NONE, None)

    def delete(self, ev):
        client = self._client(ev.calendar)
        client.remove_object_sync(ev.uid, None, ECal.ObjModType.THIS, ECal.OperationFlags.NONE, None)

    def refresh(self):
        for client in self.clients.values():
            try:
                if client.check_refresh_supported():
                    client.refresh_sync(None)
            except GLib.Error:
                pass


# -- CalDAV ---------------------------------------------------------------------

NS = {"d": "DAV:", "c": "urn:ietf:params:xml:ns:caldav", "a": "http://apple.com/ns/ical/"}
PROPFIND_PRINCIPAL = """<?xml version="1.0" encoding="utf-8"?>
<d:propfind xmlns:d="DAV:" xmlns:c="urn:ietf:params:xml:ns:caldav">
  <d:prop><d:current-user-principal/><c:calendar-home-set/><d:resourcetype/></d:prop>
</d:propfind>"""
PROPFIND_CALENDARS = """<?xml version="1.0" encoding="utf-8"?>
<d:propfind xmlns:d="DAV:" xmlns:c="urn:ietf:params:xml:ns:caldav" xmlns:a="http://apple.com/ns/ical/">
  <d:prop>
    <d:resourcetype/><d:displayname/><a:calendar-color/>
    <c:supported-calendar-component-set/><d:current-user-privilege-set/>
  </d:prop>
</d:propfind>"""
REPORT_EVENTS = """<?xml version="1.0" encoding="utf-8"?>
<c:calendar-query xmlns:d="DAV:" xmlns:c="urn:ietf:params:xml:ns:caldav">
  <d:prop><d:getetag/><c:calendar-data><c:expand start="{start}" end="{end}"/></c:calendar-data></d:prop>
  <c:filter><c:comp-filter name="VCALENDAR"><c:comp-filter name="VEVENT">
    <c:time-range start="{start}" end="{end}"/>
  </c:comp-filter></c:comp-filter></c:filter>
</c:calendar-query>"""


class CalDavBackend:
    """Ein CalDAV-Konto (Nextcloud, iCloud, mailbox.org, Radicale, …)."""

    def __init__(self, conf, password):
        if requests is None:
            raise CalendarError("Python-Modul „requests“ fehlt (sudo dnf install python3-requests)")
        self.conf = conf
        self.session = requests.Session()
        self.session.auth = (conf["user"], password)
        self.session.headers["User-Agent"] = "SIP-Telefon"

    def _request(self, method, url, body=None, depth=None, headers=None):
        h = {"Content-Type": "application/xml; charset=utf-8"}
        if depth is not None:
            h["Depth"] = str(depth)
        h.update(headers or {})
        try:
            r = self.session.request(method, url, data=body.encode() if body else None, headers=h, timeout=20)
            if r.status_code == 401 and "digest" in r.headers.get("WWW-Authenticate", "").lower():
                self.session.auth = requests.auth.HTTPDigestAuth(*self.session.auth)
                r = self.session.request(method, url, data=body.encode() if body else None, headers=h,
                                         timeout=20)
        except requests.RequestException as e:
            raise CalendarError(f"Server nicht erreichbar: {e.__class__.__name__}") from e
        if r.status_code == 401:
            raise CalendarError("Anmeldung fehlgeschlagen – Benutzername oder Passwort falsch")
        if r.status_code == 412:
            raise CalendarError("Der Termin wurde inzwischen anderswo geändert – bitte neu laden")
        if r.status_code >= 400:
            raise CalendarError(f"Serverfehler {r.status_code} bei {method}")
        return r

    def _propfind(self, url, body, depth):
        r = self._request("PROPFIND", url, body, depth)
        try:
            root = ET.fromstring(r.content)
        except ET.ParseError as e:
            raise CalendarError("Ungültige Antwort vom Server – ist die URL richtig?") from e
        result = []
        for resp in root.findall("d:response", NS):
            href = urljoin(r.url, (resp.findtext("d:href", "", NS) or "").strip())
            props = {}
            for ps in resp.findall("d:propstat", NS):
                if " 200" in (ps.findtext("d:status", "", NS) or " 200"):
                    for prop in ps.find("d:prop", NS) or []:
                        props[prop.tag] = prop
            result.append((href, props))
        return result

    @staticmethod
    def _href(prop):
        if prop is None:
            return None
        el = prop.find("d:href", NS)
        return el.text.strip() if el is not None and el.text else None

    def discover(self):
        """Findet die Kalender des Kontos. Akzeptiert Server-, Principal- oder Kalender-URL."""
        url = self.conf["url"].strip()
        if not re.match(r"^https?://", url):
            url = "https://" + url
        candidates = [url]
        parsed = urlparse(url)
        candidates.append(f"{parsed.scheme}://{parsed.netloc}/.well-known/caldav")

        home = None
        last_error = None
        for candidate in candidates:
            try:
                items = self._propfind(candidate, PROPFIND_PRINCIPAL, 0)
            except CalendarError as e:
                last_error = e
                continue
            if not items:
                continue
            base, props = items[0]
            rtype = props.get("{DAV:}resourcetype")
            if rtype is not None and rtype.find("c:calendar", NS) is not None:
                return self._list_collections(base, depth=0)
            home = self._href(props.get("{urn:ietf:params:xml:ns:caldav}calendar-home-set"))
            principal = self._href(props.get("{DAV:}current-user-principal"))
            if not home and principal:
                principal = urljoin(base, principal)
                p_items = self._propfind(principal, PROPFIND_PRINCIPAL, 0)
                if p_items:
                    home = self._href(p_items[0][1].get("{urn:ietf:params:xml:ns:caldav}calendar-home-set"))
            if home:
                home = urljoin(base, home)
                break
        if not home:
            raise last_error or CalendarError("Keine Kalender gefunden – bitte die CalDAV-URL prüfen")
        calendars = self._list_collections(home, depth=1)
        if not calendars:
            raise CalendarError("Das Konto enthält keine Terminkalender")
        return calendars

    def _list_collections(self, url, depth):
        result = []
        for href, props in self._propfind(url, PROPFIND_CALENDARS, depth):
            rtype = props.get("{DAV:}resourcetype")
            if rtype is None or rtype.find("c:calendar", NS) is None:
                continue
            comps = props.get("{urn:ietf:params:xml:ns:caldav}supported-calendar-component-set")
            if comps is not None and len(comps) and not any(
                    c.get("name") == "VEVENT" for c in comps):
                continue  # z. B. reine Aufgabenlisten
            privs = props.get("{DAV:}current-user-privilege-set")
            writable = True
            if privs is not None and len(privs):
                names = {p.tag for priv in privs for p in priv}
                writable = bool(names & {"{DAV:}write", "{DAV:}write-content", "{DAV:}all"})
            name_el = props.get("{DAV:}displayname")
            color_el = props.get("{http://apple.com/ns/ical/}calendar-color")
            color = (color_el.text or "").strip()[:7] if color_el is not None and color_el.text else ""
            result.append(Calendar(
                id=f"caldav:{self.conf['id']}:{href}",
                name=(name_el.text if name_el is not None and name_el.text else href.rstrip("/").rsplit("/", 1)[-1]),
                color=color if re.fullmatch(r"#[0-9a-fA-F]{6}", color or "") else DEFAULT_COLOR,
                backend=self,
                writable=writable,
                group=self.conf.get("name") or urlparse(href).netloc,
                href=href if href.endswith("/") else href + "/",
            ))
        return result

    def list_calendars(self):
        return self.discover()

    def events(self, cal, start, end):
        s, e = _utc_stamp(start.astimezone()), _utc_stamp(end.astimezone())
        r = self._request("REPORT", cal.href, REPORT_EVENTS.format(start=s, end=e), depth=1)
        root = ET.fromstring(r.content)
        result = []
        for resp in root.findall("d:response", NS):
            href = urljoin(r.url, (resp.findtext("d:href", "", NS) or "").strip())
            data = resp.findtext(".//c:calendar-data", "", NS)
            if not data.strip():
                continue
            vcal = ICalGLib.Component.new_from_string(data)
            if vcal is None:
                continue
            for comp in _vevents(vcal):
                result.extend(expand_locally(comp, cal, start, end, href=href))
        return result

    def save(self, ev, is_new):
        if is_new:
            ev.href = urljoin(ev.calendar.href, re.sub(r"[^\w.-]", "_", ev.uid) + ".ics")
            body = wrap_vcalendar(new_vevent(ev)).as_ical_string()
            self._request("PUT", ev.href, body, headers={
                "Content-Type": "text/calendar; charset=utf-8", "If-None-Match": "*"})
            return
        r = self._request("GET", ev.href, headers={"Content-Type": "text/calendar"})
        vcal = ICalGLib.Component.new_from_string(r.text)
        master = next((c for c in _vevents(vcal)
                       if c.get_uid() == ev.uid
                       and c.get_first_property(ICalGLib.PropertyKind.RECURRENCEID_PROPERTY) is None), None)
        if master is None:
            raise CalendarError("Termin auf dem Server nicht gefunden")
        apply_event(master, ev)
        headers = {"Content-Type": "text/calendar; charset=utf-8"}
        if r.headers.get("ETag"):
            headers["If-Match"] = r.headers["ETag"]
        self._request("PUT", ev.href, vcal.as_ical_string(), headers=headers)

    def delete(self, ev):
        self._request("DELETE", ev.href, headers={"Content-Type": "text/calendar"})

    def refresh(self):
        pass


# -- Verwaltung -------------------------------------------------------------------


class CalendarManager(GObject.Object):
    """Hält die Kalenderliste und führt Aufträge im Hintergrund aus."""

    __gsignals__ = {
        "calendars-changed": (GObject.SignalFlags.RUN_FIRST, None, ()),
        "events-changed": (GObject.SignalFlags.RUN_FIRST, None, ()),
    }

    def __init__(self, store):
        super().__init__()
        self.store = store
        self.calendars = []
        self.errors = []
        self.loading = False
        self.eds = EdsBackend() if EdsBackend.available() else None
        self.queue = queue.Queue()
        threading.Thread(target=self._worker, daemon=True).start()

    # -- Hintergrund-Thread ----------------------------------------------------

    def _worker(self):
        while True:
            fn, callback = self.queue.get()
            try:
                result, error = fn(), None
            except CalendarError as e:
                result, error = None, str(e)
            except GLib.Error as e:
                result, error = None, e.message
            except Exception as e:  # noqa: BLE001 – Fehler gehören in die Oberfläche, nicht ins Nichts
                result, error = None, f"{e.__class__.__name__}: {e}"
            if callback:
                GLib.idle_add(lambda cb=callback, r=result, err=error: (cb(r, err), False)[1])

    def run(self, fn, callback=None):
        self.queue.put((fn, callback))

    # -- Konfiguration ---------------------------------------------------------

    @property
    def settings(self):
        return self.store.settings["calendar"]

    def caldav_backend(self, conf, password=None):
        if password is None:
            password = self.store.get_secret(f"caldav:{conf['id']}")
        return CalDavBackend(conf, password)

    def reload(self):
        """Kalenderlisten aller Quellen neu einlesen."""
        settings = dict(self.settings)
        caldav = [dict(c) for c in settings.get("caldav", [])]
        passwords = {c["id"]: self.store.get_secret(f"caldav:{c['id']}") for c in caldav}
        self.loading = True

        def work():
            calendars, errors = [], []
            if self.eds and settings.get("use_eds", True):
                try:
                    calendars += self.eds.list_calendars()
                except GLib.Error as e:
                    errors.append(f"Evolution-Kalender: {e.message}")
            for conf in caldav:
                try:
                    calendars += CalDavBackend(conf, passwords[conf["id"]]).list_calendars()
                except CalendarError as e:
                    errors.append(f"{conf.get('name') or conf['url']}: {e}")
            return calendars, errors

        def done(result, error):
            self.loading = False
            self.calendars, self.errors = result if result else ([], [error])
            self.emit("calendars-changed")

        self.run(work, done)

    def is_enabled(self, cal):
        return cal.id not in self.settings.get("disabled", [])

    def set_enabled(self, cal, enabled):
        disabled = set(self.settings.get("disabled", []))
        (disabled.discard if enabled else disabled.add)(cal.id)
        self.settings["disabled"] = sorted(disabled)
        self.store.save_settings()
        self.emit("events-changed")

    def enabled_calendars(self):
        return [c for c in self.calendars if self.is_enabled(c)]

    def writable_calendars(self):
        return [c for c in self.enabled_calendars() if c.writable]

    def default_calendar(self):
        cals = self.writable_calendars()
        return next((c for c in cals if c.id == self.settings.get("default")), cals[0] if cals else None)

    # -- Termine ---------------------------------------------------------------

    def fetch(self, start, end, callback):
        """Termine aller aktiven Kalender im Zeitraum; callback(events, errors)."""
        calendars = self.enabled_calendars()

        def work():
            events, errors = [], []
            for cal in calendars:
                try:
                    events += cal.backend.events(cal, start, end)
                except CalendarError as e:
                    errors.append(f"{cal.name}: {e}")
                except GLib.Error as e:
                    errors.append(f"{cal.name}: {e.message}")
            events.sort(key=lambda e: (not e.all_day, e.start, e.summary.lower()))
            return events, errors

        self.run(work, lambda r, err: callback(*(r if r else ([], [err]))))

    def save(self, ev, is_new, callback):
        if is_new and not ev.uid:
            ev.uid = f"{uuid.uuid4()}@sip-telefon"
        self.run(lambda: ev.calendar.backend.save(ev, is_new), lambda _r, err: self._done(callback, err))

    def delete(self, ev, callback):
        self.run(lambda: ev.calendar.backend.delete(ev), lambda _r, err: self._done(callback, err))

    def _done(self, callback, error):
        callback(error)
        if not error:
            self.emit("events-changed")

    def refresh(self):
        backends = {c.backend for c in self.calendars}
        self.run(lambda: [b.refresh() for b in backends], lambda *_: self.emit("events-changed"))
