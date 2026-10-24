"""Gemeinsame Basis der Entitäten: ein Gerät je Telefonanlage."""

from __future__ import annotations

from homeassistant.helpers.device_registry import DeviceInfo
from homeassistant.helpers.update_coordinator import CoordinatorEntity

from .const import DOMAIN
from .coordinator import Phone4allCoordinator


class Phone4allEntity(CoordinatorEntity[Phone4allCoordinator]):
    """Entität der Telefonanlage."""

    _attr_has_entity_name = True

    def __init__(self, coordinator: Phone4allCoordinator, key: str) -> None:
        super().__init__(coordinator)
        entry = coordinator.config_entry
        self._attr_unique_id = f"{entry.entry_id}_{key}"
        self._attr_device_info = DeviceInfo(
            identifiers={(DOMAIN, entry.entry_id)},
            name=entry.title,
            manufacturer="Phone4all",
            model="Telefonanlage",
            sw_version=coordinator.data.get("version"),
            configuration_url=coordinator.api.url,
        )
