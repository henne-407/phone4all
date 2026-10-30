"""Zugriff auf die Schnittstelle der Telefonanlage."""

from __future__ import annotations

import asyncio
import re
from typing import Any

import aiohttp

from .const import ACTION_PATHS, STATUS_PATH


class Phone4allError(Exception):
    """Anlage nicht erreichbar oder unerwartete Antwort."""


class Phone4allAuthError(Phone4allError):
    """Zugriffsschlüssel falsch oder Schnittstelle ausgeschaltet."""


class Phone4allProxyError(Phone4allError):
    """Ein Reverse-Proxy verlangt eine eigene Anmeldung (Pfad dort freigeben)."""


class Phone4allUnsupported(Phone4allError):
    """Die Anlage ist zu alt und kennt die Schnittstelle nicht."""


class Phone4allActionError(Phone4allError):
    """Die Anlage hat eine Aktion abgelehnt (Text kommt von der Anlage)."""


# IP-Adresse (auch [IPv6]) mit optionalem Port, oder ein Name mit dem Port der Anlage im LAN
_LAN_HOST = re.compile(r"^(\d{1,3}(\.\d{1,3}){3}|\[[0-9a-fA-F:.]+\])(:\d+)?$|:8080$")


def normalize_url(url: str) -> str:
    """„pbx.example.de/“ → „https://pbx.example.de“, „192.168.1.5:8080“ → „http://192.168.1.5:8080“."""
    url = url.strip().rstrip("/")
    if "://" not in url:
        # Im LAN spricht die Anlage nur HTTP; HTTPS gibt es erst über den Reverse-Proxy
        host = url.split("/", 1)[0]
        url = f"http://{url}" if _LAN_HOST.search(host) else f"https://{url}"
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

    async def action(self, name: str, payload: dict[str, Any]) -> dict[str, Any]:
        """Schalten oder anrufen; Fehlertext der Anlage als Phone4allActionError."""
        try:
            async with asyncio.timeout(30):
                resp = await self._session.post(
                    f"{self.url}{ACTION_PATHS[name]}",
                    json=payload,
                    headers={"Authorization": f"Bearer {self._token}", "Accept": "application/json"},
                    allow_redirects=False,
                )
                # Ältere Anlagen kennen die Aktion nicht und antworten wie für die Verwaltung (401 ohne Bearer-Hinweis)
                if resp.status == 401 and "Bearer" not in resp.headers.get("WWW-Authenticate", ""):
                    raise Phone4allUnsupported("Die Anlage kennt diese Aktion nicht (bitte aktualisieren)")
                if resp.status == 401:
                    raise Phone4allAuthError("Zugriffsschlüssel abgelehnt")
                data = await resp.json(content_type=None) if "json" in resp.headers.get("Content-Type", "") else {}
                if resp.status != 200:
                    raise Phone4allActionError(str(data.get("error") or f"Antwort {resp.status}"))
        except (aiohttp.ClientError, TimeoutError) as err:
            raise Phone4allError(str(err) or type(err).__name__) from err
        return data if isinstance(data, dict) else {}
