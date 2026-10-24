"""Einrichtung über die Oberfläche: Adresse und Zugriffsschlüssel der Anlage."""

from __future__ import annotations

from collections.abc import Mapping
from typing import Any

import voluptuous as vol

from homeassistant.config_entries import ConfigFlow, ConfigFlowResult
from homeassistant.const import CONF_URL, CONF_VERIFY_SSL
from homeassistant.helpers.aiohttp_client import async_get_clientsession

from .api import (
    Phone4allApi,
    Phone4allAuthError,
    Phone4allError,
    Phone4allProxyError,
    Phone4allUnsupported,
    normalize_url,
)
from .const import CONF_TOKEN, DOMAIN, SUPPORTED_API

USER_SCHEMA = vol.Schema(
    {
        vol.Required(CONF_URL): str,
        vol.Required(CONF_TOKEN): str,
        vol.Required(CONF_VERIFY_SSL, default=True): bool,
    }
)


class Phone4allConfigFlow(ConfigFlow, domain=DOMAIN):
    """Telefonanlage hinzufügen."""

    VERSION = 1

    async def _test(self, url: str, token: str, verify_ssl: bool) -> tuple[dict[str, Any] | None, str | None]:
        """Zustandsbericht abrufen; liefert (Daten, Fehlerschlüssel)."""
        api = Phone4allApi(async_get_clientsession(self.hass, verify_ssl=verify_ssl), url, token)
        try:
            data = await api.status()
        except Phone4allAuthError:
            return None, "invalid_auth"
        except Phone4allUnsupported:
            return None, "unsupported"
        except Phone4allProxyError:
            return None, "proxy_auth"
        except Phone4allError:
            return None, "cannot_connect"
        if data.get("api", 0) > SUPPORTED_API:
            return None, "unsupported"
        return data, None

    async def async_step_user(self, user_input: dict[str, Any] | None = None) -> ConfigFlowResult:
        errors: dict[str, str] = {}
        if user_input is not None:
            url = normalize_url(user_input[CONF_URL])
            await self.async_set_unique_id(url)
            self._abort_if_unique_id_configured()
            data, error = await self._test(url, user_input[CONF_TOKEN].strip(), user_input[CONF_VERIFY_SSL])
            if data is not None:
                return self.async_create_entry(
                    title=data.get("name") or "Phone4all",
                    data={CONF_URL: url, CONF_TOKEN: user_input[CONF_TOKEN].strip(), CONF_VERIFY_SSL: user_input[CONF_VERIFY_SSL]},
                )
            errors["base"] = error or "unknown"
        return self.async_show_form(
            step_id="user",
            data_schema=self.add_suggested_values_to_schema(USER_SCHEMA, user_input or {}),
            errors=errors,
        )

    async def async_step_reauth(self, entry_data: Mapping[str, Any]) -> ConfigFlowResult:
        """Schlüssel wurde an der Anlage erneuert."""
        return await self.async_step_reauth_confirm()

    async def async_step_reauth_confirm(self, user_input: dict[str, Any] | None = None) -> ConfigFlowResult:
        errors: dict[str, str] = {}
        entry = self._get_reauth_entry()
        if user_input is not None:
            token = user_input[CONF_TOKEN].strip()
            data, error = await self._test(entry.data[CONF_URL], token, entry.data.get(CONF_VERIFY_SSL, True))
            if data is not None:
                return self.async_update_reload_and_abort(entry, data_updates={CONF_TOKEN: token})
            errors["base"] = error or "unknown"
        return self.async_show_form(
            step_id="reauth_confirm",
            data_schema=vol.Schema({vol.Required(CONF_TOKEN): str}),
            description_placeholders={"url": entry.data[CONF_URL]},
            errors=errors,
        )
