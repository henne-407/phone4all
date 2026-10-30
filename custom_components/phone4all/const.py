"""Konstanten der Phone4all-Integration."""

from datetime import timedelta

DOMAIN = "phone4all"

CONF_TOKEN = "token"

SCAN_INTERVAL = timedelta(seconds=15)

# Pfad der Schnittstelle an der Anlage (ab Telefonanlage 0.3.0)
STATUS_PATH = "/api/integration/status"
# Schalten und Anrufen (ab Telefonanlage 0.10)
ACTION_PATHS = {
    "call": "/api/integration/call",
    "announce": "/api/integration/announce",
    "dnd": "/api/integration/dnd",
    "forward": "/api/integration/forward",
    "timecondition": "/api/integration/timecondition",
}
SUPPORTED_API = 1

# Ereignisse auf dem Ereignisbus von Home Assistant (für Automationen)
EVENT_MISSED_CALL = "phone4all_missed_call"
EVENT_EMERGENCY_CALL = "phone4all_emergency_call"
EVENT_DOOR_RING = "phone4all_door_ring"
EVENT_PROBLEM = "phone4all_problem"
EVENT_PROBLEM_RESOLVED = "phone4all_problem_resolved"

# Schlüssel für das Problem „Anlage nicht erreichbar“ (erkennt Home Assistant selbst)
PROBLEM_CONNECTION = "connection"
