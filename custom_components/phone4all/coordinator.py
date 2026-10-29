"""Fragt die Anlage regelmäßig ab und meldet neue verpasste Anrufe und Probleme."""

from __future__ import annotations

import logging
from collections.abc import Callable
from datetime import timedelta
from typing import Any

from homeassistant.config_entries import ConfigEntry
from homeassistant.core import HomeAssistant
from homeassistant.exceptions import ConfigEntryAuthFailed
from homeassistant.helpers.storage import Store
from homeassistant.helpers.update_coordinator import DataUpdateCoordinator, UpdateFailed
from homeassistant.util import dt as dt_util

from .api import Phone4allApi, Phone4allAuthError, Phone4allError
from .const import (
    DOMAIN,
    EVENT_EMERGENCY_CALL,
    EVENT_MISSED_CALL,
    EVENT_PROBLEM,
    EVENT_PROBLEM_RESOLVED,
    PROBLEM_CONNECTION,
    SCAN_INTERVAL,
)

_LOGGER = logging.getLogger(__name__)

# Merkt sich so viele IDs bereits gemeldeter Anrufe
SEEN_LIMIT = 500
STORAGE_VERSION = 1
# Anrufe tauchen erst nach dem Auflegen auf, tragen aber die Anfangszeit
RESTART_MARGIN = timedelta(hours=1)

type Phone4allConfigEntry = ConfigEntry[Phone4allCoordinator]


class Phone4allCoordinator(DataUpdateCoordinator[dict[str, Any]]):
    """Zustand der Anlage; Ereignisse werden nur bei Änderungen ausgelöst."""

    config_entry: Phone4allConfigEntry

    def __init__(self, hass: HomeAssistant, entry: Phone4allConfigEntry, api: Phone4allApi) -> None:
        super().__init__(hass, _LOGGER, config_entry=entry, name=DOMAIN, update_interval=SCAN_INTERVAL)
        self.api = api
        self._seen: list[str] | None = None
        # Gemeldete Anrufe überstehen einen Neustart von Home Assistant: Was in der Zwischenzeit
        # verpasst wurde, wird nachgemeldet, Älteres nicht
        self._store: Store[dict[str, Any]] = Store(hass, STORAGE_VERSION, f"{DOMAIN}.{entry.entry_id}.seen")
        self._since: str | None = None
        self._seen_emergency: list[str] | None = None
        self._problems: dict[str, str] = {}
        self._event_listeners: list[Callable[[str, dict[str, Any]], None]] = []

    def add_event_listener(self, listener: Callable[[str, dict[str, Any]], None]) -> Callable[[], None]:
        """Für Ereignis-Entitäten: (Ereignistyp, Daten) bei jedem neuen Ereignis."""
        self._event_listeners.append(listener)
        return lambda: self._event_listeners.remove(listener)

    def _fire(self, bus_event: str, event_type: str, data: dict[str, Any]) -> None:
        data = {"entry_id": self.config_entry.entry_id, "pbx": self.config_entry.title, **data}
        self.hass.bus.async_fire(bus_event, data)
        for listener in list(self._event_listeners):
            listener(event_type, data)

    def _set_problems(self, problems: dict[str, str]) -> None:
        for key, message in problems.items():
            if key not in self._problems:
                _LOGGER.warning("%s: %s", self.config_entry.title, message)
                self._fire(EVENT_PROBLEM, "problem", {"key": key, "message": message})
        for key, message in self._problems.items():
            if key not in problems:
                self._fire(EVENT_PROBLEM_RESOLVED, "resolved", {"key": key, "message": message})
        self._problems = problems

    async def _async_update_data(self) -> dict[str, Any]:
        try:
            data = await self.api.status()
        except Phone4allAuthError as err:
            raise ConfigEntryAuthFailed(str(err)) from err
        except Phone4allError as err:
            # Bestehende Probleme der Anlage sind unbekannt, nur „nicht erreichbar“ melden
            if self.data is not None:
                self._set_problems({**self._problems, PROBLEM_CONNECTION: f"Telefonanlage nicht erreichbar: {err}"})
            raise UpdateFailed(f"Telefonanlage nicht erreichbar: {err}") from err

        self._set_problems({p["key"]: p["message"] for p in data.get("problems", [])})
        if self._seen is None:
            await self._load_seen()
        self._check_missed(data.get("missed", {}).get("calls", []))
        # Notrufe (110/112) von Nebenstellen; ältere Anlagen liefern keine
        self._check_emergency(data.get("emergency", []))
        return data

    async def _load_seen(self) -> None:
        stored = await self._store.async_load()
        if stored and isinstance(stored.get("seen"), list):
            self._seen = [str(i) for i in stored["seen"]]
            self._since = stored.get("time")

    def _save_seen(self) -> None:
        seen = list(self._seen or [])
        self._store.async_delay_save(lambda: {"seen": seen, "time": dt_util.utcnow().isoformat()}, 5)

    def _check_emergency(self, calls: list[dict[str, Any]]) -> None:
        ids = [c["id"] for c in calls]
        if self._seen_emergency is None:
            # Erster Abruf: frühere Notrufe nicht nachträglich melden
            self._seen_emergency = ids
            return
        for call in reversed(calls):
            if call["id"] in self._seen_emergency:
                continue
            self._seen_emergency.append(call["id"])
            _LOGGER.warning("%s: Notruf %s von Nebenstelle %s", self.config_entry.title, call["number"], call["extension"])
            self._fire(
                EVENT_EMERGENCY_CALL,
                "emergency_call",
                {
                    "call_id": call["id"],
                    "time": call["time"],
                    "extension": call["extension"],
                    "name": call["name"],
                    "number": call["number"],
                },
            )
        del self._seen_emergency[:-SEEN_LIMIT]

    def _check_missed(self, calls: list[dict[str, Any]]) -> None:
        ids = [c["id"] for c in calls]
        if self._seen is None:
            # Erster Abruf ohne gespeicherten Stand: vorhandene Anrufe nicht nachträglich melden
            self._seen = ids
            self._save_seen()
            return
        since = dt_util.parse_datetime(self._since) if self._since else None
        if since:
            since = dt_util.as_utc(since) - RESTART_MARGIN
        self._since = None
        changed = False
        for call in reversed(calls):
            if call["id"] in self._seen:
                continue
            self._seen.append(call["id"])
            changed = True
            time = dt_util.parse_datetime(str(call["time"]))
            if time:
                time = dt_util.as_utc(time)
            # Nach dem Neustart nur, was seit dem letzten Speichern verpasst wurde
            if since and (time is None or time < since):
                continue
            self._fire(
                EVENT_MISSED_CALL,
                "missed_call",
                {
                    "call_id": call["id"],
                    "time": call["time"],
                    "caller": call["from"],
                    "caller_name": call["from_name"],
                    "called": call["to"],
                    "voicemail": call["voicemail"],
                },
            )
        del self._seen[:-SEEN_LIMIT]
        if changed:
            self._save_seen()
