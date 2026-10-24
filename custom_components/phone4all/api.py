"""Zugriff auf die Schnittstelle der Telefonanlage."""

from __future__ import annotations

import asyncio
from typing import Any

import aiohttp

from .const import STATUS_PATH


class Phone4allError(Exception):
    """Anlage nicht erreichbar oder unerwartete Antwort."""


class Phone4allAuthError(Phone4allError):
    """Zugriffsschlüssel falsch oder Schnittstelle ausgeschaltet."""


class Phone4allProxyError(Phone4allError):
    """Ein Reverse-Proxy verlangt eine eigene Anmeldung (Pfad dort freigeben)."""


class Phone4allUnsupported(Phone4allError):
    """Die Anlage ist zu alt und kennt die Schnittstelle nicht."""


def normalize_url(url: str) -> str:
    """„pbx.example.de/“ → „https://pbx.example.de“."""
    url = url.strip().rstrip("/")
    if "://" not in url:
        url = f"https://{url}"
    return url


class Phone4allApi:
    """Fragt den Zustandsbericht der Anlage ab."""

    def __init__(self, session: aiohttp.ClientSession, url: str, token: str) -> None:
        self._session = session
        self.url = normalize_url(url)
        self._token = token

    async def status(self) -> dict[str, Any]:
        """Zustandsbericht: SIP-Konten, verpasste Anrufe, Probleme."""
        try:
            async with asyncio.timeout(15):
                resp = await self._session.get(
                    f"{self.url}{STATUS_PATH}",
                    headers={"Authorization": f"Bearer {self._token}", "Accept": "application/json"},
                    allow_redirects=False,
                )
                if resp.status == 401:
                    raise Phone4allAuthError("Zugriffsschlüssel abgelehnt")
                if 300 <= resp.status < 400:
                    raise Phone4allProxyError(f"Weiterleitung nach {resp.headers.get('Location', '?')}")
                if resp.status == 404:
                    raise Phone4allUnsupported("Schnittstelle nicht gefunden")
                if resp.status != 200:
                    raise Phone4allError(f"Antwort {resp.status}")
                if "json" not in resp.headers.get("Content-Type", ""):
                    # z. B. Anmeldeseite eines Reverse-Proxys
                    raise Phone4allProxyError("Keine Antwort der Telefonanlage")
                data = await resp.json()
        except (aiohttp.ClientError, TimeoutError) as err:
            raise Phone4allError(str(err) or type(err).__name__) from err
        if not isinstance(data, dict) or "trunks" not in data:
            raise Phone4allError("Unerwartete Antwort")
        return data
