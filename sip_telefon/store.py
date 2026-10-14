"""Einstellungen, Kontakte und Anrufverlauf (JSON-Dateien) plus Passwortablage."""

import json
import os
import re
import time
import uuid

from gi.repository import GLib

try:
    import gi

    gi.require_version("Secret", "1")
    from gi.repository import Secret
except (ImportError, ValueError):
    Secret = None
if os.environ.get("SIP_TELEFON_NO_KEYRING"):
    Secret = None  # Passwörter nur in settings.json (z. B. für Tests ohne Schlüsselbund)

APP_DIR = "sip-telefon"
CONFIG_DIR = os.path.join(GLib.get_user_config_dir(), APP_DIR)
DATA_DIR = os.path.join(GLib.get_user_data_dir(), APP_DIR)
STATE_DIR = os.path.join(GLib.get_user_state_dir(), APP_DIR)
RUNTIME_DIR = os.path.join(GLib.get_user_runtime_dir(), APP_DIR)

HISTORY_LIMIT = 300

DEFAULT_SETTINGS = {
    "account": {
        "display_name": "",
        "user": "",
        "domain": "",
        "auth_user": "",
        "port": 0,
        "local_port": 0,
        "transport": "udp",
        "outbound": "",
        "stun": "",
        "mediaenc": "",
        "regint": 600,
    },
    "calendar": {
        "use_eds": True,
        "caldav": [],  # [{"id", "name", "url", "user"}]
        "disabled": [],  # IDs ausgeblendeter Kalender
        "default": "",  # Kalender für neue Termine
        "reminder_minutes": 10,  # 0 = keine Erinnerung
    },
    "run_in_background": True,
    "autostart": False,
}

if Secret is not None:
    SECRET_SCHEMA = Secret.Schema.new(
        "de.hpieper.SipTelefon",
        Secret.SchemaFlags.NONE,
        {"account": Secret.SchemaAttributeType.STRING},
    )


def _load_json(path, default):
    try:
        with open(path) as f:
            return json.load(f)
    except (OSError, ValueError):
        return default


def _save_json(path, data, private=False):
    os.makedirs(os.path.dirname(path), exist_ok=True)
    tmp = path + ".tmp"
    fd = os.open(tmp, os.O_WRONLY | os.O_CREAT | os.O_TRUNC, 0o600 if private else 0o644)
    with os.fdopen(fd, "w") as f:
        json.dump(data, f, indent=2, ensure_ascii=False)
    os.replace(tmp, path)


def normalize_number(number):
    """Entfernt Formatierung aus einer Rufnummer, SIP-Adressen bleiben erhalten."""
    number = number.strip()
    if "@" in number or number.startswith("sip:"):
        return number
    return re.sub(r"[^\d+*#]", "", number)


def number_from_uri(uri):
    """sip:0301234@pbx.local;user=phone -> 0301234"""
    m = re.match(r"^(?:sips?:)?([^@;>]+)@", uri or "")
    return m.group(1) if m else (uri or "")


def _digits(number):
    d = re.sub(r"\D", "", number)
    if number.strip().startswith("+"):
        return d
    return d.lstrip("0")


def numbers_match(a, b):
    if not a or not b:
        return False
    if a == b:
        return True
    da, db = _digits(a), _digits(b)
    if not da or not db:
        return False
    if da == db:
        return True
    # +49301234 vs. 0301234: Länderkennung ignorieren
    short, long_ = sorted((da, db), key=len)
    return len(short) >= 6 and long_.endswith(short)


class Store:
    def __init__(self):
        self.settings_path = os.path.join(CONFIG_DIR, "settings.json")
        self.contacts_path = os.path.join(DATA_DIR, "contacts.json")
        self.history_path = os.path.join(DATA_DIR, "history.json")

        self.settings = _load_json(self.settings_path, {})
        for key, value in DEFAULT_SETTINGS.items():
            if isinstance(value, dict):
                self.settings[key] = {**value, **self.settings.get(key, {})}
            else:
                self.settings.setdefault(key, value)
        self.contacts = _load_json(self.contacts_path, [])
        self.history = _load_json(self.history_path, [])

    # -- Einstellungen -----------------------------------------------------

    @property
    def account(self):
        return self.settings["account"]

    def save_settings(self):
        _save_json(self.settings_path, self.settings, private=True)

    def _sip_key(self):
        return f"{self.account['user']}@{self.account['domain']}"

    def get_password(self):
        return self.get_secret(self._sip_key(), fallback_key="password")

    def set_password(self, password):
        """Speichert das SIP-Passwort im Schlüsselbund, sonst in settings.json (0600)."""
        return self.set_secret(self._sip_key(), password, "SIP-Telefon Passwort", fallback_key="password")

    def get_secret(self, key, fallback_key=None):
        if Secret is not None:
            try:
                pw = Secret.password_lookup_sync(SECRET_SCHEMA, {"account": key}, None)
                if pw is not None:
                    return pw
            except GLib.Error:
                pass
        return self.settings.get("secrets", {}).get(key) or self.settings.get(fallback_key or "", "")

    def set_secret(self, key, value, label, fallback_key=None):
        """Gibt False zurück, wenn kein Schlüsselbund verfügbar war (Ablage in settings.json)."""
        secrets = self.settings.setdefault("secrets", {})
        if Secret is not None:
            try:
                Secret.password_store_sync(
                    SECRET_SCHEMA, {"account": key}, Secret.COLLECTION_DEFAULT, label, value, None
                )
                secrets.pop(key, None)
                if fallback_key:
                    self.settings.pop(fallback_key, None)
                self.save_settings()
                return True
            except GLib.Error:
                pass
        secrets[key] = value
        self.save_settings()
        return False

    def delete_secret(self, key):
        self.settings.get("secrets", {}).pop(key, None)
        if Secret is not None:
            try:
                Secret.password_clear_sync(SECRET_SCHEMA, {"account": key}, None)
            except GLib.Error:
                pass
        self.save_settings()

    # -- Kontakte ----------------------------------------------------------

    def save_contacts(self):
        self.contacts.sort(key=lambda c: c["name"].lower())
        _save_json(self.contacts_path, self.contacts)

    def upsert_contact(self, contact):
        if not contact.get("id"):
            contact["id"] = uuid.uuid4().hex
            self.contacts.append(contact)
        else:
            for i, c in enumerate(self.contacts):
                if c["id"] == contact["id"]:
                    self.contacts[i] = contact
                    break
            else:
                self.contacts.append(contact)
        self.save_contacts()

    def delete_contact(self, contact_id):
        self.contacts = [c for c in self.contacts if c["id"] != contact_id]
        self.save_contacts()

    def find_contact(self, number):
        for c in self.contacts:
            for key in ("phone", "mobile"):
                if numbers_match(c.get(key, ""), number):
                    return c
        return None

    def search_contacts(self, text):
        text = text.strip().lower()
        if not text:
            return list(self.contacts)
        digits = re.sub(r"\D", "", text)
        result = []
        for c in self.contacts:
            haystack = " ".join([c.get("name", ""), c.get("company", "")]).lower()
            nums = [re.sub(r"\D", "", c.get(k, "")) for k in ("phone", "mobile")]
            if text in haystack or (digits and any(digits in n for n in nums)):
                result.append(c)
        return result

    # -- Verlauf -----------------------------------------------------------

    def add_history(self, direction, number, name, duration, missed):
        self.history.insert(
            0,
            {
                "time": time.time(),
                "direction": direction,
                "number": number,
                "name": name,
                "duration": int(duration),
                "missed": missed,
            },
        )
        del self.history[HISTORY_LIMIT:]
        _save_json(self.history_path, self.history)

    def clear_history(self):
        self.history = []
        _save_json(self.history_path, self.history)
