"""Phone4all-Telefonanlage in Home Assistant: verpasste Anrufe, SIP-Konten, Probleme."""

from __future__ import annotations

from homeassistant.const import CONF_URL, CONF_VERIFY_SSL, Platform
from homeassistant.core import HomeAssistant
from homeassistant.helpers.aiohttp_client import async_get_clientsession

from .api import Phone4allApi
from .const import CONF_TOKEN
from .coordinator import Phone4allConfigEntry, Phone4allCoordinator

PLATFORMS = [Platform.BINARY_SENSOR, Platform.EVENT, Platform.SENSOR]


async def async_setup_entry(hass: HomeAssistant, entry: Phone4allConfigEntry) -> bool:
    """Anlage einrichten."""
    session = async_get_clientsession(hass, verify_ssl=entry.data.get(CONF_VERIFY_SSL, True))
    api = Phone4allApi(session, entry.data[CONF_URL], entry.data[CONF_TOKEN])
    coordinator = Phone4allCoordinator(hass, entry, api)
    await coordinator.async_config_entry_first_refresh()
    entry.runtime_data = coordinator
    await hass.config_entries.async_forward_entry_setups(entry, PLATFORMS)
    return True


async def async_unload_entry(hass: HomeAssistant, entry: Phone4allConfigEntry) -> bool:
    """Anlage entfernen."""
    return await hass.config_entries.async_unload_platforms(entry, PLATFORMS)
