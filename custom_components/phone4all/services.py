"""Dienste: Anruf auslösen, Ansage aus Text, Umleitung setzen."""

from __future__ import annotations

from typing import Any

import voluptuous as vol

from homeassistant.config_entries import ConfigEntryState
from homeassistant.core import HomeAssistant, ServiceCall, callback
from homeassistant.exceptions import HomeAssistantError, ServiceValidationError
from homeassistant.helpers import config_validation as cv

from .api import Phone4allError
from .const import DOMAIN
from .coordinator import Phone4allCoordinator

ATTR_CONFIG_ENTRY = "config_entry_id"

BASE = {vol.Optional(ATTR_CONFIG_ENTRY): cv.string}

SCHEMAS = {
    "call": vol.Schema({**BASE, vol.Required("extension"): cv.string, vol.Required("number"): cv.string}),
    "announce": vol.Schema({**BASE, vol.Required("target"): cv.string, vol.Required("message"): cv.string, vol.Optional("voice"): cv.string}),
    "set_forward": vol.Schema({**BASE, vol.Required("extension"): cv.string, vol.Optional("target", default=""): cv.string}),
}


def _coordinator(hass: HomeAssistant, entry_id: str | None) -> Phone4allCoordinator:
    entries = [e for e in hass.config_entries.async_entries(DOMAIN) if e.state is ConfigEntryState.LOADED]
    if entry_id:
        entries = [e for e in entries if e.entry_id == entry_id]
    if not entries:
        raise ServiceValidationError("Keine eingerichtete Phone4all-Anlage gefunden.")
    if len(entries) > 1:
        raise ServiceValidationError("Mehrere Anlagen eingerichtet: bitte config_entry_id angeben.")
    return entries[0].runtime_data


@callback
def async_setup_services(hass: HomeAssistant) -> None:
    """Dienste anmelden."""

    async def handle(call: ServiceCall) -> None:
        coordinator = _coordinator(hass, call.data.get(ATTR_CONFIG_ENTRY))
        payload: dict[str, Any]
        if call.service == "call":
            name, payload = "call", {"extension": call.data["extension"], "number": call.data["number"]}
        elif call.service == "announce":
            name, payload = "announce", {"target": call.data["target"], "text": call.data["message"], "voice": call.data.get("voice", "")}
        else:
            name, payload = "forward", {"extension": call.data["extension"], "target": call.data["target"]}
        try:
            await coordinator.async_action(name, payload)
        except Phone4allError as err:
            raise HomeAssistantError(f"Telefonanlage: {err}") from err

    for service, schema in SCHEMAS.items():
        hass.services.async_register(DOMAIN, service, handle, schema=schema)
