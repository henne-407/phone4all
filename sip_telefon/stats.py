"""Auswertungen des Anrufverlaufs für Startseite und Verlaufsansicht."""

import time
from collections import Counter
from datetime import datetime, timedelta

from .store import _digits


def _since(days):
    start = datetime.now().replace(hour=0, minute=0, second=0, microsecond=0) - timedelta(days=days)
    return start.timestamp()


def summary(history, days=0):
    """Kennzahlen seit Mitternacht (days=0) bzw. der letzten `days` Tage."""
    since = _since(days)
    entries = [e for e in history if e["time"] >= since]
    return {
        "total": len(entries),
        "incoming": sum(1 for e in entries if e["direction"] == "in" and not e["missed"]),
        "outgoing": sum(1 for e in entries if e["direction"] == "out"),
        "missed": sum(1 for e in entries if e["missed"]),
        "talk": sum(e.get("duration", 0) for e in entries),
    }


def frequent(history, store, limit=8, days=90, exclude=()):
    """Häufigste Gesprächspartner: [(Name, Nummer, Anzahl)], Favoriten können ausgeschlossen werden."""
    since = time.time() - days * 86400
    counts, info = Counter(), {}
    for e in history:
        if e["time"] < since or not e["number"]:
            continue
        contact = store.find_contact(e["number"])
        # Mehrere Nummern desselben Kontakts zusammenzählen
        key = ("c", contact["id"]) if contact else ("n", _digits(e["number"])[-8:] or e["number"])
        counts[key] += 1
        info.setdefault(key, (contact, e["number"], e.get("name", "")))
    result = []
    for key, count in counts.most_common():
        contact, number, name = info[key]
        if contact is not None and contact.get("id") in exclude:
            continue
        result.append(((contact or {}).get("name") or name or number, number, count))
        if len(result) >= limit:
            break
    return result


def format_talk(seconds):
    minutes = int(seconds) // 60
    if minutes < 60:
        return f"{minutes} Min."
    return f"{minutes // 60} Std. {minutes % 60:02d} Min."
