"""Phone4all-Telefonanlage in Home Assistant: verpasste Anrufe, SIP-Konten, Probleme, Schalten und Ansagen."""

from __future__ import annotations

from homeassistant.const import CONF_URL, CONF_VERIFY_SSL, Platform
from homeassistant.core import HomeAssistant
from homeassistant.helpers import config_validation as cv
from homeassistant.helpers.aiohttp_client import async_get_clientsession
from homeassistant.helpers.typing import ConfigType

from .api import Phone4allApi
from .const import CONF_TOKEN, DOMAIN
from .coordinator import Phone4allConfigEntry, Phone4allCoordinator
from .services import async_setup_services

PLATFORMS = [Platform.BINARY_SENSOR, Platform.EVENT, Platform.SELECT, Platform.SENSOR, Platform.SWITCH]

CONFIG_SCHEMA = cv.config_entry_only_config_schema(DOMAIN)


async def async_setup(hass: HomeAssistant, config: ConfigType) -> bool:
    """Dienste (anrufen, Ansage, Umleitung) einmal für alle Anlagen anmelden."""
    async_setup_services(hass)
    return True


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
