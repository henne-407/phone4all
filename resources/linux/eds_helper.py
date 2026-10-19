#!/usr/bin/env python3
"""Zugriff auf den Evolution Data Server (GNOME Online-Konten, lokale Kalender/Adressbücher).

Wird von SIP-Telefon unter Linux als Hintergrundprozess gestartet. Anfragen kommen
zeilenweise als JSON über stdin ({"id", "cmd", ...}), Antworten gehen zeilenweise
als JSON über stdout zurück ({"id", "result"} oder {"id", "error"}).
"""

import json
import sys
import threading
from datetime import datetime, timezone
from zoneinfo import ZoneInfo

import gi

gi.require_version("ICalGLib", "3.0")
gi.require_version("ECal", "2.0")
gi.require_version("EDataServer", "1.2")
from gi.repository import ECal, EDataServer, GLib, ICalGLib  # noqa: E402

try:
    gi.require_version("EBook", "1.2")
    gi.require_version("EBookContacts", "1.2")
    from gi.repository import EBook, EBookContacts
except (ImportError, ValueError):
    EBook = None

DEFAULT_COLOR = "#6750a4"
MAX_INSTANCES = 500

registry = None
clients = {}


def _registry():
    global registry
    if registry is None:
        registry = EDataServer.SourceRegistry.new_sync(None)
    return registry


# -- Zeiten ----------------------------------------------------------------


def _zone_from_tzid(tzid):
    parts = (tzid or "").strip("/").split("/")
    for i in range(len(parts)):
        try:
            return ZoneInfo("/".join(parts[i:]))
        except (KeyError, ValueError):
            continue
    return None


def _ms(dt):
    return int(dt.timestamp() * 1000)


def ical_to_ms(t):
    """ICalGLib.Time -> (ms seit 1970, ganztägig)"""
    if t is None or t.is_null_time():
        return None, False
    if t.is_date():
        return _ms(datetime(t.get_year(), t.get_month(), t.get_day())), True
    naive = datetime(t.get_year(), t.get_month(), t.get_day(), t.get_hour(), t.get_minute(), t.get_second())
    if t.is_utc():
        return _ms(naive.replace(tzinfo=timezone.utc)), False
    zone = t.get_timezone()
    if zone is not None:
        tzid = zone.get_tzid() or ""
        if "UTC" in tzid.upper() and "/" not in tzid:
            return _ms(naive.replace(tzinfo=timezone.utc)), False
        py_zone = _zone_from_tzid(zone.get_location() or tzid)
        if py_zone is not None:
            return _ms(naive.replace(tzinfo=py_zone)), False
        return t.as_timet_with_zone(zone) * 1000, False
    py_zone = _zone_from_tzid(t.get_tzid())
    if py_zone is not None:
        return _ms(naive.replace(tzinfo=py_zone)), False
    return _ms(naive), False


def ms_to_ical(ms, all_day):
    if all_day:
        dt = datetime.fromtimestamp(ms / 1000)
        t = ICalGLib.Time.new_null_time()
        t.set_date(dt.year, dt.month, dt.day)
        t.set_is_date(True)
        return t
    return ICalGLib.Time.new_from_timet_with_zone(int(ms // 1000), 0, ICalGLib.Timezone.get_utc_timezone())


def _text(getter):
    try:
        return getter() or ""
    except (TypeError, GLib.Error):
        return ""


def event_from_comp(comp, start=None, end=None):
    s, all_day = ical_to_ms(start if start is not None else comp.get_dtstart())
    if s is None:
        return None
    e, _ = ical_to_ms(end if end is not None else comp.get_dtend())
    if e is None:
        duration = comp.get_duration()
        if duration is not None and not duration.is_null_duration():
            e = s + duration.as_int() * 1000
        else:
            e = s + 86400000 if all_day else s
    recurring = (comp.get_first_property(ICalGLib.PropertyKind.RRULE_PROPERTY) is not None
                 or comp.get_first_property(ICalGLib.PropertyKind.RECURRENCEID_PROPERTY) is not None)
    return {
        "uid": comp.get_uid() or "",
        "summary": _text(comp.get_summary) or "(ohne Titel)",
        "start": s,
        "end": e,
        "allDay": all_day,
        "location": _text(comp.get_location),
        "description": _text(comp.get_description),
        "recurring": recurring,
    }


def _remove_props(comp, kind):
    prop = comp.get_first_property(kind)
    while prop is not None:
        comp.remove_property(prop)
        prop = comp.get_first_property(kind)


def apply_event(comp, ev):
    comp.set_summary(ev["summary"])
    _remove_props(comp, ICalGLib.PropertyKind.DURATION_PROPERTY)
    comp.set_dtstart(ms_to_ical(ev["start"], ev["allDay"]))
    comp.set_dtend(ms_to_ical(ev["end"], ev["allDay"]))
    for kind, setter, value in (
        (ICalGLib.PropertyKind.LOCATION_PROPERTY, comp.set_location, ev.get("location", "")),
        (ICalGLib.PropertyKind.DESCRIPTION_PROPERTY, comp.set_description, ev.get("description", "")),
    ):
        _remove_props(comp, kind)
        if value:
            setter(value)
    comp.set_dtstamp(ICalGLib.Time.new_current_with_zone(ICalGLib.Timezone.get_utc_timezone()))


# -- Kalender ----------------------------------------------------------------


def calendars(_req):
    reg = _registry()
    result = []
    for src in reg.list_enabled(EDataServer.SOURCE_EXTENSION_CALENDAR):
        ext = src.get_extension(EDataServer.SOURCE_EXTENSION_CALENDAR)
        group = ""
        if src.get_parent():
            parent = reg.ref_source(src.get_parent())
            if parent is not None:
                group = parent.get_display_name()
        readonly = ext.get_backend_name() == "contacts"  # Geburtstage aus dem Adressbuch
        if readonly:
            group = "Kontakte"
        result.append({
            "id": "eds:" + src.get_uid(),
            "name": src.get_display_name(),
            "color": ext.get_color() or DEFAULT_COLOR,
            "writable": not readonly,
            "group": group or "Evolution",
        })
    return result


def _client(cal_id):
    client = clients.get(cal_id)
    if client is None:
        src = _registry().ref_source(cal_id[4:])
        if src is None:
            raise RuntimeError("Kalender nicht gefunden")
        client = ECal.Client.connect_sync(src, ECal.ClientSourceType.EVENTS, 20, None)
        clients[cal_id] = client
    return client


def events(req):
    client = _client(req["calendar"])
    result = []

    def on_instance(icomp, istart, iend, *_args):
        ev = event_from_comp(icomp, istart, iend)
        if ev is not None:
            result.append(ev)
        return len(result) < MAX_INSTANCES

    client.generate_instances_sync(int(req["start"] // 1000), int(req["end"] // 1000), None, on_instance)
    return {"events": result, "writable": not client.is_readonly()}


def save(req):
    client = _client(req["calendar"])
    ev = req["event"]
    if req.get("isNew"):
        comp = ICalGLib.Component.new_vevent()
        comp.set_uid(ev["uid"])
        apply_event(comp, ev)
        client.create_object_sync(comp, ECal.OperationFlags.NONE, None)
        return True
    _ok, comp = client.get_object_sync(ev["uid"], None, None)
    apply_event(comp, ev)
    client.modify_object_sync(comp, ECal.ObjModType.THIS, ECal.OperationFlags.NONE, None)
    return True


def delete(req):
    client = _client(req["calendar"])
    client.remove_object_sync(req["uid"], None, ECal.ObjModType.THIS, ECal.OperationFlags.NONE, None)
    return True


def refresh(_req):
    for client in clients.values():
        try:
            if client.check_refresh_supported():
                client.refresh_sync(None)
        except GLib.Error:
            pass
    return True


# -- Adressbücher ------------------------------------------------------------


def books(_req):
    if EBook is None:
        return []
    reg = _registry()
    result = []
    for src in reg.list_enabled(EDataServer.SOURCE_EXTENSION_ADDRESS_BOOK):
        group = ""
        if src.get_parent():
            parent = reg.ref_source(src.get_parent())
            group = parent.get_display_name() if parent else ""
        result.append({"id": "eds:" + src.get_uid(), "name": src.get_display_name(), "group": group or "Evolution"})
    return result


def vcards(req):
    src = _registry().ref_source(req["book"][4:])
    if src is None:
        return ""
    client = EBook.BookClient.connect_sync(src, 30, None)
    _ok, contacts = client.get_contacts_sync("", None)
    return "\n".join(c.to_string(EBookContacts.VCardFormat.VCARD_30) for c in contacts)


COMMANDS = {
    "calendars": calendars,
    "events": events,
    "save": save,
    "delete": delete,
    "refresh": refresh,
    "books": books,
    "vcards": vcards,
}


def serve(loop):
    """Anfragen nacheinander in diesem Thread bearbeiten (EDS-Aufrufe blockieren)."""
    for line in sys.stdin:
        if not line.strip():
            continue
        req = json.loads(line)
        try:
            reply = {"id": req["id"], "result": COMMANDS[req["cmd"]](req)}
        except GLib.Error as e:
            reply = {"id": req["id"], "error": e.message}
        except Exception as e:  # noqa: BLE001 – Fehler gehören in die Oberfläche
            reply = {"id": req["id"], "error": f"{e.__class__.__name__}: {e}"}
        sys.stdout.write(json.dumps(reply) + "\n")
        sys.stdout.flush()
    loop.quit()


def main():
    # Die EDS-Clients melden „verbunden“ über D-Bus-Signale, die nur mit
    # laufender Hauptschleife ankommen – sonst warten sie bis zum Timeout.
    loop = GLib.MainLoop()
    threading.Thread(target=serve, args=(loop,), daemon=True).start()
    loop.run()


if __name__ == "__main__":
    main()
