"""Einrichtung, Entitäten und Ereignisse der Phone4all-Integration."""

from copy import deepcopy
from datetime import timedelta

from homeassistant.config_entries import SOURCE_USER
from homeassistant.const import CONF_URL, CONF_VERIFY_SSL, STATE_OFF, STATE_ON, STATE_UNAVAILABLE
from homeassistant.core import HomeAssistant
from homeassistant.data_entry_flow import FlowResultType
from homeassistant.util import dt as dt_util
from pytest_homeassistant_custom_component.common import MockConfigEntry, async_capture_events, async_fire_time_changed
from pytest_homeassistant_custom_component.test_util.aiohttp import AiohttpClientMocker

from custom_components.phone4all.api import normalize_url
from custom_components.phone4all.const import CONF_TOKEN, DOMAIN

URL = "https://pbx.example.de"
STATUS = f"{URL}/api/integration/status"
JSON = {"Content-Type": "application/json; charset=utf-8"}

REPORT = {
    "api": 1,
    "name": "Büro",
    "version": "0.3.0",
    "asterisk": {"state": "running", "message": "", "uptime": 100},
    "trunks": [
        {"id": "t1", "name": "Telekom", "enabled": True, "register": True, "status": "Registered", "registered": True, "problem": False},
        {"id": "t2", "name": "Festnetz-IP", "enabled": True, "register": False, "status": "", "registered": False, "problem": False},
    ],
    "extensions": [],
    "active_calls": 0,
    "missed": {
        "today": 1,
        "calls": [
            {"id": "c1", "time": "2026-10-24T07:15:00.000Z", "from": "0301111", "from_name": "Kunde", "to": "0301234567", "voicemail": False}
        ],
    },
    "problems": [],
    "update": {"available": False, "current": "0.3.0", "latest": "0.3.0"},
    "bans": 0,
}


async def setup(hass: HomeAssistant, aioclient_mock: AiohttpClientMocker, report=REPORT) -> MockConfigEntry:
    aioclient_mock.get(STATUS, json=report, headers=JSON)
    entry = MockConfigEntry(domain=DOMAIN, title="Büro", unique_id=URL, data={CONF_URL: URL, CONF_TOKEN: "geheim", CONF_VERIFY_SSL: True})
    entry.add_to_hass(hass)
    assert await hass.config_entries.async_setup(entry.entry_id)
    await hass.async_block_till_done()
    return entry


async def refresh(hass: HomeAssistant, aioclient_mock: AiohttpClientMocker, report=None, **kwargs) -> None:
    aioclient_mock.clear_requests()
    if report is not None:
        aioclient_mock.get(STATUS, json=report, headers=JSON)
    else:
        aioclient_mock.get(STATUS, **kwargs)
    async_fire_time_changed(hass, dt_util.utcnow() + timedelta(seconds=20))
    await hass.async_block_till_done()


async def test_config_flow(hass: HomeAssistant, aioclient_mock: AiohttpClientMocker) -> None:
    aioclient_mock.get(STATUS, status=401)
    result = await hass.config_entries.flow.async_init(DOMAIN, context={"source": SOURCE_USER})
    result = await hass.config_entries.flow.async_configure(
        result["flow_id"], {CONF_URL: "pbx.example.de/", CONF_TOKEN: "falsch", CONF_VERIFY_SSL: True}
    )
    assert result["errors"] == {"base": "invalid_auth"}

    aioclient_mock.clear_requests()
    aioclient_mock.get(STATUS, status=302, headers={"Location": "https://auth.example.de"})
    result = await hass.config_entries.flow.async_configure(
        result["flow_id"], {CONF_URL: "pbx.example.de/", CONF_TOKEN: "geheim", CONF_VERIFY_SSL: True}
    )
    assert result["errors"] == {"base": "proxy_auth"}

    aioclient_mock.clear_requests()
    aioclient_mock.get(STATUS, json=REPORT, headers=JSON)
    result = await hass.config_entries.flow.async_configure(
        result["flow_id"], {CONF_URL: "pbx.example.de/", CONF_TOKEN: " geheim ", CONF_VERIFY_SSL: True}
    )
    assert result["type"] is FlowResultType.CREATE_ENTRY
    assert result["title"] == "Büro"
    assert result["data"] == {CONF_URL: URL, CONF_TOKEN: "geheim", CONF_VERIFY_SSL: True}
    assert aioclient_mock.mock_calls[-1][3]["Authorization"] == "Bearer geheim"


async def test_entities(hass: HomeAssistant, aioclient_mock: AiohttpClientMocker) -> None:
    await setup(hass, aioclient_mock)
    trunk = [s for s in hass.states.async_all("binary_sensor") if s.attributes.get("trunk_id") == "t1"]
    assert len(trunk) == 1 and trunk[0].state == STATE_ON
    # Konten ohne Anmeldung bekommen keinen Sensor
    assert not [s for s in hass.states.async_all("binary_sensor") if s.attributes.get("trunk_id") == "t2"]
    problem = hass.states.get("binary_sensor.buro_problem")
    assert problem.state == STATE_OFF
    assert hass.states.get("sensor.buro_missed_calls_today").state == "1"
    last = hass.states.get("sensor.buro_last_missed_call")
    assert last.state == "2026-10-24T07:15:00+00:00"
    assert last.attributes["caller_name"] == "Kunde"


async def test_events(hass: HomeAssistant, aioclient_mock: AiohttpClientMocker) -> None:
    await setup(hass, aioclient_mock)
    missed = async_capture_events(hass, "phone4all_missed_call")
    problems = async_capture_events(hass, "phone4all_problem")
    resolved = async_capture_events(hass, "phone4all_problem_resolved")

    # Neuer verpasster Anruf und abgemeldetes Konto
    report = deepcopy(REPORT)
    report["missed"]["calls"].insert(
        0, {"id": "c2", "time": "2026-10-24T08:00:00.000Z", "from": "0172222", "from_name": "", "to": "0301234567", "voicemail": True}
    )
    report["trunks"][0].update(status="Rejected", registered=False, problem=True)
    report["problems"] = [{"key": "trunk:t1", "message": "SIP-Konto Telekom ist nicht angemeldet (Rejected)"}]
    await refresh(hass, aioclient_mock, report)

    assert [e.data["call_id"] for e in missed] == ["c2"]
    assert missed[0].data["voicemail"] is True
    assert missed[0].data["pbx"] == "Büro"
    assert [e.data["key"] for e in problems] == ["trunk:t1"]
    assert hass.states.get("binary_sensor.buro_problem").state == STATE_ON
    trunk = [s for s in hass.states.async_all("binary_sensor") if s.attributes.get("trunk_id") == "t1"][0]
    assert trunk.state == STATE_OFF
    event = hass.states.get("event.buro_missed_call")
    assert event.attributes["event_type"] == "missed_call"
    assert event.attributes["caller"] == "0172222"

    # Gleicher Stand: keine doppelten Ereignisse
    await refresh(hass, aioclient_mock, report)
    assert len(missed) == 1 and len(problems) == 1

    # Anlage nicht erreichbar, dann wieder alles in Ordnung
    await refresh(hass, aioclient_mock, status=502)
    assert [e.data["key"] for e in problems] == ["trunk:t1", "connection"]
    assert hass.states.get("binary_sensor.buro_problem").state == STATE_UNAVAILABLE
    await refresh(hass, aioclient_mock, REPORT)
    assert sorted(e.data["key"] for e in resolved) == ["connection", "trunk:t1"]
    assert hass.states.get("binary_sensor.buro_problem").state == STATE_OFF


async def test_missed_after_restart(hass: HomeAssistant, aioclient_mock: AiohttpClientMocker, hass_storage) -> None:
    """Was verpasst wurde, während Home Assistant aus war, wird nachgemeldet – Älteres nicht."""
    key = f"{DOMAIN}.e1.seen"
    hass_storage[key] = {"version": 1, "minor_version": 1, "key": key, "data": {"seen": ["c0"], "time": "2026-10-24T09:00:00+00:00"}}
    report = deepcopy(REPORT)
    report["missed"]["calls"].insert(
        0, {"id": "c3", "time": "2026-10-24T10:00:00.000Z", "from": "0173333", "from_name": "", "to": "0301234567", "voicemail": False}
    )
    missed = async_capture_events(hass, "phone4all_missed_call")
    aioclient_mock.get(STATUS, json=report, headers=JSON)
    entry = MockConfigEntry(
        domain=DOMAIN, entry_id="e1", title="Büro", unique_id=URL, data={CONF_URL: URL, CONF_TOKEN: "geheim", CONF_VERIFY_SSL: True}
    )
    entry.add_to_hass(hass)
    assert await hass.config_entries.async_setup(entry.entry_id)
    await hass.async_block_till_done()
    # c1 (07:15) lag schon über eine Stunde vor dem letzten gespeicherten Stand
    assert [e.data["call_id"] for e in missed] == ["c3"]


def test_normalize_url() -> None:
    assert normalize_url("pbx.example.de/") == "https://pbx.example.de"
    assert normalize_url("192.168.1.10:8080") == "http://192.168.1.10:8080"
    assert normalize_url("truenas:8080") == "http://truenas:8080"
    assert normalize_url("https://10.0.0.1") == "https://10.0.0.1"


async def test_reauth_on_401(hass: HomeAssistant, aioclient_mock: AiohttpClientMocker) -> None:
    entry = await setup(hass, aioclient_mock)
    await refresh(hass, aioclient_mock, status=401)
    flows = hass.config_entries.flow.async_progress()
    assert [f["context"]["source"] for f in flows] == ["reauth"]

    aioclient_mock.clear_requests()
    aioclient_mock.get(STATUS, json=REPORT, headers=JSON)
    result = await hass.config_entries.flow.async_configure(flows[0]["flow_id"], {CONF_TOKEN: "neu"})
    assert result["reason"] == "reauth_successful"
    assert entry.data[CONF_TOKEN] == "neu"


async def test_blueprint(hass: HomeAssistant) -> None:
    """Der Blueprint ist gültig und ergibt mit Eingaben eine gültige Automation."""
    from pathlib import Path

    from homeassistant.components.automation.config import AUTOMATION_BLUEPRINT_SCHEMA, PLATFORM_SCHEMA
    from homeassistant.components.blueprint.models import Blueprint, BlueprintInputs
    from homeassistant.util.yaml import load_yaml_dict

    path = Path(__file__).parent.parent / "blueprints/automation/phone4all/benachrichtigung.yaml"
    blueprint = Blueprint(load_yaml_dict(str(path)), expected_domain="automation", schema=AUTOMATION_BLUEPRINT_SCHEMA)
    inputs = BlueprintInputs(blueprint, {"use_blueprint": {"path": "x", "input": {"notify_device": "abc"}}})
    inputs.validate()
    config = inputs.async_substitute()
    PLATFORM_SCHEMA(config)
    assert config["actions"][0]["choose"][1]["sequence"][0]["timeout"] == {"minutes": 2}


async def test_emergency(hass: HomeAssistant, aioclient_mock: AiohttpClientMocker) -> None:
    report = deepcopy(REPORT)
    report["emergency"] = [{"id": "e1", "time": "2026-10-24T06:00:00.000Z", "extension": "10", "name": "Anna", "number": "112"}]
    await setup(hass, aioclient_mock, report)
    emergencies = async_capture_events(hass, "phone4all_emergency_call")

    # Neuer Notruf; der beim Start schon bekannte wird nicht gemeldet
    report["emergency"].insert(0, {"id": "e2", "time": "2026-10-24T09:00:00.000Z", "extension": "11", "name": "Bert", "number": "110"})
    await refresh(hass, aioclient_mock, report)
    await refresh(hass, aioclient_mock, report)
    assert [e.data["call_id"] for e in emergencies] == ["e2"]
    assert emergencies[0].data["extension"] == "11"
    event = hass.states.get("event.buro_emergency_call")
    assert event.attributes["event_type"] == "emergency_call"
    assert event.attributes["number"] == "110"


async def test_door_ring(hass: HomeAssistant, aioclient_mock: AiohttpClientMocker) -> None:
    report = deepcopy(REPORT)
    report["door"] = [{"id": "d1", "time": "2026-10-24T06:00:00.000Z", "extension": "90", "name": "Haustür"}]
    await setup(hass, aioclient_mock, report)
    rings = async_capture_events(hass, "phone4all_door_ring")

    report["door"].insert(0, {"id": "d2", "time": "2026-10-24T09:00:00.000Z", "extension": "90", "name": "Haustür"})
    await refresh(hass, aioclient_mock, report)
    await refresh(hass, aioclient_mock, report)
    assert [e.data["call_id"] for e in rings] == ["d2"]
    event = hass.states.get("event.buro_door_bell")
    assert event.attributes["event_type"] == "door_ring"
    assert event.attributes["extension"] == "90"


CONTROL_REPORT = {
    **REPORT,
    "extensions": [
        {"number": "10", "name": "Anna", "devices": 1, "dnd": False, "forward": "", "door": False},
        {"number": "90", "name": "Haustür", "devices": 1, "dnd": False, "forward": "", "door": True},
    ],
    "timeconditions": [{"id": "tc1", "name": "Öffnungszeiten", "override": "auto", "open": True}],
}


async def test_switch_and_select(hass: HomeAssistant, aioclient_mock: AiohttpClientMocker) -> None:
    report = deepcopy(CONTROL_REPORT)
    await setup(hass, aioclient_mock, report)
    # Türsprechstelle bekommt keinen Schalter
    assert hass.states.get("switch.buro_do_not_disturb_10_anna").state == STATE_OFF
    assert not [s for s in hass.states.async_entity_ids("switch") if "90" in s]
    assert hass.states.get("select.buro_time_condition_offnungszeiten").state == "auto"

    report["extensions"][0]["dnd"] = True
    report["timeconditions"][0]["override"] = "closed"
    aioclient_mock.clear_requests()
    aioclient_mock.post(f"{URL}/api/integration/dnd", json={"ok": True, "dnd": True}, headers=JSON)
    aioclient_mock.post(f"{URL}/api/integration/timecondition", json={"ok": True}, headers=JSON)
    aioclient_mock.get(STATUS, json=report, headers=JSON)
    await hass.services.async_call("switch", "turn_on", {"entity_id": "switch.buro_do_not_disturb_10_anna"}, blocking=True)
    await hass.services.async_call("select", "select_option", {"entity_id": "select.buro_time_condition_offnungszeiten", "option": "closed"}, blocking=True)
    posts = [(str(url), body) for method, url, body, _h in aioclient_mock.mock_calls if method == "POST"]
    assert posts == [
        (f"{URL}/api/integration/dnd", {"extension": "10", "enabled": True}),
        (f"{URL}/api/integration/timecondition", {"id": "tc1", "mode": "closed"}),
    ]
    await hass.async_block_till_done()
    assert hass.states.get("switch.buro_do_not_disturb_10_anna").state == STATE_ON
    assert hass.states.get("select.buro_time_condition_offnungszeiten").state == "closed"


async def test_services(hass: HomeAssistant, aioclient_mock: AiohttpClientMocker) -> None:
    import pytest
    from homeassistant.exceptions import HomeAssistantError

    await setup(hass, aioclient_mock, deepcopy(CONTROL_REPORT))
    aioclient_mock.post(f"{URL}/api/integration/announce", json={"ok": True}, headers=JSON)
    aioclient_mock.post(f"{URL}/api/integration/forward", status=403, json={"error": "Schalten über die Schnittstelle ist ausgeschaltet."}, headers=JSON)
    aioclient_mock.post(f"{URL}/api/integration/call", status=401, json={"error": "Bitte anmelden."}, headers=JSON)
    await hass.services.async_call(DOMAIN, "announce", {"target": "20", "message": "Wasser im Keller"}, blocking=True)
    body = [b for m, u, b, _h in aioclient_mock.mock_calls if m == "POST"][0]
    assert body == {"target": "20", "text": "Wasser im Keller", "voice": ""}
    with pytest.raises(HomeAssistantError, match="ausgeschaltet"):
        await hass.services.async_call(DOMAIN, "set_forward", {"extension": "10", "target": "11"}, blocking=True)
    # Alte Anlage ohne die Aktion: kein Neu-Anmelden verlangen
    with pytest.raises(HomeAssistantError, match="aktualisieren"):
        await hass.services.async_call(DOMAIN, "call", {"extension": "10", "number": "030123"}, blocking=True)
    assert not hass.config_entries.flow.async_progress()
