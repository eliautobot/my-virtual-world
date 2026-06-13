#!/usr/bin/env python3
"""Virtual World server.
Serves static files, world/chunk/building APIs.
Self-contained Virtual World server; Virtual Office is reference/inspiration only.
"""
import asyncio
import base64
import hashlib
import http.server
import importlib.util
import json
import os
import shutil
import sys
import threading
import time
import glob
import mimetypes
import re
import socketserver
import subprocess
import urllib.parse
import urllib.request
import uuid

SERVER_DIR = os.path.dirname(os.path.abspath(__file__))
if SERVER_DIR not in sys.path:
    sys.path.insert(0, SERVER_DIR)

from license import (
    activate_license,
    check_feature,
    deactivate_license,
    get_agent_limit,
    get_building_limit,
    get_license_status,
)

try:
    from providers.hermes import HermesProvider
except Exception as e:
    HermesProvider = None
    print(f"⚠️  Virtual World Hermes provider unavailable: {e}")

# ─── CONFIGURATION ───────────────────────────────────────────────
def _env_or(key, fallback):
    val = os.environ.get(key)
    return val if val else fallback

PORT = int(_env_or("VW_PORT", "8590"))
DATA_DIR = _env_or("VW_DATA_DIR", "/data")
CHUNKS_DIR = os.path.join(DATA_DIR, "chunks")
BUILDINGS_DIR = os.path.join(DATA_DIR, "buildings")
META_FILE = os.path.join(DATA_DIR, "world-meta.json")


def _deep_merge(base, update):
    if not isinstance(base, dict):
        base = {}
    if not isinstance(update, dict):
        return dict(base)
    merged = dict(base)
    for key, value in update.items():
        if key.startswith("_") and key != "_setupComplete":
            continue
        if isinstance(value, dict) and isinstance(merged.get(key), dict):
            merged[key] = _deep_merge(merged[key], value)
        else:
            merged[key] = value
    return merged


def _resolve_vw_config_path():
    if os.environ.get("VW_CONFIG"):
        return os.environ["VW_CONFIG"]
    data_cfg = os.path.join(DATA_DIR, "vw-config.json")
    app_cfg = os.path.join(os.path.dirname(__file__), "vw-config.json")
    if os.path.isfile(data_cfg):
        return data_cfg
    return app_cfg


def _load_config_file(path):
    try:
        with open(path, "r") as f:
            return json.load(f)
    except (FileNotFoundError, json.JSONDecodeError):
        return {}


def _default_vw_config():
    app_cfg = os.path.join(os.path.dirname(__file__), "vw-config.json")
    default = _load_config_file(app_cfg)
    if default:
        return default
    return {
        "_setupComplete": False,
        "world": {"name": "My Virtual World", "showGrid": True, "showMinimap": True, "showCoords": True, "dayNightCycleEnabled": True, "weatherEnabled": True},
        "openclaw": {"homePath": "", "hostHomePath": "", "gatewayUrl": "", "gatewayToken": ""},
        "hermes": {"enabled": True, "homePath": "", "binary": "", "timeoutSec": 600, "apiUrl": "", "apiKey": "", "preferApi": True},
        "features": {"agentBrowser": False, "sms": False, "weather": True, "agentLiveMode": False, "debugTools": True},
        "browser": {"cdpUrl": "", "viewerUrl": ""},
        "sms": {"ownerAgentId": "", "twilioAccountSid": "", "twilioAuthToken": "", "fromNumber": "", "publicMediaBaseUrl": ""},
        "debug": {"movementDebugOverlays": False, "objectActionPointDebug": False},
        "license": {"acceptedTrial": False},
    }


def _load_vw_config():
    cfg = _deep_merge(_default_vw_config(), _load_config_file(_resolve_vw_config_path()))
    cfg.setdefault("openclaw", {})
    cfg.setdefault("hermes", {})
    cfg.setdefault("browser", {})
    cfg.setdefault("sms", {})
    cfg.setdefault("features", {})
    cfg.setdefault("world", {})
    cfg.setdefault("debug", {})
    cfg["openclaw"]["homePath"] = os.path.expanduser(_env_or("VW_OPENCLAW_PATH", cfg["openclaw"].get("homePath") or "~/.openclaw"))
    cfg["openclaw"]["hostHomePath"] = os.path.expanduser(_env_or("VW_OPENCLAW_HOST_PATH", cfg["openclaw"].get("hostHomePath") or cfg["openclaw"]["homePath"]))
    cfg["openclaw"]["gatewayUrl"] = _env_or("VW_GATEWAY_URL", cfg["openclaw"].get("gatewayUrl") or "")
    cfg["openclaw"]["gatewayToken"] = _env_or("VW_GATEWAY_TOKEN", _env_or("OPENCLAW_GATEWAY_TOKEN", cfg["openclaw"].get("gatewayToken") or ""))
    cfg["hermes"]["enabled"] = str(_env_or("VW_HERMES_ENABLED", cfg["hermes"].get("enabled", True))).lower() not in ("0", "false", "no", "off")
    cfg["hermes"]["homePath"] = os.path.expanduser(_env_or("VW_HERMES_HOME", cfg["hermes"].get("homePath") or os.path.expanduser("~/.hermes")))
    cfg["hermes"]["binary"] = os.path.expanduser(_env_or("VW_HERMES_BIN", cfg["hermes"].get("binary") or os.path.expanduser("~/.local/bin/hermes")))
    cfg["hermes"]["timeoutSec"] = int(_env_or("VW_HERMES_TIMEOUT_SEC", cfg["hermes"].get("timeoutSec", 600)))
    cfg["hermes"]["apiUrl"] = _env_or("VW_HERMES_API_URL", cfg["hermes"].get("apiUrl") or "")
    cfg["hermes"]["apiKey"] = _env_or("VW_HERMES_API_KEY", cfg["hermes"].get("apiKey") or "")
    cfg["browser"]["cdpUrl"] = _env_or("VW_BROWSER_CDP_URL", cfg["browser"].get("cdpUrl") or "")
    cfg["browser"]["viewerUrl"] = _env_or("VW_BROWSER_VIEWER_URL", cfg["browser"].get("viewerUrl") or "")
    cfg["sms"]["ownerAgentId"] = _env_or("VW_SMS_OWNER_AGENT_ID", cfg["sms"].get("ownerAgentId") or "")
    cfg["sms"]["twilioAccountSid"] = _env_or("VW_TWILIO_ACCOUNT_SID", cfg["sms"].get("twilioAccountSid") or "")
    cfg["sms"]["twilioAuthToken"] = _env_or("VW_TWILIO_AUTH_TOKEN", cfg["sms"].get("twilioAuthToken") or "")
    cfg["sms"]["fromNumber"] = _env_or("VW_TWILIO_FROM_NUMBER", cfg["sms"].get("fromNumber") or "")
    return cfg


VW_CONFIG = _load_vw_config()


def _display_user_home_path(path):
    if not path or not isinstance(path, str):
        return path
    home = os.path.expanduser("~").rstrip(os.sep)
    normalized = os.path.abspath(os.path.expanduser(path))
    if home and normalized == home:
        return "~"
    if home and normalized.startswith(home + os.sep):
        return "~" + normalized[len(home):]
    return path

# OpenClaw integration (for agent status)
# Keep these paths deployment-configurable. Virtual World may run on many hosts,
# so never bake in one developer's home directory or a container-only mount path.
WORKSPACE_BASE = VW_CONFIG["openclaw"]["homePath"]
HOST_WORKSPACE_BASE = VW_CONFIG["openclaw"].get("hostHomePath") or WORKSPACE_BASE
STATUS_DIR = _env_or("VW_STATUS_DIR", "/tmp/vw-data")
STATUS_FILE = _env_or("VW_STATUS_FILE", os.path.join(STATUS_DIR, "virtual-world-status.json"))
LEGACY_STATUS_FILE = _env_or("VW_LEGACY_STATUS_FILE", "")
AGENT_PLATFORM_PROVIDER_URL = os.environ.get("VW_AGENT_PLATFORM_PROVIDER_URL", "").strip().rstrip("/")
HERMES_ENABLED = VW_CONFIG["hermes"]["enabled"]
HERMES_HOME = VW_CONFIG["hermes"]["homePath"]
HERMES_BIN = VW_CONFIG["hermes"]["binary"]
HERMES_TIMEOUT_SEC = int(VW_CONFIG["hermes"].get("timeoutSec") or 600)
# Chat uploads must be saved somewhere OpenClaw agents can read from the host.
# The returned path defaults to the same configured OpenClaw tree instead of a
# machine-specific absolute path; deployments with distinct readable/host-visible
# roots can set VW_UPLOADS_HOST_DIR or VW_OPENCLAW_HOST_PATH explicitly.
UPLOADS_DIR = _env_or("VW_UPLOADS_DIR", os.path.join(WORKSPACE_BASE, "workspace", "uploads"))
UPLOADS_HOST_DIR = _env_or(
    "VW_UPLOADS_HOST_DIR",
    os.path.join(HOST_WORKSPACE_BASE, "workspace", "uploads")
)

# Ensure directories exist
os.makedirs(CHUNKS_DIR, exist_ok=True)
os.makedirs(BUILDINGS_DIR, exist_ok=True)
os.makedirs(STATUS_DIR, exist_ok=True)

_OPENCLAW_VERSION_CACHE = None


def _safe_vw_config():
    lic = get_license_status()
    sms_cfg = VW_CONFIG.get("sms", {}) or {}
    hermes_cfg = VW_CONFIG.get("hermes", {}) or {}
    openclaw_cfg = VW_CONFIG.get("openclaw", {}) or {}
    return {
        "_setupComplete": bool(VW_CONFIG.get("_setupComplete")),
        "world": VW_CONFIG.get("world", {}),
        "features": VW_CONFIG.get("features", {}),
        "openclaw": {
            "homePath": _display_user_home_path(openclaw_cfg.get("homePath")),
            "hostHomePath": _display_user_home_path(openclaw_cfg.get("hostHomePath")),
            "gatewayUrl": openclaw_cfg.get("gatewayUrl"),
            "gatewayTokenConfigured": bool(openclaw_cfg.get("gatewayToken")),
            "detected": os.path.isdir(openclaw_cfg.get("homePath") or ""),
        },
        "hermes": {
            "enabled": hermes_cfg.get("enabled", True),
            "homePath": _display_user_home_path(hermes_cfg.get("homePath")),
            "binary": _display_user_home_path(hermes_cfg.get("binary")),
            "timeoutSec": hermes_cfg.get("timeoutSec", 600),
            "apiUrl": hermes_cfg.get("apiUrl"),
            "apiKeyConfigured": bool(hermes_cfg.get("apiKey")),
            "preferApi": hermes_cfg.get("preferApi", True),
        },
        "browser": {
            "cdpUrl": (VW_CONFIG.get("browser") or {}).get("cdpUrl"),
            "viewerUrl": (VW_CONFIG.get("browser") or {}).get("viewerUrl"),
        },
        "sms": {
            "ownerAgentId": sms_cfg.get("ownerAgentId"),
            "twilioAccountSid": sms_cfg.get("twilioAccountSid"),
            "fromNumber": sms_cfg.get("fromNumber"),
            "publicMediaBaseUrl": sms_cfg.get("publicMediaBaseUrl"),
            "authTokenConfigured": bool(sms_cfg.get("twilioAuthToken")),
            "hasCredentials": bool(sms_cfg.get("twilioAccountSid") and sms_cfg.get("twilioAuthToken") and sms_cfg.get("fromNumber")),
        },
        "debug": VW_CONFIG.get("debug", {}),
        "license": lic,
    }


def _write_vw_config(config):
    cfg_path = _resolve_vw_config_path()
    data_cfg = os.path.join(DATA_DIR, "vw-config.json")
    if cfg_path != data_cfg and os.path.isdir(DATA_DIR):
        cfg_path = data_cfg
    os.makedirs(os.path.dirname(cfg_path), exist_ok=True)
    tmp_path = f"{cfg_path}.tmp-{os.getpid()}-{threading.get_ident()}"
    with open(tmp_path, "w") as f:
        json.dump(config, f, indent=2)
        f.write("\n")
        f.flush()
        os.fsync(f.fileno())
    os.replace(tmp_path, cfg_path)


def _preserve_secret_updates(existing, body):
    for section, keys in {
        "hermes": ("apiKey",),
        "sms": ("twilioAuthToken",),
        "openclaw": ("gatewayToken",),
    }.items():
        incoming = body.get(section)
        current = existing.get(section)
        if not isinstance(incoming, dict) or not isinstance(current, dict):
            continue
        for key in keys:
            if key in incoming and not incoming.get(key) and current.get(key):
                incoming.pop(key, None)


def _save_vw_config_update(body):
    global VW_CONFIG, WORKSPACE_BASE, HOST_WORKSPACE_BASE, HERMES_ENABLED, HERMES_HOME, HERMES_BIN, HERMES_TIMEOUT_SEC, UPLOADS_DIR, UPLOADS_HOST_DIR
    if not isinstance(body, dict):
        return {"ok": False, "error": "settings payload must be an object"}, 400
    existing = _deep_merge(_default_vw_config(), _load_config_file(_resolve_vw_config_path()))
    _preserve_secret_updates(existing, body)
    if isinstance(body.get("features"), dict):
        for feature in ("agentBrowser", "sms", "agentLiveMode"):
            if _demo_feature_locked(feature):
                body["features"][feature] = False
    merged = _deep_merge(existing, body)
    if body.get("_setupComplete") is not False:
        merged["_setupComplete"] = True
    _write_vw_config(merged)
    VW_CONFIG = _load_vw_config()
    WORKSPACE_BASE = VW_CONFIG["openclaw"]["homePath"]
    HOST_WORKSPACE_BASE = VW_CONFIG["openclaw"].get("hostHomePath") or WORKSPACE_BASE
    HERMES_ENABLED = VW_CONFIG["hermes"]["enabled"]
    HERMES_HOME = VW_CONFIG["hermes"]["homePath"]
    HERMES_BIN = VW_CONFIG["hermes"]["binary"]
    HERMES_TIMEOUT_SEC = int(VW_CONFIG["hermes"].get("timeoutSec") or 600)
    UPLOADS_DIR = _env_or("VW_UPLOADS_DIR", os.path.join(WORKSPACE_BASE, "workspace", "uploads"))
    UPLOADS_HOST_DIR = _env_or("VW_UPLOADS_HOST_DIR", os.path.join(HOST_WORKSPACE_BASE, "workspace", "uploads"))
    world = body.get("world") if isinstance(body.get("world"), dict) else {}
    if world:
        meta_patch = {k: v for k, v in world.items() if k in {"name", "showMinimap", "dayNightCycleEnabled", "weatherEnabled"}}
        if meta_patch:
            meta = load_world_meta()
            meta.update(meta_patch)
            save_world_meta(meta)
    return {"ok": True, "config": _safe_vw_config()}, 200


def _limited(items, limit):
    if not limit or limit <= 0:
        return items
    return items[:limit]


def _locked_response(feature, message=None):
    return {
        "ok": False,
        "locked": True,
        "feature": feature,
        "error": message or "Activation required for this feature.",
        "license": get_license_status(),
    }


def _demo_feature_locked(feature):
    return not check_feature(feature)


def _demo_edit_locked_response():
    return _locked_response(
        "advancedEditor",
        "Demo mode locks world editing. Activate a license key to edit the world, buildings, agents, roads, decorations, and outside spaces.",
    )


def _is_starter_world_seed_request(path, payload=None):
    try:
        if load_world_meta().get("initialized"):
            return False
    except Exception:
        return False
    if path in {"/api/streets"} or path.startswith("/api/chunk/"):
        return True
    if path in {"/api/building", "/api/buildings"} and isinstance(payload, dict):
        return str(payload.get("id") or "").startswith("auto_") and len(list_buildings()) < 4
    if path == "/api/meta" and isinstance(payload, dict):
        return set(payload.keys()).issubset({"initialized"}) and payload.get("initialized") is True
    return False


def _sms_log_path():
    return os.path.join(DATA_DIR, "sms-log.json")


def _load_sms_log():
    try:
        with open(_sms_log_path(), "r") as f:
            data = json.load(f)
        return data if isinstance(data, list) else []
    except (FileNotFoundError, json.JSONDecodeError):
        return []


def _save_sms_log(entries):
    os.makedirs(DATA_DIR, exist_ok=True)
    with open(_sms_log_path(), "w") as f:
        json.dump(entries[-1000:], f, indent=2)
        f.write("\n")


def _sms_status_payload():
    sms_cfg = VW_CONFIG.get("sms", {}) or {}
    enabled_by_config = bool((VW_CONFIG.get("features") or {}).get("sms"))
    licensed = check_feature("sms")
    roster = get_roster()
    owner_id = sms_cfg.get("ownerAgentId") or ""
    owner = next((a for a in roster if a.get("id") == owner_id or a.get("statusKey") == owner_id), None)
    return {
        "enabled": enabled_by_config and licensed,
        "configured": enabled_by_config,
        "locked": not licensed,
        "licensed": licensed,
        "ownerAgentId": owner_id,
        "ownerAgent": owner,
        "hasCredentials": bool(sms_cfg.get("twilioAccountSid") and sms_cfg.get("twilioAuthToken") and sms_cfg.get("fromNumber")),
    }


def _sms_threads():
    threads = {}
    for msg in _load_sms_log():
        phone = msg.get("to") or msg.get("from") or ""
        if not phone:
            continue
        thread = threads.setdefault(phone, {"phone": phone, "count": 0, "lastMessage": None, "updatedAt": 0})
        thread["count"] += 1
        ts = msg.get("ts") or 0
        if ts >= thread["updatedAt"]:
            thread["updatedAt"] = ts
            thread["lastMessage"] = msg
    return sorted(threads.values(), key=lambda item: item.get("updatedAt", 0), reverse=True)


def _send_sms(body):
    if not check_feature("sms"):
        return _locked_response("sms"), 403
    status = _sms_status_payload()
    if not status["enabled"] or not status["hasCredentials"]:
        return {"ok": False, "error": "SMS is not configured. Enable SMS and set Twilio credentials in Settings or /setup."}, 400
    sms_cfg = VW_CONFIG.get("sms", {}) or {}
    to_number = (body.get("to") or "").strip()
    text = (body.get("body") or body.get("message") or "").strip()
    if not to_number or not text:
        return {"ok": False, "error": "SMS requires both to and body."}, 400
    account_sid = sms_cfg.get("twilioAccountSid")
    auth_token = sms_cfg.get("twilioAuthToken")
    from_number = sms_cfg.get("fromNumber")
    url = f"https://api.twilio.com/2010-04-01/Accounts/{account_sid}/Messages.json"
    payload = urllib.parse.urlencode({"To": to_number, "From": from_number, "Body": text}).encode("utf-8")
    auth = base64.b64encode(f"{account_sid}:{auth_token}".encode("utf-8")).decode("ascii")
    req = urllib.request.Request(url, data=payload, headers={
        "Authorization": f"Basic {auth}",
        "Content-Type": "application/x-www-form-urlencoded",
    })
    try:
        with urllib.request.urlopen(req, timeout=20) as resp:
            result = json.loads(resp.read().decode("utf-8"))
        entry = {
            "id": result.get("sid") or f"local-{int(time.time() * 1000)}",
            "direction": "outbound",
            "to": to_number,
            "from": from_number,
            "body": text,
            "status": result.get("status", "sent"),
            "ts": int(time.time() * 1000),
            "ownerAgentId": sms_cfg.get("ownerAgentId"),
        }
        entries = _load_sms_log()
        entries.append(entry)
        _save_sms_log(entries)
        return {"ok": True, "message": entry, "twilio": {"sid": result.get("sid"), "status": result.get("status")}}, 200
    except urllib.error.HTTPError as e:
        err = e.read().decode("utf-8", errors="replace")
        return {"ok": False, "error": f"Twilio HTTP {e.code}: {err[:500]}"}, 502
    except Exception as e:
        return {"ok": False, "error": str(e)}, 502


def _get_openclaw_version():
    """Return installed OpenClaw version for gateway client identification."""
    global _OPENCLAW_VERSION_CACHE
    if _OPENCLAW_VERSION_CACHE:
        return _OPENCLAW_VERSION_CACHE
    try:
        config_path = os.path.join(WORKSPACE_BASE, "openclaw.json")
        with open(config_path, "r") as f:
            cfg = json.load(f)
        for value in (
            ((cfg.get("meta") or {}).get("lastTouchedVersion")),
            ((cfg.get("wizard") or {}).get("lastRunVersion")),
        ):
            if value:
                _OPENCLAW_VERSION_CACHE = str(value)
                return _OPENCLAW_VERSION_CACHE
    except Exception:
        pass
    try:
        result = subprocess.run(["openclaw", "--version"], capture_output=True, text=True, timeout=5)
        text_out = (result.stdout or result.stderr or "").strip()
        match = re.search(r"OpenClaw\s+([^\s]+)", text_out)
        if match:
            _OPENCLAW_VERSION_CACHE = match.group(1)
            return _OPENCLAW_VERSION_CACHE
    except Exception:
        pass
    _OPENCLAW_VERSION_CACHE = os.environ.get("OPENCLAW_VERSION", "unknown")
    return _OPENCLAW_VERSION_CACHE


def _load_external_module(module_label, file_path):
    if not file_path or not os.path.isfile(file_path):
        return None
    try:
        spec = importlib.util.spec_from_file_location(module_label, file_path)
        if not spec or not spec.loader:
            return None
        module = importlib.util.module_from_spec(spec)
        spec.loader.exec_module(module)
        return module
    except Exception as e:
        print(f"⚠️  Could not load {module_label} from {file_path}: {e}")
        return None


_gateway_presence = _load_external_module("vw_gateway_presence_local", os.path.join(os.path.dirname(__file__), "gateway_presence.py"))
_presence_snapshot_path = os.path.join(DATA_DIR, "presence-snapshot.json")
_presence_snapshot_thread = None
_presence_enabled = False
HERMES_APPROVAL_LOCK = threading.Lock()
HERMES_APPROVAL_PENDING = {}
HERMES_LIVE_LOCK = threading.Lock()
HERMES_LIVE_EVENTS = {}
HERMES_LIVE_MAX_EVENTS = 250
HERMES_APPROVAL_BRIDGE_DIR = os.path.join(DATA_DIR, "hermes-approval-bridge")

# ─── WORLD METADATA ──────────────────────────────────────────────
DEFAULT_META = {
    "name": "My Virtual World",
    "version": 1,
    "tileSize": 40,
    "chunkSize": 32,
    "spawnX": 0,
    "spawnY": 0,
    "createdAt": None,
}

# Latest known-good desktop checkpoint street layout restored on 2026-04-29.
# Keep this server-side guard narrow: it only protects the saved street list
# from accidental empty/default world-meta rewrites. Buildings, agents, and
# other world state are intentionally left alone.
LATEST_CHECKPOINT_STREETS_20260429 = [
    {"x1": -135, "z1": 15, "x2": -12, "z2": 15, "type": None, "rotation": 0, "openEdges": None},
    {"x1": -2, "z1": 15, "x2": 147, "z2": 15, "type": None, "rotation": 0, "openEdges": None},
    {"x1": -7, "z1": 15, "x2": -7, "z2": 15, "type": "x-int", "rotation": 0, "openEdges": {"n": True, "s": True, "e": True, "w": True}},
    {"x1": -7, "z1": 20, "x2": -7, "z2": 159, "type": None, "rotation": 0, "openEdges": None},
    {"x1": -7, "z1": -133, "x2": -7, "z2": -45, "type": None, "rotation": 0, "openEdges": None},
    {"x1": -7, "z1": -35, "x2": -7, "z2": 10, "type": None, "rotation": 0, "openEdges": None},
    {"x1": -7, "z1": -40, "x2": -7, "z2": -40, "type": "x-int", "rotation": 0, "openEdges": {"n": True, "s": True, "e": True, "w": True}},
    {"x1": -109, "z1": -40, "x2": -12, "z2": -40, "type": None, "rotation": 0, "openEdges": None},
    {"x1": -2, "z1": -40, "x2": 191, "z2": -40, "type": None, "rotation": 0, "openEdges": None},
]


def get_latest_checkpoint_streets():
    # Return fresh dicts so callers can mutate without corrupting the guard copy.
    return [dict(seg) for seg in LATEST_CHECKPOINT_STREETS_20260429]


def ensure_checkpoint_streets(meta, *, persist=False):
    streets = meta.get("streets")
    if isinstance(streets, list) and len(streets) > 0:
        return streets
    streets = get_latest_checkpoint_streets()
    meta["streets"] = streets
    meta["streetsRestoredFrom"] = "latest-desktop-checkpoint-2026-04-29"
    if persist:
        save_world_meta(meta)
    return streets

WORLD_ACTION_PERSISTENCE_VERSION = "agent-life-world-action-persistence/v1"
WORLD_ACTION_SCHEMA_VERSION = "agent-life-world-action/v1"
WORLD_ACTION_STATE_MACHINE_VERSION = "agent-life-world-action-lifecycle/v1"
WORLD_ACTION_ACTIVE_STATES = {"requested", "created", "reserved", "route_pending", "routing", "arrived", "in_progress"}
WORLD_ACTION_TERMINAL_STATES = {"completed", "cancelled", "failed", "expired"}
WORLD_ACTION_STATUSES = WORLD_ACTION_ACTIVE_STATES | WORLD_ACTION_TERMINAL_STATES
WORLD_ACTION_STATE_ALIASES = {
    "queued": "requested",
    "arriving": "arrived",
    "in_use": "in_progress",
    "completing": "in_progress",
    "done": "completed",
    "blocked": "failed",
    "timed_out": "expired",
}
WORLD_ACTION_TRANSITIONS = {
    "requested": {"created", "cancelled", "failed", "expired"},
    "created": {"reserved", "cancelled", "failed", "expired"},
    "reserved": {"route_pending", "cancelled", "failed", "expired"},
    "route_pending": {"routing", "cancelled", "failed", "expired"},
    "routing": {"arrived", "cancelled", "failed", "expired"},
    "arrived": {"in_progress", "cancelled", "failed", "expired"},
    "in_progress": {"completed", "cancelled", "failed", "expired"},
    "completed": set(),
    "cancelled": set(),
    "failed": set(),
    "expired": set(),
}
WORLD_ACTION_TERMINAL_ALIASES = {"done": "completed", "timed_out": "expired", "blocked": "failed"}
BEHAVIOR_SOURCE_KINDS = {"user", "agent-live-mode", "agent-scripted-mode", "system-schedule"}
BEHAVIOR_SOURCE_ALIASES = {
    "api": "user",
    "user-context-menu": "user",
    "user-agent-picker": "user",
    "agent-autonomy": "agent-scripted-mode",
    "schedule": "system-schedule",
    "system": "system-schedule",
}
BEHAVIOR_MODE_BY_SOURCE = {
    "user": "user-override",
    "agent-live-mode": "agent-live",
    "agent-scripted-mode": "agent-scripted",
    "system-schedule": "system-schedule",
}
BEHAVIOR_AUTHORITY_BY_SOURCE = {
    "user": 1000,
    "agent-live-mode": 900,
    "system-schedule": 500,
    "agent-scripted-mode": 300,
}
BEHAVIOR_CATEGORIES = {"rest", "socialize", "snack-drink", "play", "browse-read", "work-return", "wander", "sleep-home"}
WORLD_ACTION_SOURCE_KINDS = BEHAVIOR_SOURCE_KINDS | set(BEHAVIOR_SOURCE_ALIASES.keys())
AGENT_LIVE_MODE_DEFAULT_ENABLED = False
WORLD_ACTION_TARGET_KINDS = {"object-instance", "building", "room", "world-point", "agent"}
WORLD_ACTION_PRIORITIES = {"low", "normal", "high", "urgent"}
WORLD_ACTION_FAILURE_REASONS = {
    "no_matching_capability",
    "target_missing",
    "target_deleted",
    "target_disabled",
    "target_blocked",
    "permission_denied",
    "object_reserved",
    "route_unreachable",
    "agent_unavailable",
    "timed_out",
    "cancelled_by_user",
    "cancelled_by_system",
    "runtime_error",
}
WORLD_OBJECT_AVAILABILITY_STATES = {"available", "reserved", "in_use", "disabled", "missing", "deleted", "blocked"}
WORLD_RESERVATION_ACTIVE_STATES = {"queued", "reserved", "in_use"}
WORLD_RESERVATION_RELEASED_STATES = {"released", "cancelled", "failed", "timed_out", "deleted"}
WORLD_API_SERVICE_QUEUE_CATALOG_IDS = {
    "cafecounter",
    "checkoutcounter",
    "checkoutregister",
    "coffeemachine",
    "coffeepickupshelf",
    "foodtruckcounter",
    "fridge",
    "grill",
    "microwave",
    "vendingmachine",
}
WORLD_ACTION_HISTORY_RETENTION = {
    # Completed/cancelled actions are short-lived UX history; failed/blocked/timed-out
    # records are kept longer for debugging. Active actions are never pruned here.
    "completedCancelledDays": 7,
    "failedDays": 30,
    "maxHistoryRecords": 1000,
}

_WORLD_META_LOCK = threading.RLock()
META_BACKUP_FILE = META_FILE + ".bak"


def _default_world_meta():
    meta = dict(DEFAULT_META)
    meta["createdAt"] = time.strftime("%Y-%m-%dT%H:%M:%SZ")
    return meta


def _read_json_file(path):
    with open(path, "r") as f:
        return json.load(f)


def load_world_meta():
    with _WORLD_META_LOCK:
        try:
            return _read_json_file(META_FILE)
        except FileNotFoundError:
            meta = _default_world_meta()
            save_world_meta(meta)
            return meta
        except json.JSONDecodeError as e:
            # Do not "repair" a corrupt/partially-written meta file by saving
            # defaults over it. Try the last known-good backup; otherwise return
            # safe in-memory defaults and leave the broken file for inspection.
            print(f"⚠️  world-meta.json is invalid; preserving it and trying backup: {e}")
            try:
                return _read_json_file(META_BACKUP_FILE)
            except (FileNotFoundError, json.JSONDecodeError) as backup_error:
                print(f"⚠️  world-meta.json backup unavailable/invalid; using in-memory defaults only: {backup_error}")
                return _default_world_meta()


def save_world_meta(meta):
    os.makedirs(os.path.dirname(META_FILE), exist_ok=True)
    with _WORLD_META_LOCK:
        # Keep a last-known-good backup, but never replace it with malformed
        # current contents. This is intentionally not a lock file.
        try:
            _read_json_file(META_FILE)
            shutil.copy2(META_FILE, META_BACKUP_FILE)
        except (FileNotFoundError, json.JSONDecodeError, OSError):
            pass

        tmp_path = f"{META_FILE}.tmp-{os.getpid()}-{threading.get_ident()}"
        with open(tmp_path, "w") as f:
            json.dump(meta, f, indent=2)
            f.write("\n")
            f.flush()
            os.fsync(f.fileno())
        os.replace(tmp_path, META_FILE)
        try:
            dir_fd = os.open(os.path.dirname(META_FILE) or ".", os.O_DIRECTORY)
            try:
                os.fsync(dir_fd)
            finally:
                os.close(dir_fd)
        except OSError:
            pass

# ─── WORLD ACTION PERSISTENCE ─────────────────────────────────────
def _utc_now_iso():
    return time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime())


def default_world_actions_store():
    return {
        "schemaVersion": WORLD_ACTION_SCHEMA_VERSION,
        "persistenceVersion": WORLD_ACTION_PERSISTENCE_VERSION,
        "retention": dict(WORLD_ACTION_HISTORY_RETENTION),
        "active": [],
        "history": [],
    }


def _is_record(value):
    return isinstance(value, dict)


def _non_empty_string(value):
    return isinstance(value, str) and bool(value.strip())


def _valid_isoish(value):
    # The client schema owns strict semantics. The server only needs enough
    # validation to reject dangerous/malformed data without corrupting meta.
    return _non_empty_string(value) and "T" in value and (value.endswith("Z") or "+" in value or value.count("-") >= 2)


def _parse_isoish_epoch(value):
    if not _non_empty_string(value):
        return None
    try:
        normalized = value.replace("Z", "+00:00")
        from datetime import datetime
        return datetime.fromisoformat(normalized).timestamp()
    except Exception:
        return None


def _canonical_world_action_status(status):
    if not isinstance(status, str):
        return status
    return WORLD_ACTION_STATE_ALIASES.get(status, status)


def _canonical_world_action_failure(reason):
    if not isinstance(reason, str):
        return reason
    if reason == "timed_out":
        return "timed_out"
    if reason == "blocked":
        return "target_blocked"
    return reason


def _world_action_allowed_next(status):
    return sorted(WORLD_ACTION_TRANSITIONS.get(_canonical_world_action_status(status), set()))


def _world_action_transition_allowed(from_status, to_status):
    source = _canonical_world_action_status(from_status)
    target = _canonical_world_action_status(to_status)
    return target in WORLD_ACTION_TRANSITIONS.get(source, set())


def _copy_world_action_record(record):
    return json.loads(json.dumps(record)) if _is_record(record) else record


def _normalize_world_action_record(record):
    if not _is_record(record):
        return record
    action = _copy_world_action_record(record)
    original_status = action.get("status")
    action["status"] = _canonical_world_action_status(original_status)
    if action.get("failureReason") is not None:
        action["failureReason"] = _canonical_world_action_failure(action.get("failureReason"))
    lifecycle = action.get("lifecycle") if _is_record(action.get("lifecycle")) else {}
    previous = _canonical_world_action_status(lifecycle.get("previousStatus")) if lifecycle.get("previousStatus") is not None else lifecycle.get("previousStatus")
    log = []
    for entry in lifecycle.get("transitionLog") or []:
        if not _is_record(entry):
            log.append(entry)
            continue
        next_entry = dict(entry)
        if next_entry.get("from") is not None:
            next_entry["from"] = _canonical_world_action_status(next_entry.get("from"))
        next_entry["to"] = _canonical_world_action_status(next_entry.get("to"))
        if next_entry.get("reason") is not None:
            next_entry["reason"] = _canonical_world_action_failure(next_entry.get("reason"))
        log.append(next_entry)
    if lifecycle:
        lifecycle["previousStatus"] = previous
        lifecycle["allowedNext"] = _world_action_allowed_next(action.get("status"))
        lifecycle["transitionLog"] = log
        if lifecycle.get("terminalReason") is not None:
            lifecycle["terminalReason"] = _canonical_world_action_failure(lifecycle.get("terminalReason"))
        action["lifecycle"] = lifecycle
    route = action.get("route") if _is_record(action.get("route")) else None
    if route and route.get("state") is not None:
        route["state"] = _canonical_world_action_status(route.get("state"))
        action["route"] = route
    audit = action.get("audit") if _is_record(action.get("audit")) else {}
    if original_status != action.get("status"):
        migrations = list(audit.get("statusMigrations") or [])
        migrations.append({"from": original_status, "to": action.get("status"), "at": _utc_now_iso(), "source": "server.py#_normalize_world_action_record"})
        audit["statusMigrations"] = migrations
        action["audit"] = audit
    return action


def _validate_world_action_lifecycle(action, errors):
    status = action.get("status")
    lifecycle = action.get("lifecycle") if _is_record(action.get("lifecycle")) else None
    if not lifecycle:
        errors.append("lifecycle must be an object")
        return
    allowed_next = lifecycle.get("allowedNext")
    canonical_next = _world_action_allowed_next(status)
    if allowed_next != canonical_next:
        errors.append(f"lifecycle.allowedNext must match canonical transitions for {status}: {canonical_next}")
    previous = lifecycle.get("previousStatus")
    if previous is not None and previous not in WORLD_ACTION_STATUSES:
        errors.append("lifecycle.previousStatus must be a known world action state or null")
    if previous is not None and status in WORLD_ACTION_STATUSES and not _world_action_transition_allowed(previous, status):
        errors.append(f"lifecycle.previousStatus transition {previous} -> {status} is not allowed")
    for index, entry in enumerate(lifecycle.get("transitionLog") or []):
        if not _is_record(entry):
            errors.append(f"lifecycle.transitionLog[{index}] must be an object")
            continue
        from_status = entry.get("from")
        to_status = entry.get("to")
        if from_status is not None and from_status not in WORLD_ACTION_STATUSES:
            errors.append(f"lifecycle.transitionLog[{index}].from must be a known state or null")
        if to_status not in WORLD_ACTION_STATUSES:
            errors.append(f"lifecycle.transitionLog[{index}].to must be a known state")
        if from_status is not None and to_status in WORLD_ACTION_STATUSES and not _world_action_transition_allowed(from_status, to_status):
            errors.append(f"lifecycle.transitionLog[{index}] transition {from_status} -> {to_status} is not allowed")
        if not _valid_isoish(entry.get("at")):
            errors.append(f"lifecycle.transitionLog[{index}].at must be an ISO timestamp string")
        if not _non_empty_string(entry.get("actor")):
            errors.append(f"lifecycle.transitionLog[{index}].actor must record who/source made the transition")
    if status in WORLD_ACTION_TERMINAL_STATES and not lifecycle.get("terminalReason"):
        errors.append("terminal world actions require lifecycle.terminalReason")


def _validate_world_action_source(source, errors):
    if not _is_record(source):
        errors.append("source must be an object")
        return
    if source.get("kind") not in WORLD_ACTION_SOURCE_KINDS:
        errors.append(f"source.kind must be one of {sorted(WORLD_ACTION_SOURCE_KINDS)}")
    behavior = source.get("behavior") if _is_record(source.get("behavior")) else {}
    behavior_source = behavior.get("behaviorSourceKind") or source.get("behaviorSourceKind") or source.get("kind")
    if behavior_source not in BEHAVIOR_SOURCE_KINDS:
        errors.append(f"source.behaviorSourceKind must be one of {sorted(BEHAVIOR_SOURCE_KINDS)}")
    behavior_mode = behavior.get("behaviorMode") or source.get("behaviorMode")
    if behavior_mode is not None and behavior_mode not in set(BEHAVIOR_MODE_BY_SOURCE.values()):
        errors.append(f"source.behaviorMode must be one of {sorted(set(BEHAVIOR_MODE_BY_SOURCE.values()))}")
    category = behavior.get("behaviorSelectedCategory") if "behaviorSelectedCategory" in behavior else source.get("behaviorCategory")
    if category is not None and category not in BEHAVIOR_CATEGORIES:
        errors.append(f"source.behaviorSelectedCategory must be one of {sorted(BEHAVIOR_CATEGORIES)} or null")
    for key in ("requestedBy", "requestId"):
        if key in source and source[key] is not None and not _non_empty_string(source[key]):
            errors.append(f"source.{key} must be a non-empty string or null")


def _validate_world_action_target(target, errors):
    if not _is_record(target):
        errors.append("target must be an object")
        return
    kind = target.get("kind")
    if kind not in WORLD_ACTION_TARGET_KINDS:
        errors.append(f"target.kind must be one of {sorted(WORLD_ACTION_TARGET_KINDS)}")
        return
    if kind == "object-instance":
        for key in ("objectInstanceId", "catalogId", "interactionSpotId", "buildingId"):
            if not _non_empty_string(target.get(key)):
                errors.append(f"target.{key} must be a non-empty string")
    if kind in {"building", "room"} and not _non_empty_string(target.get("buildingId")):
        errors.append("target.buildingId must be a non-empty string")
    if kind == "room" and not _non_empty_string(target.get("roomId")):
        errors.append("target.roomId must be a non-empty string")
    if kind == "agent" and not _non_empty_string(target.get("targetAgentId")):
        errors.append("target.targetAgentId must be a non-empty string")
    if kind == "world-point":
        for key in ("x", "z"):
            if not isinstance(target.get(key), (int, float)):
                errors.append(f"target.{key} must be a finite number")
    if "floor" in target and (not isinstance(target.get("floor"), int) or target.get("floor") < 1):
        errors.append("target.floor must be an integer >= 1 when present")
    if "roomId" in target and target.get("roomId") is not None and not _non_empty_string(target.get("roomId")):
        errors.append("target.roomId must be a non-empty string or null when present")


def _validate_world_action_timing(timing, errors):
    if not _is_record(timing):
        errors.append("timing must be an object")
        return
    for key in ("createdAt", "updatedAt"):
        if not _valid_isoish(timing.get(key)):
            errors.append(f"timing.{key} must be an ISO timestamp string")
    for key in ("queuedAt", "startedAt", "arrivedAt", "completedAt", "terminalAt"):
        if key in timing and timing[key] is not None and not _valid_isoish(timing[key]):
            errors.append(f"timing.{key} must be an ISO timestamp string or null")
    for key in ("timeoutMs", "estimatedUseMs"):
        if key in timing and timing[key] is not None and (not isinstance(timing[key], (int, float)) or timing[key] < 0):
            errors.append(f"timing.{key} must be a finite number >= 0")


def validate_world_action_record(action, expected_bucket=None):
    errors = []
    if not _is_record(action):
        return ["world action must be an object"]
    for key in ("id", "actionType", "agentId", "capabilityTag"):
        if not _non_empty_string(action.get(key)):
            errors.append(f"{key} must be a non-empty string")
    status = action.get("status")
    if status not in WORLD_ACTION_STATUSES:
        errors.append(f"status must be one of {sorted(WORLD_ACTION_STATUSES)}")
    if expected_bucket == "active" and status not in WORLD_ACTION_ACTIVE_STATES:
        errors.append("active world actions must use an active status")
    if expected_bucket == "history" and status not in WORLD_ACTION_TERMINAL_STATES:
        errors.append("history world actions must use a terminal status")
    if action.get("priority") not in WORLD_ACTION_PRIORITIES:
        errors.append(f"priority must be one of {sorted(WORLD_ACTION_PRIORITIES)}")
    _validate_world_action_source(action.get("source"), errors)
    _validate_world_action_target(action.get("target"), errors)
    _validate_world_action_timing(action.get("timing"), errors)

    for optional_obj in ("permission", "lifecycle", "params", "result", "audit"):
        if optional_obj in action and action[optional_obj] is not None and not _is_record(action[optional_obj]):
            errors.append(f"{optional_obj} must be an object when present")
    _validate_world_action_lifecycle(action, errors)
    reservation = action.get("reservation")
    if reservation is not None:
        if not _is_record(reservation):
            errors.append("reservation must be an object when present")
        else:
            if not _non_empty_string(reservation.get("id")):
                errors.append("reservation.id must be a non-empty string")
            if reservation.get("agentId") not in (None, action.get("agentId")):
                errors.append("reservation.agentId must match agentId when present")
            # Legacy Task 3 records used actionType in reservation.actionId. New
            # records tie the reservation to the concrete world-action id while
            # retaining actionType for catalog/debug filtering.
            if reservation.get("actionId") not in (None, action.get("id"), action.get("actionType")):
                errors.append("reservation.actionId must match id when present")
            if reservation.get("state") is not None and reservation.get("state") not in WORLD_RESERVATION_ACTIVE_STATES | WORLD_RESERVATION_RELEASED_STATES:
                errors.append("reservation.state must be a known reservation lifecycle state")
            if reservation.get("availabilityState") is not None and reservation.get("availabilityState") not in WORLD_OBJECT_AVAILABILITY_STATES:
                errors.append("reservation.availabilityState must be a known object availability state")
            for key in ("objectInstanceId", "spotId", "slotId"):
                if key in reservation and reservation[key] is not None and not _non_empty_string(reservation[key]):
                    errors.append(f"reservation.{key} must be a non-empty string or null")
    route = action.get("route")
    if route is not None:
        if not _is_record(route):
            errors.append("route must be an object when present")
        elif not (_non_empty_string(route.get("id")) or _non_empty_string(route.get("routeId"))):
            errors.append("route.id or route.routeId must be a non-empty string")
    failure_reason = action.get("failureReason")
    if failure_reason is not None and failure_reason not in WORLD_ACTION_FAILURE_REASONS:
        errors.append(f"failureReason must be one of {sorted(WORLD_ACTION_FAILURE_REASONS)} or null")
    if status in WORLD_ACTION_TERMINAL_STATES and not action.get("result"):
        errors.append("terminal world actions require result metadata")
    if status in {"failed", "expired"} and not failure_reason:
        errors.append("failed/expired world actions require failureReason")
    return errors


def _sanitize_world_action_list(records, bucket):
    accepted = []
    rejected = []
    seen = set()
    if not isinstance(records, list):
        return accepted, [{"index": None, "errors": [f"{bucket} must be an array"]}]
    for index, raw_record in enumerate(records):
        record = _normalize_world_action_record(raw_record)
        errors = validate_world_action_record(record, expected_bucket=bucket)
        action_id = record.get("id") if _is_record(record) else None
        if _non_empty_string(action_id) and action_id in seen:
            errors.append("duplicate action id in bucket")
        if errors:
            rejected.append({"index": index, "id": action_id, "errors": errors})
            continue
        seen.add(action_id)
        accepted.append(record)
    return accepted, rejected


def _retention_cutoff_seconds(status, now_epoch):
    status = _canonical_world_action_status(status)
    if status in {"completed", "cancelled"}:
        return now_epoch - (WORLD_ACTION_HISTORY_RETENTION["completedCancelledDays"] * 86400)
    return now_epoch - (WORLD_ACTION_HISTORY_RETENTION["failedDays"] * 86400)


def cleanup_world_action_history(history):
    now_epoch = time.time()
    kept = []
    removed = []
    for record in history:
        status = record.get("status")
        timing = record.get("timing") if _is_record(record.get("timing")) else {}
        timestamp = _parse_isoish_epoch(timing.get("terminalAt") or timing.get("completedAt") or timing.get("updatedAt") or timing.get("createdAt"))
        if timestamp is not None and timestamp < _retention_cutoff_seconds(status, now_epoch):
            removed.append(record.get("id"))
            continue
        kept.append(record)
    max_records = WORLD_ACTION_HISTORY_RETENTION["maxHistoryRecords"]
    if len(kept) > max_records:
        kept.sort(key=lambda item: _parse_isoish_epoch((item.get("timing") or {}).get("updatedAt")) or 0, reverse=True)
        removed.extend([item.get("id") for item in kept[max_records:]])
        kept = kept[:max_records]
    return kept, removed


def get_world_actions_store(meta=None, *, persist_migration=False):
    meta = meta if isinstance(meta, dict) else load_world_meta()
    agent_life = meta.get("agentLife") if isinstance(meta.get("agentLife"), dict) else {}
    raw_store = agent_life.get("worldActions") if isinstance(agent_life.get("worldActions"), dict) else {}
    store = default_world_actions_store()
    raw_retention = raw_store.get("retention") if isinstance(raw_store.get("retention"), dict) else {}
    store["retention"].update({k: raw_retention[k] for k in store["retention"] if isinstance(raw_retention.get(k), int) and raw_retention[k] >= 0})
    active, rejected_active = _sanitize_world_action_list(raw_store.get("active", []), "active")
    history, rejected_history = _sanitize_world_action_list(raw_store.get("history", []), "history")
    history, removed = cleanup_world_action_history(history)
    store["active"] = active
    store["history"] = history
    if rejected_active or rejected_history or removed:
        store["lastCleanup"] = {
            "at": _utc_now_iso(),
            "rejectedActive": rejected_active,
            "rejectedHistory": rejected_history,
            "removedHistoryIds": removed,
        }
    if persist_migration:
        agent_life["worldActions"] = store
        meta["agentLife"] = agent_life
        save_world_meta(meta)
    return store


def save_world_actions_store(next_store):
    active, rejected_active = _sanitize_world_action_list(next_store.get("active", []), "active")
    history, rejected_history = _sanitize_world_action_list(next_store.get("history", []), "history")
    if rejected_active or rejected_history:
        return False, {"rejectedActive": rejected_active, "rejectedHistory": rejected_history}
    history, removed = cleanup_world_action_history(history)
    meta = load_world_meta()
    agent_life = meta.get("agentLife") if isinstance(meta.get("agentLife"), dict) else {}
    store = default_world_actions_store()
    store["retention"] = dict(WORLD_ACTION_HISTORY_RETENTION)
    store["active"] = active
    store["history"] = history
    store["lastSavedAt"] = _utc_now_iso()
    if removed:
        store["lastCleanup"] = {"at": _utc_now_iso(), "removedHistoryIds": removed}
    agent_life["worldActions"] = store
    meta["agentLife"] = agent_life
    save_world_meta(meta)
    return True, store

# ─── WORLD ACTION CREATE API ──────────────────────────────────────
CATALOG_SCHEMA_FILE = os.path.join(CLIENT_DIR if 'CLIENT_DIR' in globals() else os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "client"), "js", "agent-life-object-catalog-schema.mjs")
CAPABILITY_SCHEMA_FILE = os.path.join(CLIENT_DIR if 'CLIENT_DIR' in globals() else os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "client"), "js", "agent-life-capability-tags.mjs")
WORLD_ACTION_CREATE_VERSION = "agent-life-world-action-create/v1"
WORLD_ACTION_CREATE_ROUTE_OWNER = "main3d.js#setAgentTarget(agent, target, building, floor) via dynamic-interior-routing.js / dynamic-exterior-routing.js"
WORLD_ACTION_CREATE_REUSE_NOTES = [
    "Reuse server.py world-meta persistence from Phase 2 Task 2 instead of a new action store.",
    "Reuse get_roster() for agent validation and list_buildings()/load_building() for target validation.",
    "Adapt object catalog capability/action/spot metadata from agent-life-object-catalog-schema.mjs; do not mint endpoint-only capability tags.",
    "Skip route/pathfinding generation on the server; return target metadata for the existing setAgentTarget/dynamic routing handoff.",
]
WORLD_ACTION_COMPLETE_CANCEL_VERSION = "agent-life-world-action-complete-cancel/v1"
WORLD_ACTION_COMPLETE_CANCEL_REUSE_NOTES = [
    "Reuse transition_world_action() and the existing Task 5 state machine instead of adding endpoint-specific lifecycle rules.",
    "Reuse main3d.js#setAgentTarget() handoff metadata and dynamic-interior/exterior routing ownership; complete/cancel only clear route intent and never calculate paths.",
    "Reuse reservation release side effects from _apply_world_action_side_effects(); terminal complete/cancel responses are idempotent for existing history records and do not double-apply effects.",
]
MOVE_INTENT_SCHEMA_VERSION = "agent-life-move-intent/v1"
MOVE_INTENT_ACTIVE_STATES = {"route_pending", "routing"}
MOVE_INTENT_TERMINAL_STATES = {"arrived", "failed", "cancelled", "expired", "invalidated"}
MOVE_INTENT_ROUTE_GUARDRAILS = [
    "main3d.js#setAgentTarget(agent, target, building, floor) remains the move intent owner.",
    "dynamic-interior-routing.js owns indoor collision, doorway, floor, and elevator routing.",
    "dynamic-exterior-routing.js owns outdoor/world collision, sidewalk, road/crosswalk, and building-transition routing.",
    "server.py validates and records target metadata only; it never calculates paths, waypoints, trajectories, or colliders.",
]
MOVE_INTENT_REUSE_NOTES = [
    "Reuse server.py agent, building, object, reservation, and world-action helpers from Tasks 2-6.",
    "Reuse object/action spot metadata from persisted building records and the object catalog; do not create endpoint-only spot ids.",
    "Adapt room targets as building/floor/room metadata until a canonical room registry exists.",
    "Return a setAgentTarget handoff envelope for client/event-hook integration instead of adding a second router.",
]
WORLD_ACTION_EVENT_HOOKS_VERSION = "agent-life-world-action-event-hooks/v1"
WORLD_ACTION_EVENT_NAMES = {
    "action-created",
    "object-reserved",
    "route-started",
    "arrived",
    "in-progress",
    "completed",
    "cancelled",
    "failed",
    "reservation-released",
}
WORLD_ACTION_EVENT_TRANSITION_MAP = {
    "routing": "route-started",
    "arrived": "arrived",
    "in_progress": "in-progress",
    "completed": "completed",
    "cancelled": "cancelled",
    "failed": "failed",
    "expired": "failed",
}
WORLD_ACTION_EVENT_REUSE_NOTES = [
    "Reuse world-meta.json#agentLife persistence and existing /api polling style; no websocket, SSE, or unrelated realtime layer was added.",
    "Reuse Task 5 transition_world_action() as the only lifecycle/event emission point after create.",
    "Reuse Task 7 setAgentTarget route handoff metadata; event hooks expose route targets but never calculate paths or bypass dynamic routing/collision logic.",
]
WORLD_ACTION_EVENT_ROUTE_GUARDRAILS = MOVE_INTENT_ROUTE_GUARDRAILS


def _api_error(code, message, *, details=None):
    body = {"error": {"code": code, "message": message}}
    if details is not None:
        body["error"]["details"] = details
    return body


def _normalize_behavior_source_kind(value):
    kind = str(value or "").strip()
    if kind in BEHAVIOR_SOURCE_KINDS:
        return kind, None
    if kind in BEHAVIOR_SOURCE_ALIASES:
        return BEHAVIOR_SOURCE_ALIASES[kind], kind
    return None, None


def _behavior_selected_object_from_target(target):
    if not isinstance(target, dict):
        return {"kind": "none"}
    kind = target.get("kind") or "object-instance"
    if kind == "object-instance":
        object_id = target.get("objectInstanceId") or target.get("objectId") or target.get("id")
        return {
            "kind": "outdoor-node" if target.get("targetKind") == "outdoor-area-node" else "furniture",
            "id": object_id,
            "buildingId": target.get("buildingId"),
            "furnitureIndex": target.get("furnitureIndex"),
            "catalogId": target.get("catalogId") or target.get("objectCatalogId"),
            "objectType": target.get("objectType"),
            "nodeId": target.get("nodeId") if target.get("nodeId") != object_id else None,
        }
    if kind == "world-point":
        return {"kind": "world-point", "id": None, "buildingId": target.get("buildingId")}
    if kind == "building":
        return {"kind": "building", "id": target.get("buildingId"), "buildingId": target.get("buildingId")}
    if kind == "agent":
        return {"kind": "agent", "id": target.get("targetAgentId") or target.get("agentId")}
    return {"kind": kind, "id": target.get("id"), "buildingId": target.get("buildingId")}


def _behavior_selected_spot_from_target(target):
    if not isinstance(target, dict):
        return None
    return {
        "spotId": target.get("spotId") or target.get("interactionSpotId"),
        "slotId": target.get("slotId"),
        "seatId": target.get("seatId"),
        "interactionSpotId": target.get("interactionSpotId") or target.get("spotId"),
        "x": target.get("x") if target.get("x") is not None else target.get("worldX"),
        "y": target.get("y") if target.get("y") is not None else (target.get("z") if target.get("z") is not None else target.get("worldZ")),
        "floor": target.get("floor") or target.get("buildingFloor"),
    }


def _normalize_behavior_metadata(payload, source, target=None):
    if not isinstance(payload, dict):
        return None, _api_error("invalid_payload", "behavior metadata payload must be an object")
    if not isinstance(source, dict):
        return None, _api_error("invalid_behavior_source", "source must be an object with a valid behavior source kind", details={"allowed": sorted(BEHAVIOR_SOURCE_KINDS)})
    raw_kind = payload.get("behaviorSource") or payload.get("behaviorSourceKind") or source.get("behaviorSourceKind") or source.get("kind")
    source_kind, alias = _normalize_behavior_source_kind(raw_kind)
    if not source_kind:
        return None, _api_error("invalid_behavior_source", "Invalid behavior source kind.", details={"value": raw_kind, "allowed": sorted(BEHAVIOR_SOURCE_KINDS)})
    expected_mode = BEHAVIOR_MODE_BY_SOURCE[source_kind]
    mode = payload.get("behaviorMode") or source.get("behaviorMode") or expected_mode
    if mode != expected_mode:
        return None, _api_error("invalid_behavior_mode", "behaviorMode does not match behavior source kind.", details={"behaviorSourceKind": source_kind, "behaviorMode": mode, "expectedBehaviorMode": expected_mode})
    category = payload.get("behaviorCategory") if "behaviorCategory" in payload else source.get("behaviorCategory")
    if category is None and isinstance(payload.get("behavior"), dict):
        category = payload["behavior"].get("behaviorSelectedCategory")
    if category is not None and category not in BEHAVIOR_CATEGORIES:
        return None, _api_error("invalid_behavior_category", "behaviorCategory must be a known Phase 4 behavior category or null.", details={"value": category, "allowed": sorted(BEHAVIOR_CATEGORIES)})
    selected_object = payload.get("behaviorSelectedObject") if isinstance(payload.get("behaviorSelectedObject"), dict) else _behavior_selected_object_from_target(target)
    selected_spot = payload.get("behaviorSelectedSpot") if isinstance(payload.get("behaviorSelectedSpot"), dict) else _behavior_selected_spot_from_target(target)
    probability_roll = payload.get("behaviorProbabilityRoll") if isinstance(payload.get("behaviorProbabilityRoll"), dict) else None
    fallback_reason = payload.get("behaviorFallbackReason") if payload.get("behaviorFallbackReason") is not None else None
    return {
        "behaviorSourceKind": source_kind,
        "behaviorMode": mode,
        "behaviorAuthority": BEHAVIOR_AUTHORITY_BY_SOURCE[source_kind],
        "behaviorSelectedCategory": category,
        "behaviorSelectedObject": selected_object,
        "behaviorSelectedSpot": selected_spot,
        "behaviorProbabilityRoll": probability_roll,
        "behaviorFallbackReason": fallback_reason,
        "sourceAlias": alias,
    }, None


def _source_snapshot_with_behavior(source, behavior):
    source = source if isinstance(source, dict) else {}
    behavior = behavior if isinstance(behavior, dict) else {}
    keys = ["requestedBy", "requestId", "surface", "roles", "agentModelId", "modelId", "caller", "trusted"]
    snap = {"kind": behavior.get("behaviorSourceKind") or source.get("kind")}
    for key in keys:
        if source.get(key) is not None:
            snap[key] = source.get(key)
    if behavior.get("sourceAlias"):
        snap["legacyKind"] = behavior.get("sourceAlias")
    snap.update({
        "behaviorSourceKind": behavior.get("behaviorSourceKind"),
        "behaviorMode": behavior.get("behaviorMode"),
        "behaviorAuthority": behavior.get("behaviorAuthority"),
        "behaviorCategory": behavior.get("behaviorSelectedCategory"),
        "behavior": {k: behavior.get(k) for k in ["behaviorSourceKind", "behaviorMode", "behaviorAuthority", "behaviorSelectedCategory", "behaviorSelectedObject", "behaviorSelectedSpot", "behaviorProbabilityRoll", "behaviorFallbackReason"]},
    })
    return snap


def default_world_action_events_store():
    return {
        "schemaVersion": WORLD_ACTION_EVENT_HOOKS_VERSION,
        "nextSequence": 1,
        "events": [],
        "retention": {"maxEvents": 1000},
        "subscription": {"mode": "poll", "endpoint": "/api/world-action-events", "cursorField": "sequence"},
    }


def get_world_action_events_store(*, persist_migration=False):
    meta = load_world_meta()
    agent_life = meta.get("agentLife") if isinstance(meta.get("agentLife"), dict) else {}
    store = agent_life.get("worldActionEvents") if isinstance(agent_life.get("worldActionEvents"), dict) else None
    changed = store is None
    if not store:
        store = default_world_action_events_store()
    raw_events = store.get("events") if isinstance(store.get("events"), list) else []
    events = [event for event in raw_events if isinstance(event, dict) and event.get("name") in WORLD_ACTION_EVENT_NAMES]
    try:
        next_sequence = int(store.get("nextSequence") or 1)
    except (TypeError, ValueError):
        next_sequence = 1
    if events:
        next_sequence = max(next_sequence, max(int(event.get("sequence") or 0) for event in events) + 1)
    next_store = default_world_action_events_store()
    next_store.update({
        "nextSequence": next_sequence,
        "events": events[-int((store.get("retention") or {}).get("maxEvents") or 1000):],
        "retention": {**next_store["retention"], **(store.get("retention") if isinstance(store.get("retention"), dict) else {})},
    })
    if persist_migration and changed:
        agent_life["worldActionEvents"] = next_store
        meta["agentLife"] = agent_life
        save_world_meta(meta)
    return next_store


def save_world_action_events_store(store):
    meta = load_world_meta()
    agent_life = meta.get("agentLife") if isinstance(meta.get("agentLife"), dict) else {}
    next_store = default_world_action_events_store()
    if isinstance(store, dict):
        next_store.update({k: v for k, v in store.items() if k in {"nextSequence", "events", "retention", "subscription"}})
    max_events = int((next_store.get("retention") or {}).get("maxEvents") or 1000)
    next_store["events"] = [event for event in (next_store.get("events") or []) if isinstance(event, dict) and event.get("name") in WORLD_ACTION_EVENT_NAMES][-max_events:]
    try:
        next_store["nextSequence"] = int(next_store.get("nextSequence") or 1)
    except (TypeError, ValueError):
        next_store["nextSequence"] = 1
    agent_life["worldActionEvents"] = next_store
    meta["agentLife"] = agent_life
    save_world_meta(meta)
    return next_store


def _world_action_target_id(action):
    target = action.get("target") if isinstance(action.get("target"), dict) else {}
    return target.get("objectInstanceId") or target.get("buildingId") or target.get("roomId") or target.get("targetAgentId") or target.get("id")


def _world_action_event_payload(action, name, now, *, from_status=None, to_status=None, reason=None, result=None, error=None, route=None, reservation=None, actor=None, source="api"):
    target = action.get("target") if isinstance(action.get("target"), dict) else {}
    action_source = action.get("source") if isinstance(action.get("source"), dict) else {}
    behavior = action_source.get("behavior") if isinstance(action_source.get("behavior"), dict) else {}
    current_result = result if isinstance(result, dict) else (action.get("result") if isinstance(action.get("result"), dict) else None)
    current_error = error if isinstance(error, dict) else None
    failure_reason = reason or action.get("failureReason")
    if current_error is None and failure_reason and name in {"failed", "cancelled", "reservation-released"}:
        current_error = {"code": failure_reason, "message": failure_reason.replace("_", " ")}
    return {
        "schemaVersion": WORLD_ACTION_EVENT_HOOKS_VERSION,
        "name": name,
        "type": name,
        "id": f"evt-{action.get('id')}-{name}-{now.replace(':', '').replace('-', '')}",
        "at": now,
        "timestamp": now,
        "actionId": action.get("id"),
        "actionType": action.get("actionType"),
        "status": to_status or action.get("status"),
        "fromStatus": from_status,
        "toStatus": to_status or action.get("status"),
        "from": from_status,
        "to": to_status or action.get("status"),
        "agentId": action.get("agentId"),
        "targetId": _world_action_target_id(action),
        "targetKind": target.get("kind"),
        "target": target,
        "routeId": (route or action.get("route") or {}).get("id") if isinstance(route or action.get("route"), dict) else None,
        "reservationId": (reservation or action.get("reservation") or {}).get("id") if isinstance(reservation or action.get("reservation"), dict) else None,
        "source": source,
        "behaviorSourceKind": behavior.get("behaviorSourceKind") or action.get("behaviorSourceKind") or action_source.get("behaviorSourceKind"),
        "behaviorMode": behavior.get("behaviorMode") or action.get("behaviorMode") or action_source.get("behaviorMode"),
        "behaviorCategory": behavior.get("behaviorSelectedCategory") if "behaviorSelectedCategory" in behavior else action.get("behaviorCategory"),
        "behavior": behavior or None,
        "actor": actor or _transition_actor(action.get("source"), None),
        "reason": failure_reason,
        "result": current_result,
        "error": current_error,
    }


def _append_world_action_events(action, event_payloads):
    payloads = [event for event in event_payloads if isinstance(event, dict) and event.get("name") in WORLD_ACTION_EVENT_NAMES]
    if not payloads:
        return action
    store = get_world_action_events_store(persist_migration=True)
    sequence = int(store.get("nextSequence") or 1)
    existing_keys = {(event.get("actionId"), event.get("name"), event.get("fromStatus"), event.get("toStatus")) for event in store.get("events", [])}
    next_events = list(store.get("events", []))
    action_events = list(action.get("events") or [])
    for payload in payloads:
        key = (payload.get("actionId"), payload.get("name"), payload.get("fromStatus"), payload.get("toStatus"))
        if key in existing_keys:
            continue
        event = {**payload, "sequence": sequence, "cursor": sequence}
        sequence += 1
        existing_keys.add(key)
        next_events.append(event)
        action_events.append(event)
    save_world_action_events_store({**store, "nextSequence": sequence, "events": next_events})
    return {**action, "events": action_events}


def list_world_action_events(query=None):
    query = query if isinstance(query, dict) else {}
    store = get_world_action_events_store(persist_migration=True)
    events = list(store.get("events", []))
    since = (query.get("since") or query.get("after") or [None])[0] if isinstance(query.get("since") or query.get("after"), list) else query.get("since") or query.get("after")
    try:
        since = int(since) if since is not None else None
    except (TypeError, ValueError):
        since = None
    if since is not None:
        events = [event for event in events if int(event.get("sequence") or 0) > since]
    for field, key in (("agentId", "agentId"), ("actionId", "actionId"), ("targetId", "targetId"), ("name", "name")):
        value = (query.get(field) or [None])[0] if isinstance(query.get(field), list) else query.get(field)
        if value:
            events = [event for event in events if event.get(key) == value]
    try:
        limit = int(((query.get("limit") or [100])[0]) if isinstance(query.get("limit"), list) else query.get("limit") or 100)
    except (TypeError, ValueError):
        limit = 100
    limit = max(1, min(limit, 500))
    return {"ok": True, "schemaVersion": WORLD_ACTION_EVENT_HOOKS_VERSION, "subscription": store.get("subscription"), "events": events[-limit:], "nextCursor": store.get("nextSequence", 1) - 1}


def _normalize_token(value):
    return re.sub(r"[^a-z0-9]+", "", str(value or "").lower())


def _load_text_file(path):
    try:
        with open(path, "r") as f:
            return f.read()
    except OSError:
        return ""


def _normalize_capability_tag(tag):
    raw = str(tag or "").strip()
    if not raw:
        return None
    capability_text = _load_text_file(CAPABILITY_SCHEMA_FILE)
    if re.search(rf"['\"]{re.escape(raw)}['\"]\s*:", capability_text):
        return raw
    aliases = {
        "cosmetic": "appearance.customize", "cosmetics": "appearance.customize", "avatar": "appearance.customize",
        "mirror": "appearance.preview", "mannequin": "appearance.display", "barber": "appearance.salon",
        "rest": "life.rest", "recovery": "life.rest", "meal": "life.food", "drink": "life.hydration",
        "clinic": "life.medical", "shopping": "life.shopping", "retail": "life.shopping",
        "checkout": "maintenance.checkout", "trash": "maintenance.clean", "printer": "maintenance.printCopy",
        "diagnostic": "maintenance.diagnostics", "building": "world.build", "build": "world.build",
        "decor": "world.decorate", "wall": "world.structure", "terrain": "world.terrain", "outdoor": "world.exterior",
    }
    return aliases.get(raw) or aliases.get(raw.lower()) or aliases.get(_normalize_token(raw))


def _catalog_blocks():
    text = _load_text_file(CATALOG_SCHEMA_FILE)
    blocks = {}
    starts = [m.start() for m in re.finditer(r"\n\s*Object\.freeze\(\{\s*\n\s*id:\s*'", text)]
    for i, start in enumerate(starts):
        end = starts[i + 1] if i + 1 < len(starts) else len(text)
        block = text[start:end]
        match = re.search(r"id:\s*'([^']+)'", block)
        if match:
            blocks[_normalize_token(match.group(1))] = {"id": match.group(1), "block": block}
    return blocks


def _catalog_block_for(catalog_id):
    key = _normalize_token(catalog_id)
    if not key:
        return None
    blocks = _catalog_blocks()
    if key in blocks:
        return blocks[key]
    schema = _load_text_file(CATALOG_SCHEMA_FILE)
    alias = re.search(rf"{re.escape(key)}:\s*'([^']+)'", schema) or re.search(rf"'{re.escape(str(catalog_id))}':\s*'([^']+)'", schema)
    if alias:
        return blocks.get(_normalize_token(alias.group(1)))
    for block_key, block in blocks.items():
        if key == block_key or key in block_key or block_key in key:
            return block
    return None


def _catalog_action_permission(catalog, action_type, capability_tag):
    block = (catalog or {}).get("block", "")
    if not block:
        return None
    pattern = r"Object\.freeze\(\{\s*id:\s*'([^']+)'[^}]*?primaryTag:\s*'([^']+)'[^}]*?permission:\s*'([^']+)'"
    actions = re.findall(pattern, block, flags=re.S)
    normalized_capability = _normalize_capability_tag(capability_tag)
    exact = [a for a in actions if a[0] == action_type]
    by_cap = [a for a in actions if _normalize_capability_tag(a[1]) == normalized_capability]
    chosen = exact[0] if exact else (by_cap[0] if by_cap else None)
    if not chosen:
        return None
    return {"actionType": chosen[0], "capabilityTag": _normalize_capability_tag(chosen[1]), "permissionLevel": chosen[2]}


def _catalog_has_spot(catalog, spot_id, action_type=None):
    if not spot_id:
        return True
    block = (catalog or {}).get("block", "")
    spot_pattern = rf"id:\s*'{re.escape(str(spot_id))}'"
    if not re.search(spot_pattern, block):
        return False
    if action_type and action_type not in block:
        # Some legacy ACTION_SPOTS only expose role/use spots. Capability still
        # gates the action; absence of an exact action on a spot is not fatal.
        return True
    return True


def _catalog_spot_capacity(catalog, spot_id):
    if not spot_id:
        return 1
    block = (catalog or {}).get("block", "")
    match = re.search(rf"id:\s*'{re.escape(str(spot_id))}'[^}}]*?capacity:\s*(\d+)", block, flags=re.S)
    if not match:
        return 1
    try:
        return max(1, int(match.group(1)))
    except (TypeError, ValueError):
        return 1


def _catalog_queue_spot(catalog):
    block = (catalog or {}).get("block", "")
    if not block:
        return None
    pattern = r"Object\.freeze\(\{(?P<body>[^{}]*?capacityKind:\s*'queue'[^{}]*?)\}\)"
    for match in re.finditer(pattern, block, flags=re.S):
        body = match.group("body") or ""
        spot_id = re.search(r"id:\s*'([^']+)'", body)
        if not spot_id:
            continue
        capacity = re.search(r"capacity:\s*(\d+)", body)
        return {
            "id": spot_id.group(1),
            "capacity": max(1, int(capacity.group(1))) if capacity else 1,
            "action": (re.search(r"action:\s*'([^']+)'", body) or [None, None])[1],
        }
    return None


def _catalog_concurrent_capacity(catalog):
    block = (catalog or {}).get("block", "")
    match = re.search(r"capacity:\s*Object\.freeze\(\{[^}]*?concurrentUsers:\s*(\d+)", block, flags=re.S)
    if not match:
        return 1
    try:
        return max(1, int(match.group(1)))
    except (TypeError, ValueError):
        return 1


def _catalog_is_api_service_queue(catalog, catalog_id=None):
    queue_spot = _catalog_queue_spot(catalog)
    if not queue_spot:
        return False
    identifiers = {_normalize_token((catalog or {}).get("id")), _normalize_token(catalog_id)}
    return any(identifier in WORLD_API_SERVICE_QUEUE_CATALOG_IDS for identifier in identifiers if identifier)


def _normalize_reservation_status(action):
    status = _canonical_world_action_status(action.get("status"))
    if status == "in_progress":
        return "in_use"
    return "reserved"


def _reservation_sort_key(action):
    timing = action.get("timing") if isinstance(action.get("timing"), dict) else {}
    return (timing.get("createdAt") or timing.get("updatedAt") or "", action.get("id") or "")


def _active_reservations_for(store, object_id, spot_id=None):
    reservations = []
    for active in sorted(store.get("active", []), key=_reservation_sort_key):
        reservation = active.get("reservation") if isinstance(active.get("reservation"), dict) else {}
        target = active.get("target") if isinstance(active.get("target"), dict) else {}
        if reservation.get("objectInstanceId") != object_id and target.get("objectInstanceId") != object_id:
            continue
        if spot_id is not None and reservation.get("spotId") != spot_id and target.get("interactionSpotId") != spot_id:
            continue
        state = reservation.get("state") or _normalize_reservation_status(active)
        if state not in WORLD_RESERVATION_ACTIVE_STATES:
            continue
        reservations.append({"action": active, "reservation": reservation})
    return reservations


def _reservation_is_queue(reservation):
    if not isinstance(reservation, dict):
        return False
    if reservation.get("capacityKind") == "queue" or reservation.get("queueSpotId"):
        return True
    state = str(reservation.get("state") or reservation.get("status") or "").lower()
    slot_id = str(reservation.get("slotId") or "")
    return state == "queued" or bool(re.search(r":\d+$", slot_id))


def _queue_availability_for(catalog, target, object_id, *, store=None, agent_id=None):
    queue_spot = _catalog_queue_spot(catalog)
    if not queue_spot or not object_id:
        return None
    requested_spot_id = target.get("interactionSpotId") or target.get("spotId")
    if requested_spot_id == queue_spot.get("id"):
        return None
    store = store if isinstance(store, dict) else get_world_actions_store(persist_migration=True)
    queue_reservations = [
        row for row in _active_reservations_for(store, object_id, queue_spot.get("id"))
        if _reservation_is_queue(row.get("reservation"))
    ]
    for row in queue_reservations:
        if row["action"].get("agentId") == agent_id:
            return {"state": "reserved", "reason": "duplicate_queue_action", "conflicts": [{"actionId": row["action"].get("id"), "agentId": agent_id}], "queue": None}
    occupied = set()
    for row in queue_reservations:
        slot_id = str((row.get("reservation") or {}).get("slotId") or "")
        match = re.search(r":(\d+)$", slot_id)
        if match:
            occupied.add(int(match.group(1)))
    capacity = max(1, int(queue_spot.get("capacity") or 1))
    next_index = next((index for index in range(capacity) if index not in occupied), None)
    if next_index is None:
        return {"state": "reserved", "reason": "queue_full", "conflicts": [{"actionId": row["action"].get("id"), "agentId": row["action"].get("agentId"), "slotId": (row.get("reservation") or {}).get("slotId"), "state": (row.get("reservation") or {}).get("state")} for row in queue_reservations], "queue": {"spotId": queue_spot.get("id"), "capacity": capacity}}
    return {
        "state": "available",
        "reason": None,
        "conflicts": [{"actionId": row["action"].get("id"), "agentId": row["action"].get("agentId"), "slotId": (row.get("reservation") or {}).get("slotId"), "state": (row.get("reservation") or {}).get("state")} for row in queue_reservations],
        "queue": {
            "spotId": queue_spot.get("id"),
            "slotId": f"{queue_spot.get('id')}:{next_index}",
            "index": next_index,
            "capacity": capacity,
            "action": queue_spot.get("action"),
        },
    }


def _queued_reservation_sort_key(action):
    reservation = action.get("reservation") if isinstance(action.get("reservation"), dict) else {}
    return (reservation.get("queuedAt") or (action.get("timing") or {}).get("queuedAt") or "", int(reservation.get("queueIndex") or 0), action.get("id") or "")


def _renumber_api_service_queue(active, object_id):
    queued_indexes = [
        index for index, action in enumerate(active)
        if isinstance(action.get("reservation"), dict)
        and action["reservation"].get("objectInstanceId") == object_id
        and action["reservation"].get("state") == "queued"
    ]
    sorted_indexes = sorted(queued_indexes, key=lambda index: _queued_reservation_sort_key(active[index]))
    for queue_index, action_index in enumerate(sorted_indexes):
        action = dict(active[action_index])
        reservation = dict(action.get("reservation") or {})
        queue_spot_id = reservation.get("queueSpotId") or reservation.get("spotId") or "queue"
        queue_slot_id = f"{queue_spot_id}:{queue_index}"
        reservation.update({"queueIndex": queue_index, "slotId": queue_slot_id, "spotId": queue_spot_id, "capacityKind": "queue"})
        action["reservation"] = reservation
        target = dict(action.get("target") or {})
        target["interactionSpotId"] = queue_spot_id
        queue_meta = dict(target.get("queue") or {})
        queue_meta.update({"spotId": queue_spot_id, "slotId": queue_slot_id, "index": queue_index})
        target["queue"] = queue_meta
        action["target"] = target
        route = dict(action.get("route") or {})
        if isinstance(route.get("target"), dict):
            route_target = dict(route.get("target") or {})
            route_target["interactionSpotId"] = queue_spot_id
            route_target["queue"] = queue_meta
            route["target"] = route_target
        if route:
            action["route"] = route
        active[action_index] = action
    return active


def _promote_next_api_service_queue_action(active, completed_action, now, reason="service-queue-promote-front"):
    reservation = completed_action.get("reservation") if isinstance(completed_action.get("reservation"), dict) else {}
    object_id = reservation.get("objectInstanceId") or (completed_action.get("target") or {}).get("objectInstanceId")
    if not object_id:
        return active
    if reservation.get("state") == "queued":
        return _renumber_api_service_queue(active, object_id)
    queued_indexes = [
        index for index, action in enumerate(active)
        if isinstance(action.get("reservation"), dict)
        and action["reservation"].get("objectInstanceId") == object_id
        and action["reservation"].get("state") == "queued"
    ]
    if not queued_indexes:
        return active
    promote_index = sorted(queued_indexes, key=lambda index: _queued_reservation_sort_key(active[index]))[0]
    promoted = dict(active[promote_index])
    promoted_reservation = dict(promoted.get("reservation") or {})
    requested_spot_id = promoted_reservation.get("requestedSpotId") or (promoted.get("target") or {}).get("requestedInteractionSpotId") or promoted_reservation.get("spotId")
    promoted_reservation.update({
        "state": "reserved",
        "status": "held",
        "availabilityState": "reserved",
        "spotId": requested_spot_id,
        "slotId": "slot-1",
        "promotedAt": now,
        "promotedFromQueue": True,
    })
    promoted["reservation"] = promoted_reservation
    promoted_target = dict(promoted.get("target") or {})
    promoted_target["interactionSpotId"] = requested_spot_id
    promoted_target["previousQueue"] = promoted_target.get("queue")
    promoted_target.pop("queue", None)
    promoted["target"] = promoted_target
    promoted_route = dict(promoted.get("route") or {})
    if promoted_route:
        promoted_route["state"] = "route_pending"
        promoted_route["setAgentTarget"] = True
        if isinstance(promoted_route.get("target"), dict):
            route_target = dict(promoted_route.get("target") or {})
            route_target["interactionSpotId"] = requested_spot_id
            route_target["previousQueue"] = route_target.get("queue")
            route_target.pop("queue", None)
            promoted_route["target"] = route_target
        promoted["route"] = promoted_route
    effects = list(promoted.get("effects") or [])
    effects.append({"type": "service-queue-promoted", "at": now, "from": "queued", "to": "reserved", "reason": reason})
    promoted["effects"] = effects
    promoted = _append_world_action_events(promoted, [
        _world_action_event_payload(promoted, "object-reserved", now, from_status="queued", to_status="reserved", reason=reason, result=promoted.get("result"), reservation=promoted.get("reservation"), actor="server.py#promote_api_service_queue", source="reservation"),
    ])
    active[promote_index] = promoted
    return _renumber_api_service_queue(active, object_id)


def _target_deleted_or_missing(target, resolved):
    if resolved:
        obj = resolved.get("object") if isinstance(resolved, dict) else None
        if isinstance(obj, dict) and (obj.get("deleted") is True or str(obj.get("status") or obj.get("state") or "").lower() == "deleted"):
            return "deleted"
        return None
    return "deleted" if isinstance(target, dict) and target.get("deleted") is True else "missing"


def get_object_availability(target, *, agent_id=None, store=None, resolved=None):
    target = target if isinstance(target, dict) else {}
    kind = target.get("kind") or "object-instance"
    if kind != "object-instance":
        return {"state": "available", "reason": None, "capacity": {"spot": 1, "object": 1}, "conflicts": [], "reservationSlot": None}
    resolved = resolved if resolved is not None else _find_world_action_target(target)
    missing_state = _target_deleted_or_missing(target, resolved)
    if missing_state:
        return {"state": missing_state, "reason": f"target_{missing_state}", "capacity": {"spot": 0, "object": 0}, "conflicts": [], "reservationSlot": None}
    obj = resolved.get("object") if isinstance(resolved, dict) else None
    status = str((obj or {}).get("status") or (obj or {}).get("state") or "").lower()
    if isinstance(obj, dict) and ((obj.get("disabled") is True) or status in {"disabled", "broken", "offline", "inactive"}):
        return {"state": "disabled", "reason": "target_disabled", "capacity": {"spot": 0, "object": 0}, "conflicts": [], "reservationSlot": None}
    if status == "blocked":
        return {"state": "blocked", "reason": "target_blocked", "capacity": {"spot": 0, "object": 0}, "conflicts": [], "reservationSlot": None}

    catalog_id = target.get("catalogId") or _object_catalog_id(obj)
    catalog = _catalog_block_for(catalog_id)
    object_id = target.get("objectInstanceId") or target.get("id") or ((resolved.get("candidateIds") or [None])[0] if isinstance(resolved, dict) else None)
    spot_id = target.get("interactionSpotId") or target.get("spotId")
    spot_capacity = _catalog_spot_capacity(catalog, spot_id)
    object_capacity = _catalog_concurrent_capacity(catalog)
    store = store if isinstance(store, dict) else get_world_actions_store(persist_migration=True)
    spot_reservations = _active_reservations_for(store, object_id, spot_id)
    object_reservations = [row for row in _active_reservations_for(store, object_id, None) if not _reservation_is_queue(row.get("reservation"))]
    conflict_rows = []
    occupied_slots = set()
    in_use = False
    for row in spot_reservations:
        action = row["action"]
        reservation = row["reservation"]
        slot_id = reservation.get("slotId") or "slot-1"
        occupied_slots.add(slot_id)
        state = reservation.get("state") or _normalize_reservation_status(action)
        in_use = in_use or state == "in_use" or _canonical_world_action_status(action.get("status")) == "in_progress"
        conflict_rows.append({"actionId": action.get("id"), "agentId": action.get("agentId"), "slotId": slot_id, "state": state})
    next_slot = None
    for index in range(1, spot_capacity + 1):
        candidate = f"slot-{index}"
        if candidate not in occupied_slots:
            next_slot = candidate
            break
    object_full = len(object_reservations) >= object_capacity and not any(row["action"].get("agentId") == agent_id for row in object_reservations)
    spot_full = next_slot is None and not any(row["action"].get("agentId") == agent_id for row in spot_reservations)
    queue_available = _queue_availability_for(catalog, target, object_id, store=store, agent_id=agent_id) if _catalog_is_api_service_queue(catalog, catalog_id) else None
    if queue_available and queue_available.get("conflicts") and not _reservation_is_queue({"spotId": spot_id}):
        return {"state": "reserved", "reason": "queue_pending", "capacity": {"spot": spot_capacity, "object": object_capacity}, "conflicts": queue_available.get("conflicts", []), "reservationSlot": None, "queueAvailability": queue_available}
    if object_full or spot_full:
        result = {"state": "in_use" if in_use else "reserved", "reason": "object_reserved", "capacity": {"spot": spot_capacity, "object": object_capacity}, "conflicts": conflict_rows, "reservationSlot": None}
        if queue_available:
            result["queueAvailability"] = queue_available
        return result
    return {"state": "available", "reason": None, "capacity": {"spot": spot_capacity, "object": object_capacity}, "conflicts": conflict_rows, "reservationSlot": next_slot or "slot-1", "queueAvailability": queue_available}


def _object_catalog_id(obj):
    if not isinstance(obj, dict):
        return None
    return obj.get("catalogId") or obj.get("objectCatalogId") or obj.get("assetId") or obj.get("renderType") or obj.get("type")


def _candidate_object_ids(building, obj, index, collection):
    building_id = building.get("id") if isinstance(building, dict) else None
    catalog_id = _object_catalog_id(obj)
    explicit = [obj.get(k) for k in ("objectInstanceId", "instanceId", "id", "nodeId") if isinstance(obj.get(k), str)]
    # Once a placed object has a stable id, index-derived ids are intentionally
    # not aliases. Otherwise deleting item N can make a stale target like
    # building:12 resolve to the different object that shifted into slot 12.
    if explicit:
        return {str(v) for v in explicit if v and str(v) != "None"}
    generated = [
        f"{building_id}:{index}",
        f"{building_id}-{index}",
        f"{building_id}:{collection}:{index}",
        f"{building_id}-{collection}-{index}",
        f"{building_id}:{catalog_id}:{index}",
        f"{building_id}-{catalog_id}-{index}",
        f"{catalog_id}-{index}",
    ]
    return {str(v) for v in generated if v and str(v) != "None"}


def _find_world_action_target(target):
    if not isinstance(target, dict):
        return None
    kind = target.get("kind") or "object-instance"
    building_id = target.get("buildingId")
    buildings = [load_building(building_id)] if building_id else list_buildings()
    buildings = [b for b in buildings if isinstance(b, dict)]
    if kind == "building":
        building = buildings[0] if buildings else None
        return {"kind": "building", "building": building, "object": None, "collection": None, "index": None} if building else None
    if kind == "room":
        return None
    if kind == "world-point":
        return {"kind": "world-point", "building": None, "object": None, "collection": None, "index": None}
    wanted_id = str(target.get("objectInstanceId") or target.get("id") or "")
    wanted_catalog = _normalize_token(target.get("catalogId") or target.get("objectCatalogId") or "")
    for building in buildings:
        for collection, records in (("furniture", ((building.get("interior") or {}).get("furniture") or [])), ("outdoor-node", ((building.get("outdoorArea") or {}).get("nodes") or []))):
            if not isinstance(records, list):
                continue
            for index, obj in enumerate(records):
                if not isinstance(obj, dict):
                    continue
                ids = _candidate_object_ids(building, obj, index, collection)
                catalog_matches = not wanted_catalog or wanted_catalog == _normalize_token(_object_catalog_id(obj))
                explicit_index = target.get("furnitureIndex") if collection == "furniture" else target.get("nodeIndex")
                index_matches = explicit_index is not None and int(explicit_index) == index
                if (wanted_id and wanted_id in ids and catalog_matches) or (not wanted_id and index_matches and catalog_matches):
                    return {"kind": "object-instance", "building": building, "object": obj, "collection": collection, "index": index, "candidateIds": sorted(ids)}
    return None


def _resolve_agent_id(agent_id):
    wanted = str(agent_id or "").strip()
    if not wanted:
        return None
    for agent in get_roster():
        candidates = {str(agent.get("id") or ""), str(agent.get("statusKey") or "")}
        if wanted in candidates:
            return str(agent.get("statusKey") or agent.get("id"))
    return None


def _source_roles(source):
    if not isinstance(source, dict):
        return set()
    roles = source.get("roles") or source.get("worldRoles") or []
    if not isinstance(roles, list):
        return set()
    inherited = set(str(r).strip().lower() for r in roles if str(r).strip())
    if "owner" in inherited:
        inherited.update(["admin", "manager", "assigned", "participant"])
    if "admin" in inherited:
        inherited.update(["manager", "assigned", "participant"])
    if "manager" in inherited:
        inherited.update(["assigned", "participant"])
    if "assigned" in inherited:
        inherited.add("participant")
    return inherited


def _permission_allows(level, agent_id, source, target_obj):
    level = level or "public"
    if level == "public":
        return True, None
    roles = _source_roles(source)
    if isinstance(source, dict) and source.get("kind") in {"system", "api"} and source.get("trusted") is True:
        return True, None
    if level == "assigned-role":
        assigned = []
        if isinstance(target_obj, dict):
            permissions = target_obj.get("permissions") if isinstance(target_obj.get("permissions"), dict) else {}
            assigned.extend(target_obj.get("assignedAgentIds") or permissions.get("assignedAgentIds") or [])
            assigned.extend([target_obj.get("assignedTo")] if target_obj.get("assignedTo") else [])
        if agent_id in {str(x) for x in assigned} or roles.intersection({"assigned", "manager", "admin", "owner"}):
            return True, None
        return False, "assigned-role permission requires the agent to be assigned or the source to carry assigned/manager/admin/owner world roles"
    if level == "manager" and roles.intersection({"manager", "admin", "owner"}):
        return True, None
    if level == "admin" and roles.intersection({"admin", "owner"}):
        return True, None
    if level == "owner-only" and "owner" in roles:
        return True, None
    return False, f"{level} permission was not satisfied by the selected source"


def _validate_create_world_action_payload(payload):
    if not isinstance(payload, dict):
        return None, _api_error("invalid_payload", "world action create payload must be an object")
    errors = []
    source = payload.get("source") if isinstance(payload.get("source"), dict) else None
    target = payload.get("target") if isinstance(payload.get("target"), dict) else None
    behavior = None
    if not source:
        errors.append("source must be an object with kind and requestedBy/requestId metadata")
    else:
        behavior, behavior_error = _normalize_behavior_metadata(payload, source, target)
        if behavior_error:
            return None, behavior_error
        source = _source_snapshot_with_behavior(source, behavior)
    agent_id = _resolve_agent_id(payload.get("agentId"))
    if not agent_id:
        errors.append("agentId must reference an existing agent id or statusKey")
    if agent_id and isinstance(source, dict) and source.get("kind") == "agent-live-mode":
        setting = get_agent_live_mode_setting(agent_id)
        if not setting or setting.get("agentLiveModeEnabled") is not True:
            return None, _agent_live_mode_disabled_error(agent_id)
    action_type = str(payload.get("actionType") or payload.get("actionId") or "").strip()
    if not action_type:
        errors.append("actionType must be a non-empty string")
    capability = _normalize_capability_tag(payload.get("capabilityTag"))
    if not capability:
        errors.append("capabilityTag must be a known capability tag")
    params = payload.get("params", {})
    if not isinstance(params, dict):
        errors.append("params must be an object when present")
    ui_context = payload.get("uiContext", None)
    if ui_context is not None and not isinstance(ui_context, dict):
        errors.append("uiContext must be an object when present")
    if not target:
        errors.append("target must be an object")
    elif (target.get("kind") or "object-instance") == "room":
        errors.append("room targets are not supported until canonical room ids exist; use building/floor or object target")
    resolved = _find_world_action_target(target) if target else None
    if target and not resolved:
        errors.append("target does not exist in persisted buildings/objects")
    if errors:
        return None, _api_error("invalid_request", "World action could not be created.", details=errors)

    target_kind = target.get("kind") or "object-instance"
    target_obj = resolved.get("object") if resolved else None
    catalog_id = target.get("catalogId") or _object_catalog_id(target_obj) or target_kind
    catalog = _catalog_block_for(catalog_id) if target_kind == "object-instance" else None
    if target_kind == "object-instance" and not catalog:
        return None, _api_error("unsupported_target", "Target catalog is not known to the object catalog registry.", details={"catalogId": catalog_id})
    action_permission = _catalog_action_permission(catalog, action_type, capability) if catalog else {"actionType": action_type, "capabilityTag": capability, "permissionLevel": "public"}
    if target_kind == "object-instance" and not action_permission:
        return None, _api_error("unsupported_capability", "Target does not expose the requested capability/action.", details={"catalogId": catalog_id, "actionType": action_type, "capabilityTag": capability})
    if target_kind == "object-instance" and action_permission.get("capabilityTag") != capability:
        return None, _api_error("unsupported_capability", "Requested capabilityTag does not match the target action capability.", details=action_permission)
    spot_id = target.get("interactionSpotId") or target.get("spotId")
    if target_kind == "object-instance" and not _catalog_has_spot(catalog, spot_id, action_type):
        return None, _api_error("missing_interaction_spot", "Target does not expose the requested interaction/action spot.", details={"interactionSpotId": spot_id, "catalogId": catalog_id})
    allowed, deny_reason = _permission_allows(action_permission.get("permissionLevel"), agent_id, source, target_obj)
    if not allowed:
        return None, _api_error("permission_denied", "World action is not allowed from the selected source.", details=deny_reason)

    store = get_world_actions_store(persist_migration=True)
    request_id = source.get("requestId") if isinstance(source, dict) else None
    object_id = target.get("objectInstanceId") or target.get("id") or (resolved.get("candidateIds") or [None])[0]
    for active in store.get("active", []):
        active_source = active.get("source") if isinstance(active.get("source"), dict) else {}
        active_target = active.get("target") if isinstance(active.get("target"), dict) else {}
        if request_id and active_source.get("requestId") == request_id:
            return None, _api_error("duplicate_action", "A world action with this source.requestId already exists.", details={"actionId": active.get("id")})
        if active.get("agentId") == agent_id and active_target.get("objectInstanceId") == object_id and active_target.get("interactionSpotId") == spot_id:
            return None, _api_error("duplicate_action", "This agent already has an active action for the requested target/spot.", details={"actionId": active.get("id")})
    availability = get_object_availability({**target, "objectInstanceId": object_id, "catalogId": catalog_id, "interactionSpotId": spot_id}, agent_id=agent_id, store=store, resolved=resolved)
    queue_availability = availability.get("queueAvailability") if isinstance(availability.get("queueAvailability"), dict) else None
    queue_details = queue_availability.get("queue") if availability.get("state") in {"reserved", "in_use"} and isinstance(queue_availability, dict) and queue_availability.get("state") == "available" and isinstance(queue_availability.get("queue"), dict) else None
    if availability.get("state") in {"disabled", "blocked", "missing", "deleted"}:
        code = "target_disabled" if availability.get("state") == "disabled" else f"target_{availability.get('state')}"
        return None, _api_error(code, "Target is not available for world action reservation.", details=availability)
    if availability.get("state") in {"reserved", "in_use"}:
        if not queue_details:
            return None, _api_error("object_reserved", "Target interaction spot/capacity slot is already reserved by another active action.", details=availability)

    now = _utc_now_iso()
    safe_action = re.sub(r"[^A-Za-z0-9_.-]+", "-", action_type).strip("-") or "action"
    action_id = str(payload.get("id") or f"wa-{int(time.time() * 1000)}-{agent_id}-{safe_action}")
    building = resolved.get("building") if resolved else None
    target_snapshot = dict(target)
    target_snapshot["kind"] = target_kind
    target_snapshot["catalogId"] = catalog_id
    if target_kind == "object-instance":
        target_snapshot["objectInstanceId"] = object_id or (resolved.get("candidateIds") or [None])[0]
        target_snapshot["interactionSpotId"] = spot_id
        target_snapshot["buildingId"] = target.get("buildingId") or (building or {}).get("id")
        target_snapshot["floor"] = int(target.get("floor") or (target_obj or {}).get("floor") or (target_obj or {}).get("level") or 1)
        target_snapshot["roomId"] = target.get("roomId") if target.get("roomId") is not None else (target_obj or {}).get("roomId")
        if queue_details:
            target_snapshot["requestedInteractionSpotId"] = spot_id
            target_snapshot["interactionSpotId"] = queue_details.get("spotId")
            target_snapshot["queue"] = {"spotId": queue_details.get("spotId"), "slotId": queue_details.get("slotId"), "index": queue_details.get("index"), "capacity": queue_details.get("capacity"), "action": queue_details.get("action")}
    behavior = behavior or {}
    route_behavior = {k: behavior.get(k) for k in ["behaviorSourceKind", "behaviorMode", "behaviorAuthority", "behaviorSelectedCategory", "behaviorSelectedObject", "behaviorSelectedSpot", "behaviorProbabilityRoll", "behaviorFallbackReason"]}
    route_target = {"target": target_snapshot, "handoff": WORLD_ACTION_CREATE_ROUTE_OWNER, "routeOwner": "client-runtime", "setAgentTarget": True, "source": source, "behavior": route_behavior, "behaviorSourceKind": behavior.get("behaviorSourceKind"), "behaviorMode": behavior.get("behaviorMode"), "behaviorCategory": behavior.get("behaviorSelectedCategory")}
    action = {
        "id": action_id,
        "actionType": action_type,
        "agentId": agent_id,
        "source": source,
        "behaviorSourceKind": behavior.get("behaviorSourceKind"),
        "behaviorMode": behavior.get("behaviorMode"),
        "behaviorAuthority": behavior.get("behaviorAuthority"),
        "behaviorCategory": behavior.get("behaviorSelectedCategory"),
        "status": "reserved",
        "target": target_snapshot,
        "capabilityTag": capability,
        "priority": payload.get("priority") if payload.get("priority") in WORLD_ACTION_PRIORITIES else "normal",
        "permission": {"level": action_permission.get("permissionLevel"), "checked": True, "deniedReason": None, "source": "agent-life-object-catalog-schema.mjs#apiActions.permission"},
        "timing": {"createdAt": now, "updatedAt": now, "requestedAt": now, "reservedAt": now, "queuedAt": now, "timeoutMs": payload.get("timeoutMs") if isinstance(payload.get("timeoutMs"), (int, float)) and payload.get("timeoutMs") >= 0 else None},
        "lifecycle": {"previousStatus": "created", "allowedNext": _world_action_allowed_next("reserved"), "transitionLog": [
            {"at": now, "from": None, "to": "requested", "actor": _transition_actor(source, None), "source": source.get("behaviorSourceKind") or source.get("kind"), "behavior": route_behavior, "reason": "requested"},
            {"at": now, "from": "requested", "to": "created", "actor": "server.py#create_world_action", "source": source.get("behaviorSourceKind") or "api", "behavior": route_behavior, "reason": "validated"},
            {"at": now, "from": "created", "to": "reserved", "actor": "server.py#create_world_action", "source": "reservation", "behavior": route_behavior, "reason": "object-reserved"},
        ]},
        "reservation": {
            "id": f"res-{action_id}-{target_snapshot.get('objectInstanceId')}-{target_snapshot.get('interactionSpotId')}-{queue_details.get('slotId') if queue_details else availability.get('reservationSlot')}",
            "state": "queued" if queue_details else "reserved",
            "status": "queued" if queue_details else "held",
            "availabilityState": "reserved",
            "actionId": action_id,
            "actionType": action_type,
            "agentId": agent_id,
            "objectInstanceId": target_snapshot.get("objectInstanceId"),
            "spotId": target_snapshot.get("interactionSpotId"),
            "slotId": queue_details.get("slotId") if queue_details else (availability.get("reservationSlot") or "slot-1"),
            **({"requestedSpotId": spot_id, "queueSpotId": queue_details.get("spotId"), "queueIndex": queue_details.get("index"), "capacityKind": "queue"} if queue_details else {}),
            "capacity": availability.get("capacity"),
            "reservedAt": now,
            **({"queuedAt": now} if queue_details else {}),
        },
        "route": {"id": f"route-{action_id}", "state": "route_pending", **route_target},
        "params": params,
        "result": {"status": "pending"},
        "events": [],
        "audit": {"schemaVersion": WORLD_ACTION_SCHEMA_VERSION, "stateMachineVersion": WORLD_ACTION_STATE_MACHINE_VERSION, "createVersion": WORLD_ACTION_CREATE_VERSION, "eventHooksVersion": WORLD_ACTION_EVENT_HOOKS_VERSION, "reuseDecisions": [*WORLD_ACTION_CREATE_REUSE_NOTES, *WORLD_ACTION_EVENT_REUSE_NOTES], "routeGuardrails": WORLD_ACTION_EVENT_ROUTE_GUARDRAILS},
    }
    if ui_context is not None:
        action["uiContext"] = ui_context
    record_errors = validate_world_action_record(action, expected_bucket="active")
    if record_errors:
        return None, _api_error("invalid_action_record", "Created world action failed schema validation.", details=record_errors)
    return action, None


def create_world_action(payload):
    action, error = _validate_create_world_action_payload(payload)
    if error:
        code = (error.get("error") or {}).get("code")
        status = {
            "invalid_payload": 400,
            "invalid_request": 400,
            "invalid_behavior_source": 400,
            "invalid_behavior_mode": 400,
            "invalid_behavior_category": 400,
            "unsupported_target": 422,
            "unsupported_capability": 422,
            "missing_interaction_spot": 422,
            "target_disabled": 409,
            "target_blocked": 409,
            "target_missing": 404,
            "target_deleted": 410,
            "permission_denied": 403,
            "agent_live_mode_disabled": 403,
            "duplicate_action": 409,
            "object_reserved": 409,
            "invalid_action_record": 500,
        }.get(code, 400)
        return False, error, status
    now = action.get("timing", {}).get("createdAt") if isinstance(action.get("timing"), dict) else _utc_now_iso()
    action = _append_world_action_events(action, [
        _world_action_event_payload(action, "action-created", now, from_status=None, to_status="created", reason="validated", result=action.get("result"), source="api", actor="server.py#create_world_action"),
        _world_action_event_payload(action, "object-reserved", now, from_status="created", to_status="reserved", reason="object-reserved", result=action.get("result"), reservation=action.get("reservation"), source="reservation", actor="server.py#create_world_action"),
    ])
    store = get_world_actions_store(persist_migration=True)
    ok, saved = save_world_actions_store({"active": [*store.get("active", []), action], "history": store.get("history", [])})
    if not ok:
        return False, _api_error("invalid_action_record", "World action could not be persisted.", details=saved), 500
    return True, {"ok": True, "action": action, "worldActions": {"activeCount": len(saved.get("active", [])), "historyCount": len(saved.get("history", []))}, "routeHandoff": action.get("route")}, 201

# ─── AGENT MOVE INTENT API ───────────────────────────────────────
def default_move_intents_store():
    return {"schemaVersion": MOVE_INTENT_SCHEMA_VERSION, "active": [], "history": []}


def get_move_intents_store(*, persist_migration=False):
    meta = load_world_meta()
    agent_life = meta.get("agentLife") if isinstance(meta.get("agentLife"), dict) else {}
    store = agent_life.get("moveIntents") if isinstance(agent_life.get("moveIntents"), dict) else None
    changed = store is None
    if not store:
        store = default_move_intents_store()
    active = [row for row in store.get("active", []) if isinstance(row, dict)]
    history = [row for row in store.get("history", []) if isinstance(row, dict)]
    next_store = {"schemaVersion": MOVE_INTENT_SCHEMA_VERSION, "active": active, "history": history[-1000:]}
    if persist_migration and changed:
        agent_life["moveIntents"] = next_store
        meta["agentLife"] = agent_life
        save_world_meta(meta)
    return next_store


def save_move_intents_store(store):
    meta = load_world_meta()
    agent_life = meta.get("agentLife") if isinstance(meta.get("agentLife"), dict) else {}
    next_store = default_move_intents_store()
    next_store["active"] = [row for row in (store.get("active") if isinstance(store, dict) else []) if isinstance(row, dict)]
    next_store["history"] = [row for row in (store.get("history") if isinstance(store, dict) else []) if isinstance(row, dict)][-1000:]
    next_store["lastSavedAt"] = _utc_now_iso()
    agent_life["moveIntents"] = next_store
    meta["agentLife"] = agent_life
    save_world_meta(meta)
    return True, next_store


def _building_unavailable(building):
    if not isinstance(building, dict):
        return "building_missing"
    status = str(building.get("status") or building.get("state") or "").lower()
    if building.get("deleted") is True or status == "deleted":
        return "building_deleted"
    if building.get("disabled") is True or status in {"disabled", "offline", "closed", "inactive", "unavailable"}:
        return "building_unavailable"
    if status == "blocked":
        return "target_blocked"
    return None


def _spot_blocked(obj, spot_id):
    if not isinstance(obj, dict) or not spot_id:
        return False
    spot_id = str(spot_id)
    blocked_lists = [obj.get("blockedSpots"), obj.get("disabledSpots"), obj.get("unavailableSpots")]
    state = obj.get("state") if isinstance(obj.get("state"), dict) else {}
    blocked_lists.extend([state.get("blockedSpots"), state.get("disabledSpots"), state.get("unavailableSpots")])
    for value in blocked_lists:
        if isinstance(value, list) and spot_id in {str(v) for v in value}:
            return True
        if isinstance(value, dict) and value.get(spot_id):
            return True
    spots = obj.get("spots") if isinstance(obj.get("spots"), dict) else state.get("spots") if isinstance(state.get("spots"), dict) else {}
    spot_state = spots.get(spot_id) if isinstance(spots, dict) else None
    if isinstance(spot_state, dict):
        status = str(spot_state.get("status") or spot_state.get("state") or "").lower()
        return status in {"blocked", "disabled", "unavailable", "deleted"}
    return False


def _move_intent_id(agent_id):
    return f"move-{int(time.time() * 1000)}-{re.sub(r'[^A-Za-z0-9_.-]+', '-', str(agent_id)).strip('-') or 'agent'}"


def _number_or_none(value):
    if isinstance(value, (int, float)) and not isinstance(value, bool):
        return float(value)
    if isinstance(value, str) and value.strip():
        try:
            return float(value)
        except ValueError:
            return None
    return None


def _active_world_action_for_move(action_id, agent_id):
    if not action_id:
        return None
    store = get_world_actions_store(persist_migration=True)
    for action in store.get("active", []):
        if action.get("id") == action_id and action.get("agentId") == agent_id:
            return _normalize_world_action_record(action)
    return None


def _move_target_invalid_reason(target):
    if not isinstance(target, dict):
        return "target_missing"
    kind = target.get("kind") or "object-instance"
    if kind == "world-point":
        building_id = target.get("buildingId")
        if building_id:
            return _building_unavailable(load_building(building_id))
        return None
    building_id = target.get("buildingId")
    if kind in {"building", "room"}:
        return _building_unavailable(load_building(building_id))
    resolved = _find_world_action_target(target)
    if not resolved:
        return "target_missing"
    building_reason = _building_unavailable(resolved.get("building"))
    if building_reason:
        return building_reason
    obj = resolved.get("object")
    missing_state = _target_deleted_or_missing(target, resolved)
    if missing_state:
        return f"target_{missing_state}"
    status = str((obj or {}).get("status") or (obj or {}).get("state") or "").lower()
    if isinstance(obj, dict) and (obj.get("deleted") is True or status == "deleted"):
        return "target_deleted"
    if isinstance(obj, dict) and (obj.get("disabled") is True or status in {"disabled", "broken", "offline", "inactive"}):
        return "target_disabled"
    if status == "blocked" or _spot_blocked(obj, target.get("interactionSpotId") or target.get("spotId")):
        return "target_blocked"
    return None


def reconcile_move_intents():
    store = get_move_intents_store(persist_migration=True)
    now = _utc_now_iso()
    active = []
    history = list(store.get("history", []))
    changed = False
    for intent in store.get("active", []):
        reason = _move_target_invalid_reason(intent.get("target"))
        if reason:
            failed = dict(intent)
            failed.update({"status": "invalidated", "routeStatus": "failed", "failureReason": reason, "invalidatedAt": now, "updatedAt": now})
            route = dict(failed.get("route") or {})
            route.update({"state": "failed", "status": "failed", "setAgentTarget": False, "failureReason": reason})
            failed["route"] = route
            history.append(failed)
            changed = True
        else:
            active.append(intent)
    next_store = {"active": active, "history": history}
    if changed:
        _, next_store = save_move_intents_store(next_store)
    return next_store


def _agent_busy_for_move(agent_id, action_id=None):
    for action in get_world_actions_store(persist_migration=True).get("active", []):
        if action.get("agentId") != agent_id:
            continue
        status = _canonical_world_action_status(action.get("status"))
        if status in WORLD_ACTION_ACTIVE_STATES and (not action_id or action.get("id") != action_id):
            return {"type": "world-action", "id": action.get("id"), "status": status}
    for intent in reconcile_move_intents().get("active", []):
        if intent.get("agentId") == agent_id and intent.get("routeStatus") in MOVE_INTENT_ACTIVE_STATES and (not action_id or intent.get("actionId") != action_id):
            return {"type": "move-intent", "id": intent.get("id"), "status": intent.get("routeStatus")}
    return None


def _behavior_source_kind_from_record(record):
    source = record.get("source") if isinstance(record, dict) and isinstance(record.get("source"), dict) else {}
    return record.get("behaviorSourceKind") or source.get("behaviorSourceKind") or source.get("kind")


def _active_behavior_records_for_agent(agent_id):
    records = []
    for action in get_world_actions_store(persist_migration=True).get("active", []):
        if action.get("agentId") != agent_id:
            continue
        status = _canonical_world_action_status(action.get("status"))
        if status in WORLD_ACTION_ACTIVE_STATES:
            records.append({"type": "world-action", "id": action.get("id"), "status": status, "behaviorSourceKind": _behavior_source_kind_from_record(action), "record": action})
    for intent in reconcile_move_intents().get("active", []):
        if intent.get("agentId") != agent_id or intent.get("routeStatus") not in MOVE_INTENT_ACTIVE_STATES:
            continue
        records.append({"type": "move-intent", "id": intent.get("id"), "status": intent.get("routeStatus"), "behaviorSourceKind": _behavior_source_kind_from_record(intent), "record": intent})
    return records


def _interrupt_scripted_move_intent(intent_id, *, reason="interrupted_by_agent_live_mode"):
    if not intent_id:
        return None
    store = get_move_intents_store(persist_migration=True)
    now = _utc_now_iso()
    active = []
    interrupted = None
    for intent in store.get("active", []):
        if intent.get("id") != intent_id:
            active.append(intent)
            continue
        interrupted = dict(intent)
        route = dict(interrupted.get("route") or {})
        route.update({"state": "cancelled", "status": "cancelled", "setAgentTarget": False, "cancelledAt": now, "reason": reason})
        interrupted.update({"status": "cancelled", "routeStatus": "cancelled", "failureReason": "cancelled_by_system", "interruptedBy": "agent-live-mode", "interruptedAt": now, "updatedAt": now, "route": route})
    if interrupted:
        ok, saved = save_move_intents_store({"active": active, "history": [interrupted, *store.get("history", [])]})
        if not ok:
            return {"type": "move-intent", "id": intent_id, "error": "persist_failed", "details": saved}
        return {"type": "move-intent", "id": intent_id, "status": "cancelled", "reason": reason}
    return None


def _prepare_agent_live_mode_action_call(agent_id):
    interrupted = []
    for active in _active_behavior_records_for_agent(agent_id):
        source_kind = active.get("behaviorSourceKind")
        if source_kind == "user":
            return None, _api_error("active_user_directed_intent", "Agent Live Mode cannot override an active user-directed action or move intent.", details={k: active.get(k) for k in ["type", "id", "status", "behaviorSourceKind"]}), 409
        if source_kind == "agent-scripted-mode":
            if active.get("type") == "world-action":
                ok, result, status = cancel_world_action(active.get("id"), {"failureReason": "cancelled_by_system", "reason": "cancelled_by_system", "actor": "agent-live-mode", "source": "agent-live-mode"})
                if not ok:
                    return None, _api_error("scripted_interrupt_failed", "Agent Live Mode could not interrupt the active scripted world action.", details={"active": active, "result": result}), status
                interrupted.append({"type": "world-action", "id": active.get("id"), "status": "cancelled"})
            else:
                released = _interrupt_scripted_move_intent(active.get("id"))
                if isinstance(released, dict) and released.get("error"):
                    return None, _api_error("scripted_interrupt_failed", "Agent Live Mode could not interrupt the active scripted move intent.", details=released), 500
                if released:
                    interrupted.append(released)
            continue
        return None, _api_error("agent_unavailable", "Agent already has an active higher/equal authority action or move intent.", details={k: active.get(k) for k in ["type", "id", "status", "behaviorSourceKind"]}), 409
    return interrupted, None, None


def create_agent_live_mode_action_request(payload):
    if not isinstance(payload, dict):
        return False, _api_error("invalid_payload", "Agent Live Mode action request payload must be an object."), 400
    source = payload.get("source") if isinstance(payload.get("source"), dict) else None
    if not source or source.get("kind") != "agent-live-mode":
        return False, _api_error("invalid_behavior_source", "Agent Live Mode action caller requires source.kind to be agent-live-mode.", details={"required": "agent-live-mode"}), 400
    agent_id = _resolve_agent_id(payload.get("agentId"))
    if not agent_id:
        return False, _api_error("agent_not_found", "agentId must reference an existing agent id or statusKey"), 404
    setting = get_agent_live_mode_setting(agent_id)
    if not setting or setting.get("agentLiveModeEnabled") is not True:
        return False, _agent_live_mode_disabled_error(agent_id), 403

    interrupted, error, status = _prepare_agent_live_mode_action_call(agent_id)
    if error:
        return False, error, status

    action_payload = {**payload, "agentId": agent_id, "source": {**source, "kind": "agent-live-mode"}}
    ok, action_result, action_status = create_world_action(action_payload)
    if not ok:
        return False, action_result, action_status
    action = action_result.get("action") if isinstance(action_result, dict) else None
    action_id = action.get("id") if isinstance(action, dict) else None
    move_payload = {
        "agentId": agent_id,
        "actionAgentId": agent_id,
        "actionId": action_id,
        "worldActionId": action_id,
        "source": action_payload["source"],
        "behaviorCategory": action_payload.get("behaviorCategory"),
        "behaviorSelectedObject": action_payload.get("behaviorSelectedObject"),
        "behaviorSelectedSpot": action_payload.get("behaviorSelectedSpot"),
        "behaviorProbabilityRoll": action_payload.get("behaviorProbabilityRoll"),
        "behaviorFallbackReason": action_payload.get("behaviorFallbackReason"),
        "target": {**(action.get("target") if isinstance(action, dict) and isinstance(action.get("target"), dict) else payload.get("target") or {}), "actionId": action_id, "worldActionId": action_id},
    }
    ok, move_result, move_status = create_move_intent(agent_id, move_payload)
    if not ok:
        cancel_world_action(action_id, {"failureReason": "cancelled_by_system", "reason": "cancelled_by_system", "actor": "agent-live-mode", "source": "agent-live-mode"})
        return False, _api_error("move_intent_handoff_failed", "Agent Live Mode action was validated but could not create the existing move-intent/AgentIntent handoff; the reserved action was cancelled.", details=move_result), move_status
    return True, {"ok": True, "action": action_result.get("action"), "worldAction": action_result, "moveIntent": move_result.get("moveIntent"), "routeHandoff": move_result.get("routeHandoff"), "linkedAction": move_result.get("linkedAction"), "interruptedLowerLayer": interrupted, "callerContract": {"endpoint": "POST /api/agent-model/actions", "requiredSourceKind": "agent-live-mode", "requiresAgentLiveModeEnabled": True, "usesExistingWorldActionValidation": True, "usesExistingMoveIntentHandoff": True, "overrideOrder": ["user", "agent-live-mode", "agent-scripted-mode"]}}, 202


def _route_planner_for_target(kind, resolved, target):
    if kind == "object-instance" and isinstance(resolved, dict) and resolved.get("collection") == "outdoor-node":
        return "dynamic-exterior-routing.js"
    if kind in {"building", "room"}:
        return "dynamic-interior-routing.js / dynamic-exterior-routing.js"
    if kind == "world-point":
        return "dynamic-exterior-routing.js"
    return "dynamic-interior-routing.js"


def _normalize_move_target(target, agent_id, action_id=None):
    if not isinstance(target, dict):
        return None, None, _api_error("invalid_request", "target must be an object")
    kind = target.get("kind") or ("object-instance" if (target.get("objectInstanceId") or target.get("id") or target.get("catalogId")) else "world-point")
    if kind not in WORLD_ACTION_TARGET_KINDS:
        return None, None, _api_error("invalid_request", f"target.kind must be one of {sorted(WORLD_ACTION_TARGET_KINDS)}")
    if kind == "agent":
        return None, None, _api_error("unsupported_target", "agent targets are reserved for later phases")

    supplied_floor = _number_or_none(target.get("floor") if target.get("floor") is not None else target.get("buildingFloor"))
    floor = max(1, int(supplied_floor or 1))
    room_id = target.get("roomId") or target.get("room")
    target_action_id = action_id or target.get("actionId") or target.get("worldActionId")
    resolved = None
    metadata = {"kind": kind, "floor": floor, "roomId": room_id, "actionId": target_action_id, "guardrails": MOVE_INTENT_ROUTE_GUARDRAILS}

    if kind == "world-point":
        x = _number_or_none(target.get("x") if target.get("x") is not None else target.get("worldX"))
        y = _number_or_none(target.get("y") if target.get("y") is not None else target.get("z") if target.get("z") is not None else target.get("worldZ"))
        if x is None or y is None:
            return None, None, _api_error("invalid_request", "world-point targets require numeric x and y/z coordinates")
        building_id = target.get("buildingId")
        if building_id:
            building_reason = _building_unavailable(load_building(building_id))
            if building_reason:
                return None, None, _api_error(building_reason, "Target building is unavailable.", details={"buildingId": building_id})
        normalized = {"kind": "world-point", "x": x, "y": y, "floor": floor, "buildingId": building_id, "roomId": room_id, "actionId": target_action_id, "targetKind": "world-point"}
        metadata.update({"coordinate": {"x": x, "y": y}, "routingPlan": "world-coordinate-to-setAgentTarget"})
        return normalized, metadata, None

    building_id = target.get("buildingId")
    if kind in {"building", "room"} and not building_id:
        return None, None, _api_error("invalid_request", f"{kind} targets require buildingId")
    if kind == "room" and not room_id:
        return None, None, _api_error("invalid_request", "room targets require roomId plus buildingId/floor metadata")
    if kind in {"building", "room"}:
        building = load_building(building_id)
        reason = _building_unavailable(building)
        if reason:
            return None, None, _api_error(reason, "Target building is unavailable.", details={"buildingId": building_id})
        normalized = {"kind": kind, "buildingId": building_id, "floor": floor, "roomId": room_id, "actionId": target_action_id, "targetKind": kind}
        if target.get("x") is not None or target.get("y") is not None or target.get("z") is not None:
            x = _number_or_none(target.get("x"))
            y = _number_or_none(target.get("y") if target.get("y") is not None else target.get("z"))
            if x is not None and y is not None:
                normalized.update({"x": x, "y": y})
        metadata.update({"buildingId": building_id, "buildingName": building.get("name"), "routingPlan": "building-floor-room-to-setAgentTarget"})
        return normalized, metadata, None

    resolved = _find_world_action_target(target)
    if not resolved:
        return None, None, _api_error("target_missing", "Target object does not exist in persisted buildings/objects.")
    building = resolved.get("building") or {}
    obj = resolved.get("object") or {}
    building_reason = _building_unavailable(building)
    if building_reason:
        return None, None, _api_error(building_reason, "Target building is unavailable.", details={"buildingId": building.get("id") or building_id})
    catalog_id = target.get("catalogId") or _object_catalog_id(obj)
    spot_id = target.get("interactionSpotId") or target.get("spotId")
    object_id = target.get("objectInstanceId") or target.get("id") or (resolved.get("candidateIds") or [None])[0]
    if _spot_blocked(obj, spot_id):
        return None, None, _api_error("target_blocked", "Target interaction spot is blocked or disabled.", details={"objectInstanceId": object_id, "interactionSpotId": spot_id})
    catalog = _catalog_block_for(catalog_id)
    if catalog_id and catalog and not _catalog_has_spot(catalog, spot_id, target_action_id):
        return None, None, _api_error("missing_interaction_spot", "Target does not expose the requested interaction/action spot.", details={"interactionSpotId": spot_id, "catalogId": catalog_id})
    availability = get_object_availability({**target, "objectInstanceId": object_id, "catalogId": catalog_id, "interactionSpotId": spot_id}, agent_id=agent_id, resolved=resolved)
    if availability.get("state") in {"disabled", "blocked", "missing", "deleted"}:
        code = "target_disabled" if availability.get("state") == "disabled" else f"target_{availability.get('state')}"
        return None, None, _api_error(code, "Target is not available for movement.", details=availability)
    if availability.get("state") in {"reserved", "in_use"}:
        return None, None, _api_error("object_reserved", "Target interaction spot/capacity slot is already reserved by another active action.", details=availability)
    object_floor = max(1, int(supplied_floor or obj.get("floor") or obj.get("level") or 1))
    normalized = {
        "kind": "object-instance",
        "objectInstanceId": object_id,
        "catalogId": catalog_id,
        "interactionSpotId": spot_id,
        "buildingId": target.get("buildingId") or building.get("id"),
        "floor": object_floor,
        "roomId": room_id if room_id is not None else obj.get("roomId"),
        "actionId": target_action_id,
        "targetKind": "outdoor-area-node" if resolved.get("collection") == "outdoor-node" else "interior-object",
    }
    metadata.update({
        "objectInstanceId": object_id,
        "catalogId": catalog_id,
        "interactionSpotId": spot_id,
        "buildingId": normalized.get("buildingId"),
        "floor": normalized.get("floor"),
        "roomId": normalized.get("roomId"),
        "collection": resolved.get("collection"),
        "index": resolved.get("index"),
        "availability": availability,
        "routingPlan": "object-action-spot-to-setAgentTarget",
    })
    return normalized, metadata, None


def _attach_move_intent_to_world_action(action_id, move_intent):
    if not action_id:
        return None
    store = get_world_actions_store(persist_migration=True)
    now = _utc_now_iso()
    next_active = []
    updated = None
    for action in store.get("active", []):
        if action.get("id") != action_id:
            next_active.append(action)
            continue
        updated = _normalize_world_action_record(action)
        if updated.get("agentId") != move_intent.get("agentId"):
            next_active.append(action)
            return {"error": "agent_mismatch", "action": action}
        route = dict(updated.get("route") or {})
        route.update({"state": move_intent.get("routeStatus"), "status": move_intent.get("routeStatus"), "target": move_intent.get("target"), "targetMetadata": move_intent.get("targetMetadata"), "handoff": WORLD_ACTION_CREATE_ROUTE_OWNER, "routeOwner": "client-runtime", "setAgentTarget": True, "source": move_intent.get("source"), "behavior": move_intent.get("behavior"), "behaviorSourceKind": move_intent.get("behaviorSourceKind"), "behaviorMode": move_intent.get("behaviorMode"), "behaviorCategory": move_intent.get("behaviorCategory"), "moveIntent": {"id": move_intent.get("id"), "state": move_intent.get("routeStatus"), "createdAt": move_intent.get("createdAt")}})
        updated["route"] = route
        if _canonical_world_action_status(updated.get("status")) == "reserved":
            updated["status"] = "route_pending"
            updated["timing"] = {**(updated.get("timing") if isinstance(updated.get("timing"), dict) else {}), "updatedAt": now, "routePendingAt": now}
            lifecycle = dict(updated.get("lifecycle") or {})
            log = list(lifecycle.get("transitionLog") or [])
            log.append({"at": now, "from": "reserved", "to": "route_pending", "actor": "server.py#create_move_intent", "source": "api", "reason": "move-intent-created"})
            lifecycle.update({"previousStatus": "reserved", "allowedNext": _world_action_allowed_next("route_pending"), "transitionLog": log})
            updated["lifecycle"] = lifecycle
        next_active.append(updated)
    if updated:
        ok, saved = save_world_actions_store({"active": next_active, "history": store.get("history", [])})
        if not ok:
            return {"error": "persist_failed", "details": saved}
        return _find_world_action_record(saved, action_id)[2]
    return None


def create_move_intent(path_agent_id, payload):
    if not isinstance(payload, dict):
        return False, _api_error("invalid_payload", "move intent payload must be an object"), 400
    agent_id = _resolve_agent_id(path_agent_id)
    if not agent_id:
        return False, _api_error("agent_not_found", "agentId must reference an existing agent id or statusKey"), 404
    supplied_agent = payload.get("agentId") or payload.get("actionAgentId")
    if supplied_agent is not None and _resolve_agent_id(supplied_agent) != agent_id:
        return False, _api_error("permission_denied", "Payload agentId must match the URL agentId."), 403
    linked_action_id = payload.get("actionId") or payload.get("worldActionId")
    if linked_action_id and not _active_world_action_for_move(linked_action_id, agent_id):
        return False, _api_error("action_not_found", "actionId/worldActionId must reference an active action for this agent."), 404
    raw_source = payload.get("source") if isinstance(payload.get("source"), dict) else {"kind": "api"}
    behavior, behavior_error = _normalize_behavior_metadata(payload, raw_source, payload.get("target"))
    if behavior_error:
        return False, behavior_error, 400
    source = _source_snapshot_with_behavior(raw_source, behavior)
    if source.get("kind") == "agent-live-mode":
        setting = get_agent_live_mode_setting(agent_id)
        if not setting or setting.get("agentLiveModeEnabled") is not True:
            return False, _agent_live_mode_disabled_error(agent_id), 403
    target, metadata, error = _normalize_move_target(payload.get("target"), agent_id, linked_action_id)
    if error:
        status = {
            "invalid_payload": 400,
            "invalid_request": 400,
            "unsupported_target": 422,
            "missing_interaction_spot": 422,
            "building_missing": 404,
            "building_deleted": 410,
            "building_unavailable": 409,
            "target_missing": 404,
            "target_deleted": 410,
            "target_disabled": 409,
            "target_blocked": 409,
            "object_reserved": 409,
        }.get((error.get("error") or {}).get("code"), 400)
        return False, error, status
    route_behavior = {k: behavior.get(k) for k in ["behaviorSourceKind", "behaviorMode", "behaviorAuthority", "behaviorSelectedCategory", "behaviorSelectedObject", "behaviorSelectedSpot", "behaviorProbabilityRoll", "behaviorFallbackReason"]}
    metadata = {**metadata, "behavior": route_behavior, "behaviorSourceKind": behavior.get("behaviorSourceKind"), "behaviorMode": behavior.get("behaviorMode"), "behaviorCategory": behavior.get("behaviorSelectedCategory")}
    action_id = linked_action_id or target.get("actionId")
    busy = _agent_busy_for_move(agent_id, action_id=linked_action_id)
    if busy:
        return False, _api_error("agent_unavailable", "Agent already has an active action or move intent.", details=busy), 409
    now = _utc_now_iso()
    planner = _route_planner_for_target(target.get("kind"), _find_world_action_target(target), target)
    route = {
        "id": f"route-{_move_intent_id(agent_id)}",
        "state": "route_pending",
        "status": "route_pending",
        "target": target,
        "targetMetadata": metadata,
        "handoff": WORLD_ACTION_CREATE_ROUTE_OWNER,
        "routeOwner": "client-runtime",
        "setAgentTarget": True,
        "routingOwner": "main3d.js#setAgentTarget()",
        "planner": planner,
        "collisionGuardrails": MOVE_INTENT_ROUTE_GUARDRAILS,
        "source": source,
        "behavior": route_behavior,
        "behaviorSourceKind": behavior.get("behaviorSourceKind"),
        "behaviorMode": behavior.get("behaviorMode"),
        "behaviorCategory": behavior.get("behaviorSelectedCategory"),
        "lifecycleAdvance": {"from": "route_pending/routing", "arrived": "arrived", "failed": "failed"},
    }
    move_intent = {
        "id": route["id"].replace("route-", "", 1),
        "schemaVersion": MOVE_INTENT_SCHEMA_VERSION,
        "agentId": agent_id,
        "actionId": action_id,
        "status": "route_pending",
        "routeStatus": "route_pending",
        "target": target,
        "targetMetadata": metadata,
        "route": route,
        "source": source,
        "behaviorSourceKind": behavior.get("behaviorSourceKind"),
        "behaviorMode": behavior.get("behaviorMode"),
        "behaviorAuthority": behavior.get("behaviorAuthority"),
        "behaviorCategory": behavior.get("behaviorSelectedCategory"),
        "behavior": route_behavior,
        "createdAt": now,
        "updatedAt": now,
        "audit": {"reuseDecisions": MOVE_INTENT_REUSE_NOTES, "routeGuardrails": MOVE_INTENT_ROUTE_GUARDRAILS},
    }
    store = reconcile_move_intents()
    ok, saved = save_move_intents_store({"active": [*store.get("active", []), move_intent], "history": store.get("history", [])})
    if not ok:
        return False, _api_error("persist_failed", "Move intent could not be persisted.", details=saved), 500
    linked_action = _attach_move_intent_to_world_action(linked_action_id, move_intent) if linked_action_id else None
    if isinstance(linked_action, dict) and linked_action.get("error"):
        return False, _api_error(linked_action.get("error"), "Move intent could not be attached to the linked world action.", details=linked_action), 409
    return True, {"ok": True, "moveIntent": move_intent, "routeStatus": move_intent.get("routeStatus"), "targetMetadata": metadata, "routeHandoff": route, "linkedAction": linked_action, "moveIntents": {"activeCount": len(saved.get("active", [])), "historyCount": len(saved.get("history", []))}}, 202


def _release_reservation(action, terminal_status, now, reason=None):
    next_action = dict(action)
    if not _is_record(next_action.get("reservation")):
        next_action.pop("reservation", None)
        return next_action
    reservation = dict(next_action.get("reservation") or {})
    release_state = {
        "completed": "released",
        "cancelled": "cancelled",
        "failed": "failed",
        "expired": "timed_out",
    }.get(_canonical_world_action_status(terminal_status), "released")
    reservation.update({
        "state": release_state,
        "status": "released",
        "availabilityState": "available",
        "releasedAt": now,
    })
    if reason:
        reservation["releaseReason"] = reason
    next_action["reservation"] = reservation
    return next_action


def _apply_world_action_side_effects(action, from_status, to_status, now, reason=None):
    next_action = dict(action)
    reservation = dict(next_action.get("reservation") or {})
    route = dict(next_action.get("route") or {})
    effects = list(next_action.get("effects") or [])
    if to_status == "reserved" and reservation and reservation.get("state") not in {"queued", "reserved"}:
        reservation.update({"state": "reserved", "status": "held", "availabilityState": "reserved", "reservedAt": reservation.get("reservedAt") or now})
    if to_status == "route_pending" and route:
        route.update({"state": "route_pending", "handoffPendingAt": route.get("handoffPendingAt") or now, "setAgentTarget": True})
    if to_status == "routing" and route:
        route.update({"state": "routing", "startedAt": route.get("startedAt") or now, "setAgentTarget": True})
    if to_status == "arrived" and route:
        route.update({"state": "arrived", "arrivedAt": route.get("arrivedAt") or now})
    if to_status == "in_progress" and reservation:
        reservation.update({"state": "in_use", "status": "active", "availabilityState": "in_use", "inUseAt": reservation.get("inUseAt") or now})
    if to_status in WORLD_ACTION_TERMINAL_STATES and route:
        route.update({
            "state": to_status,
            "stoppedAt": route.get("stoppedAt") or now,
            "setAgentTarget": False,
            "moveIntent": {
                **(route.get("moveIntent") if isinstance(route.get("moveIntent"), dict) else {}),
                "state": "cleared",
                "clearedAt": now,
                "reason": reason or to_status,
            },
        })
        if to_status == "completed":
            route["completedAt"] = route.get("completedAt") or now
        if to_status == "cancelled":
            route["cancelledAt"] = route.get("cancelledAt") or now
        effects.append({"type": "route-intent-cleared", "at": now, "from": from_status, "to": to_status, "reason": reason or to_status})
    if route:
        next_action["route"] = route
    if reservation:
        next_action["reservation"] = reservation
    if to_status in WORLD_ACTION_TERMINAL_STATES:
        had_reservation = _is_record(next_action.get("reservation"))
        next_action = _release_reservation(next_action, to_status, now, reason)
        if had_reservation:
            effects.append({"type": "reservation-released", "at": now, "state": (next_action.get("reservation") or {}).get("state"), "reason": reason or to_status})
    if effects:
        next_action["effects"] = effects
    return next_action


def _find_world_action_record(store, action_id):
    for bucket in ("active", "history"):
        for index, record in enumerate(store.get(bucket, [])):
            if record.get("id") == action_id:
                return bucket, index, _normalize_world_action_record(record)
    return None, None, None


def _world_action_payload_authorized(action, payload):
    if not isinstance(payload, dict):
        return True, None
    supplied_agent = payload.get("agentId") or payload.get("actionAgentId")
    if supplied_agent is not None and supplied_agent != action.get("agentId"):
        return False, {"expectedAgentId": action.get("agentId"), "suppliedAgentId": supplied_agent}
    return True, None


def _world_action_outcome(action, operation, disposition, reason=None):
    status = action.get("status") if isinstance(action, dict) else None
    messages = {
        ("complete", "applied"): "World action completed; reservation and route intent were cleaned up.",
        ("cancel", "applied"): "World action cancelled; reservation and route intent were cleaned up.",
        ("complete", "already-completed"): "World action was already completed; no effects were applied again.",
        ("cancel", "already-cancelled"): "World action was already cancelled; no effects were applied again.",
        ("complete", "already-terminal"): f"World action is already {status}; completion was not applied.",
        ("cancel", "already-terminal"): f"World action is already {status}; cancellation was not applied.",
    }
    return {"operation": operation, "status": status, "disposition": disposition, "reason": reason, "message": messages.get((operation, disposition), f"World action {operation} result: {disposition}.")}


def _terminal_action_response(action_id, operation, payload, apply_fn):
    store = get_world_actions_store(persist_migration=True)
    bucket, _, action = _find_world_action_record(store, action_id)
    if action is None:
        return False, _api_error("not_found", "World action is not active or does not exist."), 404
    authorized, details = _world_action_payload_authorized(action, payload)
    if not authorized:
        return False, _api_error("permission_denied", "World action id does not belong to the supplied agent; effects were not applied.", details=details), 403
    status = action.get("status")
    if bucket == "history" or status in WORLD_ACTION_TERMINAL_STATES:
        expected = "completed" if operation == "complete" else "cancelled"
        if status == expected:
            disposition = "already-completed" if expected == "completed" else "already-cancelled"
            return True, {"ok": True, "action": action, "outcome": _world_action_outcome(action, operation, disposition), "worldActions": {"activeCount": len(store.get("active", [])), "historyCount": len(store.get("history", []))}}, 200
        return False, _api_error("already_terminal", f"World action is already {status}; no effects were applied.", details={"action": action, "outcome": _world_action_outcome(action, operation, "already-terminal", status)}), 409
    return apply_fn(action)


def complete_world_action(action_id, payload=None):
    payload = payload if isinstance(payload, dict) else {}
    def apply(_action):
        result = payload.get("result") if isinstance(payload.get("result"), dict) else {"status": "completed", "applied": True, "reason": payload.get("reason") or "completed"}
        result = {**result, "status": "completed", "applied": result.get("applied", True)}
        ok, response, status = transition_world_action(action_id, "completed", result=result, actor=payload.get("actor"), source=payload.get("source") if isinstance(payload.get("source"), str) else "api")
        if ok:
            response["outcome"] = _world_action_outcome(response.get("action", {}), "complete", "applied", result.get("reason"))
        return ok, response, status
    return _terminal_action_response(action_id, "complete", payload, apply)


def cancel_world_action(action_id, payload=None):
    payload = payload if isinstance(payload, dict) else {}
    reason = payload.get("failureReason") or payload.get("reason") or "cancelled_by_user"
    if reason not in {"cancelled_by_user", "cancelled_by_system"}:
        return False, _api_error("invalid_failure_reason", "Cancel requires cancelled_by_user or cancelled_by_system."), 400
    def apply(_action):
        result = payload.get("result") if isinstance(payload.get("result"), dict) else {"status": "cancelled", "reason": reason}
        result = {**result, "status": "cancelled", "reason": result.get("reason") or reason}
        ok, response, status = transition_world_action(action_id, "cancelled", result=result, failure_reason=reason, actor=payload.get("actor"), source=payload.get("source") if isinstance(payload.get("source"), str) else "api")
        if ok:
            response["outcome"] = _world_action_outcome(response.get("action", {}), "cancel", "applied", reason)
        return ok, response, status
    return _terminal_action_response(action_id, "cancel", payload, apply)


def _transition_actor(source, actor):
    if _non_empty_string(actor):
        return actor
    if isinstance(source, dict):
        return source.get("requestedBy") or source.get("kind") or "api"
    return "api"


def transition_world_action(action_id, to_status, *, result=None, failure_reason=None, actor=None, source="api"):
    to_status = _canonical_world_action_status(to_status)
    failure_reason = _canonical_world_action_failure(failure_reason)
    if to_status not in WORLD_ACTION_STATUSES:
        return False, _api_error("invalid_status", f"status must be one of {sorted(WORLD_ACTION_STATUSES)}"), 400
    if to_status in {"failed", "expired"} and failure_reason not in WORLD_ACTION_FAILURE_REASONS:
        return False, _api_error("invalid_failure_reason", "Failed and expired actions require a known failureReason."), 400
    if to_status == "cancelled" and failure_reason not in (None, "cancelled_by_user", "cancelled_by_system"):
        return False, _api_error("invalid_failure_reason", "Cancelled actions require cancelled_by_user or cancelled_by_system when a failureReason is supplied."), 400
    store = get_world_actions_store(persist_migration=True)
    active = list(store.get("active", []))
    history = list(store.get("history", []))
    index = next((i for i, record in enumerate(active) if record.get("id") == action_id), None)
    if index is None:
        return False, _api_error("not_found", "World action is not active or does not exist."), 404
    now = _utc_now_iso()
    action = _normalize_world_action_record(active.pop(index))
    from_status = action.get("status")
    if not _world_action_transition_allowed(from_status, to_status):
        return False, _api_error("illegal_transition", "World action lifecycle transition is not allowed.", details={"from": from_status, "to": to_status, "allowedNext": _world_action_allowed_next(from_status)}), 409
    action["status"] = to_status
    action["failureReason"] = failure_reason if to_status in {"failed", "expired", "cancelled"} else None
    if result is not None:
        if not isinstance(result, dict):
            return False, _api_error("invalid_result", "result must be an object when supplied."), 400
        action["result"] = result
    elif to_status in WORLD_ACTION_TERMINAL_STATES:
        action["result"] = {"status": to_status, "reason": failure_reason}
    else:
        action["result"] = {**(action.get("result") if isinstance(action.get("result"), dict) else {}), "status": to_status}
    timing = dict(action.get("timing") or {})
    timing["updatedAt"] = now
    if to_status == "routing":
        timing["startedAt"] = timing.get("startedAt") or now
    if to_status == "arrived":
        timing["arrivedAt"] = timing.get("arrivedAt") or now
    if to_status in WORLD_ACTION_TERMINAL_STATES:
        timing["terminalAt"] = now
    if to_status == "completed":
        timing["completedAt"] = now
    action["timing"] = timing
    lifecycle = dict(action.get("lifecycle") or {})
    transition_log = list(lifecycle.get("transitionLog") or [])
    transition_log.append({"at": now, "from": from_status, "to": to_status, "actor": _transition_actor(action.get("source"), actor), "source": source, "reason": failure_reason or (result.get("reason") if isinstance(result, dict) else None) or to_status})
    lifecycle.update({"previousStatus": from_status, "allowedNext": _world_action_allowed_next(to_status), "transitionLog": transition_log})
    if to_status in WORLD_ACTION_TERMINAL_STATES:
        lifecycle["terminalReason"] = failure_reason or to_status
    action["lifecycle"] = lifecycle
    action = _apply_world_action_side_effects(action, from_status, to_status, now, failure_reason)
    event_name = WORLD_ACTION_EVENT_TRANSITION_MAP.get(to_status)
    event_payloads = []
    if event_name:
        event_payloads.append(_world_action_event_payload(
            action,
            event_name,
            now,
            from_status=from_status,
            to_status=to_status,
            reason=failure_reason or (result.get("reason") if isinstance(result, dict) else None) or to_status,
            result=action.get("result"),
            route=action.get("route"),
            reservation=action.get("reservation"),
            actor=_transition_actor(action.get("source"), actor),
            source=source,
        ))
    if to_status in WORLD_ACTION_TERMINAL_STATES and _is_record(action.get("reservation")):
        event_payloads.append(_world_action_event_payload(
            action,
            "reservation-released",
            now,
            from_status=from_status,
            to_status=to_status,
            reason=failure_reason or to_status,
            result=action.get("result"),
            reservation=action.get("reservation"),
            actor=_transition_actor(action.get("source"), actor),
            source="reservation",
        ))
    if event_payloads:
        action = _append_world_action_events(action, event_payloads)
    else:
        legacy_events = list(action.get("events") or [])
        legacy_events.append({"type": f"world-action-{to_status}", "at": now, "timestamp": now, "actor": _transition_actor(action.get("source"), actor), "source": source, "from": from_status, "to": to_status, "fromStatus": from_status, "toStatus": to_status, "reason": failure_reason})
        action["events"] = legacy_events
    next_active = active
    next_history = history
    if to_status in WORLD_ACTION_TERMINAL_STATES:
        next_active = _promote_next_api_service_queue_action(next_active, action, now, reason=f"{to_status}-promote-service-queue")
        next_history = [action, *history]
    else:
        next_active.insert(index, action)
    ok, saved = save_world_actions_store({"active": next_active, "history": next_history})
    if not ok:
        return False, _api_error("invalid_action_record", "World action transition could not be persisted.", details=saved), 500
    return True, {"ok": True, "action": action, "worldActions": {"activeCount": len(saved.get("active", [])), "historyCount": len(saved.get("history", []))}}, 200


def reconcile_world_action_reservations():
    store = get_world_actions_store(persist_migration=True)
    changed = False
    active = []
    history = list(store.get("history", []))
    now_epoch = time.time()
    for action in store.get("active", []):
        target = action.get("target") if isinstance(action.get("target"), dict) else {}
        timing = action.get("timing") if isinstance(action.get("timing"), dict) else {}
        timeout_ms = timing.get("timeoutMs")
        created_epoch = _parse_isoish_epoch(timing.get("createdAt"))
        timed_out = isinstance(timeout_ms, (int, float)) and timeout_ms > 0 and created_epoch is not None and now_epoch >= created_epoch + timeout_ms / 1000
        missing_state = _target_deleted_or_missing(target, _find_world_action_target(target)) if target.get("kind") == "object-instance" else None
        if not timed_out and missing_state not in {"deleted", "missing"}:
            active.append(action)
            continue
        terminal = "expired" if timed_out else "failed"
        reason = "timed_out" if timed_out else f"target_{missing_state}"
        now = _utc_now_iso()
        moved = _normalize_world_action_record(action)
        from_status = moved.get("status")
        moved["status"] = terminal
        moved["failureReason"] = reason
        moved["result"] = {"status": terminal, "reason": reason}
        moved["timing"] = {**timing, "updatedAt": now, "terminalAt": now}
        lifecycle = dict(moved.get("lifecycle") or {})
        transition_log = list(lifecycle.get("transitionLog") or [])
        transition_log.append({"at": now, "from": from_status, "to": terminal, "actor": "server.py#reconcile_world_action_reservations", "source": "system", "reason": reason})
        lifecycle.update({"previousStatus": from_status, "allowedNext": [], "terminalReason": reason, "transitionLog": transition_log})
        moved["lifecycle"] = lifecycle
        moved = _release_reservation(moved, terminal, now, reason)
        moved = _append_world_action_events(moved, [
            _world_action_event_payload(moved, "failed", now, from_status=from_status, to_status=terminal, reason=reason, result=moved.get("result"), reservation=moved.get("reservation"), actor="server.py#reconcile_world_action_reservations", source="system"),
            _world_action_event_payload(moved, "reservation-released", now, from_status=from_status, to_status=terminal, reason=reason, result=moved.get("result"), reservation=moved.get("reservation"), actor="server.py#reconcile_world_action_reservations", source="reservation"),
        ])
        history.insert(0, moved)
        changed = True
    if not changed:
        return store
    ok, saved = save_world_actions_store({"active": active, "history": history})
    return saved if ok else store

# ─── CHUNK STORAGE ────────────────────────────────────────────────
def chunk_path(cx, cy):
    return os.path.join(CHUNKS_DIR, f"c_{cx}_{cy}.json")

def load_chunk(cx, cy):
    path = chunk_path(cx, cy)
    try:
        with open(path, "r") as f:
            return json.load(f)
    except (FileNotFoundError, json.JSONDecodeError):
        return None  # chunk doesn't exist yet

def save_chunk(cx, cy, data):
    path = chunk_path(cx, cy)
    with open(path, "w") as f:
        json.dump(data, f)

def list_chunks():
    """List all saved chunk coordinates."""
    chunks = []
    for fname in glob.glob(os.path.join(CHUNKS_DIR, "c_*.json")):
        base = os.path.basename(fname)
        m = re.match(r"c_(-?\d+)_(-?\d+)\.json", base)
        if m:
            chunks.append({"cx": int(m.group(1)), "cy": int(m.group(2))})
    return chunks

# ─── BUILDING STORAGE ─────────────────────────────────────────────
def building_path(building_id):
    return os.path.join(BUILDINGS_DIR, f"{building_id}.json")

def strip_transient_object_assignment_state(obj):
    """Remove runtime-only object reservation/use state before building data is served or saved."""
    if not isinstance(obj, dict):
        return obj
    for key in [
        "reservation",
        "activeUse",
        "objectUseSeat",
        "objectUseStanding",
        "objectUseActive",
        "objectUseSeatReservations",
        "objectUseStandingReservations",
        "objectUseActiveReservations",
        "_scriptedObjectUseStore",
        "_scriptedServiceQueueStore",
    ]:
        obj.pop(key, None)
    state = obj.get("state")
    if isinstance(state, dict):
        state.pop("reservation", None)
    for key, value in list(obj.items()):
        if not key.endswith("State") or not isinstance(value, dict):
            continue
        for list_key in ["activeSlotIds", "reservedSlotIds", "activeSeatIds", "reservedSeatIds"]:
            if isinstance(value.get(list_key), list):
                value[list_key] = []
        status = str(value.get("status", "")).lower()
        if status in {"reserved", "active", "playing", "occupied", "queued", "in-use", "in_use"}:
            value["status"] = value.get("readyStatus") or value.get("openStatus") or "ready"
        for agent_key in ["agentId", "reservedAgentId", "activeAgentId"]:
            value.pop(agent_key, None)
    return obj

def strip_building_transient_object_assignments(building):
    if not isinstance(building, dict):
        return building
    interior = building.get("interior")
    if isinstance(interior, dict):
        furniture = interior.get("furniture")
        if isinstance(furniture, list):
            for item in furniture:
                strip_transient_object_assignment_state(item)
    outdoor_area = building.get("outdoorArea")
    if isinstance(outdoor_area, dict):
        nodes = outdoor_area.get("nodes")
        if isinstance(nodes, list):
            for node in nodes:
                strip_transient_object_assignment_state(node)
    outdoor_nodes = building.get("outdoorNodes")
    if isinstance(outdoor_nodes, list):
        for node in outdoor_nodes:
            strip_transient_object_assignment_state(node)
    return building

def load_building(building_id):
    path = building_path(building_id)
    try:
        with open(path, "r") as f:
            return strip_building_transient_object_assignments(json.load(f))
    except (FileNotFoundError, json.JSONDecodeError):
        return None

def save_building(building_id, data):
    path = building_path(building_id)
    data = strip_building_transient_object_assignments(data)
    with open(path, "w") as f:
        json.dump(data, f, indent=2)

def delete_building(building_id):
    path = building_path(building_id)
    if os.path.exists(path):
        os.remove(path)
        return True
    return False

def list_buildings():
    buildings = []
    for fname in glob.glob(os.path.join(BUILDINGS_DIR, "*.json")):
        try:
            with open(fname, "r") as f:
                b = strip_building_transient_object_assignments(json.load(f))
                buildings.append(b)
        except (json.JSONDecodeError, OSError):
            continue
    return buildings

# ─── AGENT STATUS / PRESENCE ──────────────────────────────────────
def _load_status_file():
    for candidate in (STATUS_FILE, LEGACY_STATUS_FILE):
        try:
            with open(candidate, "r") as f:
                return json.load(f)
        except (FileNotFoundError, json.JSONDecodeError):
            continue
    return {}


def _fetch_json(url, timeout=3):
    try:
        with urllib.request.urlopen(url, timeout=timeout) as resp:
            return json.load(resp)
    except Exception:
        return None


def _post_json(url, data, timeout=120):
    try:
        body = json.dumps(data).encode("utf-8")
        req = urllib.request.Request(url, data=body, headers={"Content-Type": "application/json"}, method="POST")
        with urllib.request.urlopen(req, timeout=timeout) as resp:
            return json.load(resp), resp.status
    except urllib.error.HTTPError as e:
        try:
            payload = json.loads(e.read().decode("utf-8", errors="replace"))
        except Exception:
            payload = {"ok": False, "error": str(e)}
        return payload, e.code
    except Exception as e:
        return {"ok": False, "error": str(e)}, 502


# ─── AGENT PLATFORM COMMUNICATIONS ──────────────────────────────
AGENT_PLATFORM_COMM_SKILL_NAME = "AgentPlatform-to-AgentPlatform_Communications"
AGENT_PLATFORM_COMM_LOG = os.path.join(DATA_DIR, "agent-platform-communications.jsonl")


def _agent_platform_comm_skill_content():
    return """---
name: AgentPlatform-to-AgentPlatform_Communications
description: \"Talk to agents on OpenClaw, Hermes, or other Virtual World-connected platforms through the world/office communication layer.\"
---

# AgentPlatform-to-AgentPlatform Communications

Use this when you need to send a visible message, question, handoff, or task note to another agent in My Virtual World, including agents from other platforms.

## Endpoint

```bash
POST http://127.0.0.1:8590/api/agent-platform-communications/send
```

## Message format

```json
{
  \"fromAgentId\": \"<your world agent id>\",
  \"toAgentId\": \"<target world agent id>\",
  \"message\": \"<clear message to the target agent>\",
  \"conversationId\": \"<optional stable thread id>\",
  \"metadata\": {\"topic\": \"optional\"}
}
```

Agent IDs may include OpenClaw agents such as `main`, `coder`, `gen-itty`, and Hermes profiles such as `hermes-default`.

## Rules

- Use the Virtual World endpoint instead of a private/offscreen CLI when the interaction should be visible in-world.
- Keep private data minimal; communication events are visible/logged for world UI surfaces.
- Do not request config, credential, network, or infrastructure changes unless the world owner explicitly approved them.
- Use a stable `conversationId` for follow-up messages on the same topic.
"""


def _append_comm_event(event):
    event = dict(event)
    event.setdefault("id", str(uuid.uuid4()))
    event.setdefault("ts", int(time.time() * 1000))
    event.setdefault("schema", "vw.agent-platform-communication.v1")
    event.setdefault("visibleInWorld", True)
    try:
        os.makedirs(os.path.dirname(AGENT_PLATFORM_COMM_LOG), exist_ok=True)
        with open(AGENT_PLATFORM_COMM_LOG, "a") as f:
            f.write(json.dumps(event, ensure_ascii=False) + "\n")
    except OSError as e:
        print(f"⚠️  Virtual World comm log write failed: {e}")
    return event


def _load_comm_history(limit=200, conversation_id=None, agent_id=None):
    events = []
    try:
        with open(AGENT_PLATFORM_COMM_LOG, "r") as f:
            for line in f:
                try:
                    event = json.loads(line)
                except json.JSONDecodeError:
                    continue
                if conversation_id and event.get("conversationId") != conversation_id:
                    continue
                if agent_id:
                    src = (event.get("from") or {}).get("id")
                    dst = (event.get("to") or {}).get("id")
                    if agent_id not in (src, dst):
                        continue
                events.append(event)
    except FileNotFoundError:
        pass
    except OSError as e:
        print(f"⚠️  Virtual World comm log read failed: {e}")
    return events[-max(1, min(int(limit or 200), 1000)):]


def _hermes_provider():
    if HermesProvider is None:
        return None
    return HermesProvider(home_path=HERMES_HOME, binary=HERMES_BIN, enabled=HERMES_ENABLED, timeout_sec=HERMES_TIMEOUT_SEC)


def _discover_hermes_agents():
    provider = _hermes_provider()
    if not provider:
        return []
    try:
        return provider.discover_agents()
    except Exception as e:
        print(f"⚠️  Virtual World Hermes discovery failed: {e}")
        return []


def _is_hermes_agent(agent_id_or_key):
    needle = str(agent_id_or_key or "").strip()
    if not needle:
        return False
    for agent in get_roster():
        aliases = {str(agent.get("id") or ""), str(agent.get("statusKey") or ""), str(agent.get("providerAgentId") or "")}
        if needle in aliases:
            return agent.get("providerKind") == "hermes"
    return needle.startswith("hermes:") or needle.startswith("hermes-")


def _get_hermes_agent(agent_id_or_key=None):
    needle = str(agent_id_or_key or "").strip()
    for agent in get_roster():
        aliases = {str(agent.get("id") or ""), str(agent.get("statusKey") or ""), str(agent.get("providerAgentId") or "")}
        if agent.get("providerKind") == "hermes" and (not needle or needle in aliases or needle == f"hermes:{agent.get('profile') or agent.get('providerAgentId')}"):
            return agent
    return None


def _hermes_history_path(profile="default"):
    safe_profile = re.sub(r"[^A-Za-z0-9_.-]+", "-", str(profile or "default")).strip("-.") or "default"
    return os.path.join(DATA_DIR, f"hermes-chat-{safe_profile}.json")


def _load_hermes_state(profile="default"):
    try:
        with open(_hermes_history_path(profile), "r") as f:
            data = json.load(f)
        if isinstance(data, dict):
            return data
        if isinstance(data, list):
            return {"messages": data, "sessionId": ""}
    except (FileNotFoundError, json.JSONDecodeError, OSError):
        pass
    return {"messages": [], "sessionId": ""}


def _load_hermes_history(profile="default"):
    messages = _load_hermes_state(profile).get("messages", [])
    return messages if isinstance(messages, list) else []


def _save_hermes_state(profile, state):
    os.makedirs(DATA_DIR, exist_ok=True)
    with open(_hermes_history_path(profile), "w") as f:
        json.dump(state, f, ensure_ascii=False, indent=2)


def _save_hermes_history(profile, messages):
    state = _load_hermes_state(profile)
    state["messages"] = messages[-500:]
    _save_hermes_state(profile, state)


def _get_hermes_session_id(profile="default"):
    return str(_load_hermes_state(profile).get("sessionId") or "")


def _set_hermes_session_id(profile="default", session_id=""):
    state = _load_hermes_state(profile)
    state["sessionId"] = session_id or ""
    _save_hermes_state(profile, state)


def _jsonish(value):
    if value in (None, ""):
        return {}
    if isinstance(value, (dict, list)):
        return value
    if isinstance(value, str):
        try:
            return json.loads(value)
        except json.JSONDecodeError:
            return {"value": value}
    return {"value": value}


def _extract_hermes_turn_activity(exported_session, user_content):
    """Convert public Hermes session export messages into Virtual World chat activity cards."""
    if not isinstance(exported_session, dict):
        return {"tools": [], "thinking": "", "reasoningTokens": 0}
    messages = exported_session.get("messages") or []
    if not isinstance(messages, list):
        return {"tools": [], "thinking": "", "reasoningTokens": int(exported_session.get("reasoning_tokens") or 0)}

    start_idx = -1
    needle = str(user_content or "").strip()
    for i in range(len(messages) - 1, -1, -1):
        msg = messages[i] if isinstance(messages[i], dict) else {}
        if msg.get("role") == "user" and (not needle or str(msg.get("content") or "").strip() == needle):
            start_idx = i
            break
    turn = messages[start_idx + 1:] if start_idx >= 0 else messages[-8:]

    pending = {}
    tools = []
    thinking_parts = []

    for msg in turn:
        if not isinstance(msg, dict):
            continue
        reasoning = msg.get("reasoning") or msg.get("reasoning_content")
        if isinstance(reasoning, str) and reasoning.strip():
            thinking_parts.append(reasoning.strip())
        details = msg.get("reasoning_details")
        if isinstance(details, list):
            for item in details:
                if isinstance(item, dict):
                    txt = item.get("text") or item.get("summary")
                    if isinstance(txt, str) and txt.strip():
                        thinking_parts.append(txt.strip())

        for call in msg.get("tool_calls") or []:
            if not isinstance(call, dict):
                continue
            fn = call.get("function") if isinstance(call.get("function"), dict) else {}
            call_id = str(call.get("id") or call.get("call_id") or "")
            tool = {
                "id": call_id,
                "status": "running",
                "name": fn.get("name") or call.get("name") or call.get("tool_name") or "tool",
                "arguments": _jsonish(fn.get("arguments") or call.get("arguments") or call.get("args") or {}),
                "result": "",
            }
            tools.append(tool)
            if call_id:
                pending[call_id] = tool

        if msg.get("role") == "tool":
            call_id = str(msg.get("tool_call_id") or "")
            tool = pending.get(call_id)
            if not tool:
                tool = {
                    "id": call_id,
                    "status": "done",
                    "name": msg.get("tool_name") or "tool result",
                    "arguments": {},
                    "result": "",
                }
                tools.append(tool)
            tool["status"] = "error" if msg.get("finish_reason") == "error" else "done"
            if msg.get("tool_name"):
                tool["name"] = msg.get("tool_name")
            tool["result"] = msg.get("content") or ""

    for tool in tools:
        if tool.get("status") == "running":
            tool["status"] = "done"
    return {
        "tools": tools[-40:],
        "thinking": "\n\n".join(dict.fromkeys(thinking_parts))[:12000],
        "reasoningTokens": int(exported_session.get("reasoning_tokens") or 0),
    }


def _append_hermes_live_event(run_id, event_type, payload=None):
    run_id = str(run_id or "").strip()
    if not run_id:
        return None
    event = {
        "seq": 0,
        "ts": int(time.time() * 1000),
        "type": event_type,
        "payload": payload if isinstance(payload, dict) else {},
    }
    with HERMES_LIVE_LOCK:
        events = HERMES_LIVE_EVENTS.setdefault(run_id, [])
        event["seq"] = (events[-1]["seq"] + 1) if events else 1
        events.append(event)
        if len(events) > HERMES_LIVE_MAX_EVENTS:
            del events[:-HERMES_LIVE_MAX_EVENTS]
    return event


def _get_hermes_live_events(run_id, since=0):
    run_id = str(run_id or "").strip()
    try:
        since = int(since or 0)
    except (TypeError, ValueError):
        since = 0
    with HERMES_LIVE_LOCK:
        events = list(HERMES_LIVE_EVENTS.get(run_id, []))
    return {"ok": True, "runId": run_id, "events": [event for event in events if int(event.get("seq") or 0) > since]}


def _start_hermes_session_activity_poller(run_id, provider, profile, session_id, delivery_message, stop_event):
    if not run_id or not provider or not profile or not session_id or not hasattr(provider, "export_session"):
        return None

    def _poll():
        last_sig = ""
        while not stop_event.wait(1.25):
            try:
                exported = provider.export_session(profile, session_id, timeout_sec=8)
                if not exported.get("ok"):
                    continue
                activity = _extract_hermes_turn_activity(exported.get("session"), delivery_message)
                tools = activity.get("tools") or []
                thinking = activity.get("thinking") or ""
                reasoning_tokens = activity.get("reasoningTokens") or 0
                sig = json.dumps({
                    "tools": [(t.get("id"), t.get("name"), t.get("status"), t.get("result")) for t in tools],
                    "thinking": thinking[-800:],
                    "reasoningTokens": reasoning_tokens,
                }, sort_keys=True)
                if sig == last_sig:
                    continue
                last_sig = sig
                _append_hermes_live_event(run_id, "activity", {
                    "tools": tools,
                    "thinking": thinking,
                    "reasoningTokens": reasoning_tokens,
                })
            except Exception as exc:
                _append_hermes_live_event(run_id, "debug", {"message": f"Hermes live activity poll failed: {exc}"})

    thread = threading.Thread(target=_poll, name=f"hermes-live-{run_id}", daemon=True)
    thread.start()
    return thread


def _safe_hermes_bridge_run_id(run_id):
    safe = re.sub(r"[^A-Za-z0-9_.-]+", "-", str(run_id or "").strip())
    return safe[:120] or ("run-" + uuid.uuid4().hex)


def _hermes_approval_bridge_dir(run_id):
    return os.path.join(HERMES_APPROVAL_BRIDGE_DIR, _safe_hermes_bridge_run_id(run_id))


def _start_hermes_approval_bridge_watcher(run_id, bridge_dir, agent_id, profile, stop_event):
    if not run_id or not bridge_dir:
        return None

    def _watch():
        events_path = os.path.join(bridge_dir, "events.jsonl")
        offset = 0
        seen = set()
        while not stop_event.wait(0.25):
            try:
                if not os.path.exists(events_path):
                    continue
                with open(events_path, "r", encoding="utf-8") as f:
                    f.seek(offset)
                    lines = f.readlines()
                    offset = f.tell()
                for line in lines:
                    line = line.strip()
                    if not line:
                        continue
                    try:
                        item = json.loads(line)
                    except json.JSONDecodeError:
                        continue
                    approval_id = str(item.get("approval_id") or item.get("id") or "").strip()
                    if not approval_id or approval_id in seen:
                        continue
                    seen.add(approval_id)
                    status = str(item.get("status") or "pending").lower()
                    approval = {
                        "id": approval_id,
                        "approval_id": approval_id,
                        "provider": "hermes",
                        "status": "pending" if status == "pending" else status,
                        "kind": "command",
                        "title": "Hermes approval required",
                        "description": item.get("description") or "Hermes needs permission before it can continue this command.",
                        "command": item.get("command") or "Approval-gated Hermes command",
                        "message": "",
                        "agentId": agent_id or "hermes-default",
                        "profile": profile or "default",
                        "session_id": item.get("session_id") or "",
                        "bridgeRunId": _safe_hermes_bridge_run_id(run_id),
                        "bridgeApprovalId": approval_id,
                        "queuedAt": item.get("createdAt") or int(time.time() * 1000),
                        "nativeHermesApproval": True,
                    }
                    if status == "pending":
                        approval = _remember_hermes_approval_pending(approval, agent_id, profile, approval.get("session_id", ""))
                        _append_hermes_live_event(run_id, "approval", {"approval": approval, "pending_count": 1})
                    else:
                        _append_hermes_live_event(run_id, "approval", {"approval": approval, "pending_count": 0})
            except Exception as exc:
                _append_hermes_live_event(run_id, "debug", {"message": f"Hermes approval bridge watch failed: {exc}"})

    thread = threading.Thread(target=_watch, name=f"hermes-approval-bridge-{run_id}", daemon=True)
    thread.start()
    return thread


def _remove_hermes_progress_messages(messages):
    return [m for m in messages if not (isinstance(m, dict) and m.get("ephemeral") == "hermes-progress")]


def _hermes_approval_key(agent_id="", profile="", session_id=""):
    if session_id:
        return f"session:{session_id}"
    if profile:
        return f"profile:{profile}"
    return f"agent:{agent_id or 'hermes-default'}"


def _normalize_hermes_approval_choice(choice):
    choice = str(choice or "").strip().lower()
    return {
        "once": "approve_once",
        "allow_once": "approve_once",
        "approve": "approve_once",
        "approved_once": "approve_once",
        "no": "deny",
        "denied": "deny",
    }.get(choice, choice)


def _remember_hermes_approval_pending(approval, agent_id="", profile="", session_id=""):
    if not isinstance(approval, dict):
        return None
    approval = dict(approval)
    approval_id = approval.get("approval_id") or approval.get("id")
    if approval_id:
        approval["id"] = approval_id
        approval["approval_id"] = approval_id
    approval["session_id"] = approval.get("session_id") or session_id or ""
    approval["agentId"] = approval.get("agentId") or agent_id or "hermes-default"
    approval["profile"] = approval.get("profile") or profile or ""
    approval["queuedAt"] = approval.get("queuedAt") or int(time.time() * 1000)
    approval["status"] = approval.get("status") or "pending"
    key = _hermes_approval_key(approval.get("agentId"), approval.get("profile"), approval.get("session_id"))
    with HERMES_APPROVAL_LOCK:
        queue = HERMES_APPROVAL_PENDING.setdefault(key, [])
        existing_idx = next((i for i, item in enumerate(queue) if item.get("id") == approval.get("id")), None)
        if existing_idx is None:
            queue.append(approval)
        else:
            queue[existing_idx] = {**queue[existing_idx], **approval}
    return approval


def _get_hermes_approval_pending(agent_key="hermes-default", session_id=""):
    agent = _get_hermes_agent(agent_key) or {}
    agent_id = agent.get("id") or agent_key or "hermes-default"
    profile = agent.get("profile") or agent.get("providerAgentId") or "default"
    keys = [
        _hermes_approval_key(agent_id, profile, session_id),
        _hermes_approval_key(agent_id, profile, ""),
        _hermes_approval_key(agent_id, "", ""),
    ]
    with HERMES_APPROVAL_LOCK:
        for key in dict.fromkeys(keys):
            queue = [item for item in HERMES_APPROVAL_PENDING.get(key, []) if item.get("status", "pending") == "pending"]
            HERMES_APPROVAL_PENDING[key] = queue
            if queue:
                return {"ok": True, "pending": queue[0], "pending_count": len(queue), "session_id": session_id or queue[0].get("session_id", "")}
        for key, items in list(HERMES_APPROVAL_PENDING.items()):
            queue = [
                item for item in items
                if item.get("status", "pending") == "pending"
                and (item.get("agentId") == agent_id or item.get("profile") == profile)
            ]
            HERMES_APPROVAL_PENDING[key] = queue
            if queue:
                return {"ok": True, "pending": queue[0], "pending_count": len(queue), "session_id": session_id or queue[0].get("session_id", "")}
    return {"ok": True, "pending": None, "pending_count": 0, "session_id": session_id or ""}


def _resolve_hermes_approval_pending(agent_key="hermes-default", approval_id="", session_id="", choice=""):
    agent = _get_hermes_agent(agent_key) or {}
    agent_id = agent.get("id") or agent_key or "hermes-default"
    profile = agent.get("profile") or agent.get("providerAgentId") or "default"
    keys = [
        _hermes_approval_key(agent_id, profile, session_id),
        _hermes_approval_key(agent_id, profile, ""),
        _hermes_approval_key(agent_id, "", ""),
    ]
    with HERMES_APPROVAL_LOCK:
        for key in dict.fromkeys(keys):
            queue = HERMES_APPROVAL_PENDING.get(key, [])
            for idx, item in enumerate(queue):
                if not approval_id or item.get("id") == approval_id or item.get("approval_id") == approval_id:
                    resolved = {**item, "status": choice or "resolved", "resolvedAt": int(time.time() * 1000)}
                    del queue[idx]
                    HERMES_APPROVAL_PENDING[key] = queue
                    return resolved
        for key, queue in list(HERMES_APPROVAL_PENDING.items()):
            for idx, item in enumerate(queue):
                if (
                    (item.get("agentId") == agent_id or item.get("profile") == profile)
                    and (not approval_id or item.get("id") == approval_id or item.get("approval_id") == approval_id)
                ):
                    resolved = {**item, "status": choice or "resolved", "resolvedAt": int(time.time() * 1000)}
                    del queue[idx]
                    HERMES_APPROVAL_PENDING[key] = queue
                    return resolved
    return None


def _detect_hermes_approval_request(reply="", stderr="", original_message="", agent_key="hermes-default"):
    text = f"{reply or ''}\n{stderr or ''}"
    lower = text.lower()
    markers = (
        "timeout — denying command",
        "timeout - denying command",
        "denying command",
        "blocked: user denied",
        "blocked by the command approval system",
        "denied by the approval system",
        "approval system still says",
        "was blocked by the command approval system",
        "approval required",
        "requires approval",
        "dangerous command",
        "command approval",
        "permission prompt",
        "approval prompt",
    )
    if not any(marker in lower for marker in markers):
        return None
    command = ""
    for pattern in (
        r"`([^`\n]{3,500})`",
        r"command(?:\s+I\s+attempted)?\s+was:\s*\n+\s*([^\n]{3,500})",
        r"command\s+was\s+denied:\s*\n+\s*([^\n]{3,500})",
        r"command\s+was\s+blocked:\s*\n+\s*([^\n]{3,500})",
        r"command(?: was)?[:\s]+([^\n]{3,500})",
        r"\n\s*((?:~|/|\.)[^\n]{3,500})",
    ):
        match = re.search(pattern, text, re.IGNORECASE)
        if match:
            candidate = match.group(1).strip()
            if candidate and "BLOCKED:" not in candidate and not candidate.lower().startswith(("system", "approval", "it was", "it is", "the approval")):
                command = candidate[:500]
                break
    seed = f"{agent_key}:{original_message}:{command}:{int(time.time() // 60)}"
    approval_id = "hermes-approval-" + hashlib.sha1(seed.encode("utf-8")).hexdigest()[:16]
    return {
        "id": approval_id,
        "approval_id": approval_id,
        "provider": "hermes",
        "status": "pending",
        "kind": "command",
        "title": "Hermes approval required",
        "description": "Hermes needs permission to retry this turn with approval bypass for this invocation only.",
        "command": command or "Approval-gated Hermes command",
        "message": original_message,
        "agentId": agent_key,
        "choices": ["approve_once", "deny"],
    }


def _approval_result_message(approval, choice):
    label = "approved once and retried" if choice == "approve_once" else "denied"
    return {
        "role": "assistant",
        "text": "",
        "ts": int(time.time() * 1000),
        "agentId": approval.get("agentId") or "hermes-default",
        "approval": {**approval, "status": label, "resolvedAt": int(time.time() * 1000)},
        "tools": [],
        "thinking": "",
        "reasoningTokens": 0,
    }


def _handle_hermes_test(body=None):
    body = body if isinstance(body, dict) else {}
    provider = HermesProvider(
        home_path=os.path.expanduser(body.get("homePath") or HERMES_HOME),
        binary=os.path.expanduser(body.get("binary") or HERMES_BIN),
        enabled=True,
        timeout_sec=int(body.get("timeoutSec") or HERMES_TIMEOUT_SEC),
    ) if HermesProvider else None
    if not provider:
        return {"ok": False, "error": "Hermes provider module unavailable", "agents": []}
    return provider.test()


def _handle_hermes_chat(body):
    if not isinstance(body, dict):
        return {"ok": False, "error": "payload must be an object", "_status": 400}
    agent_key = body.get("agentId") or body.get("key") or body.get("sessionKey") or "hermes-default"
    message = str(body.get("message") or body.get("text") or "").strip()
    if not message:
        return {"ok": False, "error": "message is required", "_status": 400}
    agent = _get_hermes_agent(agent_key)
    if not agent:
        return {"ok": False, "error": f"Hermes agent '{agent_key}' not found", "_status": 404}
    provider = _hermes_provider()
    if not provider:
        return {"ok": False, "error": "Hermes provider module unavailable", "_status": 503}
    timeout = int(body.get("timeoutSec") or HERMES_TIMEOUT_SEC)
    profile = agent.get("profile") or agent.get("providerAgentId") or "default"
    from_type = str(body.get("fromType") or body.get("senderType") or "").strip().lower()
    is_human_source = from_type in {"human", "user", "chat", "ui"}
    source_app = str(body.get("sourceApp") or body.get("app") or "virtual-world").strip() or "virtual-world"
    source_surface = str(body.get("sourceSurface") or body.get("surface") or "chat-window").strip() or "chat-window"
    source_label = str(body.get("sourceLabel") or "").strip()
    sender_name = str(body.get("fromDisplayName") or body.get("displayName") or body.get("fromName") or "User").strip() or "User"
    yolo_once = bool(body.get("yoloOnce") or body.get("approvalApprovedOnce"))
    live_run_id = str(body.get("liveRunId") or body.get("runId") or "").strip()
    delivery_message = message
    if is_human_source:
        pretty_surface = source_label or ("Virtual World Chat" if source_app == "virtual-world" and source_surface in {"chat-window", "chat"} else f"{source_app.replace('-', ' ').title()} {source_surface.replace('-', ' ').title()}".strip())
        delivery_message = (
            f"[A2A from=user name={json.dumps(sender_name)} to={agent.get('id') or agent_key} isUser=true sourceApp={json.dumps(source_app)} sourceSurface={json.dumps(source_surface)}]\n"
            f"Message from {sender_name} via {pretty_surface}.\n\n"
            f"{message}\n\n"
            "Reply directly to the user. Do not assume a personal name unless the user provides one."
        )
    history = _load_hermes_history(profile)
    now_ms = int(time.time() * 1000)
    history.append({
        "role": "user",
        "text": message,
        "ts": now_ms,
        "epochMs": now_ms,
        "from": sender_name if is_human_source else "You",
        "fromType": from_type or "",
        "source": "hermes",
        "sourceApp": source_app if is_human_source else "",
        "sourceSurface": source_surface if is_human_source else "",
        "sourceLabel": source_label if is_human_source else "",
    })
    _save_hermes_history(profile, history)
    progress_id = f"hermes-progress-{now_ms}"
    history.append({
        "role": "assistant",
        "text": "",
        "ts": int(time.time() * 1000),
        "epochMs": int(time.time() * 1000),
        "from": agent.get("name") or "Hermes",
        "source": "hermes",
        "ephemeral": "hermes-progress",
        "progressId": progress_id,
        "runId": live_run_id,
        "tools": [],
        "thinking": "Waiting for native Hermes activity.",
        "reasoningTokens": 0,
    })
    _save_hermes_history(profile, history)
    if _gateway_presence:
        try:
            _gateway_presence.set_manual_override(agent.get("statusKey") or agent.get("id"), "working", "Hermes CLI task")
        except Exception:
            pass
    session_id = _get_hermes_session_id(profile)
    _append_hermes_live_event(live_run_id, "activity", {
        "tools": [],
        "thinking": "Hermes CLI process started.",
        "reasoningTokens": 0,
    })
    stop_live_poll = threading.Event()
    live_thread = _start_hermes_session_activity_poller(live_run_id, provider, profile, session_id, delivery_message, stop_live_poll)
    approval_bridge_dir = _hermes_approval_bridge_dir(live_run_id or f"{profile}-{now_ms}")
    try:
        os.makedirs(os.path.join(approval_bridge_dir, "responses"), exist_ok=True)
        events_path = os.path.join(approval_bridge_dir, "events.jsonl")
        if os.path.exists(events_path):
            with open(events_path, "w", encoding="utf-8"):
                pass
    except Exception:
        approval_bridge_dir = ""
    approval_bridge_thread = _start_hermes_approval_bridge_watcher(
        live_run_id,
        approval_bridge_dir,
        agent.get("id") or agent_key,
        profile,
        stop_live_poll,
    ) if approval_bridge_dir else None
    try:
        result = provider.send_chat_message(
            profile,
            delivery_message,
            session_id=session_id,
            timeout_sec=timeout,
            yolo_once=yolo_once,
            approval_bridge_dir=approval_bridge_dir,
        )
    finally:
        stop_live_poll.set()
        if live_thread:
            live_thread.join(timeout=0.2)
        if approval_bridge_thread:
            approval_bridge_thread.join(timeout=0.2)
    if result.get("sessionId"):
        _set_hermes_session_id(profile, result.get("sessionId"))
    active_session_id = result.get("sessionId") or session_id
    activity = {"tools": [], "thinking": "", "reasoningTokens": 0}
    if active_session_id and hasattr(provider, "export_session"):
        exported = provider.export_session(profile, active_session_id)
        if exported.get("ok"):
            activity = _extract_hermes_turn_activity(exported.get("session"), delivery_message)
    reply = result.get("reply") or result.get("error") or ""
    visible_tools = activity.get("tools") or []
    approval = _detect_hermes_approval_request(reply, result.get("stderr", ""), message, agent.get("id") or agent_key)
    if approval:
        approval = _remember_hermes_approval_pending(approval, agent.get("id") or agent_key, profile, result.get("sessionId") or _get_hermes_session_id(profile))
        _append_hermes_live_event(live_run_id, "approval", {"approval": approval})
    now_ms = int(time.time() * 1000)
    history = _remove_hermes_progress_messages(_load_hermes_history(profile))
    history.append({
        "role": "assistant",
        "text": reply,
        "ts": now_ms,
        "epochMs": now_ms,
        "from": agent.get("name") or "Hermes",
        "source": "hermes",
        "sessionId": active_session_id,
        "exitCode": result.get("exitCode"),
        "tools": visible_tools,
        "thinking": activity.get("thinking") or "",
        "reasoningTokens": activity.get("reasoningTokens") or 0,
        "approval": approval,
    })
    _save_hermes_history(profile, history)
    _append_hermes_live_event(live_run_id, "final", {
        "reply": reply,
        "ok": bool(result.get("ok")),
        "tools": visible_tools,
        "thinking": activity.get("thinking") or "",
        "reasoningTokens": activity.get("reasoningTokens") or 0,
        "approval": approval,
        "error": result.get("error"),
    })
    if _gateway_presence:
        try:
            _gateway_presence.set_manual_override(agent.get("statusKey") or agent.get("id"), "idle" if result.get("ok") else "offline", "")
        except Exception:
            pass
    return {
        "ok": bool(result.get("ok")),
        "reply": reply,
        "agent": {"id": agent.get("id"), "name": agent.get("name"), "providerKind": "hermes", "profile": profile},
        "sessionId": active_session_id,
        "tools": visible_tools,
        "thinking": activity.get("thinking") or "",
        "reasoningTokens": activity.get("reasoningTokens") or 0,
        "approval": approval,
        "error": result.get("error"),
        "stderr": result.get("stderr", ""),
        "exitCode": result.get("exitCode"),
    }


def _handle_hermes_approval_respond(body):
    body = body if isinstance(body, dict) else {}
    approval = body.get("approval") if isinstance(body.get("approval"), dict) else {}
    choice = _normalize_hermes_approval_choice(body.get("choice") or body.get("action") or "")
    if choice not in {"approve_once", "deny"}:
        return {"ok": False, "error": "choice must be approve_once or deny", "_status": 400}
    agent_key = body.get("agentId") or approval.get("agentId") or "hermes-default"
    approval_id = str(body.get("approval_id") or body.get("approvalId") or approval.get("approval_id") or approval.get("id") or "").strip()
    session_id = str(body.get("session_id") or body.get("sessionId") or approval.get("session_id") or approval.get("sessionId") or "").strip()
    queued_approval = _resolve_hermes_approval_pending(agent_key, approval_id, session_id, choice)
    if queued_approval:
        approval = {**queued_approval, **approval}
    message = str(body.get("message") or approval.get("message") or "").strip()
    agent = _get_hermes_agent(agent_key)
    if not agent:
        return {"ok": False, "error": f"Hermes agent '{agent_key}' not found", "_status": 404}
    profile = agent.get("profile") or agent.get("providerAgentId") or "default"
    history = _load_hermes_history(profile)
    history.append(_approval_result_message({**approval, "agentId": agent.get("id") or agent_key, "message": message}, choice))
    _save_hermes_history(profile, history)
    bridge_run_id = str(approval.get("bridgeRunId") or "").strip()
    bridge_approval_id = str(approval.get("bridgeApprovalId") or approval.get("approval_id") or approval.get("id") or "").strip()
    if bridge_run_id and bridge_approval_id:
        bridge_dir = _hermes_approval_bridge_dir(bridge_run_id)
        response_dir = os.path.join(bridge_dir, "responses")
        try:
            os.makedirs(response_dir, exist_ok=True)
            hermes_choice = "once" if choice == "approve_once" else "deny"
            response_path = os.path.join(response_dir, f"{bridge_approval_id}.json")
            with open(response_path, "w", encoding="utf-8") as f:
                json.dump({
                    "choice": hermes_choice,
                    "resolvedAt": int(time.time() * 1000),
                    "source": "virtual-world-chat",
                }, f)
            return {
                "ok": True,
                "choice": choice,
                "message": "Hermes approval response delivered to the running request.",
                "approval": {**approval, "status": "approved" if choice == "approve_once" else "denied"},
                "deferredFinal": True,
            }
        except Exception as exc:
            return {"ok": False, "error": f"failed to resolve live Hermes approval: {exc}", "_status": 500}
    if choice == "deny":
        return {"ok": True, "choice": "deny", "message": "Hermes approval denied."}
    if not message:
        return {"ok": False, "error": "original approval message is missing", "_status": 400}
    result = _handle_hermes_chat({
        "agentId": agent_key,
        "message": message,
        "fromType": "human",
        "fromDisplayName": body.get("fromDisplayName") or "User",
        "sourceApp": "virtual-world",
        "sourceSurface": "chat-window-approval",
        "sourceLabel": "Virtual World Approval",
        "yoloOnce": True,
        "approvalRetry": True,
    })
    result["approvalChoice"] = "approve_once"
    return result


def _agent_ref(agent_id):
    aid = str(agent_id or "")
    for agent in get_roster():
        aliases = {str(agent.get("id") or ""), str(agent.get("statusKey") or ""), str(agent.get("providerAgentId") or "")}
        if aid in aliases:
            return {
                "id": agent.get("statusKey") or agent.get("id"),
                "nativeId": agent.get("providerAgentId") or agent.get("id"),
                "providerKind": agent.get("providerKind", "openclaw"),
                "name": agent.get("name") or agent.get("id"),
                "emoji": agent.get("emoji") or "",
            }
    return {"id": aid, "nativeId": aid, "providerKind": "unknown", "name": aid, "emoji": ""}


def _handle_agent_platform_comm_send(data):
    if not isinstance(data, dict):
        return {"ok": False, "error": "payload must be an object"}, 400
    from_type = str(data.get("fromType") or data.get("senderType") or "agent").strip().lower()
    is_human_source = from_type in {"human", "user", "chat", "ui"}
    from_id = str(data.get("fromAgentId") or data.get("from") or "").strip()
    to_id = str(data.get("toAgentId") or data.get("to") or "").strip()
    message = str(data.get("message") or data.get("text") or "").strip()
    if not from_id and not is_human_source:
        return {"ok": False, "error": "fromAgentId is required"}, 400
    if not to_id:
        return {"ok": False, "error": "toAgentId is required"}, 400
    if not message:
        return {"ok": False, "error": "message is required"}, 400
    source_app = str(data.get("sourceApp") or data.get("app") or "virtual-world").strip() or "virtual-world"
    source_surface = str(data.get("sourceSurface") or data.get("surface") or "agent-platform").strip() or "agent-platform"
    source_label = str(data.get("sourceLabel") or "").strip()
    if is_human_source:
        display_name = str(data.get("fromDisplayName") or data.get("displayName") or data.get("fromName") or "User").strip() or "User"
        from_ref = {
            "id": str(data.get("fromId") or data.get("fromUserId") or "user").strip() or "user",
            "nativeId": str(data.get("fromId") or data.get("fromUserId") or "user").strip() or "user",
            "providerKind": "human",
            "providerType": "chat-window",
            "name": display_name,
            "emoji": "",
            "sourceApp": source_app,
            "sourceSurface": source_surface,
            "sourceLabel": source_label,
        }
    else:
        from_ref = _agent_ref(from_id)
    to_ref = _agent_ref(to_id)
    conversation_id = str(data.get("conversationId") or f"{from_ref['id']}__{to_ref['id']}")
    metadata = data.get("metadata") if isinstance(data.get("metadata"), dict) else {}
    metadata = dict(metadata)
    metadata.setdefault("sourceApp", source_app)
    metadata.setdefault("sourceSurface", source_surface)
    if source_label:
        metadata.setdefault("sourceLabel", source_label)
    inbound = _append_comm_event({
        "type": "message", "direction": "request", "conversationId": conversation_id,
        "from": from_ref, "to": to_ref, "text": message,
        "metadata": metadata,
    })
    if to_ref.get("providerKind") == "hermes" or _is_hermes_agent(to_ref.get("id")):
        result = _handle_hermes_chat({
            "agentId": to_ref.get("id"),
            "message": message,
            "timeoutSec": data.get("timeoutSec") or 180,
            "fromType": from_type,
            "fromDisplayName": from_ref.get("name") or "User",
            "sourceApp": source_app,
            "sourceSurface": source_surface,
            "sourceLabel": source_label,
        })
        reply = result.get("reply") if isinstance(result, dict) else ""
        outbound = _append_comm_event({
            "type": "message", "direction": "reply", "conversationId": conversation_id,
            "from": to_ref, "to": from_ref, "text": reply or (result.get("error") if isinstance(result, dict) else ""),
            "inReplyTo": inbound["id"], "ok": bool(isinstance(result, dict) and result.get("ok")), "via": "virtual-world-hermes-native",
        })
        if isinstance(result, dict):
            result = dict(result)
            result.setdefault("messageId", inbound["id"])
            result.setdefault("replyMessageId", outbound["id"])
            result.setdefault("conversationId", conversation_id)
            return result, int(result.pop("_status", 200) or 200) if result.get("ok") else int(result.pop("_status", 502) or 502)
        return {"ok": False, "error": "Invalid Hermes response", "messageId": inbound["id"], "replyMessageId": outbound["id"]}, 502
    if not AGENT_PLATFORM_PROVIDER_URL:
        return {
            "ok": False,
            "error": "No Virtual World agent-platform provider relay is configured. Set VW_AGENT_PLATFORM_PROVIDER_URL for external-provider delivery; the message was logged locally.",
            "messageId": inbound["id"],
            "conversationId": conversation_id,
        }, 503
    payload = dict(data)
    payload.update({"fromAgentId": from_ref["id"], "toAgentId": to_ref["id"], "message": message, "conversationId": conversation_id})
    result, status = _post_json(f"{AGENT_PLATFORM_PROVIDER_URL}/api/agent-platform-communications/send", payload, timeout=int(data.get("timeoutSec") or 180) + 30)
    reply = result.get("reply") if isinstance(result, dict) else None
    outbound = _append_comm_event({
        "type": "message", "direction": "reply", "conversationId": conversation_id,
        "from": to_ref, "to": from_ref, "text": reply or (result.get("error") if isinstance(result, dict) else ""),
        "inReplyTo": inbound["id"], "ok": bool(isinstance(result, dict) and result.get("ok")), "via": AGENT_PLATFORM_PROVIDER_URL,
    })
    if isinstance(result, dict):
        result = dict(result)
        result.setdefault("messageId", inbound["id"])
        result.setdefault("replyMessageId", outbound["id"])
        result.setdefault("conversationId", conversation_id)
        return result, status
    return {"ok": False, "error": "Invalid upstream response", "messageId": inbound["id"], "replyMessageId": outbound["id"]}, 502


def _resolve_session_jsonl_path(session_path, session_id, sessions_dir):
    """Resolve a session JSONL path without assuming container mount aliases.

    sessions.json may already contain the host-readable absolute path. Prefer it
    exactly as recorded, then fall back to the configured sessions directory. Any
    host/container path mapping must be supplied by configuration (for example by
    setting VW_OPENCLAW_PATH to the readable host tree), not hard-coded here.
    """
    candidates = []
    if session_path:
        candidates.append(session_path)
    if session_id:
        candidates.append(os.path.join(sessions_dir, f"{session_id}.jsonl"))
    for candidate in candidates:
        if candidate and os.path.isfile(candidate):
            return candidate
    return candidates[-1] if candidates else None


def _read_gateway_config():
    config_path = os.path.join(WORKSPACE_BASE, "openclaw.json")
    override_url = (VW_CONFIG.get("openclaw", {}).get("gatewayUrl") or os.environ.get("VW_GATEWAY_URL") or "").strip()
    override_token = (VW_CONFIG.get("openclaw", {}).get("gatewayToken") or os.environ.get("VW_GATEWAY_TOKEN") or "").strip()
    try:
        with open(config_path, "r") as f:
            cfg = json.load(f)
    except Exception:
        return override_url or None, override_token

    gateway_cfg = cfg.get("gateway", {}) or {}
    gw_port = gateway_cfg.get("port", 18789)
    gw_url = override_url or gateway_cfg.get("url") or gateway_cfg.get("gatewayUrl") or f"ws://127.0.0.1:{gw_port}"
    gw_token = override_token or ((gateway_cfg.get("auth") or {}).get("token", "") or "").strip()
    return gw_url, gw_token


def initialize_live_presence():
    global _presence_enabled, _presence_snapshot_thread
    if not _gateway_presence:
        print("⚠️  Virtual World presence: gateway_presence unavailable, falling back to legacy status file")
        return
    if _presence_enabled:
        return

    agent_ids = [a.get("statusKey") or a.get("id") for a in get_roster() if a.get("statusKey") or a.get("id")]
    if agent_ids:
        _gateway_presence.init_agents(agent_ids)

    try:
        _gateway_presence.set_meetings_file(STATUS_FILE)
    except Exception:
        pass

    try:
        _gateway_presence.load_snapshot(_presence_snapshot_path)
    except Exception as e:
        print(f"⚠️  Virtual World presence: could not load snapshot: {e}")

    gw_url, gw_token = _read_gateway_config()
    if gw_url and gw_token:
        try:
            _gateway_presence.start(gw_url, gw_token, port=PORT, client_version=_get_openclaw_version())
            _presence_enabled = True
        except Exception as e:
            print(f"⚠️  Virtual World presence: failed to start gateway listener: {e}")
    else:
        print("⚠️  Virtual World presence: missing gateway config/token, falling back to legacy status file")

    if _presence_enabled and _presence_snapshot_thread is None:
        def snapshot_loop():
            while True:
                time.sleep(30)
                try:
                    _gateway_presence.save_snapshot(_presence_snapshot_path)
                except Exception:
                    pass

        _presence_snapshot_thread = threading.Thread(target=snapshot_loop, daemon=True, name="vw-presence-snapshot")
        _presence_snapshot_thread.start()


def _normalize_presence_entry(entry):
    if not isinstance(entry, dict):
        return {"state": "offline", "task": "", "updated": 0, "source": "invalid"}
    state = str(entry.get("state") or entry.get("status") or entry.get("presence") or entry.get("activity") or "offline").strip().lower()
    state = {
        "busy": "working",
        "thinking": "working",
        "processing": "working",
        "responding": "working",
        "running": "working",
        "reading": "working",
        "reading_file": "working",
        "reading-file": "working",
        "analyzing": "working",
        "planning": "working",
        "reasoning": "working",
        "inference": "working",
        "inferencing": "working",
        "generating": "working",
        "streaming": "working",
        "executing": "working",
        "command": "working",
        "command_output": "working",
        "tool": "working",
        "tool_start": "working",
        "running_command": "working",
        "available": "idle",
    }.get(state, state)
    if state not in {"working", "finishing", "idle", "meeting", "break", "offline"}:
        state = "offline" if not state else state
    normalized = dict(entry)
    normalized["state"] = state
    normalized["task"] = str(entry.get("task") or "")
    normalized["updated"] = int(entry.get("updated") or 0) if str(entry.get("updated") or "").isdigit() else entry.get("updated", 0)
    normalized["source"] = str(entry.get("source") or "legacy")
    try:
        updated_epoch = float(normalized.get("updated") or 0)
    except (TypeError, ValueError):
        updated_epoch = 0
    source_lower = str(normalized.get("source") or "").lower()
    task_lower = str(normalized.get("task") or "").strip().lower()
    # Active lifecycle/tool sources can be silent during long commands. Generic
    # chat/snapshot display states must still age out if maintenance missed the
    # terminal event, otherwise disconnected apps can show stale working status.
    has_active_work_source = source_lower.startswith(("agent-lifecycle", "agent-tool", "session-tool", "gateway"))
    stale_limit_sec = 180 if (
        "tool" in source_lower or "command" in source_lower or
        any(token in task_lower for token in ("reading", "processing", "thinking", "running command", "editing", "writing", "searching", "fetching"))
    ) else 45
    if (
        not has_active_work_source
        and state in {"working", "finishing"}
        and updated_epoch > 0
        and (time.time() - updated_epoch) > stale_limit_sec
    ):
        normalized["state"] = "idle"
        normalized["task"] = ""
        normalized["source"] = f"{normalized.get('source') or 'presence'}-stale-idle"
    return normalized


def _normalize_presence_map(data):
    if not isinstance(data, dict):
        return {}
    result = {}
    for key, value in data.items():
        if key == "_meetings":
            result[key] = value if isinstance(value, list) else []
        elif isinstance(value, dict):
            result[key] = _normalize_presence_entry(value)
    return result


def _load_local_presence_state():
    if _presence_enabled and _gateway_presence:
        try:
            return _normalize_presence_map(_gateway_presence.get_state())
        except Exception as e:
            print(f"⚠️  Virtual World presence: falling back to status file after read error: {e}")
    return _normalize_presence_map(_load_status_file())


def load_agent_status():
    # Virtual World owns its presence state. It derives status directly from the
    # local OpenClaw gateway listener and only falls back to local status files.
    return _load_local_presence_state()


def load_presence_debug():
    if _presence_enabled and _gateway_presence and hasattr(_gateway_presence, "get_connection_status"):
        try:
            return {**_gateway_presence.get_connection_status(), "source": "virtual-world", "statusEndpoint": "/api/status"}
        except Exception as e:
            return {"connected": False, "error": str(e), "agentsCached": 0, "debug": {}, "source": "virtual-world", "statusEndpoint": "/api/status"}
    local_state = _load_local_presence_state()
    return {
        "connected": False,
        "error": None if local_state else "gateway presence unavailable; using legacy status file",
        "agentsCached": len([k for k in local_state.keys() if not str(k).startswith("_")]),
        "debug": {"sessionListCalls": 0, "events": {}, "snapshots": 0},
        "source": "legacy-status-file",
        "statusEndpoint": "/api/status",
    }


# ─── AGENT DISCOVERY (VO-compatible when available) ──────────────
def _identity_candidates_for_agent(agent_id):
    safe_id = re.sub(r"[^A-Za-z0-9_.-]", "", str(agent_id or ""))
    if not safe_id:
        return []
    candidates = [
        os.path.join(WORKSPACE_BASE, "agents", safe_id, "agent", "IDENTITY.md"),
        os.path.join(WORKSPACE_BASE, f"workspace-{safe_id}", "IDENTITY.md"),
        os.path.join(WORKSPACE_BASE, "workspace", safe_id, "IDENTITY.md"),
    ]
    if safe_id == "main":
        candidates.append(os.path.join(WORKSPACE_BASE, "workspace", "IDENTITY.md"))
    return candidates


def _read_agent_identity(agent_id):
    for identity_file in _identity_candidates_for_agent(agent_id):
        if not os.path.isfile(identity_file):
            continue
        identity = {}
        try:
            with open(identity_file, "r") as f:
                for line in f:
                    line = line.strip()
                    if line.startswith("- **Name:**"):
                        parsed_name = line.split(":**", 1)[1].strip()
                        if parsed_name:
                            identity["name"] = parsed_name
                    elif line.startswith("- **Emoji:**"):
                        parsed_emoji = line.split(":**", 1)[1].strip()
                        if parsed_emoji:
                            identity["emoji"] = parsed_emoji
        except OSError:
            continue
        if identity:
            return identity
    return {}


def _apply_identity_to_agent(agent):
    enriched = dict(agent)
    ids = []
    for key in ("id", "statusKey", "agentId", "key"):
        value = enriched.get(key)
        if value and value not in ids:
            ids.append(value)
    for agent_id in ids:
        identity = _read_agent_identity(agent_id)
        if identity:
            enriched.update(identity)
            break
    return enriched


def _apply_identities_to_roster(roster):
    return [_apply_identity_to_agent(agent) for agent in roster]


def discover_agents():
    """Discover agents from OpenClaw using Virtual World's own local scanner."""
    agents_dir = os.path.join(WORKSPACE_BASE, "agents")
    agents = []
    if os.path.isdir(agents_dir):
        for name in sorted(os.listdir(agents_dir)):
            agent_dir = os.path.join(agents_dir, name, "agent")
            if not os.path.isdir(agent_dir):
                continue
            agent_info = {"id": name, "statusKey": name, "name": name.capitalize(), "emoji": "🤖", "providerKind": "openclaw", "providerType": "runtime", "providerAgentId": name}
            agents.append(_apply_identity_to_agent(agent_info))
    agents.extend(_discover_hermes_agents())
    return agents


def _agent_profile_key(agent):
    return str(agent.get("statusKey") or agent.get("id") or "").strip()


def _find_agent_identity_file(agent_id):
    safe_id = re.sub(r"[^A-Za-z0-9_.-]", "", str(agent_id or ""))
    candidates = [
        os.path.join(WORKSPACE_BASE, "agents", safe_id, "agent", "IDENTITY.md"),
        os.path.join(WORKSPACE_BASE, f"workspace-{safe_id}", "IDENTITY.md"),
        os.path.join(WORKSPACE_BASE, "workspace", "IDENTITY.md") if safe_id == "main" else None,
    ]
    for candidate in candidates:
        if candidate and os.path.isfile(candidate):
            return candidate
    return None


def _update_identity_field(file_path, label, value):
    if not file_path or value is None:
        return False
    try:
        with open(file_path, "r") as f:
            content = f.read()
        pattern = re.compile(rf"^- \*\*{re.escape(label)}:\*\*.*$", re.MULTILINE)
        replacement = f"- **{label}:** {value}"
        if pattern.search(content):
            content = pattern.sub(replacement, content, count=1)
        else:
            content = content.rstrip() + "\n" + replacement + "\n"
        with open(file_path, "w") as f:
            f.write(content)
        return True
    except OSError:
        return False


def _agent_profile_for(meta, agent_id):
    profiles = meta.get("agentProfiles", {}) if isinstance(meta.get("agentProfiles"), dict) else {}
    resolved_id = _resolve_agent_id(agent_id)
    if not resolved_id:
        return None, None, None
    profile = profiles.get(resolved_id, {}) if isinstance(profiles.get(resolved_id), dict) else {}
    return profiles, resolved_id, profile


def _agent_live_mode_enabled_from_profile(profile):
    if isinstance(profile, dict) and isinstance(profile.get("agentLiveModeEnabled"), bool):
        return profile.get("agentLiveModeEnabled")
    return AGENT_LIVE_MODE_DEFAULT_ENABLED


def get_agent_live_mode_setting(agent_id):
    meta = load_world_meta()
    _, resolved_id, profile = _agent_profile_for(meta, agent_id)
    if not resolved_id:
        return None
    return {
        "agentId": resolved_id,
        "agentLiveModeEnabled": _agent_live_mode_enabled_from_profile(profile),
        "storage": "world-meta.json agentProfiles[agentId].agentLiveModeEnabled",
        "defaulted": not (isinstance(profile, dict) and isinstance(profile.get("agentLiveModeEnabled"), bool)),
    }


def set_agent_live_mode_setting(agent_id, enabled):
    if not isinstance(enabled, bool):
        return False, _api_error("invalid_payload", "agentLiveModeEnabled must be a boolean"), 400
    meta = load_world_meta()
    profiles, resolved_id, profile = _agent_profile_for(meta, agent_id)
    if not resolved_id:
        return False, _api_error("agent_not_found", "Unknown agent id for Agent Live Mode setting.", details={"agentId": agent_id}), 404
    next_profile = dict(profile or {})
    next_profile["agentLiveModeEnabled"] = enabled
    profiles[resolved_id] = next_profile
    meta["agentProfiles"] = profiles
    save_world_meta(meta)
    return True, {
        "ok": True,
        "agentId": resolved_id,
        "agentLiveModeEnabled": enabled,
        "storage": "world-meta.json agentProfiles[agentId].agentLiveModeEnabled",
    }, 200


def _agent_live_mode_disabled_error(agent_id):
    return _api_error(
        "agent_live_mode_disabled",
        "Agent Live Mode is disabled for this agent; agent-model action requests are rejected until agentLiveModeEnabled is true.",
        details={"agentId": agent_id, "agentLiveModeEnabled": False},
    )


def _merge_agent_profiles(roster):
    meta = load_world_meta()
    profiles = meta.get("agentProfiles", {}) if isinstance(meta.get("agentProfiles"), dict) else {}
    merged = []
    for agent in roster:
        a = dict(agent)
        profile = profiles.get(_agent_profile_key(a)) or profiles.get(str(a.get("id"))) or {}
        a["agentLiveModeEnabled"] = _agent_live_mode_enabled_from_profile(profile)
        if isinstance(profile, dict):
            if profile.get("name"):
                a["name"] = profile["name"]
            if profile.get("emoji"):
                a["emoji"] = profile["emoji"]
            if isinstance(profile.get("appearance"), dict):
                a["appearance"] = profile["appearance"]
            if isinstance(profile.get("docs"), dict):
                a["docs"] = profile["docs"]
        merged.append(a)
    return merged

_agent_roster = discover_agents()
_roster_time = time.time()

# ─── AGENT CHAT ───────────────────────────────────────────────────
from datetime import datetime, timezone, timedelta
import zoneinfo

# Timezone for server-side fallback strings only. The Virtual World app should
# prefer raw timestamps and let each user's browser render local chat times.
def _get_tz():
    tz_name = os.environ.get("VW_TIMEZONE", "")
    if tz_name:
        try:
            return zoneinfo.ZoneInfo(tz_name)
        except Exception:
            pass
    # Prefer system local if configured; otherwise use UTC rather than a
    # product/user-specific timezone.
    try:
        return datetime.now().astimezone().tzinfo
    except Exception:
        return timezone.utc

_LOCAL_TZ = _get_tz()
_chat_cache = {}
_chat_cache_time = 0

def _format_tool_activity(item):
    """Format a tool_use content item into a short emoji+text description."""
    name = item.get("name", "")
    inp = item.get("input", {})
    if name == "exec":
        cmd = inp.get("command", "")[:60]
        return f"⚙️ {cmd}"
    elif name == "sessions_send":
        target = inp.get("label", inp.get("sessionKey", ""))[:30]
        return f"✉️ → {target}"
    elif name == "Read" or name == "read":
        path = inp.get("file", inp.get("path", inp.get("filePath", "")))
        return f"📄 {os.path.basename(path or '?')}"
    elif name == "Edit" or name == "edit":
        path = inp.get("file", inp.get("path", inp.get("filePath", "")))
        return f"✏️ {os.path.basename(path or '?')}"
    elif name == "Write" or name == "write":
        path = inp.get("file", inp.get("path", inp.get("filePath", "")))
        return f"💾 {os.path.basename(path or '?')}"
    elif name == "web_search":
        return f"🔍 {inp.get('query', '')[:40]}"
    elif name == "web_fetch":
        return f"🌐 {inp.get('url', '')[:40]}"
    elif name == "message":
        return f"💬 {inp.get('message', '')[:40]}"
    elif name == "sessions_spawn":
        return f"🚀 spawn: {inp.get('task', '')[:40]}"
    else:
        return f"🔧 {name}"

def _format_time_et(ts):
    """Convert ISO timestamp or epoch ms to HH:MM AM/PM ET."""
    try:
        if isinstance(ts, (int, float)):
            dt = datetime.fromtimestamp(ts / 1000 if ts > 1e12 else ts, tz=timezone.utc)
        elif isinstance(ts, str):
            ts_clean = ts.replace("Z", "+00:00")
            dt = datetime.fromisoformat(ts_clean)
        else:
            return ""
        dt_et = dt.astimezone(_LOCAL_TZ)
        return dt_et.strftime("%I:%M %p").lstrip("0")
    except:
        return ""

def get_agent_chat():
    """Read recent chat messages from agent session JSONL files."""
    global _chat_cache, _chat_cache_time
    now = time.time()
    if now - _chat_cache_time < 2:  # cache for 2 seconds
        return _chat_cache

    result = {}
    roster = get_roster()

    for agent in roster:
        agent_id = agent.get("id", "")
        if not agent_id:
            continue
        sessions_dir = os.path.join(WORKSPACE_BASE, "agents", agent_id, "sessions")
        sessions_json = os.path.join(sessions_dir, "sessions.json")

        if not os.path.isfile(sessions_json):
            continue

        try:
            with open(sessions_json, "r") as f:
                sessions = json.load(f)

            # Find most recently updated main session
            if isinstance(sessions, dict):
                best_key = None
                best_time = 0
                for key, sess in sessions.items():
                    if "subagent" in key:
                        continue  # skip subagent sessions
                    updated = sess.get("updatedAt", 0)
                    if updated > best_time:
                        best_time = updated
                        best_key = key
                if not best_key:
                    continue
                sess_id = sessions[best_key].get("sessionId", "")
            elif isinstance(sessions, list):
                sessions.sort(key=lambda s: s.get("updatedAt", 0), reverse=True)
                sess_id = sessions[0].get("sessionId", "")
            else:
                continue

            if not sess_id:
                continue

            best_meta = sessions.get(best_key, {}) or {}
            jsonl_path = _resolve_session_jsonl_path(
                best_meta.get("sessionFile"),
                sess_id,
                sessions_dir,
            )
            if not jsonl_path or not os.path.isfile(jsonl_path):
                continue

            # Read a wider tail so busy sessions still surface recent visible commentary.
            # 32KB was too small for agents like coder/main, causing false "Responding..." fallbacks.
            file_size = os.path.getsize(jsonl_path)
            read_start = max(0, file_size - 524288)

            messages = []
            with open(jsonl_path, "r", errors="replace") as f:
                if read_start > 0:
                    f.seek(read_start)
                    f.readline()  # skip partial first line
                for line in f:
                    line = line.strip()
                    if not line:
                        continue
                    try:
                        entry = json.loads(line)
                    except json.JSONDecodeError:
                        continue

                    if entry.get("type") != "message":
                        continue

                    msg = entry.get("message", {})
                    role = msg.get("role", "")
                    if role == "toolResult":
                        continue

                    content = msg.get("content", "")
                    ts = entry.get("timestamp", "")
                    time_str = _format_time_et(ts)
                    from_name = agent.get("name", agent_id)

                    if isinstance(content, str):
                        if content.strip():
                            messages.append({
                                "role": role,
                                "text": content[:500],
                                "time": time_str,
                                "from": from_name
                            })
                    elif isinstance(content, list):
                        for item in content:
                            item_type = item.get("type", "")
                            if item_type == "text":
                                text = item.get("text", "").strip()
                                if text:
                                    messages.append({
                                        "role": role,
                                        "text": text[:500],
                                        "time": time_str,
                                        "from": from_name
                                    })
                            elif item_type == "tool_use":
                                activity = _format_tool_activity(item)
                                messages.append({
                                    "role": role,
                                    "text": activity,
                                    "time": time_str,
                                    "from": from_name
                                })

            # Keep last 500 messages
            result[agent_id] = messages[-500:]

        except Exception as e:
            pass  # skip agents with read errors

    for agent in roster:
        if agent.get("providerKind") == "hermes":
            profile = agent.get("profile") or agent.get("providerAgentId") or "default"
            hermes_messages = []
            for msg in _load_hermes_history(profile):
                if not isinstance(msg, dict):
                    continue
                hermes_messages.append({
                    "role": msg.get("role") or "assistant",
                    "text": str(msg.get("text") or msg.get("content") or ""),
                    "time": msg.get("time") or "",
                    "ts": msg.get("ts") or msg.get("epochMs") or msg.get("timestamp") or 0,
                    "epochMs": msg.get("epochMs") or msg.get("ts") or 0,
                    "from": msg.get("from") or agent.get("name") or "Hermes",
                    "source": "hermes",
                    "sessionId": msg.get("sessionId") or "",
                    "exitCode": msg.get("exitCode"),
                    "tools": msg.get("tools") if isinstance(msg.get("tools"), list) else [],
                    "thinking": msg.get("thinking") or "",
                    "reasoningTokens": msg.get("reasoningTokens") or 0,
                    "approval": msg.get("approval") if isinstance(msg.get("approval"), dict) else None,
                })
            if hermes_messages:
                result.setdefault(agent.get("id"), []).extend(hermes_messages[-500:])

    # Merge Virtual World's own local A2A log so world-originated
    # communication remains visible from world UI surfaces.
    local_events = _load_comm_history(limit=1000)
    for event in local_events:
        if not event.get("visibleInWorld", True):
            continue
        from_ref = event.get("from") or {}
        to_ref = event.get("to") or {}
        if (
            from_ref.get("providerKind") == "hermes"
            or to_ref.get("providerKind") == "hermes"
            or _is_hermes_agent(from_ref.get("id"))
            or _is_hermes_agent(to_ref.get("id"))
        ):
            continue
        for ref in [event.get("from") or {}, event.get("to") or {}]:
            agent_key = ref.get("id")
            if not agent_key:
                continue
            role = "assistant" if from_ref.get("id") == agent_key else "user"
            msg = {
                "role": role,
                "text": str(event.get("text") or ""),
                "ts": event.get("ts", 0),
                "epochMs": event.get("ts", 0),
                "from": from_ref.get("name") or from_ref.get("id") or "Agent",
                "to": to_ref.get("name") or to_ref.get("id") or "Agent",
                "source": "agent-platform-communications",
                "conversationId": event.get("conversationId", ""),
            }
            result.setdefault(agent_key, []).append(msg)
    for agent_key, messages in list(result.items()):
        seen = set()
        cleaned = []
        for msg in messages:
            if not isinstance(msg, dict):
                continue
            if not str(msg.get("time") or "").strip():
                raw_ts = msg.get("epochMs") or msg.get("ts") or msg.get("timestamp") or msg.get("createdAt") or msg.get("updatedAt")
                msg["time"] = _format_time_et(raw_ts)
            key = (msg.get("source"), msg.get("role"), msg.get("text"), msg.get("epochMs") or msg.get("ts") or msg.get("time"))
            if key in seen:
                continue
            seen.add(key)
            cleaned.append(msg)
        try:
            cleaned.sort(key=lambda m: int(m.get("epochMs") or m.get("ts") or 0))
        except Exception:
            pass
        result[agent_key] = cleaned[-500:]

    # Fallback: if an actively working agent has no parsed session chat yet,
    # synthesize a bubble from the live task so the world mirrors VO behavior.
    status = load_agent_status()
    now_iso = datetime.now(timezone.utc).isoformat()
    for agent in roster:
        agent_id = agent.get("id", "")
        status_key = agent.get("statusKey") or agent_id
        if not agent_id or result.get(agent_id):
            continue
        snapshot = status.get(status_key, {}) or status.get(agent_id, {}) or {}
        agent_state = snapshot.get("state", snapshot.get("status", "offline"))
        task = (snapshot.get("task") or "").strip()
        if agent_state == "working" and task:
            result[agent_id] = [{
                "role": "assistant",
                "text": task,
                "time": _format_time_et(now_iso),
                "from": "task",
            }]

    _chat_cache = result
    _chat_cache_time = now
    return result

def get_roster():
    global _agent_roster, _roster_time
    if time.time() - _roster_time > 300:
        _agent_roster = discover_agents()
        _roster_time = time.time()
        if _gateway_presence:
            try:
                _gateway_presence.init_agents([
                    a.get("statusKey") or a.get("id") for a in _agent_roster if a.get("statusKey") or a.get("id")
                ])
            except Exception:
                pass
    return _merge_agent_profiles(_agent_roster)

# ─── HTTP HANDLER ─────────────────────────────────────────────────
CLIENT_DIR = os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "client")

def _resolve_node_modules_dir():
    configured = os.environ.get("VW_NODE_MODULES_DIR", "").strip()
    candidates = [configured] if configured else []
    # Docker layout: /app/client, /app/server, /app/node_modules.
    candidates.append(os.path.abspath(os.path.join(CLIENT_DIR, "..", "node_modules")))
    # Source checkout layout: repo/src/client, repo/node_modules.
    candidates.append(os.path.abspath(os.path.join(CLIENT_DIR, "..", "..", "node_modules")))
    for candidate in candidates:
        if candidate and os.path.isdir(candidate):
            return candidate
    return candidates[0] if candidates else os.path.abspath(os.path.join(CLIENT_DIR, "..", "node_modules"))

NODE_MODULES_DIR = _resolve_node_modules_dir()

class VWHandler(http.server.SimpleHTTPRequestHandler):
    def __init__(self, *args, **kwargs):
        super().__init__(*args, directory=CLIENT_DIR, **kwargs)

    def translate_path(self, path):
        parsed_path = urllib.parse.urlparse(path).path
        if parsed_path == "/node_modules" or parsed_path.startswith("/node_modules/"):
            rel = urllib.parse.unquote(parsed_path[len("/node_modules"):]).lstrip("/")
            resolved = os.path.realpath(os.path.join(NODE_MODULES_DIR, rel))
            root = os.path.realpath(NODE_MODULES_DIR)
            if resolved == root or resolved.startswith(root + os.sep):
                return resolved
            return root
        return super().translate_path(path)

    def send_error(self, code, message=None, explain=None):
        self._vw_send_error_status = code
        return super().send_error(code, message, explain)

    def end_headers(self):
        request_path = urllib.parse.urlparse(getattr(self, "path", "")).path
        if getattr(self, "_vw_send_error_status", None):
            # Do not let a transient missing static asset poison browser caches.
            self.send_header("Cache-Control", "no-store")
        elif request_path in {"/", "/index.html"}:
            # Public-app cache policy: always revalidate HTML so new versioned
            # asset URLs reach every user, while static files can be cached.
            self.send_header("Cache-Control", "no-cache, must-revalidate")
        elif request_path.endswith((".css", ".js", ".mjs", ".png", ".jpg", ".jpeg", ".webp", ".svg", ".wasm")):
            self.send_header("Cache-Control", "public, max-age=31536000, immutable")
        super().end_headers()

    def log_message(self, fmt, *args):
        # Quiet logging — only errors
        if args and isinstance(args[0], str) and args[0].startswith("GET") and "200" in str(args[-1] if len(args) > 2 else ""):
            return
        super().log_message(fmt, *args)

    def _send_json(self, data, status=200):
        body = json.dumps(data).encode("utf-8")
        self.send_response(status)
        self.send_header("Content-Type", "application/json")
        self.send_header("Content-Length", str(len(body)))
        self.send_header("Access-Control-Allow-Origin", "*")
        self.end_headers()
        self.wfile.write(body)

    def _read_body(self):
        length = int(self.headers.get("Content-Length", 0))
        if length == 0:
            return None
        body = self.rfile.read(length)
        return json.loads(body)

    def _serve_chat_media(self, query):
        params = urllib.parse.parse_qs(query)
        requested = (params.get("path") or [""])[0]
        if not requested:
            self.send_error(400, "Missing path")
            return

        # Browser-visible chat history may contain host paths. Map them to the
        # container's configured, read-only/read-write public upload roots.
        candidates = []
        if os.path.isabs(requested):
            candidates.append(requested)
            host_upload_root = os.path.join(HOST_WORKSPACE_BASE, "workspace", "uploads")
            if requested.startswith(host_upload_root + os.sep):
                candidates.append(os.path.join(UPLOADS_DIR, os.path.relpath(requested, host_upload_root)))
        else:
            candidates.append(os.path.join(UPLOADS_DIR, requested))
            candidates.append(os.path.join(STATUS_DIR, "uploads", requested))

        allowed_roots = [UPLOADS_DIR, os.path.join(STATUS_DIR, "uploads")]
        for candidate in candidates:
            try:
                real = os.path.realpath(candidate)
                if not any(real == os.path.realpath(root) or real.startswith(os.path.realpath(root) + os.sep) for root in allowed_roots):
                    continue
                if not os.path.isfile(real):
                    continue
                ctype = mimetypes.guess_type(real)[0] or "application/octet-stream"
                self.send_response(200)
                self.send_header("Content-Type", ctype)
                self.send_header("Content-Length", str(os.path.getsize(real)))
                self.send_header("Cache-Control", "public, max-age=3600")
                self.end_headers()
                with open(real, "rb") as f:
                    shutil.copyfileobj(f, self.wfile)
                return
            except Exception:
                continue
        self.send_error(404, "File not found")

    def do_OPTIONS(self):
        self.send_response(204)
        self.send_header("Access-Control-Allow-Origin", "*")
        self.send_header("Access-Control-Allow-Methods", "GET, POST, PUT, DELETE, OPTIONS")
        self.send_header("Access-Control-Allow-Headers", "Content-Type")
        self.end_headers()

    def do_GET(self):
        parsed = urllib.parse.urlparse(self.path)
        path = parsed.path

        if path == "/setup":
            setup_path = os.path.join(CLIENT_DIR, "setup.html")
            if os.path.isfile(setup_path):
                self.send_response(200)
                self.send_header("Content-Type", "text/html; charset=utf-8")
                self.send_header("Cache-Control", "no-cache, must-revalidate")
                self.end_headers()
                with open(setup_path, "rb") as f:
                    self.wfile.write(f.read())
                return
            return self._send_json({"error": "Setup page not found"}, 404)

        # --- API Routes ---
        if path == "/api/license":
            return self._send_json(get_license_status())

        if path == "/vw-config":
            return self._send_json(_safe_vw_config())

        if path == "/browser-status":
            cdp_url = (VW_CONFIG.get("browser") or {}).get("cdpUrl") or ""
            viewer_url = (VW_CONFIG.get("browser") or {}).get("viewerUrl") or ""
            configured = bool((VW_CONFIG.get("features") or {}).get("agentBrowser"))
            licensed = check_feature("agentBrowser")
            cdp_available = False
            if configured and licensed and cdp_url:
                try:
                    urllib.request.urlopen(cdp_url.rstrip("/") + "/json", timeout=2)
                    cdp_available = True
                except Exception:
                    pass
            return self._send_json({
                "enabled": configured and licensed,
                "configured": configured,
                "locked": not licensed,
                "licensed": licensed,
                "cdpAvailable": cdp_available,
                "cdpUrl": cdp_url,
                "viewerUrl": viewer_url,
            })

        if path == "/browser-tabs":
            if not check_feature("agentBrowser"):
                return self._send_json(_locked_response("agentBrowser"), 403)
            cdp_url = (VW_CONFIG.get("browser") or {}).get("cdpUrl") or ""
            if not cdp_url:
                return self._send_json({"available": False, "error": "CDP URL is not configured"})
            try:
                req = urllib.request.urlopen(cdp_url.rstrip("/") + "/json", timeout=2)
                return self._send_json(json.loads(req.read().decode("utf-8")))
            except Exception as e:
                return self._send_json({"available": False, "error": str(e)})

        if path == "/browser-controller":
            if not check_feature("agentBrowser"):
                return self._send_json(_locked_response("agentBrowser"), 403)
            return self._send_json({"agent": None})

        if path == "/sms-status":
            return self._send_json(_sms_status_payload())

        if path == "/sms-threads":
            if not check_feature("sms"):
                return self._send_json(_locked_response("sms"), 403)
            return self._send_json({"threads": _sms_threads()})

        if path == "/sms-thread":
            if not check_feature("sms"):
                return self._send_json(_locked_response("sms"), 403)
            qs = urllib.parse.parse_qs(parsed.query)
            phone = (qs.get("phone") or [""])[0]
            messages = [m for m in _load_sms_log() if m.get("to") == phone or m.get("from") == phone]
            return self._send_json({"phone": phone, "messages": messages[-250:]})

        if path == "/sms-contacts":
            if not check_feature("sms"):
                return self._send_json(_locked_response("sms"), 403)
            return self._send_json({"contacts": [{"phone": item["phone"], "name": item["phone"]} for item in _sms_threads()]})

        if path == "/api/meta":
            return self._send_json(load_world_meta())

        if path in {"/api/world-action-events", "/api/world-actions/events"}:
            return self._send_json(list_world_action_events(urllib.parse.parse_qs(parsed.query)))

        if path == "/api/world-actions":
            return self._send_json(reconcile_world_action_reservations())

        if path == "/api/world-actions/active":
            return self._send_json(reconcile_world_action_reservations().get("active", []))

        if path == "/api/world-actions/history":
            return self._send_json(reconcile_world_action_reservations().get("history", []))

        if path == "/api/world-actions/object-availability":
            query = urllib.parse.parse_qs(parsed.query)
            target = {
                "kind": "object-instance",
                "objectInstanceId": (query.get("objectInstanceId") or query.get("id") or [None])[0],
                "buildingId": (query.get("buildingId") or [None])[0],
                "catalogId": (query.get("catalogId") or [None])[0],
                "interactionSpotId": (query.get("interactionSpotId") or query.get("spotId") or [None])[0],
            }
            if query.get("floor"):
                try:
                    target["floor"] = int(query.get("floor")[0])
                except (TypeError, ValueError):
                    pass
            return self._send_json({"ok": True, "target": target, "availability": get_object_availability(target, agent_id=(query.get("agentId") or [None])[0], store=reconcile_world_action_reservations())})

        if path == "/api/chunks":
            return self._send_json(list_chunks())

        if path.startswith("/api/chunk/"):
            parts = path.split("/")
            if len(parts) >= 5:
                try:
                    cx, cy = int(parts[3]), int(parts[4])
                    chunk = load_chunk(cx, cy)
                    if chunk:
                        return self._send_json(chunk)
                    else:
                        return self._send_json(None)  # no chunk = generate default on client
                except (ValueError, IndexError):
                    pass
            return self._send_json({"error": "Invalid chunk coords"}, 400)

        if path == "/api/buildings":
            return self._send_json(list_buildings())

        if path.startswith("/api/building/"):
            building_id = path.split("/")[-1]
            building = load_building(building_id)
            if building:
                return self._send_json(building)
            return self._send_json({"error": "Not found"}, 404)

        if path == "/api/agents":
            roster = get_roster()
            total_agents = len(roster)
            roster = _limited(roster, get_agent_limit())
            status = load_agent_status()
            # Load agent assignments from world meta
            meta = load_world_meta()
            assignments = meta.get("agentAssignments", {})
            # Merge status + assignments into roster
            result = []
            for agent in roster:
                a = dict(agent)
                status_key = agent.get("statusKey") or agent.get("id")
                agent_status = status.get(status_key, {}) or status.get(agent.get("id"), {})
                a["status"] = agent_status.get("state", agent_status.get("status", "offline"))
                a["task"] = agent_status.get("task", "")
                a["homeBuilding"] = assignments.get(status_key, assignments.get(agent["id"], {})).get("home")
                a["workBuilding"] = assignments.get(status_key, assignments.get(agent["id"], {})).get("work")
                profile = (meta.get("agentProfiles", {}) or {}).get(status_key) or (meta.get("agentProfiles", {}) or {}).get(agent.get("id")) or {}
                a["agentLiveModeEnabled"] = _agent_live_mode_enabled_from_profile(profile)
                if isinstance(profile.get("appearance"), dict):
                    a["appearance"] = profile["appearance"]
                if isinstance(profile.get("personality"), dict):
                    a["personality"] = profile["personality"]
                result.append(a)
            return self._send_json(result)

        if path.startswith("/api/agent/") and path.endswith("/live-mode"):
            parts = path.strip("/").split("/")
            agent_id = urllib.parse.unquote(parts[2]) if len(parts) >= 3 else ""
            setting = get_agent_live_mode_setting(agent_id)
            if not setting:
                return self._send_json(_api_error("agent_not_found", "Unknown agent id for Agent Live Mode setting.", details={"agentId": agent_id}), 404)
            return self._send_json(setting)

        if path == "/api/assignments":
            meta = load_world_meta()
            return self._send_json(meta.get("agentAssignments", {}))

        if path == "/api/decorations":
            meta = load_world_meta()
            return self._send_json(meta.get("decorations", []))

        if path == "/api/streets":
            meta = load_world_meta()
            return self._send_json(ensure_checkpoint_streets(meta, persist=True))

        if path == "/api/status":
            return self._send_json(load_agent_status())

        if path in {"/api/presence", "/api/presence/"}:
            return self._send_json(load_agent_status())

        if path == "/api/presence/debug":
            return self._send_json(load_presence_debug())

        if path.startswith("/api/presence/"):
            agent_id = urllib.parse.unquote(path.split("/")[-1])
            status = load_agent_status()
            return self._send_json(status.get(agent_id, {"state": "offline", "task": "", "updated": 0, "source": "not-found"}))

        if path == "/api/agent-chat":
            return self._send_json(get_agent_chat())

        if path == "/api/agent-platform-communications/skill":
            self.send_response(200)
            self.send_header("Content-Type", "text/markdown; charset=utf-8")
            self.send_header("Access-Control-Allow-Origin", "*")
            self.end_headers()
            self.wfile.write(_agent_platform_comm_skill_content().encode("utf-8"))
            return

        if path == "/api/agent-platform-communications/history" or path.startswith("/api/agent-platform-communications/history?"):
            qs = urllib.parse.parse_qs(parsed.query)
            return self._send_json({
                "ok": True,
                "events": _load_comm_history(
                    limit=int((qs.get("limit") or [200])[0] or 200),
                    conversation_id=(qs.get("conversationId") or [None])[0],
                    agent_id=(qs.get("agentId") or [None])[0],
                ),
            })

        if path == "/api/hermes/history" or path.startswith("/api/hermes/history?"):
            qs = urllib.parse.parse_qs(parsed.query)
            agent_key = (qs.get("agentId") or qs.get("key") or ["hermes-default"])[0]
            agent = _get_hermes_agent(agent_key) or {}
            profile = agent.get("profile") or agent.get("providerAgentId") or "default"
            return self._send_json({"ok": True, "messages": _load_hermes_history(profile), "profile": profile})

        if path == "/api/hermes/live" or path.startswith("/api/hermes/live?"):
            qs = urllib.parse.parse_qs(parsed.query)
            run_id = (qs.get("runId") or qs.get("id") or [""])[0]
            since = (qs.get("since") or ["0"])[0]
            return self._send_json(_get_hermes_live_events(run_id, since))

        if path == "/api/hermes/approval/pending":
            qs = urllib.parse.parse_qs(parsed.query)
            agent_key = (qs.get("agentId") or qs.get("key") or ["hermes-default"])[0]
            session_id = (qs.get("session_id") or qs.get("sessionId") or [""])[0]
            return self._send_json(_get_hermes_approval_pending(agent_key, session_id))

        if path == "/api/hermes/approval/stream":
            qs = urllib.parse.parse_qs(parsed.query)
            agent_key = (qs.get("agentId") or qs.get("key") or ["hermes-default"])[0]
            session_id = (qs.get("session_id") or qs.get("sessionId") or [""])[0]
            result = _get_hermes_approval_pending(agent_key, session_id)
            event_name = "approval" if result.get("pending") else "idle"
            payload = json.dumps(result)
            self.send_response(200)
            self.send_header("Content-Type", "text/event-stream")
            self.send_header("Cache-Control", "no-cache")
            self.send_header("Access-Control-Allow-Origin", "*")
            self.end_headers()
            self.wfile.write(f"event: {event_name}\ndata: {payload}\n\n".encode("utf-8"))
            return

        if path == "/api/hermes/test":
            return self._send_json(_handle_hermes_test())

        if path == "/chat-media":
            return self._serve_chat_media(parsed.query)

        if path == "/healthz":
            return self._send_json({
                "ok": True,
                "service": "virtual-world",
                "port": PORT,
                "dataDir": DATA_DIR,
                "time": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()),
            })

        # ─── CHAT INTERFACE ENDPOINTS ─────────────────────────────
        if path == "/gateway-info":
            # Provide gateway WS port + auth token for chat WebSocket connection
            token = ""
            ws_port = 18789
            config_path = os.path.join(WORKSPACE_BASE, "openclaw.json")
            try:
                with open(config_path, "r") as f:
                    cfg = json.loads(f.read())
                gw = cfg.get("gateway", {})
                ws_port = gw.get("port", 18789)
                token = gw.get("auth", {}).get("token", "")
            except Exception:
                pass
            return self._send_json({"wsPort": ws_port, "token": token, "openclawVersion": _get_openclaw_version()})

        if path == "/agents-list":
            # Return agent roster formatted for chat agent selector
            roster = get_roster()
            # Load office-config overrides if available
            oc_overrides = {}
            oc_branches = {}
            try:
                oc_path = os.path.join(STATUS_DIR, "office-config.json")
                with open(oc_path, "r") as f:
                    oc_data = json.load(f)
                for oc_agent in oc_data.get("agents", []):
                    oc_id = oc_agent.get("id", "")
                    if oc_id:
                        oc_overrides[oc_id] = oc_agent
                for br in oc_data.get("branches", []):
                    br_id = br.get("id", "")
                    if br_id:
                        oc_branches[br_id] = br.get("name", br_id)
            except (FileNotFoundError, json.JSONDecodeError):
                pass
            agents = []
            total_agents = len(roster)
            for a in _limited(roster, get_agent_limit()):
                provider_kind = a.get("providerKind", "openclaw")
                session_key = f"hermes:{a.get('profile') or a.get('providerAgentId') or a['id']}" if provider_kind == "hermes" else f"agent:{a['id']}:main"
                oc = oc_overrides.get(a["id"], {})
                branch_id = oc.get("branch", "")
                branch_name = oc_branches.get(branch_id, "") if branch_id else ""
                if not branch_name:
                    branch_name = "Agents"
                agents.append({
                    "key": a["id"],
                    "agentId": a["id"],
                    "sessionKey": session_key,
                    "providerKind": provider_kind,
                    "providerType": a.get("providerType", "runtime"),
                    "providerAgentId": a.get("providerAgentId", a["id"]),
                    # Identity.md is the source of truth for the visible agent persona.
                    # Office config may still provide grouping/session metadata, but it
                    # should not mask the agent's chosen identity name or emoji.
                    "emoji": a.get("emoji") or oc.get("emoji") or "🤖",
                    "name": a.get("name") or oc.get("name") or a["id"],
                    "branch": branch_name,
                })
            return self._send_json({"agents": agents, "totalAgents": total_agents, "license": get_license_status()})

        if path == "/session-info":
            # Return current model + context window for the active session
            KNOWN_CONTEXT = {
                "anthropic/claude-opus-4-6": 1000000,
                "anthropic/claude-sonnet-4-6": 1000000,
                "anthropic/claude-sonnet-4-20250514": 200000,
                "google/gemini-2.5-flash": 1048576,
                "google/gemini-2.5-pro": 1048576,
                "google/gemini-3.1-pro-preview": 1048576,
                "openai/gpt-4o": 128000,
                "openai/gpt-5.4": 1000000,
                "openai/o3": 200000,
                "openai/o4-mini": 200000,
            }
            config_path = os.path.join(WORKSPACE_BASE, "openclaw.json")
            model = "unknown"
            context_window = 0
            try:
                with open(config_path, "r") as f:
                    cfg = json.loads(f.read())
                model = cfg.get("agents", {}).get("defaults", {}).get("model", {}).get("primary", "unknown")
                for a_cfg in cfg.get("agents", {}).get("list", []):
                    if a_cfg.get("default") and a_cfg.get("model"):
                        model = a_cfg["model"]
                        break
                context_window = KNOWN_CONTEXT.get(model, 0)
            except Exception:
                pass
            return self._send_json({"model": model, "contextWindow": context_window})

        # Serve node_modules for pixi.js
        if path.startswith("/node_modules/"):
            # Try multiple locations
            candidates = [
                os.path.join("/app", path.lstrip("/")),  # Docker: /app/node_modules/
                os.path.join(os.path.dirname(os.path.abspath(__file__)), "../..", path.lstrip("/")),  # Local dev
            ]
            nm_path = None
            for c in candidates:
                c = os.path.normpath(c)
                if os.path.isfile(c):
                    nm_path = c
                    break
            if not nm_path:
                self.send_error(404)
                return
            if os.path.isfile(nm_path):
                self.send_response(200)
                if nm_path.endswith(".js") or nm_path.endswith(".mjs"):
                    self.send_header("Content-Type", "application/javascript")
                elif nm_path.endswith(".json"):
                    self.send_header("Content-Type", "application/json")
                elif nm_path.endswith(".css"):
                    self.send_header("Content-Type", "text/css")
                elif nm_path.endswith(".wasm"):
                    self.send_header("Content-Type", "application/wasm")
                else:
                    self.send_header("Content-Type", "application/octet-stream")
                with open(nm_path, "rb") as f:
                    data = f.read()
                self.send_header("Content-Length", str(len(data)))
                self.end_headers()
                self.wfile.write(data)
                return

        # --- Static files ---
        super().do_GET()

    def do_POST(self):
        parsed = urllib.parse.urlparse(self.path)
        path = parsed.path

        if path in {"/setup/save", "/api/settings"}:
            result, status = _save_vw_config_update(self._read_body() or {})
            return self._send_json(result, status)

        if path == "/api/license/activate":
            body = self._read_body() or {}
            return self._send_json(activate_license(body.get("key") or ""))

        if path == "/api/license/deactivate":
            return self._send_json(deactivate_license())

        if path == "/sms-send":
            result, status = _send_sms(self._read_body() or {})
            return self._send_json(result, status)

        if path == "/api/meta":
            data = self._read_body()
            if _demo_feature_locked("advancedEditor") and not _is_starter_world_seed_request(path, data):
                return self._send_json(_demo_edit_locked_response(), 403)
            if data:
                meta = load_world_meta()
                meta.update(data)
                save_world_meta(meta)
                return self._send_json({"ok": True})
            return self._send_json({"error": "No data"}, 400)

        if path == "/api/agent-platform-communications/send":
            result, status = _handle_agent_platform_comm_send(self._read_body())
            return self._send_json(result, status)

        if path == "/api/hermes/chat":
            result = _handle_hermes_chat(self._read_body())
            status = int(result.pop("_status", 200) or 200) if (result.get("ok") or result.get("approval")) else int(result.pop("_status", 502) or 502)
            return self._send_json(result, status)

        if path == "/api/hermes/approval/respond":
            result = _handle_hermes_approval_respond(self._read_body())
            status = int(result.pop("_status", 200) or 200) if result.get("ok") else int(result.pop("_status", 502) or 502)
            return self._send_json(result, status)

        if path == "/api/hermes/history/clear":
            body = self._read_body() or {}
            agent = _get_hermes_agent(body.get("agentId") or body.get("key") or "hermes-default") or {}
            profile = agent.get("profile") or agent.get("providerAgentId") or "default"
            _save_hermes_state(profile, {"messages": [], "sessionId": ""})
            return self._send_json({"ok": True, "profile": profile})

        if path == "/api/hermes/test":
            return self._send_json(_handle_hermes_test(self._read_body()))

        if path == "/api/world-actions":
            if not check_feature("agentLiveMode"):
                data_preview = self._read_body()
                source = (data_preview or {}).get("source") if isinstance(data_preview, dict) else None
                source_kind = (source or {}).get("kind") if isinstance(source, dict) else ""
                if source_kind == "agent-live-mode":
                    return self._send_json(_locked_response("agentLiveMode"), 403)
                data = data_preview
            else:
                data = self._read_body()
            if not isinstance(data, dict):
                return self._send_json({"error": "world-actions payload must be an object"}, 400)
            # Backward-compatible bulk replace from Task 2. A create request is
            # identified by agentId/actionType/target/source and appends one
            # queued action instead of replacing the full store.
            if "active" in data or "history" in data:
                ok, result = save_world_actions_store({
                    "active": data.get("active", []),
                    "history": data.get("history", []),
                })
                if not ok:
                    return self._send_json({"error": "Malformed world action records", **result}, 400)
                return self._send_json({"ok": True, "worldActions": result})
            ok, result, status = create_world_action(data)
            return self._send_json(result, status)

        if path == "/api/agent-model/actions":
            if _demo_feature_locked("agentLiveMode"):
                return self._send_json(_locked_response("agentLiveMode"), 403)
            data = self._read_body()
            ok, result, status = create_agent_live_mode_action_request(data)
            return self._send_json(result, status)

        if path.startswith("/api/agents/") and path.endswith("/move"):
            parts = path.strip("/").split("/")
            if len(parts) == 4 and parts[0] == "api" and parts[1] == "agents" and parts[3] == "move":
                data = self._read_body()
                ok, result, status = create_move_intent(urllib.parse.unquote(parts[2]), data)
                return self._send_json(result, status)
            return self._send_json({"error": "Unsupported agent move endpoint"}, 404)

        if path.startswith("/api/world-actions/") and path not in {"/api/world-actions/active", "/api/world-actions/history"}: 
            parts = path.strip("/").split("/")
            if len(parts) == 4 and parts[0] == "api" and parts[1] == "world-actions":
                action_id = urllib.parse.unquote(parts[2])
                op = parts[3]
                data = self._read_body() or {}
                actor = data.get("actor") if isinstance(data, dict) else None
                source = data.get("source") if isinstance(data, dict) and isinstance(data.get("source"), str) else "api"
                if op == "transition":
                    ok, result, status = transition_world_action(action_id, data.get("status") if isinstance(data, dict) else None, result=data.get("result") if isinstance(data, dict) else None, failure_reason=data.get("failureReason") if isinstance(data, dict) else None, actor=actor, source=source)
                    return self._send_json(result, status)
                if op in {"complete", "done", "completed"}:
                    ok, result, status = complete_world_action(action_id, data)
                    return self._send_json(result, status)
                if op == "cancel":
                    ok, result, status = cancel_world_action(action_id, data)
                    return self._send_json(result, status)
                if op in {"fail", "failed"}:
                    ok, result, status = transition_world_action(action_id, "failed", result=data.get("result") if isinstance(data, dict) else None, failure_reason=(data.get("failureReason") if isinstance(data, dict) else None) or "runtime_error", actor=actor, source=source)
                    return self._send_json(result, status)
                if op in {"timeout", "expire", "expired"}:
                    ok, result, status = transition_world_action(action_id, "expired", result=data.get("result") if isinstance(data, dict) else None, failure_reason="timed_out", actor=actor, source=source)
                    return self._send_json(result, status)
            return self._send_json({"error": "Unsupported world-action transition"}, 404)

        if path == "/api/world-actions/active":
            data = self._read_body()
            records = data if isinstance(data, list) else (data.get("active") if isinstance(data, dict) else None)
            if records is None:
                return self._send_json({"error": "active payload must be an array or { active: [] }"}, 400)
            current = get_world_actions_store()
            ok, result = save_world_actions_store({"active": records, "history": current.get("history", [])})
            if not ok:
                return self._send_json({"error": "Malformed active world action records", **result}, 400)
            return self._send_json({"ok": True, "active": result.get("active", [])})

        if path == "/api/world-actions/history":
            data = self._read_body()
            records = data if isinstance(data, list) else (data.get("history") if isinstance(data, dict) else None)
            if records is None:
                return self._send_json({"error": "history payload must be an array or { history: [] }"}, 400)
            current = get_world_actions_store()
            ok, result = save_world_actions_store({"active": current.get("active", []), "history": records})
            if not ok:
                return self._send_json({"error": "Malformed history world action records", **result}, 400)
            return self._send_json({"ok": True, "history": result.get("history", [])})

        if path.startswith("/api/chunk/"):
            parts = path.split("/")
            if len(parts) >= 5:
                try:
                    cx, cy = int(parts[3]), int(parts[4])
                    data = self._read_body()
                    if _demo_feature_locked("advancedEditor") and not _is_starter_world_seed_request(path, data):
                        return self._send_json(_demo_edit_locked_response(), 403)
                    if data:
                        save_chunk(cx, cy, data)
                        return self._send_json({"ok": True})
                except (ValueError, IndexError):
                    pass
            return self._send_json({"error": "Invalid chunk"}, 400)

        if path == "/api/assignments":
            if _demo_feature_locked("advancedEditor"):
                return self._send_json(_demo_edit_locked_response(), 403)
            data = self._read_body()
            if data:
                meta = load_world_meta()
                meta["agentAssignments"] = data
                save_world_meta(meta)
                return self._send_json({"ok": True})
            return self._send_json({"error": "No data"}, 400)

        if path.startswith("/api/agent/") and path.endswith("/live-mode"):
            if _demo_feature_locked("agentLiveMode"):
                return self._send_json(_locked_response("agentLiveMode"), 403)
            parts = path.strip("/").split("/")
            agent_id = urllib.parse.unquote(parts[2]) if len(parts) >= 3 else ""
            data = self._read_body()
            if data is None:
                return self._send_json({"error": "No data"}, 400)
            enabled = data.get("agentLiveModeEnabled") if isinstance(data, dict) else None
            ok, result, status = set_agent_live_mode_setting(agent_id, enabled)
            return self._send_json(result, status)

        if path.startswith("/api/agent/") and path.endswith("/profile"):
            if _demo_feature_locked("advancedEditor"):
                return self._send_json(_demo_edit_locked_response(), 403)
            parts = path.strip("/").split("/")
            agent_id = urllib.parse.unquote(parts[2]) if len(parts) >= 3 else ""
            data = self._read_body()
            if data is None:
                return self._send_json({"error": "No data"}, 400)
            meta = load_world_meta()
            profiles, resolved_agent_id, profile = _agent_profile_for(meta, agent_id)
            if not resolved_agent_id:
                return self._send_json(_api_error("agent_not_found", "Unknown agent id for profile update.", details={"agentId": agent_id}), 404)
            profile = dict(profile or {})
            if "agentLiveModeEnabled" in data:
                if not isinstance(data.get("agentLiveModeEnabled"), bool):
                    return self._send_json(_api_error("invalid_payload", "agentLiveModeEnabled must be a boolean"), 400)
                profile["agentLiveModeEnabled"] = data["agentLiveModeEnabled"]
            if "name" in data:
                profile["name"] = str(data.get("name") or "").strip()
            if "emoji" in data:
                profile["emoji"] = str(data.get("emoji") or "🤖").strip() or "🤖"
            if isinstance(data.get("appearance"), dict):
                profile["appearance"] = data["appearance"]
            if "personality" in data:
                raw_personality = data.get("personality")
                if not isinstance(raw_personality, dict):
                    return self._send_json(_api_error("invalid_payload", "personality must be an object with outgoing/curious/easygoing trait multipliers"), 400)
                trait_keys = ("outgoing", "curious", "easygoing")
                legacy_keys = ("thirst", "energy", "social", "boredom")
                has_traits = any(k in raw_personality for k in trait_keys)
                if not has_traits and any(k in raw_personality for k in legacy_keys):
                    # v1 -> v2 migration (mirrors agent-needs-personality.mjs):
                    # social->outgoing, boredom->curious, avg(energy,thirst)->easygoing
                    def _legacy(k):
                        try:
                            return min(2.0, max(0.5, float(raw_personality.get(k, 1.0))))
                        except (TypeError, ValueError):
                            return 1.0
                    raw_personality = {
                        "outgoing": _legacy("social"),
                        "curious": _legacy("boredom"),
                        "easygoing": (_legacy("energy") + _legacy("thirst")) / 2.0,
                    }
                cleaned = {}
                for trait in trait_keys:
                    value = raw_personality.get(trait, 1.0)
                    try:
                        value = float(value)
                    except (TypeError, ValueError):
                        value = 1.0
                    cleaned[trait] = round(min(2.0, max(0.5, value)), 2)
                profile["personality"] = cleaned
            if isinstance(data.get("docs"), dict):
                docs = data["docs"]
                profile["docs"] = {
                    "reviewSummary": str(docs.get("reviewSummary") or "")[:1200],
                    "maintenanceNotes": str(docs.get("maintenanceNotes") or "")[:1200],
                    "carePlan": str(docs.get("carePlan") or "")[:1200],
                    "lastReviewedAt": str(docs.get("lastReviewedAt") or "")[:80],
                    "reviewedVia": str(docs.get("reviewedVia") or "")[:80],
                }
            profiles[resolved_agent_id] = profile
            meta["agentProfiles"] = profiles
            save_world_meta(meta)
            identity_path = _find_agent_identity_file(resolved_agent_id)
            wrote_identity = False
            if profile.get("name"):
                wrote_identity = _update_identity_field(identity_path, "Name", profile["name"]) or wrote_identity
            if profile.get("emoji"):
                wrote_identity = _update_identity_field(identity_path, "Emoji", profile["emoji"]) or wrote_identity
            global _agent_roster, _roster_time
            _agent_roster = discover_agents()
            _roster_time = time.time()
            return self._send_json({
                "ok": True,
                "agentId": resolved_agent_id,
                "identityPath": identity_path,
                "wroteIdentity": wrote_identity,
            })

        if path == "/api/decorations":
            if _demo_feature_locked("advancedEditor"):
                return self._send_json(_demo_edit_locked_response(), 403)
            data = self._read_body()
            if data is not None:
                meta = load_world_meta()
                meta["decorations"] = data
                save_world_meta(meta)
                return self._send_json({"ok": True})
            return self._send_json({"error": "No data"}, 400)

        if path == "/api/streets":
            data = self._read_body()
            if _demo_feature_locked("advancedEditor") and not _is_starter_world_seed_request(path, data):
                return self._send_json(_demo_edit_locked_response(), 403)
            if data is not None:
                meta = load_world_meta()
                if isinstance(data, list) and len(data) == 0:
                    # A transient/default client state must not wipe the
                    # checkpoint streets. Restore the known-good street layout
                    # instead of accepting an accidental empty save.
                    ensure_checkpoint_streets(meta, persist=False)
                else:
                    meta["streets"] = data
                save_world_meta(meta)
                return self._send_json({"ok": True})
            return self._send_json({"error": "No data"}, 400)

        if path == "/api/building" or path == "/api/buildings":
            data = self._read_body()
            if _demo_feature_locked("advancedEditor") and not _is_starter_world_seed_request(path, data):
                return self._send_json(_demo_edit_locked_response(), 403)
            if data and data.get("id"):
                building_limit = get_building_limit()
                existing = list_buildings()
                exists = any(b.get("id") == data["id"] for b in existing)
                if building_limit and not exists and len(existing) >= building_limit:
                    return self._send_json({
                        "ok": False,
                        "locked": True,
                        "feature": "buildings",
                        "error": f"Demo mode is limited to {building_limit} buildings.",
                        "license": get_license_status(),
                    }, 403)
                save_building(data["id"], data)
                return self._send_json({"ok": True, "id": data["id"]})
            return self._send_json({"error": "No data or missing id"}, 400)

        if path.startswith("/api/building/"):
            if _demo_feature_locked("advancedEditor"):
                return self._send_json(_demo_edit_locked_response(), 403)
            building_id = path.split("/")[-1]
            data = self._read_body()
            if data:
                data["id"] = building_id
                save_building(building_id, data)
                return self._send_json({"ok": True})
            return self._send_json({"error": "No data"}, 400)

        # ─── CHAT INTERFACE POST ENDPOINTS ───────────────────────
        if path == "/upload":
            # Save uploaded files to the OpenClaw workspace, not container-only /data.
            # Return the host-visible path so agents like Coder can read attachments.
            data = self._read_body()
            if data and data.get("filename") and data.get("content"):
                import base64
                os.makedirs(UPLOADS_DIR, exist_ok=True)
                filename = os.path.basename(data["filename"])
                # Add timestamp prefix to avoid collisions
                ts = int(time.time() * 1000)
                safe_name = f"{ts}_{filename}"
                dest = os.path.join(UPLOADS_DIR, safe_name)
                host_path = os.path.join(UPLOADS_HOST_DIR, safe_name)
                try:
                    raw = base64.b64decode(data["content"])
                    with open(dest, "wb") as f:
                        f.write(raw)
                    return self._send_json({"ok": True, "path": host_path})
                except Exception as e:
                    return self._send_json({"error": str(e)}, 500)
            return self._send_json({"error": "Missing filename or content"}, 400)

        if path == "/transcribe":
            # Proxy to Whisper STT if configured, else return error
            # Read raw audio body
            length = int(self.headers.get("Content-Length", 0))
            if length == 0:
                return self._send_json({"error": "No audio data"}, 400)
            audio_data = self.rfile.read(length)
            content_type = self.headers.get("Content-Type", "audio/webm")
            # Try local whisper endpoint
            whisper_url = os.environ.get("VW_WHISPER_URL", "http://127.0.0.1:9876/transcribe")
            try:
                boundary = "----WebKitFormBoundary" + str(int(time.time()))
                body = (
                    f"--{boundary}\r\n"
                    f'Content-Disposition: form-data; name="file"; filename="audio.webm"\r\n'
                    f"Content-Type: {content_type}\r\n\r\n"
                ).encode() + audio_data + f"\r\n--{boundary}--\r\n".encode()
                req = urllib.request.Request(
                    whisper_url,
                    data=body,
                    headers={"Content-Type": f"multipart/form-data; boundary={boundary}"},
                    method="POST"
                )
                resp = urllib.request.urlopen(req, timeout=30)
                result = json.loads(resp.read().decode())
                return self._send_json(result)
            except Exception as e:
                return self._send_json({"error": f"Transcription unavailable: {str(e)}"}, 503)

        return self._send_json({"error": "Not found"}, 404)

    def do_DELETE(self):
        parsed = urllib.parse.urlparse(self.path)
        path = parsed.path

        if path.startswith("/api/building/"):
            if _demo_feature_locked("advancedEditor"):
                return self._send_json(_demo_edit_locked_response(), 403)
            building_id = path.split("/")[-1]
            if delete_building(building_id):
                return self._send_json({"ok": True})
            return self._send_json({"error": "Not found"}, 404)

        if path.startswith("/api/chunk/"):
            if _demo_feature_locked("advancedEditor"):
                return self._send_json(_demo_edit_locked_response(), 403)
            parts = path.split("/")
            if len(parts) >= 5:
                try:
                    cx, cy = int(parts[3]), int(parts[4])
                    p = chunk_path(cx, cy)
                    if os.path.exists(p):
                        os.remove(p)
                        return self._send_json({"ok": True})
                except (ValueError, IndexError):
                    pass
            return self._send_json({"error": "Invalid"}, 400)

        return self._send_json({"error": "Not found"}, 404)

# ─── GATEWAY ORIGIN AUTO-CONFIGURE ────────────────────────────────
def _check_gateway_origin():
    """Check if this VW instance's origin is in gateway allowedOrigins.
    Logs a warning if not — user needs to add it via openclaw config or the VO settings.
    (Can't auto-add from Docker since openclaw.json is mounted read-only.)
    """
    config_path = os.path.join(WORKSPACE_BASE, "openclaw.json")
    origin_local = f"http://127.0.0.1:{PORT}"
    try:
        with open(config_path, "r") as f:
            cfg = json.loads(f.read())
        origins = cfg.get("gateway", {}).get("controlUi", {}).get("allowedOrigins", [])
        if origin_local in origins:
            print(f"[chat] ✅ Gateway origin {origin_local} found in allowedOrigins")
        else:
            print(f"[chat] ⚠️  Origin {origin_local} NOT in gateway.controlUi.allowedOrigins!")
            print(f"[chat]    Chat will get 1008 disconnects. Add this origin to openclaw.json")
            print(f"[chat]    and restart the gateway, or use the VO settings panel.")
    except Exception as e:
        print(f"[chat] Could not check gateway config: {e}")

# ─── START SERVER ─────────────────────────────────────────────────
def main():
    print(f"╔══════════════════════════════════════════╗")
    print(f"║       🌍 My Virtual World Server         ║")
    print(f"║       Port: {PORT:<28}║")
    print(f"║       Data: {DATA_DIR:<28}║")
    print(f"╚══════════════════════════════════════════╝")

    # Check if gateway is configured to accept chat connections from this origin
    _check_gateway_origin()

    # Derive working/idle from Virtual World's own live OpenClaw gateway state.
    initialize_live_presence()

    handler = VWHandler
    with socketserver.ThreadingTCPServer(("", PORT), handler) as httpd:
        httpd.allow_reuse_address = True
        print(f"🌐 Serving on http://0.0.0.0:{PORT}")
        try:
            httpd.serve_forever()
        except KeyboardInterrupt:
            print("\n🛑 Server stopped.")

if __name__ == "__main__":
    main()
