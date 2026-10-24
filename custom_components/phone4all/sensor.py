"""Sensoren: verpasste Anrufe heute, letzter verpasster Anruf, laufende Gespräche."""

from __future__ import annotations

from datetime import datetime
from typing import Any

from homeassistant.components.sensor import SensorDeviceClass, SensorEntity, SensorStateClass
from homeassistant.core import HomeAssistant
from homeassistant.helpers.entity_platform import AddConfigEntryEntitiesCallback
from homeassistant.util import dt as dt_util

from .coordinator import Phone4allConfigEntry, Phone4allCoordinator
from .entity import Phone4allEntity


async def async_setup_entry(
    hass: HomeAssistant, entry: Phone4allConfigEntry, async_add_entities: AddConfigEntryEntitiesCallback
) -> None:
    coordinator = entry.runtime_data
    async_add_entities([MissedTodaySensor(coordinator), LastMissedSensor(coordinator), ActiveCallsSensor(coordinator)])


class MissedTodaySensor(Phone4allEntity, SensorEntity):
    """Verpasste Anrufe seit Mitternacht (auch auf die Voicemail gelaufene)."""

    _attr_translation_key = "missed_today"
    _attr_state_class = SensorStateClass.TOTAL_INCREASING

    def __init__(self, coordinator: Phone4allCoordinator) -> None:
        super().__init__(coordinator, "missed_today")

    @property
    def native_value(self) -> int:
        return self.coordinator.data["missed"]["today"]

    @property
    def extra_state_attributes(self) -> dict[str, Any]:
        # Die letzten Anrufe für Karten im Dashboard
        return {
            "calls": [
                {"time": c["time"], "caller": c["from"], "caller_name": c["from_name"], "called": c["to"], "voicemail": c["voicemail"]}
                for c in self.coordinator.data["missed"]["calls"][:10]
            ]
        }


class LastMissedSensor(Phone4allEntity, SensorEntity):
    """Zeitpunkt des letzten verpassten Anrufs, Anrufer als Attribute."""

    _attr_translation_key = "last_missed"
    _attr_device_class = SensorDeviceClass.TIMESTAMP

    def __init__(self, coordinator: Phone4allCoordinator) -> None:
        super().__init__(coordinator, "last_missed")

    def _call(self) -> dict[str, Any] | None:
        calls = self.coordinator.data["missed"]["calls"]
        return calls[0] if calls else None

    @property
    def native_value(self) -> datetime | None:
        call = self._call()
        return dt_util.parse_datetime(call["time"]) if call else None

    @property
    def extra_state_attributes(self) -> dict[str, Any]:
        call = self._call() or {}
        return {
            "caller": call.get("from"),
            "caller_name": call.get("from_name"),
            "called": call.get("to"),
            "voicemail": call.get("voicemail"),
        }


class ActiveCallsSensor(Phone4allEntity, SensorEntity):
    """Gespräche, die gerade laufen."""

    _attr_translation_key = "active_calls"
    _attr_state_class = SensorStateClass.MEASUREMENT

    def __init__(self, coordinator: Phone4allCoordinator) -> None:
        super().__init__(coordinator, "active_calls")

    @property
    def native_value(self) -> int:
        return self.coordinator.data["active_calls"]
