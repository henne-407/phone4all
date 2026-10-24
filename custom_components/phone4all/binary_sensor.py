"""Binärsensoren: Anmeldung der SIP-Konten, Probleme, Asterisk, Update."""

from __future__ import annotations

from typing import Any

from homeassistant.components.binary_sensor import BinarySensorDeviceClass, BinarySensorEntity
from homeassistant.const import EntityCategory
from homeassistant.core import HomeAssistant, callback
from homeassistant.helpers.entity_platform import AddConfigEntryEntitiesCallback

from .coordinator import Phone4allConfigEntry, Phone4allCoordinator
from .entity import Phone4allEntity


async def async_setup_entry(
    hass: HomeAssistant, entry: Phone4allConfigEntry, async_add_entities: AddConfigEntryEntitiesCallback
) -> None:
    coordinator = entry.runtime_data
    async_add_entities([ProblemSensor(coordinator), AsteriskSensor(coordinator), UpdateSensor(coordinator)])

    # SIP-Konten können an der Anlage hinzukommen
    known: set[str] = set()

    @callback
    def add_trunks() -> None:
        new = [t for t in coordinator.data["trunks"] if t["register"] and t["id"] not in known]
        known.update(t["id"] for t in new)
        if new:
            async_add_entities(TrunkSensor(coordinator, t["id"], t["name"]) for t in new)

    add_trunks()
    entry.async_on_unload(coordinator.async_add_listener(add_trunks))


class ProblemSensor(Phone4allEntity, BinarySensorEntity):
    """An, sobald die Anlage ein Problem meldet (z. B. SIP-Konto abgemeldet)."""

    _attr_device_class = BinarySensorDeviceClass.PROBLEM
    _attr_translation_key = "problem"

    def __init__(self, coordinator: Phone4allCoordinator) -> None:
        super().__init__(coordinator, "problem")

    @property
    def is_on(self) -> bool:
        return bool(self.coordinator.data["problems"])

    @property
    def extra_state_attributes(self) -> dict[str, Any]:
        return {"problems": [p["message"] for p in self.coordinator.data["problems"]]}


class AsteriskSensor(Phone4allEntity, BinarySensorEntity):
    """Asterisk (die eigentliche Telefonanlage) läuft."""

    _attr_device_class = BinarySensorDeviceClass.RUNNING
    _attr_entity_category = EntityCategory.DIAGNOSTIC
    _attr_translation_key = "asterisk"

    def __init__(self, coordinator: Phone4allCoordinator) -> None:
        super().__init__(coordinator, "asterisk")

    @property
    def is_on(self) -> bool:
        return self.coordinator.data["asterisk"]["state"] == "running"

    @property
    def extra_state_attributes(self) -> dict[str, Any]:
        a = self.coordinator.data["asterisk"]
        return {"state": a["state"], "message": a["message"], "uptime": a["uptime"]}


class UpdateSensor(Phone4allEntity, BinarySensorEntity):
    """Neue Version der Telefonanlage verfügbar."""

    _attr_device_class = BinarySensorDeviceClass.UPDATE
    _attr_entity_category = EntityCategory.DIAGNOSTIC
    _attr_translation_key = "update"

    def __init__(self, coordinator: Phone4allCoordinator) -> None:
        super().__init__(coordinator, "update")

    @property
    def is_on(self) -> bool:
        return self.coordinator.data["update"]["available"]

    @property
    def extra_state_attributes(self) -> dict[str, Any]:
        u = self.coordinator.data["update"]
        return {"installed_version": u["current"], "latest_version": u["latest"]}


class TrunkSensor(Phone4allEntity, BinarySensorEntity):
    """Ein SIP-Konto ist beim Anbieter angemeldet."""

    _attr_device_class = BinarySensorDeviceClass.CONNECTIVITY
    _attr_translation_key = "trunk"

    def __init__(self, coordinator: Phone4allCoordinator, trunk_id: str, name: str) -> None:
        super().__init__(coordinator, f"trunk_{trunk_id}")
        self._trunk_id = trunk_id
        self._attr_translation_placeholders = {"trunk": name}

    def _trunk(self) -> dict[str, Any] | None:
        return next((t for t in self.coordinator.data["trunks"] if t["id"] == self._trunk_id), None)

    @property
    def available(self) -> bool:
        # Gelöschtes oder ausgeschaltetes Konto: nicht verfügbar statt „getrennt“
        trunk = self._trunk()
        return super().available and trunk is not None and trunk["register"]

    @property
    def is_on(self) -> bool:
        trunk = self._trunk()
        return bool(trunk and trunk["registered"])

    @property
    def extra_state_attributes(self) -> dict[str, Any]:
        trunk = self._trunk() or {}
        return {"status": trunk.get("status", ""), "trunk_id": self._trunk_id}
