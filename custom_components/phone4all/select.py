"""Auswahl: Zeitsteuerungen umschalten (automatisch, immer geöffnet, immer geschlossen)."""

from __future__ import annotations

from typing import Any

from homeassistant.components.select import SelectEntity
from homeassistant.core import HomeAssistant, callback
from homeassistant.exceptions import HomeAssistantError
from homeassistant.helpers.entity_platform import AddConfigEntryEntitiesCallback

from .api import Phone4allError
from .coordinator import Phone4allConfigEntry, Phone4allCoordinator
from .entity import Phone4allEntity

MODES = ["auto", "open", "closed"]


async def async_setup_entry(
    hass: HomeAssistant, entry: Phone4allConfigEntry, async_add_entities: AddConfigEntryEntitiesCallback
) -> None:
    coordinator = entry.runtime_data
    known: set[str] = set()

    @callback
    def add_conditions() -> None:
        new = [t for t in coordinator.data.get("timeconditions", []) if t["id"] not in known]
        known.update(t["id"] for t in new)
        if new:
            async_add_entities(TimeConditionSelect(coordinator, t["id"], t["name"]) for t in new)

    add_conditions()
    entry.async_on_unload(coordinator.async_add_listener(add_conditions))


class TimeConditionSelect(Phone4allEntity, SelectEntity):
    """Zeitsteuerung (z. B. Öffnungszeiten) von Hand umschalten, wie *28 am Telefon."""

    _attr_translation_key = "timecondition"
    _attr_options = MODES

    def __init__(self, coordinator: Phone4allCoordinator, tc_id: str, name: str) -> None:
        super().__init__(coordinator, f"timecondition_{tc_id}")
        self._id = tc_id
        self._attr_translation_placeholders = {"name": name}

    def _condition(self) -> dict[str, Any] | None:
        return next((t for t in self.coordinator.data.get("timeconditions", []) if t["id"] == self._id), None)

    @property
    def available(self) -> bool:
        return super().available and self._condition() is not None

    @property
    def current_option(self) -> str | None:
        tc = self._condition()
        return tc["override"] if tc else None

    @property
    def extra_state_attributes(self) -> dict[str, Any]:
        tc = self._condition() or {}
        return {"open": tc.get("open"), "timecondition_id": self._id}

    async def async_select_option(self, option: str) -> None:
        try:
            await self.coordinator.async_action("timecondition", {"id": self._id, "mode": option})
        except Phone4allError as err:
            raise HomeAssistantError(f"Telefonanlage: {err}") from err
