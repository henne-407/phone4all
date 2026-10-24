"""Ereignis-Entitäten: verpasster Anruf, Problem aufgetreten / behoben."""

from __future__ import annotations

from typing import Any

from homeassistant.components.event import EventEntity
from homeassistant.core import HomeAssistant, callback
from homeassistant.helpers.entity_platform import AddConfigEntryEntitiesCallback

from .coordinator import Phone4allConfigEntry, Phone4allCoordinator
from .entity import Phone4allEntity


async def async_setup_entry(
    hass: HomeAssistant, entry: Phone4allConfigEntry, async_add_entities: AddConfigEntryEntitiesCallback
) -> None:
    coordinator = entry.runtime_data
    async_add_entities(
        [
            Phone4allEvent(coordinator, "missed_call", ["missed_call"]),
            Phone4allEvent(coordinator, "problem", ["problem", "resolved"]),
        ]
    )


class Phone4allEvent(Phone4allEntity, EventEntity):
    """Zeigt das letzte Ereignis einer Art an (für Verlauf und Automationen)."""

    def __init__(self, coordinator: Phone4allCoordinator, key: str, event_types: list[str]) -> None:
        super().__init__(coordinator, f"event_{key}")
        self._attr_translation_key = f"{key}_event"
        self._attr_event_types = event_types

    async def async_added_to_hass(self) -> None:
        await super().async_added_to_hass()
        self.async_on_remove(self.coordinator.add_event_listener(self._on_event))

    @callback
    def _on_event(self, event_type: str, data: dict[str, Any]) -> None:
        if event_type not in self.event_types:
            return
        self._trigger_event(event_type, {k: v for k, v in data.items() if k not in ("entry_id", "pbx")})
        self.async_write_ha_state()
