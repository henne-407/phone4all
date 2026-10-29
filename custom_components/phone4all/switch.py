"""Schalter: Nicht stören je Nebenstelle (braucht „Schalten über die Schnittstelle“ an der Anlage)."""

from __future__ import annotations

from typing import Any

from homeassistant.components.switch import SwitchEntity
from homeassistant.core import HomeAssistant, callback
from homeassistant.exceptions import HomeAssistantError
from homeassistant.helpers.entity_platform import AddConfigEntryEntitiesCallback

from .api import Phone4allError
from .coordinator import Phone4allConfigEntry, Phone4allCoordinator
from .entity import Phone4allEntity


async def async_setup_entry(
    hass: HomeAssistant, entry: Phone4allConfigEntry, async_add_entities: AddConfigEntryEntitiesCallback
) -> None:
    coordinator = entry.runtime_data
    known: set[str] = set()

    # Nebenstellen können an der Anlage hinzukommen; Türsprechstellen bekommen keinen Schalter
    @callback
    def add_extensions() -> None:
        new = [e for e in coordinator.data.get("extensions", []) if not e.get("door") and e["number"] not in known]
        known.update(e["number"] for e in new)
        if new:
            async_add_entities(DndSwitch(coordinator, e["number"], e["name"]) for e in new)

    add_extensions()
    entry.async_on_unload(coordinator.async_add_listener(add_extensions))


class DndSwitch(Phone4allEntity, SwitchEntity):
    """Nicht stören einer Nebenstelle (wie *76 am Telefon)."""

    _attr_translation_key = "dnd"

    def __init__(self, coordinator: Phone4allCoordinator, number: str, name: str) -> None:
        super().__init__(coordinator, f"dnd_{number}")
        self._number = number
        self._attr_translation_placeholders = {"extension": f"{number} {name}".strip()}

    def _extension(self) -> dict[str, Any] | None:
        return next((e for e in self.coordinator.data.get("extensions", []) if e["number"] == self._number), None)

    @property
    def available(self) -> bool:
        return super().available and self._extension() is not None

    @property
    def is_on(self) -> bool:
        ext = self._extension()
        return bool(ext and ext["dnd"])

    @property
    def extra_state_attributes(self) -> dict[str, Any]:
        ext = self._extension() or {}
        return {"extension": self._number, "forward": ext.get("forward", "")}

    async def _set(self, enabled: bool) -> None:
        try:
            await self.coordinator.async_action("dnd", {"extension": self._number, "enabled": enabled})
        except Phone4allError as err:
            raise HomeAssistantError(f"Telefonanlage: {err}") from err

    async def async_turn_on(self, **kwargs: Any) -> None:
        await self._set(True)

    async def async_turn_off(self, **kwargs: Any) -> None:
        await self._set(False)
