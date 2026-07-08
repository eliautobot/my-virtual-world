#!/usr/bin/env python3
"""Virtual World server.
Serves static files, world/chunk/building APIs.
Self-contained Virtual World server; Virtual Office is reference/inspiration only.
"""
import asyncio
import base64
import copy
import contextlib
import gzip
import hashlib
import http.server
import importlib.util
import json
import math
import os
import signal
import shutil
import sqlite3
import sys
import threading
import time
import glob
import mimetypes
import re
import socketserver
import subprocess
import urllib.error
import urllib.parse
import urllib.request
import uuid

try:
    import fcntl
except Exception:
    fcntl = None

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
    from providers.hermes import HermesApiClient, HermesProvider
except Exception as e:
    HermesApiClient = None
    HermesProvider = None
    print(f"⚠️  Virtual World Hermes provider unavailable: {e}")

try:
    from providers.codex import CodexProvider
except Exception as e:
    CodexProvider = None
    print(f"⚠️  Virtual World Codex provider unavailable: {e}")

try:
    from websockets.asyncio.client import connect as ws_connect
except Exception as e:
    ws_connect = None
    print(f"⚠️  Virtual World Gateway RPC client unavailable: {e}")

try:
    import yaml
except Exception:
    yaml = None

# ─── CONFIGURATION ───────────────────────────────────────────────
def _env_or(key, fallback):
    val = os.environ.get(key)
    return val if val else fallback


def _env_bool(key, fallback=False):
    val = os.environ.get(key)
    if val is None or val == "":
        return bool(fallback)
    return str(val).strip().lower() not in ("0", "false", "no", "off")


PORT = int(_env_or("VW_PORT", "8590"))
PUBLIC_HOST_PORT = _env_or("VW_HOST_PORT", str(PORT))
PUBLIC_ORIGIN = _env_or("VW_PUBLIC_ORIGIN", f"http://127.0.0.1:{PUBLIC_HOST_PORT}")
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
        "world": {
            "name": "My Virtual World",
            "showGrid": True,
            "showMinimap": True,
            "showCoords": True,
            "dayNightCycleEnabled": True,
            "weatherEnabled": True,
            "location": {"label": "", "timeZone": "", "latitude": None, "longitude": None},
        },
        "openclaw": {"homePath": "", "hostHomePath": "", "gatewayUrl": "", "gatewayToken": ""},
        "hermes": {
            "enabled": True,
            "homePath": "",
            "binary": "",
            "timeoutSec": 600,
            "apiUrl": "",
            "apiKey": "",
            "preferApi": True,
            "autoStartProfileApis": True,
            "autoStartDefaultApi": True,
            "apiProfilePortBase": "",
            "apiProfiles": {},
        },
        "codex": {
            "enabled": True,
            "homePath": "",
            "binary": "",
            "workspaceRoot": "",
            "mainWorkspace": "",
            "timeoutSec": 900,
            "model": "",
            "sandbox": "workspace-write",
            "approvalPolicy": "never",
            "preferAppServer": True,
            "includeMain": True,
            "includeNativeAgents": True,
            "registerNativeAgents": True,
        },
        "claudeCode": {
            "enabled": False,
            "homePath": "",
            "binary": "",
            "workspaceRoot": "",
            "mainWorkspace": "",
            "timeoutSec": 900,
            "model": "",
            "permissionMode": "acceptEdits",
            "includeMain": True,
            "includeNativeAgents": True,
            "registerNativeAgents": True,
        },
        "features": {"agentBrowser": False, "sms": False, "weather": True, "agentLiveMode": False, "debugTools": True},
        "realtime": {"enabled": False, "url": "", "room": "agent_runtime"},
        "browser": {"cdpUrl": "", "viewerUrl": ""},
        "sms": {"ownerAgentId": "", "twilioAccountSid": "", "twilioAuthToken": "", "fromNumber": "", "publicMediaBaseUrl": ""},
        "debug": {"movementDebugOverlays": False, "objectActionPointDebug": False},
        "license": {"acceptedTrial": False},
    }


def _load_vw_config():
    cfg = _deep_merge(_default_vw_config(), _load_config_file(_resolve_vw_config_path()))
    cfg.setdefault("openclaw", {})
    cfg.setdefault("hermes", {})
    cfg.setdefault("codex", {})
    cfg.setdefault("claudeCode", {})
    cfg.setdefault("browser", {})
    cfg.setdefault("sms", {})
    cfg.setdefault("features", {})
    cfg.setdefault("realtime", {})
    cfg.setdefault("world", {})
    cfg.setdefault("debug", {})
    if not isinstance(cfg["world"].get("location"), dict):
        cfg["world"]["location"] = {"label": "", "timeZone": "", "latitude": None, "longitude": None}
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
    cfg["hermes"]["preferApi"] = _env_bool("VW_HERMES_PREFER_API", cfg["hermes"].get("preferApi", True))
    cfg["hermes"]["autoStartProfileApis"] = _env_bool("VW_HERMES_AUTO_START_PROFILE_APIS", cfg["hermes"].get("autoStartProfileApis", True))
    cfg["hermes"]["autoStartDefaultApi"] = _env_bool("VW_HERMES_AUTO_START_DEFAULT_API", cfg["hermes"].get("autoStartDefaultApi", cfg["hermes"].get("autoStartProfileApis", True)))
    cfg["hermes"]["apiProfilePortBase"] = _env_or("VW_HERMES_API_PROFILE_PORT_BASE", cfg["hermes"].get("apiProfilePortBase") or "")
    if not isinstance(cfg["hermes"].get("apiProfiles"), dict):
        cfg["hermes"]["apiProfiles"] = {}
    cfg["codex"]["enabled"] = _env_bool("VW_CODEX_ENABLED", cfg["codex"].get("enabled", True))
    cfg["codex"]["homePath"] = os.path.expanduser(_env_or("VW_CODEX_HOME", _env_or("CODEX_HOME", cfg["codex"].get("homePath") or "~/.codex")))
    cfg["codex"]["binary"] = os.path.expanduser(_env_or("VW_CODEX_BIN", cfg["codex"].get("binary") or "codex"))
    cfg["codex"]["workspaceRoot"] = os.path.expanduser(_env_or("VW_CODEX_WORKSPACE_ROOT", cfg["codex"].get("workspaceRoot") or os.path.join(DATA_DIR, "codex-agents")))
    cfg["codex"]["mainWorkspace"] = os.path.expanduser(_env_or("VW_CODEX_MAIN_WORKSPACE", cfg["codex"].get("mainWorkspace") or os.path.join(DATA_DIR, "codex-main")))
    cfg["codex"]["timeoutSec"] = int(_env_or("VW_CODEX_TIMEOUT_SEC", cfg["codex"].get("timeoutSec", 900)))
    cfg["codex"]["model"] = _env_or("VW_CODEX_MODEL", cfg["codex"].get("model") or "")
    cfg["codex"]["sandbox"] = _env_or("VW_CODEX_SANDBOX", cfg["codex"].get("sandbox") or "workspace-write")
    cfg["codex"]["approvalPolicy"] = _env_or("VW_CODEX_APPROVAL_POLICY", cfg["codex"].get("approvalPolicy") or "never")
    cfg["codex"]["preferAppServer"] = _env_bool("VW_CODEX_PREFER_APP_SERVER", cfg["codex"].get("preferAppServer", True))
    cfg["codex"]["includeMain"] = _env_bool("VW_CODEX_INCLUDE_MAIN", cfg["codex"].get("includeMain", True))
    cfg["codex"]["includeNativeAgents"] = _env_bool("VW_CODEX_INCLUDE_NATIVE_AGENTS", cfg["codex"].get("includeNativeAgents", True))
    cfg["codex"]["registerNativeAgents"] = _env_bool("VW_CODEX_REGISTER_NATIVE_AGENTS", cfg["codex"].get("registerNativeAgents", True))
    cfg["claudeCode"]["enabled"] = _env_bool("VW_CLAUDE_CODE_ENABLED", cfg["claudeCode"].get("enabled", False))
    cfg["claudeCode"]["homePath"] = os.path.expanduser(_env_or("VW_CLAUDE_CODE_HOME", _env_or("CLAUDE_CONFIG_DIR", cfg["claudeCode"].get("homePath") or "~/.claude")))
    cfg["claudeCode"]["binary"] = os.path.expanduser(_env_or("VW_CLAUDE_CODE_BIN", cfg["claudeCode"].get("binary") or "claude"))
    cfg["claudeCode"]["workspaceRoot"] = os.path.expanduser(_env_or("VW_CLAUDE_CODE_WORKSPACE_ROOT", cfg["claudeCode"].get("workspaceRoot") or os.path.join(DATA_DIR, "claude-code-agents")))
    cfg["claudeCode"]["mainWorkspace"] = os.path.expanduser(_env_or("VW_CLAUDE_CODE_MAIN_WORKSPACE", cfg["claudeCode"].get("mainWorkspace") or os.path.join(DATA_DIR, "claude-code-main")))
    cfg["claudeCode"]["timeoutSec"] = int(_env_or("VW_CLAUDE_CODE_TIMEOUT_SEC", cfg["claudeCode"].get("timeoutSec", 900)))
    cfg["claudeCode"]["model"] = _env_or("VW_CLAUDE_CODE_MODEL", cfg["claudeCode"].get("model") or "")
    cfg["claudeCode"]["permissionMode"] = _env_or("VW_CLAUDE_CODE_PERMISSION_MODE", cfg["claudeCode"].get("permissionMode") or "acceptEdits")
    cfg["claudeCode"]["includeMain"] = _env_bool("VW_CLAUDE_CODE_INCLUDE_MAIN", cfg["claudeCode"].get("includeMain", True))
    cfg["claudeCode"]["includeNativeAgents"] = _env_bool("VW_CLAUDE_CODE_INCLUDE_NATIVE_AGENTS", cfg["claudeCode"].get("includeNativeAgents", True))
    cfg["claudeCode"]["registerNativeAgents"] = _env_bool("VW_CLAUDE_CODE_REGISTER_NATIVE_AGENTS", cfg["claudeCode"].get("registerNativeAgents", True))
    cfg["browser"]["cdpUrl"] = _env_or("VW_BROWSER_CDP_URL", cfg["browser"].get("cdpUrl") or "")
    cfg["browser"]["viewerUrl"] = _env_or("VW_BROWSER_VIEWER_URL", cfg["browser"].get("viewerUrl") or "")
    realtime_url = _env_or(
        "VW_REALTIME_BROWSER_URL",
        _env_or("VW_REALTIME_URL", cfg["realtime"].get("url") or ""),
    )
    realtime_url_from_env = bool(os.environ.get("VW_REALTIME_BROWSER_URL") or os.environ.get("VW_REALTIME_URL"))
    realtime_enabled_default = True if realtime_url and realtime_url_from_env else cfg["realtime"].get("enabled", False)
    cfg["realtime"]["enabled"] = _env_bool("VW_REALTIME_ENABLED", realtime_enabled_default)
    cfg["realtime"]["url"] = realtime_url
    cfg["realtime"]["room"] = _env_or("VW_REALTIME_ROOM", cfg["realtime"].get("room") or "agent_runtime")
    cfg["sms"]["ownerAgentId"] = _env_or("VW_SMS_OWNER_AGENT_ID", cfg["sms"].get("ownerAgentId") or "")
    cfg["sms"]["twilioAccountSid"] = _env_or("VW_TWILIO_ACCOUNT_SID", cfg["sms"].get("twilioAccountSid") or "")
    cfg["sms"]["twilioAuthToken"] = _env_or("VW_TWILIO_AUTH_TOKEN", cfg["sms"].get("twilioAuthToken") or "")
    cfg["sms"]["fromNumber"] = _env_or("VW_TWILIO_FROM_NUMBER", cfg["sms"].get("fromNumber") or "")
    return cfg


VW_CONFIG = _load_vw_config()

KNOWN_MODEL_CONTEXT_WINDOWS = {
    "anthropic/claude-opus-4-6": 1000000,
    "anthropic/claude-sonnet-4-6": 1000000,
    "anthropic/claude-sonnet-4-20250514": 200000,
    "google/gemini-2.5-flash": 1048576,
    "google/gemini-2.5-pro": 1048576,
    "google/gemini-3.1-pro-preview": 1048576,
    "openai/gpt-4o": 128000,
    "openai/gpt-5.4": 1000000,
    "openai/gpt-5.5": 1000000,
    "openai-codex/gpt-5.5": 1000000,
    "gpt-5.4": 1000000,
    "gpt-5.5": 1000000,
    "openai/o3": 200000,
    "openai/o4-mini": 200000,
    "o3": 200000,
    "o4-mini": 200000,
}


def _known_context_window(model, provider=""):
    model_key = str(model or "").strip().lower()
    provider_key = str(provider or "").strip().lower()
    candidates = []
    if model_key:
        candidates.append(model_key)
        if "/" in model_key:
            candidates.append(model_key.split("/", 1)[1])
    if provider_key and model_key and "/" not in model_key:
        candidates.insert(0, f"{provider_key}/{model_key}")
    for key in candidates:
        if key in KNOWN_MODEL_CONTEXT_WINDOWS:
            return KNOWN_MODEL_CONTEXT_WINDOWS[key]
    return 0


def _load_openclaw_model_config():
    config_path = os.path.join(WORKSPACE_BASE, "openclaw.json")
    try:
        with open(config_path, "r") as f:
            data = json.load(f)
        return data if isinstance(data, dict) else {}
    except Exception:
        return {}


def _default_openclaw_model(cfg=None):
    cfg = cfg if isinstance(cfg, dict) else _load_openclaw_model_config()
    for agent_cfg in cfg.get("agents", {}).get("list", []) or []:
        if isinstance(agent_cfg, dict) and agent_cfg.get("default") and agent_cfg.get("model"):
            return str(agent_cfg["model"])
    return str(cfg.get("agents", {}).get("defaults", {}).get("model", {}).get("primary") or "")


def _primary_openclaw_model(cfg=None):
    cfg = cfg if isinstance(cfg, dict) else _load_openclaw_model_config()
    return str(cfg.get("agents", {}).get("defaults", {}).get("model", {}).get("primary") or "")


def _openclaw_config_agent_for(agent_id, agent=None, cfg=None):
    cfg = cfg if isinstance(cfg, dict) else _load_openclaw_model_config()
    aliases = {
        str(agent_id or "").strip(),
        str((agent or {}).get("id") or "").strip(),
        str((agent or {}).get("statusKey") or "").strip(),
        str((agent or {}).get("providerAgentId") or "").strip(),
        str((agent or {}).get("profile") or "").strip(),
    }
    aliases.discard("")
    if not aliases:
        return None
    for item in cfg.get("agents", {}).get("list", []) or []:
        if not isinstance(item, dict):
            continue
        item_aliases = {
            str(item.get("id") or "").strip(),
            str(item.get("name") or "").strip(),
            str(item.get("profile") or "").strip(),
        }
        workspace = str(item.get("workspace") or "").strip()
        if workspace:
            item_aliases.add(os.path.basename(workspace.rstrip(os.sep)))
            if os.path.basename(workspace.rstrip(os.sep)).startswith("workspace-"):
                item_aliases.add(os.path.basename(workspace.rstrip(os.sep))[len("workspace-"):])
        item_aliases.discard("")
        if aliases & item_aliases:
            return item
    return None


def _configured_context_window(model, cfg=None):
    cfg = cfg if isinstance(cfg, dict) else _load_openclaw_model_config()
    model_key = str(model or "").strip()
    if not model_key:
        return 0
    candidates = [model_key]
    if "/" in model_key:
        candidates.append(model_key.split("/", 1)[1])
    defaults = cfg.get("agents", {}).get("defaults", {})
    models = defaults.get("models") if isinstance(defaults.get("models"), dict) else {}
    for key in candidates:
        meta = models.get(key)
        params = meta.get("params") if isinstance(meta, dict) and isinstance(meta.get("params"), dict) else {}
        value = params.get("contextWindow") or meta.get("contextWindow") if isinstance(meta, dict) else 0
        try:
            if value:
                return int(value)
        except (TypeError, ValueError):
            pass
    return 0


def _context_window_for_model(model, provider="", cfg=None):
    return _configured_context_window(model, cfg) or _known_context_window(model, provider)


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
CODEX_ENABLED = VW_CONFIG["codex"].get("enabled", True)
CODEX_HOME = VW_CONFIG["codex"].get("homePath") or os.path.expanduser("~/.codex")
CODEX_BIN = VW_CONFIG["codex"].get("binary") or "codex"
CODEX_WORKSPACE_ROOT = VW_CONFIG["codex"].get("workspaceRoot") or os.path.join(DATA_DIR, "codex-agents")
CODEX_MAIN_WORKSPACE = VW_CONFIG["codex"].get("mainWorkspace") or os.path.join(DATA_DIR, "codex-main")
CODEX_TIMEOUT_SEC = int(VW_CONFIG["codex"].get("timeoutSec") or 900)
CODEX_MODEL = VW_CONFIG["codex"].get("model") or ""
CODEX_SANDBOX = VW_CONFIG["codex"].get("sandbox") or "workspace-write"
CODEX_APPROVAL_POLICY = VW_CONFIG["codex"].get("approvalPolicy") or "never"
CODEX_PREFER_APP_SERVER = bool(VW_CONFIG["codex"].get("preferAppServer", True))
CODEX_INCLUDE_MAIN = bool(VW_CONFIG["codex"].get("includeMain", True))
CODEX_INCLUDE_NATIVE_AGENTS = bool(VW_CONFIG["codex"].get("includeNativeAgents", True))
CODEX_REGISTER_NATIVE_AGENTS = bool(VW_CONFIG["codex"].get("registerNativeAgents", True))
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
    codex_cfg = VW_CONFIG.get("codex", {}) or {}
    claude_code_cfg = VW_CONFIG.get("claudeCode", {}) or {}
    openclaw_cfg = VW_CONFIG.get("openclaw", {}) or {}
    realtime_cfg = VW_CONFIG.get("realtime", {}) or {}
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
            "autoStartProfileApis": hermes_cfg.get("autoStartProfileApis", True),
            "autoStartDefaultApi": hermes_cfg.get("autoStartDefaultApi", True),
            "apiProfilePortBase": hermes_cfg.get("apiProfilePortBase") or "",
            "apiProfilesConfigured": sorted((hermes_cfg.get("apiProfiles") or {}).keys()) if isinstance(hermes_cfg.get("apiProfiles"), dict) else [],
        },
        "codex": {
            "enabled": codex_cfg.get("enabled", True),
            "homePath": _display_user_home_path(codex_cfg.get("homePath")),
            "binary": _display_user_home_path(codex_cfg.get("binary")),
            "workspaceRoot": _display_user_home_path(codex_cfg.get("workspaceRoot")),
            "mainWorkspace": _display_user_home_path(codex_cfg.get("mainWorkspace")),
            "timeoutSec": codex_cfg.get("timeoutSec", 900),
            "model": codex_cfg.get("model"),
            "sandbox": codex_cfg.get("sandbox", "workspace-write"),
            "approvalPolicy": codex_cfg.get("approvalPolicy", "never"),
            "preferAppServer": codex_cfg.get("preferAppServer", True),
            "includeMain": codex_cfg.get("includeMain", True),
            "includeNativeAgents": codex_cfg.get("includeNativeAgents", True),
            "registerNativeAgents": codex_cfg.get("registerNativeAgents", True),
        },
        "claudeCode": {
            "enabled": claude_code_cfg.get("enabled", False),
            "homePath": _display_user_home_path(claude_code_cfg.get("homePath")),
            "binary": _display_user_home_path(claude_code_cfg.get("binary")),
            "workspaceRoot": _display_user_home_path(claude_code_cfg.get("workspaceRoot")),
            "mainWorkspace": _display_user_home_path(claude_code_cfg.get("mainWorkspace")),
            "timeoutSec": claude_code_cfg.get("timeoutSec", 900),
            "model": claude_code_cfg.get("model"),
            "permissionMode": claude_code_cfg.get("permissionMode", "acceptEdits"),
            "includeMain": claude_code_cfg.get("includeMain", True),
            "includeNativeAgents": claude_code_cfg.get("includeNativeAgents", True),
            "registerNativeAgents": claude_code_cfg.get("registerNativeAgents", True),
        },
        "browser": {
            "cdpUrl": (VW_CONFIG.get("browser") or {}).get("cdpUrl"),
            "viewerUrl": (VW_CONFIG.get("browser") or {}).get("viewerUrl"),
        },
        "realtime": {
            "enabled": bool(realtime_cfg.get("enabled")),
            "url": realtime_cfg.get("url") or "",
            "room": realtime_cfg.get("room") or "agent_runtime",
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
    global VW_CONFIG, WORKSPACE_BASE, HOST_WORKSPACE_BASE, HERMES_ENABLED, HERMES_HOME, HERMES_BIN, HERMES_TIMEOUT_SEC
    global CODEX_ENABLED, CODEX_HOME, CODEX_BIN, CODEX_WORKSPACE_ROOT, CODEX_MAIN_WORKSPACE, CODEX_TIMEOUT_SEC
    global CODEX_MODEL, CODEX_SANDBOX, CODEX_APPROVAL_POLICY, CODEX_PREFER_APP_SERVER, CODEX_INCLUDE_MAIN
    global CODEX_INCLUDE_NATIVE_AGENTS, CODEX_REGISTER_NATIVE_AGENTS, UPLOADS_DIR, UPLOADS_HOST_DIR
    if not isinstance(body, dict):
        return {"ok": False, "error": "settings payload must be an object"}, 400
    old_gateway_config = _gateway_config_key()
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
    CODEX_ENABLED = VW_CONFIG["codex"].get("enabled", True)
    CODEX_HOME = VW_CONFIG["codex"].get("homePath") or os.path.expanduser("~/.codex")
    CODEX_BIN = VW_CONFIG["codex"].get("binary") or "codex"
    CODEX_WORKSPACE_ROOT = VW_CONFIG["codex"].get("workspaceRoot") or os.path.join(DATA_DIR, "codex-agents")
    CODEX_MAIN_WORKSPACE = VW_CONFIG["codex"].get("mainWorkspace") or os.path.join(DATA_DIR, "codex-main")
    CODEX_TIMEOUT_SEC = int(VW_CONFIG["codex"].get("timeoutSec") or 900)
    CODEX_MODEL = VW_CONFIG["codex"].get("model") or ""
    CODEX_SANDBOX = VW_CONFIG["codex"].get("sandbox") or "workspace-write"
    CODEX_APPROVAL_POLICY = VW_CONFIG["codex"].get("approvalPolicy") or "never"
    CODEX_PREFER_APP_SERVER = bool(VW_CONFIG["codex"].get("preferAppServer", True))
    CODEX_INCLUDE_MAIN = bool(VW_CONFIG["codex"].get("includeMain", True))
    CODEX_INCLUDE_NATIVE_AGENTS = bool(VW_CONFIG["codex"].get("includeNativeAgents", True))
    CODEX_REGISTER_NATIVE_AGENTS = bool(VW_CONFIG["codex"].get("registerNativeAgents", True))
    UPLOADS_DIR = _env_or("VW_UPLOADS_DIR", os.path.join(WORKSPACE_BASE, "workspace", "uploads"))
    UPLOADS_HOST_DIR = _env_or("VW_UPLOADS_HOST_DIR", os.path.join(HOST_WORKSPACE_BASE, "workspace", "uploads"))
    if _gateway_config_key() != old_gateway_config:
        restart_gateway_presence()
    world = body.get("world") if isinstance(body.get("world"), dict) else {}
    if world:
        meta_patch = {k: v for k, v in world.items() if k in {"name", "showMinimap", "dayNightCycleEnabled", "weatherEnabled", "location"}}
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
        meta = load_world_meta()
        if meta.get("initialized"):
            if path == "/api/streets" and _street_payload_matches(payload, meta.get("streets")):
                return True
            if path == "/api/streets" and _street_payload_matches(payload, get_latest_checkpoint_streets()):
                return True
            return False
    except Exception:
        return False
    if path in {"/api/streets"} or path.startswith("/api/chunk/"):
        return True
    if path in {"/api/building", "/api/buildings"} and isinstance(payload, dict):
        building_id = str(payload.get("id") or "")
        starter_id = building_id.startswith("auto_") or building_id in STARTER_WORLD_BUILDING_IDS
        return starter_id and len(list_buildings()) < 4
    if path == "/api/meta" and isinstance(payload, dict):
        return set(payload.keys()).issubset({"initialized", "name", "starterMap"}) and payload.get("initialized") is True
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
_presence_gateway_config = None
_live_agent_loop_thread = None
_live_agent_loop_stop = threading.Event()
_live_agent_loop_lock = threading.RLock()
_live_agent_action_handoff_lock = threading.RLock()
_live_agent_loop_last_client_at = 0
_live_agent_loop_last_client_info = {}
_live_agent_user_attention_lock = threading.RLock()
_live_agent_user_attention = {}
_live_agent_model_decision_lock = threading.RLock()
_live_agent_model_decision_state = {}
_live_agent_planner_transcript_lock = threading.RLock()
HERMES_APPROVAL_LOCK = threading.Lock()
HERMES_APPROVAL_PENDING = {}
HERMES_LIVE_LOCK = threading.Lock()
HERMES_LIVE_EVENTS = {}
HERMES_LIVE_MAX_EVENTS = 250
HERMES_APPROVAL_BRIDGE_DIR = os.path.join(DATA_DIR, "hermes-approval-bridge")
HERMES_ACTIVE_RUNS_LOCK = threading.Lock()
HERMES_ACTIVE_RUNS = {}
CODEX_ACTIVE_RUNS_LOCK = threading.Lock()
CODEX_ACTIVE_RUNS = {}
CODEX_TOKEN_USAGE_CACHE = {}
HERMES_PROFILE_API_LOCK = threading.Lock()
HERMES_PROFILE_API_PROCESSES = {}

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

STARTER_WORLD_BUILDING_IDS = {"bld_1781275602998", "bld_1781275645157"}

# Current 8590 desktop starter street layout. Keep this server-side guard
# narrow: it only protects the saved street list from accidental empty/default
# world-meta rewrites. Buildings, agents, and other world state stay separate.
LATEST_CHECKPOINT_STREETS_20260429 = [
    {"x1": -7, "z1": 20, "x2": -7, "z2": 159, "type": None, "rotation": 0, "openEdges": None},
    {"x1": -7, "z1": -133, "x2": -7, "z2": -45, "type": None, "rotation": 0, "openEdges": None},
    {"x1": -7, "z1": -35, "x2": -7, "z2": 10, "type": None, "rotation": 0, "openEdges": None},
    {"x1": -109, "z1": -40, "x2": -12, "z2": -40, "type": None, "rotation": 0, "openEdges": None},
    {"x1": -7, "z1": -40, "x2": -7, "z2": -40, "type": "x-int", "rotation": 0, "openEdges": {"n": True, "s": True, "e": True, "w": True}},
    {"x1": -2, "z1": 15, "x2": 142, "z2": 15, "type": None, "rotation": 0, "openEdges": None},
    {"x1": -2, "z1": -40, "x2": 141, "z2": -40, "type": None, "rotation": 0, "openEdges": None},
    {"x1": -7, "z1": 15, "x2": -7, "z2": 15, "type": "x-int", "rotation": 0, "openEdges": {"n": True, "s": True, "e": True, "w": True}},
    {"x1": -12, "z1": 15, "x2": -109, "z2": 15, "type": None, "rotation": 0, "openEdges": None},
]
BUILDING_PLACEMENT_RULES_SCHEMA_VERSION = "building-placement-rules/v1"
# Mirror src/client/js/main3d.js ST: sidewalk + curb + gutter + lane + center/2.
BUILDING_PLACEMENT_STREET_SURFACE_HALF_WIDTH_TILES = 2.0 + 0.3 + 0.35 + 2.5 + 0.3 / 2
BUILDING_PLACEMENT_OVERLAP_EPSILON = 1e-5


def get_latest_checkpoint_streets():
    # Return fresh dicts so callers can mutate without corrupting the guard copy.
    return [dict(seg) for seg in LATEST_CHECKPOINT_STREETS_20260429]


def _normalize_starter_street_segment(segment):
    if not isinstance(segment, dict):
        return None
    open_edges = segment.get("openEdges")
    if isinstance(open_edges, dict):
        open_edges = {str(k): bool(v) for k, v in sorted(open_edges.items())}
    else:
        open_edges = None
    return {
        "x1": segment.get("x1"),
        "z1": segment.get("z1"),
        "x2": segment.get("x2"),
        "z2": segment.get("z2"),
        "type": segment.get("type") or None,
        "rotation": segment.get("rotation") or 0,
        "openEdges": open_edges,
    }


def _street_payload_matches(left, right):
    if not isinstance(left, list) or not isinstance(right, list):
        return False
    if len(left) != len(right):
        return False
    return [_normalize_starter_street_segment(item) for item in left] == [_normalize_starter_street_segment(item) for item in right]


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


def get_building_placement_rules():
    return {
        "ok": True,
        "schemaVersion": BUILDING_PLACEMENT_RULES_SCHEMA_VERSION,
        "rules": [
            {
                "id": "no-roadway-or-sidewalk-overlap",
                "severity": "reject",
                "message": "Building footprints may snap next to streets, but cannot intersect roadway, curb, gutter, or sidewalk surfaces.",
            },
        ],
        "constraints": {
            "noRoadwayOrSidewalkOverlap": True,
            "streetSurfaceHalfWidthTiles": BUILDING_PLACEMENT_STREET_SURFACE_HALF_WIDTH_TILES,
            "buildingFootprintFields": ["worldX", "worldY", "widthTiles", "heightTiles", "_rotation"],
            "legacyFootprintAliases": {"x": "worldX", "z": "worldY", "width": "widthTiles", "depth": "heightTiles"},
            "edgeContactAllowed": True,
        },
        "guidance": "Agents should choose a grass/buildable footprint adjacent to the street snap point. Do not cover the road bed, curb/gutter, or either sidewalk.",
    }


def _float_or_none(value):
    try:
        number = float(value)
    except (TypeError, ValueError):
        return None
    return number if math.isfinite(number) else None


def _rects_overlap(a, b, epsilon=BUILDING_PLACEMENT_OVERLAP_EPSILON):
    return (
        a["minX"] < b["maxX"] - epsilon
        and a["maxX"] > b["minX"] + epsilon
        and a["minZ"] < b["maxZ"] - epsilon
        and a["maxZ"] > b["minZ"] + epsilon
    )


def _building_footprint_tile_rect(building):
    if not isinstance(building, dict):
        return None
    world_x = _float_or_none(building.get("worldX") if building.get("worldX") is not None else building.get("x"))
    world_z = _float_or_none(building.get("worldY") if building.get("worldY") is not None else building.get("z"))
    width = _float_or_none(building.get("widthTiles") if building.get("widthTiles") is not None else building.get("width"))
    depth = _float_or_none(building.get("heightTiles") if building.get("heightTiles") is not None else building.get("depth"))
    if world_x is None or world_z is None or width is None or depth is None or width <= 0 or depth <= 0:
        return None
    rotation = _float_or_none(building.get("_rotation") if building.get("_rotation") is not None else building.get("rotation")) or 0
    rotation = int(round(rotation)) % 360
    if rotation in {90, 270}:
        width, depth = depth, width
    return {"minX": world_x, "minZ": world_z, "maxX": world_x + width, "maxZ": world_z + depth}


def _street_surface_tile_rect(street):
    if not isinstance(street, dict):
        return None
    x1 = _float_or_none(street.get("x1"))
    z1 = _float_or_none(street.get("z1"))
    x2 = _float_or_none(street.get("x2"))
    z2 = _float_or_none(street.get("z2"))
    if x1 is None or z1 is None:
        return None
    half_width = BUILDING_PLACEMENT_STREET_SURFACE_HALF_WIDTH_TILES
    if street.get("type"):
        cx = x1 + 0.5
        cz = z1 + 0.5
        return {"minX": cx - half_width, "minZ": cz - half_width, "maxX": cx + half_width, "maxZ": cz + half_width}
    if x2 is None or z2 is None:
        return None
    is_horizontal = abs(x2 - x1) >= abs(z2 - z1)
    min_x = min(x1, x2)
    max_x = max(x1, x2) + 1
    min_z = min(z1, z2)
    max_z = max(z1, z2) + 1
    if is_horizontal:
        cz = z1 + 0.5
        return {"minX": min_x, "minZ": cz - half_width, "maxX": max_x, "maxZ": cz + half_width}
    cx = x1 + 0.5
    return {"minX": cx - half_width, "minZ": min_z, "maxX": cx + half_width, "maxZ": max_z}


def validate_building_placement(building, *, streets=None):
    footprint = _building_footprint_tile_rect(building)
    if not footprint:
        return {"ok": True, "rule": "geometry-unavailable"}
    if streets is None:
        meta = load_world_meta()
        streets = ensure_checkpoint_streets(meta, persist=False)
    for index, street in enumerate(streets if isinstance(streets, list) else []):
        street_rect = _street_surface_tile_rect(street)
        if not street_rect:
            continue
        if _rects_overlap(footprint, street_rect):
            return {
                "ok": False,
                "error": {
                    "code": "building_roadway_overlap",
                    "message": "Building footprint cannot intersect a roadway or sidewalk. Snap next to the street edge instead of covering the road, curb, gutter, or sidewalk.",
                    "details": {
                        "rule": "no-roadway-or-sidewalk-overlap",
                        "buildingId": building.get("id"),
                        "buildingFootprint": footprint,
                        "streetIndex": index,
                        "street": _copy_jsonable(street),
                        "streetSurface": street_rect,
                        "placementRules": get_building_placement_rules()["constraints"],
                    },
                },
            }
    return {"ok": True, "rule": "no-roadway-or-sidewalk-overlap"}

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
_WORLD_META_FAST_CACHE = {"sig": None, "data": None}
_WORLD_META_BOOT_KEYS = {
    "version",
    "name",
    "createdAt",
    "initialized",
    "starterMap",
    "streetsRestoredFrom",
    "location",
    "tileSize",
    "chunkSize",
    "spawnX",
    "spawnY",
    "showMinimap",
    "dayNightCycleEnabled",
    "weatherEnabled",
}


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


def _world_meta_file_sig(path=META_FILE):
    try:
        stat = os.stat(path)
        return (stat.st_mtime_ns, stat.st_size)
    except OSError:
        return None


def load_world_meta_fast():
    """Read-only cached world meta for hot GET paths."""
    sig = _world_meta_file_sig()
    with _WORLD_META_LOCK:
        if sig and _WORLD_META_FAST_CACHE.get("sig") == sig and isinstance(_WORLD_META_FAST_CACHE.get("data"), dict):
            return _WORLD_META_FAST_CACHE["data"]
        try:
            meta = _read_json_file(META_FILE)
            _WORLD_META_FAST_CACHE["sig"] = _world_meta_file_sig()
            _WORLD_META_FAST_CACHE["data"] = meta
            return meta
        except FileNotFoundError:
            meta = _default_world_meta()
            save_world_meta(meta)
            return meta
        except json.JSONDecodeError as e:
            print(f"⚠️  world-meta.json is invalid; preserving it and trying backup: {e}")
            try:
                meta = _read_json_file(META_BACKUP_FILE)
                _WORLD_META_FAST_CACHE["sig"] = _world_meta_file_sig(META_BACKUP_FILE)
                _WORLD_META_FAST_CACHE["data"] = meta
                return meta
            except (FileNotFoundError, json.JSONDecodeError) as backup_error:
                print(f"⚠️  world-meta.json backup unavailable/invalid; using in-memory defaults only: {backup_error}")
                return _default_world_meta()


def world_meta_boot_payload(meta=None):
    meta = meta if isinstance(meta, dict) else load_world_meta_fast()
    return {key: copy.deepcopy(meta[key]) for key in _WORLD_META_BOOT_KEYS if key in meta}


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
        _WORLD_META_FAST_CACHE["sig"] = _world_meta_file_sig()
        _WORLD_META_FAST_CACHE["data"] = meta
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
WORLD_ACTION_SERVER_RUNTIME_OWNER = "agent-runtime-room.mjs#tickLiveActionRuntime"
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
LIVE_AGENT_LOOP_SCHEMA_VERSION = "agent-live-mode-loop/v1"
LIVE_AGENT_LOOP_PLAN_SCHEMA_VERSION = "agent-live-mode-plan/v1"
LIVE_AGENT_OPERATOR_PROPOSAL_SCHEMA_VERSION = "agent-live-mode-operator-proposal/v1"
LIVE_AGENT_OPERATOR_TIMELINE_SCHEMA_VERSION = "agent-live-mode-operator-timeline/v1"
LIVE_AGENT_LOOP_DEFAULTS = {
    "enabled": True,
    "intervalSec": 30,
    "minActionIntervalSec": 120,
    "clientActiveTtlSec": 45,
    "maxActionsPerTick": 1,
    "worldClientRequired": False,
    "serverRuntimeAuthority": True,
    "eventRetention": 100,
    "memoryRetention": 24,
    "reflectionRetention": 18,
    "feedbackRetention": 24,
    "settledActionRetention": 120,
    "planRetention": 12,
    "planMaxRetries": 2,
    "operatorProposalRetention": 24,
    "decisionMode": "planner-v2",
    "modelDecisionEnabled": True,
    "modelDecisionTimeoutSec": 45,
    "modelDecisionMinIntervalSec": 90,
    "userChatPreemptionEnabled": True,
    "userChatPreemptionHoldSec": 180,
}
LIVE_AGENT_LOOP_MODEL_DECISION_MODE = "model-autonomy-v3"
LIVE_AGENT_LOOP_MODEL_DECISION_SOURCES = {"openclaw"}
LIVE_AGENT_MODEL_PROMPT_CHAR_BUDGET = 12000
LIVE_AGENT_AUTONOMY_PLAN_SCHEMA_VERSION = "agent-live-mode-autonomy-plan/v1"
LIVE_AGENT_PLANNER_TRANSCRIPT_SCHEMA_VERSION = "agent-live-mode-planner-transcripts/v1"
LIVE_AGENT_PLANNER_TRANSCRIPT_FILE = os.path.join(DATA_DIR, "live-agent-planner-transcripts.json")
LIVE_AGENT_PLANNER_TRANSCRIPT_RETENTION = 120
LIVE_AGENT_PLANNER_TRANSCRIPT_TEXT_LIMIT = 20000
LIVE_AGENT_CRITICAL_NEED_THRESHOLD = 0.82
LIVE_AGENT_HIGH_NEED_THRESHOLD = 0.65
LIVE_AGENT_ISSUE_PRIORITY = 0.88
LIVE_AGENT_CURRENT_GOAL_PRIORITY = 0.74
LIVE_AGENT_DAILY_GOAL_PRIORITY = 0.52
LIVE_AGENT_LONG_TERM_GOAL_PRIORITY = 0.38
LIVE_AGENT_LOOP_CLIENT_MARKER_VERSION = "20260614-live-mode-social-r28"
LIVE_AGENT_HOME_INTERIOR_VERSION = "20260614-live-home-starter-interior-r1"
LIVE_AGENT_LOOP_STALE_ACTIVE_ACTION_SECONDS = {
    "route_pending": 360,
    "routing": 420,
    "arrived": 300,
    "in_progress": 900,
}
LIVE_AGENT_VISIBLE_ACTION_CONTRACT_VERSION = "agent-live-mode-visible-action-contract/v1"
LIVE_AGENT_LOOP_API_TILE = 40
LIVE_AGENT_HOME_BUILD_SITE_WIDTH_TILES = 10
LIVE_AGENT_HOME_BUILD_SITE_HEIGHT_TILES = 8
LIVE_AGENT_LOOP_NEED_DEFAULTS = {
    "hydration": 0.45,
    "food": 0.35,
    "energy": 0.32,
    "curiosity": 0.55,
    "maintenance": 0.22,
    "shelter": 0.68,
    "social": 0.30,
}
LIVE_AGENT_LOOP_NEED_RATES_PER_MIN = {
    "hydration": 0.012,
    "food": 0.008,
    "energy": 0.006,
    "curiosity": 0.010,
    "maintenance": 0.004,
    "shelter": 0.001,
    "social": 0.006,
}
LIVE_AGENT_LOOP_PERSONALITY_TRAITS = ("outgoing", "curious", "easygoing")
LIVE_AGENT_LOOP_PERSONALITY_NEED_WEIGHTS = {
    "hydration": {"easygoing": 0.18},
    "food": {"easygoing": 0.28},
    "energy": {"easygoing": 0.42},
    "curiosity": {"curious": 0.55},
    "maintenance": {"curious": 0.20},
    "shelter": {"easygoing": 0.20},
    "social": {"outgoing": 0.62, "easygoing": 0.12},
}
AGENT_WORKSPACE_SCHEMA_VERSION = "agent-framework-workspace/v1"
AGENT_WORKSPACE_ALLOWED_FILES = (
    "AGENTS.md",
    "SOUL.md",
    "IDENTITY.md",
    "USER.md",
    "MEMORY.md",
    "TOOLS.md",
    "HEARTBEAT.md",
)
AGENT_WORKSPACE_FILE_MAX_BYTES = 160 * 1024
AGENT_SKILL_FILE_MAX_BYTES = 256 * 1024
AGENT_SKILL_SCHEMA_VERSION = "agent-skills/v1"
SKILLS_LIBRARY_SCHEMA_VERSION = "skills-library/v1"
RESIDENT_PROFILE_SCHEMA_VERSION = "virtual-world-resident-profile/v1"
RESIDENT_PROFILE_TEXT_LIMIT = 4000
RESIDENT_PROFILE_LIST_LIMIT = 40
RESIDENT_PROFILE_MEMORY_LIMIT = 80
LIVE_AGENT_PROFILE_ACTION_KEYWORDS = {
    "hydrate-water-cooler": ("water", "hydrate", "hydration", "drink"),
    "hydrate-coffee-machine": ("coffee", "energy", "focus", "drink"),
    "snack-vending-machine": ("snack", "food", "eat", "vending"),
    "heat-microwave-food": ("food", "meal", "eat", "microwave", "heat"),
    "brainstorm-whiteboard": ("brainstorm", "plan", "idea", "learn", "curious", "create"),
    "work-on-active-goal": ("goal", "work", "task", "finish", "complete", "progress", "test"),
    "investigate-blocking-issue": ("issue", "bug", "broken", "fix", "failed", "blocked", "not working"),
    "use-seating-object": ("seat", "seating", "chair", "chairs", "furniture", "couch", "bench", "interactive", "sit"),
    "print-copy-document": ("print", "copy", "document", "maintenance", "paperwork"),
    "build-small-home-site": ("home", "house", "shelter", "settle", "build"),
    "rest-at-home": ("rest", "home", "sleep", "energy", "recover"),
    "talk-with-nearby-agent": ("social", "talk", "friend", "relationship", "conversation", "meet"),
}
LIVE_AGENT_PROFILE_GOAL_INTENT_KEYWORDS = {
    "seating-test": (
        "seat",
        "seating",
        "chair",
        "chairs",
        "couch",
        "bench",
        "stool",
        "sofa",
        "furniture",
        "sit",
        "interactive",
    ),
    "issue-investigation": (
        "issue",
        "bug",
        "broken",
        "blocked",
        "failed",
        "failing",
        "error",
        "not working",
        "doesnt work",
        "doesn't work",
        "fix",
        "repair",
    ),
    "building": ("build", "home", "house", "construct", "construction", "shelter"),
    "social": ("talk", "social", "friend", "relationship", "conversation", "meet"),
    "maintenance": ("maintain", "maintenance", "paperwork", "print", "copy", "document"),
}
LIVE_AGENT_GOAL_INTENT_ACTION_BOOSTS = {
    "seating-test": {"use-seating-object": 0.82, "work-on-active-goal": 0.30, "brainstorm-whiteboard": 0.12},
    "issue-investigation": {"investigate-blocking-issue": 0.86, "work-on-active-goal": 0.20, "brainstorm-whiteboard": 0.10},
    "building": {"build-small-home-site": 0.46, "work-on-active-goal": 0.18, "brainstorm-whiteboard": 0.10},
    "social": {"talk-with-nearby-agent": 0.40, "work-on-active-goal": 0.08},
    "maintenance": {"print-copy-document": 0.26, "investigate-blocking-issue": 0.18, "work-on-active-goal": 0.12},
}
# Object-category resolver data: maps world object catalog ids to their safe
# visible interaction. This is EXECUTION-layer data, not a planner menu. The
# planner/model expresses an intention (e.g. "use a seating object"), and the
# resolver below turns that intention into a real reachable object action.
LIVE_AGENT_SEATING_ACTION_CANDIDATES = (
    {"catalogIds": ("armchair",), "actionType": "life.restAtArmchair", "spotId": "seat", "label": "test seating on an armchair"},
    {"catalogIds": ("officeChair",), "actionType": "life.sitAtOfficeChair", "spotId": "seat", "label": "test seating on an office chair"},
    {"catalogIds": ("diningChair",), "actionType": "life.sitAtDiningChair", "spotId": "seat", "label": "test seating on a dining chair"},
    {"catalogIds": ("patioChair",), "actionType": "life.sitAtPatioChair", "spotId": "seat", "label": "test seating on a patio chair"},
    {"catalogIds": ("conferenceChair",), "actionType": "planning.sitAtConferenceChair", "spotId": "seat", "label": "test seating on a conference chair"},
    {"catalogIds": ("barStool",), "actionType": "life.sitAtBarStool", "spotId": "seat", "label": "test seating on a bar stool"},
    {"catalogIds": ("couch",), "actionType": "life.restAtCouch", "spotId": "sit-center", "label": "test seating on a couch"},
    {"catalogIds": ("sectionalSofa", "sectional-sofa-variants"), "actionType": "life.restAtSectionalSofa", "spotId": "seat-center", "label": "test seating on a sectional sofa"},
    {"catalogIds": ("loveseat",), "actionType": "life.restAtLoveseat", "spotId": "seat-left", "label": "test seating on a loveseat"},
    {"catalogIds": ("parkBench", "park-bench"), "actionType": "life.restAtBench", "spotId": "seat-left", "label": "test seating on a park bench"},
    {"catalogIds": ("hallwayBench", "hallway-bench"), "actionType": "life.restAtHallwayBench", "spotId": "seat-left", "label": "test seating on a hallway bench"},
    {"catalogIds": ("gazeboPavilion", "gazebo-pavilion"), "actionType": "life.restAtGazeboPavilion", "spotId": "rest-west", "label": "test seating in a gazebo pavilion"},
)
LIVE_AGENT_SEATING_ACTION_TYPES = tuple(sorted({
    str(candidate.get("actionType") or "")
    for candidate in LIVE_AGENT_SEATING_ACTION_CANDIDATES
    if candidate.get("actionType")
}))
LIVE_AGENT_SEATING_COMPLETION_VALIDATION_VERSION = "agent-live-seating-completion-validation/v1"
# Dynamic object-category affordances. These are NOT fixed planner actions:
# they only become candidates when an agent's own goals or model intention ask
# for that category, and their concrete target/actionType is resolved at
# runtime from real available world objects.
LIVE_AGENT_DYNAMIC_OBJECT_AFFORDANCES = {
    "seating": {
        "id": "use-seating-object",
        "targetKind": "seating-object",
        "actionType": "life.restAtArmchair",
        "capabilityTag": "life.rest",
        "need": "curiosity",
        "category": "seating",
        "autonomyKind": "goal-work",
        "dynamic": True,
        "label": "use a seating object",
        "experience": "route to a real chair, couch, stool, or bench and visibly use its seating interaction",
    },
}
LIVE_AGENT_GOAL_INTENT_OBJECT_CATEGORIES = {
    "seating-test": ("seating",),
}
LIVE_AGENT_INTENTION_CATEGORY_ALIASES = {
    "seating": "seating",
    "seat": "seating",
    "chair": "seating",
    "chairs": "seating",
    "couch": "seating",
    "sofa": "seating",
    "bench": "seating",
    "stool": "seating",
    "furnitureseating": "seating",
}
LIVE_AGENT_LOOP_ACTIONS = [
    {
        "id": "hydrate-water-cooler",
        "catalogIds": ["waterCooler", "coffeeMachine"],
        "actionType": "life.getWater",
        "capabilityTag": "life.hydration",
        "interactionSpotId": "use-front",
        "need": "hydration",
        "label": "get water",
        "experience": "get water from the Office cooler",
    },
    {
        "id": "hydrate-coffee-machine",
        "catalogIds": ["countertopCoffeeMachine"],
        "actionType": "life.getCoffee",
        "capabilityTag": "life.hydration",
        "interactionSpotId": "use-front",
        "need": "energy",
        "label": "get coffee",
        "experience": "make coffee at the counter",
    },
    {
        "id": "snack-vending-machine",
        "catalogIds": ["vending", "vending-machine"],
        "actionType": "life.buyVendingSnackDrink",
        "capabilityTag": "life.food",
        "interactionSpotId": "use-front",
        "need": "food",
        "label": "buy a snack",
        "experience": "use the vending machine",
    },
    {
        "id": "heat-microwave-food",
        "catalogIds": ["microwave"],
        "actionType": "life.heatFood",
        "capabilityTag": "life.food",
        "interactionSpotId": "use-front",
        "need": "food",
        "label": "heat food",
        "experience": "heat a snack in the microwave",
    },
    {
        "id": "brainstorm-whiteboard",
        "catalogIds": ["whiteboard"],
        "actionType": "planning.brainstorm",
        "capabilityTag": "planning.brainstorm",
        "interactionSpotId": "presenter",
        "need": "curiosity",
        "label": "brainstorm at whiteboard",
        "experience": "think through ideas at the Office whiteboard",
    },
    {
        "id": "work-on-active-goal",
        "catalogIds": ["whiteboard"],
        "actionType": "planning.brainstorm",
        "capabilityTag": "planning.brainstorm",
        "interactionSpotId": "presenter",
        "need": "curiosity",
        "autonomyKind": "goal-work",
        "label": "work on active goal",
        "experience": "use a visible planning surface to make progress on the current Resident Profile goal",
    },
    {
        "id": "investigate-blocking-issue",
        "catalogIds": ["whiteboard"],
        "actionType": "planning.brainstorm",
        "capabilityTag": "planning.brainstorm",
        "interactionSpotId": "presenter",
        "need": "maintenance",
        "autonomyKind": "issue-investigation",
        "label": "investigate blocking issue",
        "experience": "review a recent failure or broken behavior and form a visible recovery plan",
    },
    {
        "id": "print-copy-document",
        "catalogIds": ["printerCopier", "all-in-one-printer-scanner"],
        "actionType": "maintenance.printCopy",
        "capabilityTag": "maintenance.printCopy",
        "interactionSpotId": "use-front",
        "need": "maintenance",
        "label": "print or copy",
        "experience": "use the Office printer/copier",
    },
    {
        "id": "build-small-home-site",
        "targetKind": "world-point",
        "siteKind": "agent-home",
        "actionType": "world.buildStructure",
        "capabilityTag": "world.build",
        "need": "shelter",
        "label": "build a small home",
        "experience": "build a small home at a visible construction site",
    },
    {
        "id": "rest-at-home",
        "targetKind": "agent-home-building",
        "actionType": "life.restAtHome",
        "capabilityTag": "life.rest",
        "need": "energy",
        "label": "rest at home",
        "experience": "go home and rest at their visible home",
    },
    {
        "id": "talk-with-nearby-agent",
        "targetKind": "agent",
        "actionType": "life.social",
        "capabilityTag": "life.social",
        "need": "social",
        "label": "talk with a nearby agent",
        "experience": "approach a visible nearby resident and have a short in-world conversation",
    },
]
LIVE_AGENT_VISIBLE_ACTION_CONTRACTS = {
    "life.getWater": {
        "schemaVersion": LIVE_AGENT_VISIBLE_ACTION_CONTRACT_VERSION,
        "policy": "visible-world-execution-required",
        "visibleInWorld": True,
        "hiddenWorldMutationAllowed": False,
        "requiresWorldAction": True,
        "requiresMoveIntent": True,
        "targetKind": "object-instance",
        "clientExecutor": "main3d.js#routeLiveModeStandingMachineWorldAction",
        "routeKind": "standing-machine-use",
        "requiredStages": ["reserved", "route_pending", "routing", "arrived", "in_progress", "completed"],
    },
    "life.getCoffee": {
        "schemaVersion": LIVE_AGENT_VISIBLE_ACTION_CONTRACT_VERSION,
        "policy": "visible-world-execution-required",
        "visibleInWorld": True,
        "hiddenWorldMutationAllowed": False,
        "requiresWorldAction": True,
        "requiresMoveIntent": True,
        "targetKind": "object-instance",
        "clientExecutor": "main3d.js#routeLiveModeStandingMachineWorldAction",
        "routeKind": "standing-machine-use",
        "requiredStages": ["reserved", "route_pending", "routing", "arrived", "in_progress", "completed"],
    },
    "life.buyVendingSnackDrink": {
        "schemaVersion": LIVE_AGENT_VISIBLE_ACTION_CONTRACT_VERSION,
        "policy": "visible-world-execution-required",
        "visibleInWorld": True,
        "hiddenWorldMutationAllowed": False,
        "requiresWorldAction": True,
        "requiresMoveIntent": True,
        "targetKind": "object-instance",
        "clientExecutor": "main3d.js#routeLiveModeStandingMachineWorldAction",
        "routeKind": "standing-machine-use",
        "requiredStages": ["reserved", "route_pending", "routing", "arrived", "in_progress", "completed"],
    },
    "life.heatFood": {
        "schemaVersion": LIVE_AGENT_VISIBLE_ACTION_CONTRACT_VERSION,
        "policy": "visible-world-execution-required",
        "visibleInWorld": True,
        "hiddenWorldMutationAllowed": False,
        "requiresWorldAction": True,
        "requiresMoveIntent": True,
        "targetKind": "object-instance",
        "clientExecutor": "main3d.js#routeLiveModeStandingMachineWorldAction",
        "routeKind": "standing-machine-use",
        "requiredStages": ["reserved", "route_pending", "routing", "arrived", "in_progress", "completed"],
    },
    "life.restAtHome": {
        "schemaVersion": LIVE_AGENT_VISIBLE_ACTION_CONTRACT_VERSION,
        "policy": "visible-world-execution-required",
        "visibleInWorld": True,
        "hiddenWorldMutationAllowed": False,
        "requiresWorldAction": True,
        "requiresMoveIntent": True,
        "targetKind": "building",
        "clientExecutor": "main3d.js#routeLiveModeHomeWorldAction",
        "routeKind": "home-rest",
        "requiredStages": ["reserved", "route_pending", "routing", "arrived", "in_progress", "completed"],
    },
    "planning.brainstorm": {
        "schemaVersion": LIVE_AGENT_VISIBLE_ACTION_CONTRACT_VERSION,
        "policy": "visible-world-execution-required",
        "visibleInWorld": True,
        "hiddenWorldMutationAllowed": False,
        "requiresWorldAction": True,
        "requiresMoveIntent": True,
        "targetKind": "object-instance",
        "clientExecutor": "main3d.js#routeLiveModeLocalObjectWorldAction",
        "routeKind": "local-object-use",
        "requiredStages": ["reserved", "route_pending", "routing", "arrived", "in_progress", "completed"],
    },
    "maintenance.printCopy": {
        "schemaVersion": LIVE_AGENT_VISIBLE_ACTION_CONTRACT_VERSION,
        "policy": "visible-world-execution-required",
        "visibleInWorld": True,
        "hiddenWorldMutationAllowed": False,
        "requiresWorldAction": True,
        "requiresMoveIntent": True,
        "targetKind": "object-instance",
        "clientExecutor": "main3d.js#routeLiveModeStandingMachineWorldAction",
        "routeKind": "standing-machine-use",
        "requiredStages": ["reserved", "route_pending", "routing", "arrived", "in_progress", "completed"],
    },
    "world.buildStructure": {
        "schemaVersion": LIVE_AGENT_VISIBLE_ACTION_CONTRACT_VERSION,
        "policy": "visible-world-execution-required",
        "visibleInWorld": True,
        "hiddenWorldMutationAllowed": False,
        "requiresWorldAction": True,
        "requiresMoveIntent": True,
        "targetKind": "world-point",
        "clientExecutor": "main3d.js#routeLiveModeConstructionSiteWorldAction",
        "routeKind": "construction-site-build",
        "mutatesWorldOnlyAfterVisibleCompletion": True,
        "requiredStages": ["reserved", "route_pending", "routing", "arrived", "in_progress", "completed"],
    },
    "life.social": {
        "schemaVersion": LIVE_AGENT_VISIBLE_ACTION_CONTRACT_VERSION,
        "policy": "visible-world-execution-required",
        "visibleInWorld": True,
        "hiddenWorldMutationAllowed": False,
        "requiresWorldAction": True,
        "requiresMoveIntent": True,
        "targetKind": "agent",
        "clientExecutor": "main3d.js#routeLiveModeSocialWorldAction",
        "routeKind": "social-agent-conversation",
        "requiredStages": ["reserved", "route_pending", "routing", "arrived", "in_progress", "completed"],
    },
}
LIVE_AGENT_LOCAL_OBJECT_VISIBLE_ACTION_TYPES = (
    "life.sitAtArmchair",
    "life.restAtArmchair",
    "life.sitAtOfficeChair",
    "planning.workAtOfficeChair",
    "life.sitAtDiningChair",
    "life.sitAtPatioChair",
    "planning.sitAtConferenceChair",
    "life.sitAtBarStool",
    "life.sitAtCouch",
    "life.restAtCouch",
    "life.sitAtSectionalSofa",
    "life.restAtSectionalSofa",
    "life.loungeAtSectionalSofa",
    "life.sitAtLoveseat",
    "life.restAtLoveseat",
    "life.sitAtBench",
    "life.restAtBench",
    "life.restAtHallwayBench",
    "life.sitAtGazeboPavilion",
    "life.restAtGazeboPavilion",
)
for _live_agent_action_type in LIVE_AGENT_LOCAL_OBJECT_VISIBLE_ACTION_TYPES:
    LIVE_AGENT_VISIBLE_ACTION_CONTRACTS.setdefault(
        _live_agent_action_type,
        {
            "schemaVersion": LIVE_AGENT_VISIBLE_ACTION_CONTRACT_VERSION,
            "policy": "visible-world-execution-required",
            "visibleInWorld": True,
            "hiddenWorldMutationAllowed": False,
            "requiresWorldAction": True,
            "requiresMoveIntent": True,
            "targetKind": "object-instance",
            "clientExecutor": "main3d.js#routeLiveModeLocalObjectWorldAction",
            "routeKind": "local-object-use",
            "requiredStages": ["reserved", "route_pending", "routing", "arrived", "in_progress", "completed"],
        },
    )
LIVE_AGENT_PROPOSAL_ONLY_CAPABILITIES = [
    {
        "id": "world.build.customStructure",
        "actionType": "world.build",
        "capabilityTag": "world.build",
        "label": "build arbitrary custom structures",
        "status": "proposal_only",
        "blockedReason": "missing-visible-client-executor",
        "requiredExecutor": "visible-custom-construction-site-build",
        "requirement": "Arbitrary structures still need typed visible executors. The small-home path is executable through world.buildStructure and routeLiveModeConstructionSiteWorldAction.",
    },
    {
        "id": "world.modify.road",
        "actionType": "world.modifyRoad",
        "capabilityTag": "world.terrain",
        "label": "modify a road or path",
        "status": "proposal_only",
        "blockedReason": "missing-visible-client-executor",
        "requiredExecutor": "visible-roadwork-construction",
        "requirement": "Agent must be physically present at the roadwork site and show the edit as an in-world construction sequence before changing persisted streets or terrain.",
    },
    {
        "id": "world.move.object",
        "actionType": "world.moveObject",
        "capabilityTag": "world.decorate",
        "label": "move a placed object",
        "status": "proposal_only",
        "blockedReason": "missing-visible-client-executor",
        "requiredExecutor": "visible-object-relocation",
        "requirement": "Agent must visibly go to the object, pick up or stage it, move to the destination, place it, then persist the placement.",
    },
    {
        "id": "world.delete.object",
        "actionType": "world.deleteObject",
        "capabilityTag": "world.decorate",
        "label": "delete or remove a placed object",
        "status": "proposal_only",
        "blockedReason": "missing-visible-client-executor",
        "requiredExecutor": "visible-object-removal",
        "requirement": "Agent must visibly go to the object and perform a removal/cleanup sequence before the object is deleted from persistent world state.",
    },
]


def _api_error(code, message, *, details=None):
    body = {"error": {"code": code, "message": message}}
    if details is not None:
        body["error"]["details"] = details
    return body


def _copy_jsonable(value):
    return json.loads(json.dumps(value))


def _live_agent_visible_action_contract(action_type):
    key = str(action_type or "").strip()
    contract = LIVE_AGENT_VISIBLE_ACTION_CONTRACTS.get(key)
    if not isinstance(contract, dict):
        return None
    copied = _copy_jsonable(contract)
    copied["serverExecutor"] = WORLD_ACTION_SERVER_RUNTIME_OWNER
    copied["serverRuntimeAuthority"] = True
    return copied


def _live_agent_visible_action_policy():
    return {
        "schemaVersion": LIVE_AGENT_VISIBLE_ACTION_CONTRACT_VERSION,
        "policy": "visible-world-execution-required",
        "hiddenWorldMutationAllowed": False,
        "appliesToSourceKind": "agent-live-mode",
        "requiredExecution": {
            "requiresWorldAction": True,
            "requiresMoveIntent": True,
            "requiresServerRuntimeAuthority": True,
            "requiresVisibleClientExecutor": True,
            "requiresVisibleCompletionEvent": True,
            "requiresPhysicalAgentPresence": True,
        },
        "proposalOnlyCapabilities": _copy_jsonable(LIVE_AGENT_PROPOSAL_ONLY_CAPABILITIES),
    }


def _live_agent_proposal_only_capability_for(action_type=None, capability_tag=None):
    action_key = str(action_type or "").strip()
    capability_key = str(capability_tag or "").strip()
    for capability in LIVE_AGENT_PROPOSAL_ONLY_CAPABILITIES:
        if action_key and action_key == capability.get("actionType"):
            return _copy_jsonable(capability)
    for capability in LIVE_AGENT_PROPOSAL_ONLY_CAPABILITIES:
        if capability_key and capability_key == capability.get("capabilityTag"):
            return _copy_jsonable(capability)
    if action_key.startswith("world.") or capability_key.startswith("world."):
        return {
            "id": f"{action_key or capability_key}.proposal",
            "actionType": action_key,
            "capabilityTag": capability_key,
            "label": action_key or capability_key,
            "status": "proposal_only",
            "blockedReason": "missing-visible-client-executor",
            "requiredExecutor": "typed-visible-world-executor",
            "requirement": "High-impact Live Mode world changes must be reviewed and given a typed visible executor before any persistent mutation is allowed.",
        }
    return None


def _validate_live_agent_visible_action_contract(payload, action_type=None, capability=None):
    if not isinstance(payload, dict):
        return None, None
    source = payload.get("source") if isinstance(payload.get("source"), dict) else {}
    if source.get("kind") != "agent-live-mode":
        return None, None
    resolved_action_type = str(action_type or payload.get("actionType") or payload.get("actionId") or "").strip()
    if not resolved_action_type:
        return None, None
    contract = _live_agent_visible_action_contract(resolved_action_type)
    if not contract:
        return None, _api_error(
            "hidden_action_not_allowed",
            "Agent Live Mode actions must have a visible world executor before they can mutate or reserve world state.",
            details={
                "actionType": resolved_action_type,
                "capabilityTag": capability or payload.get("capabilityTag"),
                "contractVersion": LIVE_AGENT_VISIBLE_ACTION_CONTRACT_VERSION,
                "policy": "visible-world-execution-required",
                "hiddenWorldMutationAllowed": False,
                "proposalOnlyCapabilities": _copy_jsonable(LIVE_AGENT_PROPOSAL_ONLY_CAPABILITIES),
            },
        )
    target = payload.get("target") if isinstance(payload.get("target"), dict) else {}
    target_kind = target.get("kind") or "object-instance"
    required_target_kind = contract.get("targetKind")
    if required_target_kind and target_kind != required_target_kind:
        return None, _api_error(
            "visible_executor_missing",
            "Agent Live Mode action target does not match the visible client executor contract.",
            details={
                "actionType": resolved_action_type,
                "targetKind": target_kind,
                "requiredTargetKind": required_target_kind,
                "clientExecutor": contract.get("clientExecutor"),
                "contractVersion": LIVE_AGENT_VISIBLE_ACTION_CONTRACT_VERSION,
            },
        )
    return contract, None


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


WORLD_ACTION_CATALOG_ID_ALIASES = {
    "printercopier": "all-in-one-printer-scanner",
    "printerscanner": "all-in-one-printer-scanner",
    "allinoneprinterscanner": "all-in-one-printer-scanner",
}


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
    aliased_catalog_id = WORLD_ACTION_CATALOG_ID_ALIASES.get(key)
    if aliased_catalog_id:
        key = _normalize_token(aliased_catalog_id)
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
    if kind == "agent":
        target_agent_id = _resolve_agent_id(target.get("targetAgentId"))
        if not target_agent_id:
            return None
        return {"kind": "agent", "agentId": target_agent_id, "object": None, "collection": None, "index": None}
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
    visible_action_contract = None
    if isinstance(source, dict) and source.get("kind") == "agent-live-mode":
        visible_action_contract, contract_error = _validate_live_agent_visible_action_contract(payload, action_type=action_type, capability=capability)
        if contract_error:
            return None, contract_error
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
    if target_kind == "agent":
        target_agent_id = resolved.get("agentId") if isinstance(resolved, dict) else _resolve_agent_id(target.get("targetAgentId"))
        if not target_agent_id:
            return None, _api_error("target_missing", "Target agent does not exist.", details={"targetAgentId": target.get("targetAgentId")})
        if target_agent_id == agent_id:
            return None, _api_error("unsupported_target", "Agent Live Mode social actions cannot target the same agent.", details={"agentId": agent_id, "targetAgentId": target_agent_id})
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
    elif target_kind == "agent":
        target_snapshot["targetAgentId"] = resolved.get("agentId") if isinstance(resolved, dict) else target.get("targetAgentId")
        target_snapshot["buildingId"] = target.get("buildingId")
        target_snapshot["floor"] = int(target.get("floor") or 1)
    behavior = behavior or {}
    route_behavior = {k: behavior.get(k) for k in ["behaviorSourceKind", "behaviorMode", "behaviorAuthority", "behaviorSelectedCategory", "behaviorSelectedObject", "behaviorSelectedSpot", "behaviorProbabilityRoll", "behaviorFallbackReason"]}
    server_authoritative_runtime = bool(visible_action_contract)
    route_target = {
        "target": target_snapshot,
        "handoff": WORLD_ACTION_SERVER_RUNTIME_OWNER if server_authoritative_runtime else WORLD_ACTION_CREATE_ROUTE_OWNER,
        "routeOwner": "server-authoritative-runtime" if server_authoritative_runtime else "client-runtime",
        "setAgentTarget": False if server_authoritative_runtime else True,
        "serverExecutor": WORLD_ACTION_SERVER_RUNTIME_OWNER if server_authoritative_runtime else None,
        "serverRuntimeAuthority": server_authoritative_runtime,
        "source": source,
        "behavior": route_behavior,
        "behaviorSourceKind": behavior.get("behaviorSourceKind"),
        "behaviorMode": behavior.get("behaviorMode"),
        "behaviorCategory": behavior.get("behaviorSelectedCategory"),
    }
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
    if visible_action_contract:
        action["visibility"] = {
            "schemaVersion": LIVE_AGENT_VISIBLE_ACTION_CONTRACT_VERSION,
            "policy": visible_action_contract.get("policy"),
            "visibleInWorld": True,
            "hiddenWorldMutationAllowed": False,
            "clientExecutor": visible_action_contract.get("clientExecutor"),
            "serverExecutor": WORLD_ACTION_SERVER_RUNTIME_OWNER,
            "serverRuntimeAuthority": True,
            "requiresMoveIntent": visible_action_contract.get("requiresMoveIntent") is True,
            "requiresPhysicalAgentPresence": True,
        }
        action["route"]["visibleActionContract"] = action["visibility"]
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
            "hidden_action_not_allowed": 422,
            "visible_executor_missing": 422,
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


def _linked_world_action_terminal_for_move(intent):
    if not isinstance(intent, dict):
        return None
    action_id = _move_intent_linked_world_action_id(intent)
    if not action_id:
        return None
    store = get_world_actions_store(persist_migration=True)
    bucket, _, action = _find_world_action_record(store, action_id)
    if action is None:
        return {"status": "failed", "reason": "linked_action_missing", "actionId": action_id}
    status = _canonical_world_action_status(action.get("status"))
    if bucket == "active" and status not in WORLD_ACTION_TERMINAL_STATES:
        return None
    terminal_status = {
        "completed": "arrived",
        "cancelled": "cancelled",
        "failed": "failed",
        "expired": "expired",
    }.get(status, "failed")
    return {
        "status": terminal_status,
        "reason": action.get("failureReason") or status or "linked_action_terminal",
        "actionId": action_id,
        "worldActionId": action_id,
        "worldActionStatus": status,
    }


def _move_intent_linked_world_action_id(intent):
    if not isinstance(intent, dict):
        return None
    target = intent.get("target") if isinstance(intent.get("target"), dict) else {}
    metadata = intent.get("targetMetadata") if isinstance(intent.get("targetMetadata"), dict) else {}
    route = intent.get("route") if isinstance(intent.get("route"), dict) else {}
    route_target = route.get("target") if isinstance(route.get("target"), dict) else {}
    route_metadata = route.get("targetMetadata") if isinstance(route.get("targetMetadata"), dict) else {}
    for value in (
        intent.get("worldActionId"),
        intent.get("actionId"),
        target.get("worldActionId"),
        target.get("actionId"),
        metadata.get("worldActionId"),
        metadata.get("actionId"),
        route.get("worldActionId"),
        route_target.get("worldActionId"),
        route_target.get("actionId"),
        route_metadata.get("worldActionId"),
        route_metadata.get("actionId"),
    ):
        if value:
            return value
    return None


def reconcile_move_intents():
    store = get_move_intents_store(persist_migration=True)
    now = _utc_now_iso()
    active = []
    history = list(store.get("history", []))
    changed = False
    for intent in store.get("active", []):
        linked_terminal = _linked_world_action_terminal_for_move(intent)
        reason = linked_terminal.get("reason") if linked_terminal else _move_target_invalid_reason(intent.get("target"))
        if reason:
            failed = dict(intent)
            route_status = linked_terminal.get("status") if linked_terminal else "failed"
            failed.update({"status": route_status if linked_terminal else "invalidated", "routeStatus": route_status, "failureReason": None if route_status == "arrived" else reason, "invalidatedAt": now, "updatedAt": now})
            route = dict(failed.get("route") or {})
            route.update({"state": route_status, "status": route_status, "setAgentTarget": False, "failureReason": None if route_status == "arrived" else reason})
            if linked_terminal:
                route["linkedWorldAction"] = linked_terminal
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
        intent_action_id = _move_intent_linked_world_action_id(intent)
        if intent.get("agentId") == agent_id and intent.get("routeStatus") in MOVE_INTENT_ACTIVE_STATES and (not action_id or intent_action_id != action_id):
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
        records.append({"type": "move-intent", "id": intent.get("id"), "status": intent.get("routeStatus"), "worldActionId": _move_intent_linked_world_action_id(intent), "behaviorSourceKind": _behavior_source_kind_from_record(intent), "record": intent})
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
    live_world = setting.get("liveWorld") if isinstance(setting.get("liveWorld"), dict) else _agent_live_world_claim_payload(agent_id)
    if live_world.get("conflict"):
        return False, _api_error(
            "agent_live_mode_world_conflict",
            live_world.get("notice") or "This agent is currently live in another Virtual World.",
            details={
                "agentId": agent_id,
                "currentWorld": live_world.get("currentWorld"),
                "activeWorld": live_world.get("claim"),
                "notice": live_world.get("notice"),
            },
        ), 409

    visible_action_contract, contract_error = _validate_live_agent_visible_action_contract(payload, action_type=payload.get("actionType") or payload.get("actionId"), capability=payload.get("capabilityTag"))
    if contract_error:
        proposal = None
        with _live_agent_loop_lock:
            state = get_live_agent_loop_state(persist_migration=True)
            proposal = _live_agent_loop_record_operator_proposal_from_rejection(state, agent_id, payload, contract_error)
            if proposal:
                save_live_agent_loop_state(state)
        if proposal and isinstance(contract_error.get("error"), dict):
            contract_error = _copy_jsonable(contract_error)
            details = contract_error["error"].setdefault("details", {})
            if isinstance(details, dict):
                details["operatorProposal"] = {
                    "schemaVersion": LIVE_AGENT_OPERATOR_PROPOSAL_SCHEMA_VERSION,
                    "id": proposal.get("id"),
                    "status": proposal.get("status"),
                    "executesOnApproval": False,
                    "endpoint": "GET /api/agent-live-loop/proposals",
                }
        return False, contract_error, 422

    with _live_agent_action_handoff_lock:
        interrupted, error, status = _prepare_agent_live_mode_action_call(agent_id)
        if error:
            return False, error, status

        action_payload = {**payload, "agentId": agent_id, "source": {**source, "kind": "agent-live-mode"}}
        visible_params = {
            "visibleActionContractVersion": LIVE_AGENT_VISIBLE_ACTION_CONTRACT_VERSION,
            "visibleActionPolicy": "visible-world-execution-required",
            "visibleWorldAction": True,
            "hiddenWorldMutationAllowed": False,
            "visibleExecutor": visible_action_contract.get("clientExecutor") if visible_action_contract else None,
            "requiresPhysicalAgentPresence": True,
        }
        if isinstance(payload.get("params"), dict):
            action_payload["params"] = {**payload.get("params"), **visible_params}
        elif payload.get("params") is None:
            action_payload["params"] = visible_params
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
        return True, {"ok": True, "action": action_result.get("action"), "worldAction": action_result, "moveIntent": move_result.get("moveIntent"), "routeHandoff": move_result.get("routeHandoff"), "linkedAction": move_result.get("linkedAction"), "interruptedLowerLayer": interrupted, "callerContract": {"endpoint": "POST /api/agent-model/actions", "requiredSourceKind": "agent-live-mode", "requiresAgentLiveModeEnabled": True, "usesExistingWorldActionValidation": True, "usesExistingMoveIntentHandoff": True, "visibleActionContractVersion": LIVE_AGENT_VISIBLE_ACTION_CONTRACT_VERSION, "visibleWorldExecutionRequired": True, "hiddenWorldMutationAllowed": False, "visibleExecutor": visible_action_contract.get("clientExecutor") if visible_action_contract else None, "overrideOrder": ["user", "agent-live-mode", "agent-scripted-mode"]}}, 202


# ─── AGENT LIVE MODE PERSISTENT LOOP ─────────────────────────────
def _epoch_to_utc_iso(epoch):
    try:
        return time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime(float(epoch)))
    except (TypeError, ValueError, OSError):
        return _utc_now_iso()


def default_live_agent_loop_state():
    now = _utc_now_iso()
    return {
        "schemaVersion": LIVE_AGENT_LOOP_SCHEMA_VERSION,
        "enabled": LIVE_AGENT_LOOP_DEFAULTS["enabled"],
        "createdAt": now,
        "updatedAt": now,
        "lastTickAt": None,
        "pausedUntil": None,
        "pauseReason": None,
        "pausedAt": None,
        "pausedBy": None,
        "intervalSec": LIVE_AGENT_LOOP_DEFAULTS["intervalSec"],
        "minActionIntervalSec": LIVE_AGENT_LOOP_DEFAULTS["minActionIntervalSec"],
        "clientActiveTtlSec": LIVE_AGENT_LOOP_DEFAULTS["clientActiveTtlSec"],
        "maxActionsPerTick": LIVE_AGENT_LOOP_DEFAULTS["maxActionsPerTick"],
        "worldClientRequired": LIVE_AGENT_LOOP_DEFAULTS["worldClientRequired"],
        "serverRuntimeAuthority": LIVE_AGENT_LOOP_DEFAULTS["serverRuntimeAuthority"],
        "modelDecisionEnabled": LIVE_AGENT_LOOP_DEFAULTS["modelDecisionEnabled"],
        "modelDecisionTimeoutSec": LIVE_AGENT_LOOP_DEFAULTS["modelDecisionTimeoutSec"],
        "modelDecisionMinIntervalSec": LIVE_AGENT_LOOP_DEFAULTS["modelDecisionMinIntervalSec"],
        "userChatPreemptionEnabled": LIVE_AGENT_LOOP_DEFAULTS["userChatPreemptionEnabled"],
        "userChatPreemptionHoldSec": LIVE_AGENT_LOOP_DEFAULTS["userChatPreemptionHoldSec"],
        "agents": {},
        "events": [],
        "stats": {"ticks": 0, "actionsCreated": 0, "dryRuns": 0, "errors": 0},
    }


def _normalize_int(value, fallback, *, minimum=None, maximum=None):
    try:
        number = int(value)
    except (TypeError, ValueError):
        number = fallback
    if minimum is not None:
        number = max(minimum, number)
    if maximum is not None:
        number = min(maximum, number)
    return number


def _normalize_live_agent_loop_state(raw):
    state = default_live_agent_loop_state()
    if isinstance(raw, dict):
        for key in ("enabled", "createdAt", "updatedAt", "lastTickAt", "worldClientRequired", "serverRuntimeAuthority", "pausedUntil", "pauseReason", "pausedAt", "pausedBy"):
            if key in raw:
                state[key] = raw[key]
        state["intervalSec"] = _normalize_int(raw.get("intervalSec"), state["intervalSec"], minimum=10, maximum=300)
        state["minActionIntervalSec"] = _normalize_int(raw.get("minActionIntervalSec"), state["minActionIntervalSec"], minimum=30, maximum=3600)
        state["clientActiveTtlSec"] = _normalize_int(raw.get("clientActiveTtlSec"), state["clientActiveTtlSec"], minimum=10, maximum=300)
        state["maxActionsPerTick"] = _normalize_int(raw.get("maxActionsPerTick"), state["maxActionsPerTick"], minimum=1, maximum=5)
        if isinstance(raw.get("modelDecisionEnabled"), bool):
            state["modelDecisionEnabled"] = raw["modelDecisionEnabled"]
        state["modelDecisionTimeoutSec"] = _normalize_int(raw.get("modelDecisionTimeoutSec"), state["modelDecisionTimeoutSec"], minimum=10, maximum=180)
        state["modelDecisionMinIntervalSec"] = _normalize_int(raw.get("modelDecisionMinIntervalSec"), state["modelDecisionMinIntervalSec"], minimum=30, maximum=3600)
        if isinstance(raw.get("userChatPreemptionEnabled"), bool):
            state["userChatPreemptionEnabled"] = raw["userChatPreemptionEnabled"]
        state["userChatPreemptionHoldSec"] = _normalize_int(raw.get("userChatPreemptionHoldSec"), state["userChatPreemptionHoldSec"], minimum=30, maximum=1800)
        if isinstance(raw.get("agents"), dict):
            state["agents"] = {str(k): v for k, v in raw["agents"].items() if isinstance(v, dict)}
        if isinstance(raw.get("events"), list):
            state["events"] = [event for event in raw["events"] if isinstance(event, dict)][-LIVE_AGENT_LOOP_DEFAULTS["eventRetention"]:]
        if isinstance(raw.get("operatorProposals"), list):
            state["operatorProposals"] = [proposal for proposal in raw["operatorProposals"] if isinstance(proposal, dict)][-LIVE_AGENT_LOOP_DEFAULTS["operatorProposalRetention"]:]
        if isinstance(raw.get("stats"), dict):
            state["stats"].update({k: v for k, v in raw["stats"].items() if isinstance(v, (int, float))})
    state["schemaVersion"] = LIVE_AGENT_LOOP_SCHEMA_VERSION
    state["enabled"] = bool(state.get("enabled"))
    state["serverRuntimeAuthority"] = True
    state["worldClientRequired"] = False
    if state.get("pausedUntil") and not _parse_isoish_epoch(state.get("pausedUntil")):
        state["pausedUntil"] = None
        state["pauseReason"] = None
        state["pausedAt"] = None
        state["pausedBy"] = None
    _live_agent_loop_normalize_operator_proposals(state)
    return state


def get_live_agent_loop_state(*, persist_migration=False, meta=None):
    meta = meta if isinstance(meta, dict) else load_world_meta_fast()
    agent_life = meta.get("agentLife") if isinstance(meta.get("agentLife"), dict) else {}
    existing = agent_life.get("liveModeLoop")
    state = _normalize_live_agent_loop_state(existing)
    if persist_migration and state != existing:
        agent_life["liveModeLoop"] = state
        meta["agentLife"] = agent_life
        save_world_meta(meta)
    return state


def save_live_agent_loop_state(state):
    meta = load_world_meta()
    agent_life = meta.get("agentLife") if isinstance(meta.get("agentLife"), dict) else {}
    state = _normalize_live_agent_loop_state(state)
    state["updatedAt"] = _utc_now_iso()
    agent_life["liveModeLoop"] = state
    meta["agentLife"] = agent_life
    save_world_meta(meta)
    return state


def _clean_live_agent_loop_client_detail(value, limit=160):
    if value is None:
        return None
    text = str(value).strip()
    if not text:
        return None
    return text[:limit]


def note_live_agent_loop_world_client_activity(source="/api/world-actions/active", client_version=None, client_info=None):
    global _live_agent_loop_last_client_at, _live_agent_loop_last_client_info
    if client_version != LIVE_AGENT_LOOP_CLIENT_MARKER_VERSION:
        return False
    now_epoch = time.time()
    state = get_live_agent_loop_state()
    ttl = _normalize_int(state.get("clientActiveTtlSec"), LIVE_AGENT_LOOP_DEFAULTS["clientActiveTtlSec"], minimum=10, maximum=300)
    info = client_info if isinstance(client_info, dict) else {}
    cleaned = {
        "sessionId": _clean_live_agent_loop_client_detail(info.get("sessionId"), limit=96),
        "client": _clean_live_agent_loop_client_detail(info.get("client"), limit=80) or "main3d-live-sync",
        "version": _clean_live_agent_loop_client_detail(client_version, limit=96),
        "source": _clean_live_agent_loop_client_detail(source, limit=120) or "/api/world-actions/active",
        "page": _clean_live_agent_loop_client_detail(info.get("page"), limit=160),
        "visibility": _clean_live_agent_loop_client_detail(info.get("visibility"), limit=32),
        "userAgent": _clean_live_agent_loop_client_detail(info.get("userAgent"), limit=160),
        "lastSeenAt": _epoch_to_utc_iso(now_epoch),
    }
    cleaned = {key: value for key, value in cleaned.items() if value is not None}
    incoming_session = cleaned.get("sessionId") or cleaned.get("client")
    with _live_agent_loop_lock:
        current_info = dict(_live_agent_loop_last_client_info or {})
        current_session = current_info.get("sessionId") or current_info.get("client")
        last_seen = float(_live_agent_loop_last_client_at or 0)
        current_active = bool(last_seen and (now_epoch - last_seen) <= ttl)
        if current_active and current_session and incoming_session and current_session != incoming_session:
            return False
        _live_agent_loop_last_client_at = now_epoch
        _live_agent_loop_last_client_info = cleaned
    return True


def clear_live_agent_loop_world_client_activity():
    global _live_agent_loop_last_client_at, _live_agent_loop_last_client_info
    with _live_agent_loop_lock:
        had_client = bool(_live_agent_loop_last_client_at)
        _live_agent_loop_last_client_at = 0
        _live_agent_loop_last_client_info = {}
    return had_client


def _live_agent_loop_world_client_status(state=None):
    state = state if isinstance(state, dict) else get_live_agent_loop_state()
    ttl = _normalize_int(state.get("clientActiveTtlSec"), LIVE_AGENT_LOOP_DEFAULTS["clientActiveTtlSec"], minimum=10, maximum=300)
    now = time.time()
    last_seen = float(_live_agent_loop_last_client_at or 0)
    age = (now - last_seen) if last_seen else None
    active = bool(last_seen and age is not None and age <= ttl)
    client_info = dict(_live_agent_loop_last_client_info or {})
    if last_seen:
        client_info.setdefault("lastSeenAt", _epoch_to_utc_iso(last_seen))
        client_info["ageSec"] = round(age, 3) if age is not None else None
        client_info["active"] = active
    diagnostic = None
    if active:
        session_label = client_info.get("sessionId") or client_info.get("client") or "unknown client"
        diagnostic = f"Client session {session_label} is within the active TTL and can enable new visible Live Mode actions."
    elif client_info:
        session_label = client_info.get("sessionId") or client_info.get("client") or "unknown client"
        diagnostic = f"Last client session {session_label} is stale; the loop will wait for a fresh 3D sync marker."
    return {
        "active": active,
        "lastSeenAt": _epoch_to_utc_iso(last_seen) if last_seen else None,
        "ageSec": round(age, 3) if age is not None else None,
        "ttlSec": ttl,
        "source": "/api/world-actions/active",
        "requiredClientVersion": LIVE_AGENT_LOOP_CLIENT_MARKER_VERSION,
        "client": client_info or None,
        "diagnostic": diagnostic,
    }


def _live_agent_loop_pause_status(state, now_epoch=None):
    now_epoch = float(now_epoch or time.time())
    paused_until_epoch = _parse_isoish_epoch(state.get("pausedUntil"))
    active = bool(paused_until_epoch and paused_until_epoch > now_epoch)
    return {
        "active": active,
        "pausedUntil": state.get("pausedUntil") if paused_until_epoch else None,
        "remainingSec": max(0, int(round(paused_until_epoch - now_epoch))) if active else 0,
        "reason": state.get("pauseReason") if active else None,
        "pausedAt": state.get("pausedAt") if active else None,
        "pausedBy": state.get("pausedBy") if active else None,
    }


##############################################################################
# LIVE AGENT MODE - USER ATTENTION (chat preemption)
##############################################################################

def _live_agent_user_attention_hold_sec():
    try:
        state = get_live_agent_loop_state()
        return _normalize_int(state.get("userChatPreemptionHoldSec"), LIVE_AGENT_LOOP_DEFAULTS["userChatPreemptionHoldSec"], minimum=30, maximum=1800)
    except Exception:
        return LIVE_AGENT_LOOP_DEFAULTS["userChatPreemptionHoldSec"]


def live_agent_note_user_attention(agent_id, *, source="chat", message_preview="", hold_sec=None):
    """Mark an agent as attending to the user. Live Mode halts current live task and
    will not create new live actions for this agent until the hold expires or is cleared."""
    resolved = _resolve_agent_id(agent_id) or str(agent_id or "").strip()
    if not resolved:
        return None
    hold = _normalize_int(hold_sec, _live_agent_user_attention_hold_sec(), minimum=30, maximum=1800)
    now_epoch = time.time()
    record = {
        "agentId": resolved,
        "startedAt": _epoch_to_utc_iso(now_epoch),
        "holdUntilEpoch": now_epoch + hold,
        "holdUntil": _epoch_to_utc_iso(now_epoch + hold),
        "holdSec": hold,
        "source": str(source or "chat")[:80],
        "messagePreview": str(message_preview or "")[:160],
    }
    with _live_agent_user_attention_lock:
        _live_agent_user_attention[resolved] = record
    interrupted = []
    try:
        interrupted = _live_agent_halt_live_actions_for_user(resolved)
    except Exception as exc:
        print(f"⚠️  Live Mode user preemption halt failed for {resolved}: {exc}")
    record["interrupted"] = interrupted

    def _log_attention_event():
        try:
            with _live_agent_loop_lock:
                state = get_live_agent_loop_state(persist_migration=True)
                if state.get("userChatPreemptionEnabled", True):
                    _live_agent_loop_add_event(state, "user-attention", agent_id=resolved, details={"source": record["source"], "holdSec": hold, "interrupted": interrupted})
                    agent_state = _live_agent_loop_agent_state(state, resolved)
                    agent_state["userAttention"] = {k: v for k, v in record.items() if k != "holdUntilEpoch"}
                    save_live_agent_loop_state(state)
        except Exception as exc:
            print(f"⚠️  Live Mode user attention event log failed for {resolved}: {exc}")

    # The attention hold + action halt above are already effective. Audit logging
    # runs in the background so chat sends never wait on a long-held loop lock
    # (for example while a model decision is in flight).
    threading.Thread(target=_log_attention_event, daemon=True, name=f"vw-user-attention-{resolved}").start()
    return record


def live_agent_clear_user_attention(agent_id):
    resolved = _resolve_agent_id(agent_id) or str(agent_id or "").strip()
    if not resolved:
        return False
    with _live_agent_user_attention_lock:
        return _live_agent_user_attention.pop(resolved, None) is not None


def live_agent_user_attention_status(agent_id, now_epoch=None):
    resolved = _resolve_agent_id(agent_id) or str(agent_id or "").strip()
    now_epoch = float(now_epoch or time.time())
    with _live_agent_user_attention_lock:
        record = _live_agent_user_attention.get(resolved)
        if not record:
            return {"active": False, "agentId": resolved}
        if float(record.get("holdUntilEpoch") or 0) <= now_epoch:
            _live_agent_user_attention.pop(resolved, None)
            return {"active": False, "agentId": resolved, "expired": True}
        remaining = max(0, int(round(float(record.get("holdUntilEpoch") or 0) - now_epoch)))
        return {
            "active": True,
            "agentId": resolved,
            "startedAt": record.get("startedAt"),
            "holdUntil": record.get("holdUntil"),
            "remainingSec": remaining,
            "source": record.get("source"),
        }


def _live_agent_halt_live_actions_for_user(agent_id):
    """Cancel active live-mode world actions and live-loop move intents for this agent
    so it can attend to the user. User-directed and scripted work of other sources is untouched."""
    interrupted = []
    for active in _active_behavior_records_for_agent(agent_id):
        if active.get("behaviorSourceKind") != "agent-live-mode":
            continue
        if active.get("type") == "world-action":
            ok, result, status = cancel_world_action(active.get("id"), {
                "failureReason": "cancelled_by_system",
                "reason": "cancelled_by_system",
                "actor": "user-chat-preemption",
                "source": "agent-live-mode",
            })
            interrupted.append({"type": "world-action", "id": active.get("id"), "cancelled": bool(ok), "status": status})
        elif active.get("type") == "move-intent":
            released = _interrupt_scripted_move_intent(active.get("id"), reason="interrupted_by_user_chat")
            if released:
                interrupted.append(released)
    return interrupted


def _live_agent_loop_stat(container, key, amount=1):
    stats = container.setdefault("stats", {})
    try:
        stats[key] = int(stats.get(key) or 0) + amount
    except (TypeError, ValueError):
        stats[key] = amount
    return stats[key]


def _live_agent_loop_add_event(state, event_type, *, agent_id=None, details=None):
    retention = LIVE_AGENT_LOOP_DEFAULTS["eventRetention"]
    event = {"at": _utc_now_iso(), "type": event_type}
    if agent_id:
        event["agentId"] = agent_id
    if isinstance(details, dict):
        event["details"] = details
    events = [event for event in (state.get("events") or []) if isinstance(event, dict)]
    events.append(event)
    state["events"] = events[-retention:]
    return event


def _live_agent_loop_clamp_need(value):
    try:
        number = float(value)
    except (TypeError, ValueError):
        number = 0
    return round(max(0, min(1.25, number)), 3)


def _live_agent_loop_normalize_memory(agent_state):
    if not isinstance(agent_state.get("needs"), dict):
        agent_state["needs"] = dict(LIVE_AGENT_LOOP_NEED_DEFAULTS)
    else:
        needs = dict(LIVE_AGENT_LOOP_NEED_DEFAULTS)
        needs.update({key: _live_agent_loop_clamp_need(value) for key, value in agent_state.get("needs", {}).items() if key in LIVE_AGENT_LOOP_NEED_DEFAULTS})
        agent_state["needs"] = needs
    memory = agent_state.get("memory") if isinstance(agent_state.get("memory"), dict) else {}
    memory.setdefault("recentActions", [])
    memory.setdefault("observations", [])
    memory.setdefault("reflections", [])
    memory["recentActions"] = _live_agent_loop_trim_list(
        _live_agent_loop_dedupe_settled_records(
            memory.get("recentActions"),
            lambda item: _live_agent_loop_settled_action_key(item.get("actionId"), item.get("status")),
        ),
        LIVE_AGENT_LOOP_DEFAULTS["memoryRetention"],
    )
    memory["observations"] = _live_agent_loop_trim_list(
        _live_agent_loop_dedupe_settled_records(
            memory.get("observations"),
            lambda item: _live_agent_loop_settled_action_key(item.get("actionId"), item.get("status")),
        ),
        LIVE_AGENT_LOOP_DEFAULTS["memoryRetention"],
    )
    memory["reflections"] = _live_agent_loop_trim_list(
        _live_agent_loop_dedupe_settled_records(memory.get("reflections"), lambda item: item.get("actionId")),
        LIVE_AGENT_LOOP_DEFAULTS["reflectionRetention"],
    )
    agent_state["memory"] = memory
    goal_progress = agent_state.get("goalProgress") if isinstance(agent_state.get("goalProgress"), dict) else {}
    cleaned_progress = {}
    for key, row in list(goal_progress.items())[-8:]:
        if not isinstance(row, dict):
            continue
        cleaned_progress[str(key)[:80]] = {
            "completedTargets": [str(item)[:160] for item in (row.get("completedTargets") or []) if item][-24:],
            "failedTargets": [str(item)[:160] for item in (row.get("failedTargets") or []) if item][-24:],
            "updatedAt": row.get("updatedAt"),
        }
    agent_state["goalProgress"] = cleaned_progress
    autonomy_plan = _live_agent_loop_normalize_autonomy_plan(agent_state.get("autonomyPlan"))
    if autonomy_plan:
        agent_state["autonomyPlan"] = autonomy_plan
    else:
        agent_state.pop("autonomyPlan", None)
    if not isinstance(agent_state.get("feedbackReports"), list):
        agent_state["feedbackReports"] = []
    else:
        agent_state["feedbackReports"] = _live_agent_loop_trim_list(
            _live_agent_loop_dedupe_settled_records(agent_state.get("feedbackReports"), _live_agent_loop_feedback_dedupe_key),
            LIVE_AGENT_LOOP_DEFAULTS["feedbackRetention"],
        )
    retained_keys = sorted(_live_agent_loop_existing_settled_keys(agent_state))
    agent_state["settledActionKeys"] = retained_keys[-LIVE_AGENT_LOOP_DEFAULTS["settledActionRetention"]:]
    normalized_plans = []
    for plan in agent_state.get("plans") or []:
        normalized = _live_agent_loop_normalize_plan(plan)
        if normalized:
            normalized_plans.append(normalized)
    active_plan = _live_agent_loop_normalize_plan(agent_state.get("activePlan"))
    if active_plan:
        normalized_plans = [plan for plan in normalized_plans if plan.get("id") != active_plan.get("id")]
        normalized_plans.append(active_plan)
    agent_state["plans"] = normalized_plans[-LIVE_AGENT_LOOP_DEFAULTS["planRetention"]:]
    if active_plan:
        agent_state["activePlan"] = active_plan
    elif "activePlan" in agent_state:
        agent_state.pop("activePlan", None)
    return agent_state


def _live_agent_loop_agent_state(state, agent_id):
    agents = state.setdefault("agents", {})
    row = dict(agents.get(agent_id) or {})
    row.setdefault("enabled", True)
    row.setdefault("stats", {
        "ticks": 0,
        "actionsCreated": 0,
        "skippedActive": 0,
        "skippedCooldown": 0,
        "skippedNoClient": 0,
        "targetMisses": 0,
        "errors": 0,
    })
    _live_agent_loop_normalize_memory(row)
    agents[agent_id] = row
    return row


def _live_agent_loop_update_needs(agent_state, now_epoch=None):
    _live_agent_loop_normalize_memory(agent_state)
    now_epoch = float(now_epoch or time.time())
    last_epoch = _parse_isoish_epoch(agent_state.get("lastNeedUpdateAt")) or now_epoch
    elapsed_min = max(0, min(60, (now_epoch - last_epoch) / 60.0))
    needs = dict(agent_state.get("needs") or LIVE_AGENT_LOOP_NEED_DEFAULTS)
    for key, rate in LIVE_AGENT_LOOP_NEED_RATES_PER_MIN.items():
        needs[key] = _live_agent_loop_clamp_need(needs.get(key, LIVE_AGENT_LOOP_NEED_DEFAULTS.get(key, 0)) + (rate * elapsed_min))
    agent_state["needs"] = needs
    agent_state["lastNeedUpdateAt"] = _epoch_to_utc_iso(now_epoch)
    return needs


def _live_agent_loop_decay_need_after_action(agent_state, need_key, completed=True):
    needs = dict((agent_state or {}).get("needs") or LIVE_AGENT_LOOP_NEED_DEFAULTS)
    if need_key in needs:
        needs[need_key] = _live_agent_loop_clamp_need(0.12 if completed else min(1.25, needs.get(need_key, 0.5) + 0.12))
    if completed and need_key != "curiosity":
        needs["curiosity"] = _live_agent_loop_clamp_need(needs.get("curiosity", LIVE_AGENT_LOOP_NEED_DEFAULTS["curiosity"]) + 0.04)
    agent_state["needs"] = needs
    return needs


def _live_agent_loop_trim_list(values, limit):
    values = [item for item in (values or []) if isinstance(item, dict)]
    return values[-max(1, int(limit)):]


def _live_agent_loop_clean_plan_text(value, limit=220):
    if value is None:
        return None
    text = str(value).strip()
    if not text:
        return None
    return text[:limit]


def _live_agent_loop_normalize_text_list(values, *, limit=8, item_limit=240):
    if isinstance(values, str):
        values = [values]
    if not isinstance(values, list):
        return []
    result = []
    for item in values[:limit]:
        if isinstance(item, dict):
            text = item.get("label") or item.get("text") or item.get("step") or item.get("intent") or item.get("description")
        else:
            text = item
        clean = _live_agent_loop_clean_plan_text(text, limit=item_limit)
        if clean:
            result.append(clean)
    return result


def _live_agent_loop_normalize_next_step(value):
    if isinstance(value, str):
        value = {"intent": value}
    if not isinstance(value, dict):
        return {}
    action_value = value.get("action") or value.get("interactionId") or value.get("loopActionId") or value.get("actionId")
    if isinstance(action_value, dict):
        action_value = action_value.get("id") or action_value.get("loopActionId") or action_value.get("name")
    target_value = value.get("targetCriteria") or value.get("target") or value.get("object") or value.get("where")
    if isinstance(target_value, dict):
        target_value = json.dumps(_copy_jsonable(target_value), sort_keys=True, default=str)
    normalized = {}
    for key, raw, limit in (
        ("intent", value.get("intent") or value.get("activity") or value.get("goal") or value.get("description"), 420),
        ("action", action_value, 120),
        ("category", value.get("category") or value.get("objectCategory") or value.get("targetCategory"), 80),
        ("targetCriteria", target_value, 420),
        ("successCriteria", value.get("successCriteria") or value.get("success") or value.get("doneWhen"), 420),
        ("failureCriteria", value.get("failureCriteria") or value.get("failure") or value.get("watchFor"), 420),
    ):
        clean = _live_agent_loop_clean_plan_text(raw, limit=limit)
        if clean:
            normalized[key] = clean
    return normalized


def _live_agent_loop_normalize_autonomy_plan(plan):
    if not isinstance(plan, dict):
        return None
    now_iso = _utc_now_iso()
    next_step = _live_agent_loop_normalize_next_step(plan.get("nextStep"))
    normalized = {
        "schemaVersion": LIVE_AGENT_AUTONOMY_PLAN_SCHEMA_VERSION,
        "updatedAt": plan.get("updatedAt") if _parse_isoish_epoch(plan.get("updatedAt")) else now_iso,
    }
    if _parse_isoish_epoch(plan.get("createdAt")):
        normalized["createdAt"] = plan.get("createdAt")
    else:
        normalized["createdAt"] = normalized["updatedAt"]
    for key, limit in (
        ("reflection", 700),
        ("currentGoal", 500),
        ("status", 80),
        ("lesson", 500),
        ("lastOutcome", 500),
    ):
        clean = _live_agent_loop_clean_plan_text(plan.get(key), limit=limit)
        if clean:
            normalized[key] = clean
    steps = _live_agent_loop_normalize_text_list(plan.get("steps") or plan.get("plan"), limit=10, item_limit=260)
    if steps:
        normalized["steps"] = steps
    if next_step:
        normalized["nextStep"] = next_step
    tool_requests = _live_agent_loop_normalize_text_list(plan.get("toolRequests") or plan.get("tools") or plan.get("requestedTools"), limit=5, item_limit=220)
    if tool_requests:
        normalized["toolRequests"] = tool_requests
    event_requests = _live_agent_loop_normalize_text_list(plan.get("eventRequests") or plan.get("events") or plan.get("requestedEvents"), limit=5, item_limit=220)
    if event_requests:
        normalized["eventRequests"] = event_requests
    return normalized if any(key in normalized for key in ("reflection", "currentGoal", "steps", "nextStep", "lesson", "toolRequests", "eventRequests")) else None


def _live_agent_loop_autonomy_plan_from_planner_turn(planner_turn, now_iso=None):
    if not isinstance(planner_turn, dict):
        return None
    memory_update = planner_turn.get("memoryUpdate") if isinstance(planner_turn.get("memoryUpdate"), dict) else {}
    plan = {
        "createdAt": now_iso or _utc_now_iso(),
        "updatedAt": now_iso or _utc_now_iso(),
        "status": "active",
        "reflection": planner_turn.get("reflection"),
        "currentGoal": planner_turn.get("currentGoal") or planner_turn.get("goal"),
        "plan": planner_turn.get("plan") or planner_turn.get("steps"),
        "nextStep": planner_turn.get("nextStep") or planner_turn.get("next"),
        "lesson": memory_update.get("lesson") or memory_update.get("text") or planner_turn.get("lesson"),
        "toolRequests": planner_turn.get("toolRequests") or planner_turn.get("tools") or planner_turn.get("requestedTools"),
        "eventRequests": planner_turn.get("eventRequests") or planner_turn.get("events") or planner_turn.get("requestedEvents"),
    }
    return _live_agent_loop_normalize_autonomy_plan(plan)


def _live_agent_loop_operator_proposal_status(value, default="pending"):
    status = str(value or default).strip().lower().replace("-", "_")
    allowed = {"pending", "acknowledged", "vetoed", "dismissed", "superseded"}
    return status if status in allowed else default


def _live_agent_loop_normalize_operator_proposal(proposal):
    if not isinstance(proposal, dict):
        return None
    proposal_id = _live_agent_loop_clean_plan_text(proposal.get("id"), limit=160)
    if not proposal_id:
        return None
    now_iso = _utc_now_iso()
    normalized = {
        "schemaVersion": LIVE_AGENT_OPERATOR_PROPOSAL_SCHEMA_VERSION,
        "id": proposal_id,
        "status": _live_agent_loop_operator_proposal_status(proposal.get("status")),
        "title": _live_agent_loop_clean_plan_text(proposal.get("title"), limit=180) or "Live Mode proposal",
        "summary": _live_agent_loop_clean_plan_text(proposal.get("summary"), limit=500) or "",
        "requestedAt": proposal.get("requestedAt") if _parse_isoish_epoch(proposal.get("requestedAt")) else now_iso,
        "updatedAt": proposal.get("updatedAt") if _parse_isoish_epoch(proposal.get("updatedAt")) else now_iso,
        "policy": "operator-review-required-before-visible-executor",
        "hiddenWorldMutationAllowed": False,
        "executesOnApproval": False,
    }
    for key, limit in (
        ("agentId", 120),
        ("actionType", 120),
        ("capabilityTag", 120),
        ("sourceKind", 80),
        ("blockedReason", 180),
        ("requiredExecutor", 180),
        ("requirement", 500),
        ("operatorNote", 500),
        ("resolvedBy", 120),
    ):
        cleaned = _live_agent_loop_clean_plan_text(proposal.get(key), limit=limit)
        if cleaned:
            normalized[key] = cleaned
    for key in ("resolvedAt",):
        if _parse_isoish_epoch(proposal.get(key)):
            normalized[key] = proposal.get(key)
    for key in ("capability", "target", "payloadPreview", "rejection"):
        value = proposal.get(key)
        if isinstance(value, dict):
            normalized[key] = _copy_jsonable(value)
    return normalized


def _live_agent_loop_limited_operator_proposals(state, *, agent_id=None, include_resolved=False, limit=None):
    retention = LIVE_AGENT_LOOP_DEFAULTS["operatorProposalRetention"]
    limit_value = _normalize_int(limit, retention, minimum=1, maximum=retention) if limit not in (None, "") else retention
    proposals = []
    for item in state.get("operatorProposals") or []:
        proposal = _live_agent_loop_normalize_operator_proposal(item)
        if not proposal:
            continue
        if agent_id and proposal.get("agentId") != agent_id:
            continue
        if not include_resolved and proposal.get("status") != "pending":
            continue
        proposals.append(proposal)
    return proposals[-limit_value:]


def _live_agent_loop_normalize_operator_proposals(state):
    proposals = []
    for item in state.get("operatorProposals") or []:
        proposal = _live_agent_loop_normalize_operator_proposal(item)
        if proposal:
            proposals.append(proposal)
    state["operatorProposals"] = proposals[-LIVE_AGENT_LOOP_DEFAULTS["operatorProposalRetention"]:]
    return state["operatorProposals"]


def _live_agent_loop_record_operator_proposal_from_rejection(state, agent_id, payload, rejection):
    if not isinstance(state, dict) or not isinstance(payload, dict):
        return None
    action_type = str(payload.get("actionType") or payload.get("actionId") or "").strip()
    capability_tag = str(payload.get("capabilityTag") or "").strip()
    capability = _live_agent_proposal_only_capability_for(action_type, capability_tag)
    if not capability:
        return None
    now_iso = _utc_now_iso()
    source = payload.get("source") if isinstance(payload.get("source"), dict) else {}
    target = payload.get("target") if isinstance(payload.get("target"), dict) else {}
    seed = json.dumps(
        {
            "agentId": agent_id,
            "actionType": action_type,
            "capabilityTag": capability_tag,
            "target": target,
            "capabilityId": capability.get("id"),
        },
        sort_keys=True,
        default=str,
    )
    proposal_id = "live-proposal-" + hashlib.sha1(seed.encode("utf-8")).hexdigest()[:16]
    existing = _live_agent_loop_limited_operator_proposals(state, include_resolved=True, limit=LIVE_AGENT_LOOP_DEFAULTS["operatorProposalRetention"])
    existing = [item for item in existing if item.get("id") != proposal_id]
    proposal = _live_agent_loop_normalize_operator_proposal({
        "id": proposal_id,
        "status": "pending",
        "agentId": agent_id,
        "actionType": action_type,
        "capabilityTag": capability_tag or capability.get("capabilityTag"),
        "sourceKind": source.get("kind"),
        "title": f"Review {capability.get('label') or action_type}",
        "summary": f"{agent_id} requested {action_type or capability.get('id')}, but Live Mode kept it proposal-only because no typed visible executor is available.",
        "requestedAt": now_iso,
        "updatedAt": now_iso,
        "blockedReason": capability.get("blockedReason"),
        "requiredExecutor": capability.get("requiredExecutor"),
        "requirement": capability.get("requirement"),
        "capability": capability,
        "target": _copy_jsonable(target),
        "payloadPreview": {
            "actionType": action_type,
            "capabilityTag": capability_tag,
            "target": _copy_jsonable(target),
            "params": _copy_jsonable(payload.get("params")) if isinstance(payload.get("params"), dict) else None,
        },
        "rejection": _copy_jsonable(rejection.get("error")) if isinstance(rejection.get("error"), dict) else _copy_jsonable(rejection),
    })
    state["operatorProposals"] = [*existing, proposal][-LIVE_AGENT_LOOP_DEFAULTS["operatorProposalRetention"]:]
    _live_agent_loop_add_event(state, "operator-proposal-created", agent_id=agent_id, details={"proposalId": proposal_id, "actionType": action_type, "capabilityId": capability.get("id")})
    return proposal


def _live_agent_loop_plan_status(value, default="planned"):
    status = str(value or default).strip().lower().replace("-", "_")
    allowed = {"planned", "in_progress", "retrying", "completed", "failed", "cancelled"}
    return status if status in allowed else default


def _live_agent_loop_step_status(value, default="pending"):
    status = str(value or default).strip().lower().replace("-", "_")
    allowed = {"pending", "in_progress", "completed", "failed", "skipped"}
    return status if status in allowed else default


def _live_agent_loop_normalize_plan(plan):
    if not isinstance(plan, dict):
        return None
    plan_id = _live_agent_loop_clean_plan_text(plan.get("id"), limit=120)
    if not plan_id:
        return None
    now_iso = _utc_now_iso()
    raw_steps = [step for step in (plan.get("steps") or []) if isinstance(step, dict)]
    steps = []
    for index, step in enumerate(raw_steps[:8]):
        step_id = _live_agent_loop_clean_plan_text(step.get("id"), limit=120) or f"step-{index + 1}"
        normalized_step = {
            "id": step_id,
            "label": _live_agent_loop_clean_plan_text(step.get("label"), limit=160) or step_id,
            "status": _live_agent_loop_step_status(step.get("status")),
            "attempts": _normalize_int(step.get("attempts"), 0, minimum=0, maximum=20),
        }
        for key, limit in (("loopActionId", 120), ("actionType", 120), ("actionId", 160), ("failureReason", 220)):
            cleaned = _live_agent_loop_clean_plan_text(step.get(key), limit=limit)
            if cleaned:
                normalized_step[key] = cleaned
        for key in ("startedAt", "settledAt", "updatedAt"):
            if _parse_isoish_epoch(step.get(key)):
                normalized_step[key] = step.get(key)
        steps.append(normalized_step)
    current_index = _normalize_int(plan.get("currentStepIndex"), 0, minimum=0, maximum=max(0, len(steps) - 1))
    normalized = {
        "schemaVersion": LIVE_AGENT_LOOP_PLAN_SCHEMA_VERSION,
        "id": plan_id,
        "status": _live_agent_loop_plan_status(plan.get("status")),
        "title": _live_agent_loop_clean_plan_text(plan.get("title"), limit=180) or "Live Mode plan",
        "createdAt": plan.get("createdAt") if _parse_isoish_epoch(plan.get("createdAt")) else now_iso,
        "updatedAt": plan.get("updatedAt") if _parse_isoish_epoch(plan.get("updatedAt")) else now_iso,
        "currentStepIndex": current_index,
        "steps": steps,
        "retries": _normalize_int(plan.get("retries"), 0, minimum=0, maximum=20),
        "maxRetries": _normalize_int(plan.get("maxRetries"), LIVE_AGENT_LOOP_DEFAULTS["planMaxRetries"], minimum=0, maximum=5),
    }
    for key, limit in (("agentId", 120), ("loopActionId", 120), ("actionType", 120), ("need", 80), ("lastActionId", 160), ("failureReason", 240), ("operatorSummary", 500)):
        cleaned = _live_agent_loop_clean_plan_text(plan.get(key), limit=limit)
        if cleaned:
            normalized[key] = cleaned
    for key in ("startedAt", "completedAt", "failedAt", "cancelledAt"):
        if _parse_isoish_epoch(plan.get(key)):
            normalized[key] = plan.get(key)
    return normalized


def _live_agent_loop_plan_current_step(plan):
    if not isinstance(plan, dict):
        return None
    steps = plan.get("steps") if isinstance(plan.get("steps"), list) else []
    if not steps:
        return None
    index = _normalize_int(plan.get("currentStepIndex"), 0, minimum=0, maximum=max(0, len(steps) - 1))
    return steps[index] if index < len(steps) else None


def _live_agent_loop_plan_is_active(plan):
    return isinstance(plan, dict) and _live_agent_loop_plan_status(plan.get("status")) in {"planned", "in_progress", "retrying"}


def _live_agent_loop_current_plan_action_id(agent_state):
    plan = _live_agent_loop_normalize_plan(agent_state.get("activePlan")) if isinstance(agent_state, dict) else None
    if not _live_agent_loop_plan_is_active(plan):
        return None
    step = _live_agent_loop_plan_current_step(plan)
    if not isinstance(step, dict):
        return None
    return step.get("loopActionId") if step.get("status") in {"pending", "in_progress", "failed"} else None


def _live_agent_loop_store_plan(agent_state, plan):
    normalized = _live_agent_loop_normalize_plan(plan)
    if not normalized:
        return None
    plans = []
    for item in agent_state.get("plans") or []:
        existing = _live_agent_loop_normalize_plan(item)
        if existing and existing.get("id") != normalized.get("id"):
            plans.append(existing)
    plans.append(normalized)
    agent_state["plans"] = plans[-LIVE_AGENT_LOOP_DEFAULTS["planRetention"]:]
    if _live_agent_loop_plan_is_active(normalized):
        agent_state["activePlan"] = normalized
    elif isinstance(agent_state.get("activePlan"), dict) and agent_state["activePlan"].get("id") == normalized.get("id"):
        agent_state["activePlan"] = normalized
    return normalized


def _live_agent_loop_settled_action_key(action_id, status):
    if not action_id or not status:
        return None
    return f"{action_id}:{_canonical_world_action_status(status)}"


def _live_agent_loop_dedupe_settled_records(values, key_fn):
    deduped = []
    seen = set()
    for item in (values or []):
        if not isinstance(item, dict):
            continue
        key = key_fn(item)
        if key and key in seen:
            continue
        if key:
            seen.add(key)
        deduped.append(item)
    return deduped


def _live_agent_loop_feedback_dedupe_key(item):
    details = item.get("details") if isinstance(item.get("details"), dict) else {}
    action_key = _live_agent_loop_settled_action_key(details.get("actionId"), details.get("status"))
    if not action_key:
        return None
    return f"{action_key}:{item.get('level')}:{item.get('message')}"


def _live_agent_loop_existing_settled_keys(agent_state):
    keys = set(str(key) for key in (agent_state.get("settledActionKeys") or []) if isinstance(key, str))
    memory = agent_state.get("memory") if isinstance(agent_state.get("memory"), dict) else {}
    for item in memory.get("recentActions") or []:
        if not isinstance(item, dict):
            continue
        key = _live_agent_loop_settled_action_key(item.get("actionId"), item.get("status"))
        if key:
            keys.add(key)
    for item in agent_state.get("feedbackReports") or []:
        if not isinstance(item, dict):
            continue
        details = item.get("details") if isinstance(item.get("details"), dict) else {}
        key = _live_agent_loop_settled_action_key(details.get("actionId"), details.get("status"))
        if key:
            keys.add(key)
    return keys


def _live_agent_loop_mark_settled_action(agent_state, action_id, status):
    key = _live_agent_loop_settled_action_key(action_id, status)
    if not key:
        return None
    retention = max(1, int(LIVE_AGENT_LOOP_DEFAULTS.get("settledActionRetention") or 120))
    existing = [str(item) for item in (agent_state.get("settledActionKeys") or []) if isinstance(item, str) and item != key]
    agent_state["settledActionKeys"] = [*existing, key][-retention:]
    return key


def _live_agent_loop_add_feedback(state, agent_id, level, message, details=None):
    agent_state = _live_agent_loop_agent_state(state, agent_id)
    report = {
        "at": _utc_now_iso(),
        "level": level or "info",
        "message": str(message or "").strip()[:500],
    }
    if isinstance(details, dict):
        report["details"] = details
    reports = _live_agent_loop_trim_list([*(agent_state.get("feedbackReports") or []), report], LIVE_AGENT_LOOP_DEFAULTS["feedbackRetention"])
    agent_state["feedbackReports"] = reports
    _live_agent_loop_add_event(state, "feedback-report", agent_id=agent_id, details={"level": report["level"], "message": report["message"], **({"actionId": details.get("actionId")} if isinstance(details, dict) and details.get("actionId") else {})})
    return report


def _live_agent_loop_enabled_roster():
    roster = _merge_agent_profiles(get_roster())
    enabled = []
    for agent in roster:
        agent_id = agent.get("statusKey") or agent.get("id")
        if not agent_id:
            continue
        if agent.get("agentLiveModeEnabled") is True:
            enabled.append({**agent, "agentId": agent_id})
    return enabled


def _live_agent_loop_presence(agent_id, state, task):
    if not (_presence_enabled and _gateway_presence):
        return False
    try:
        current = _gateway_presence.get_agent_state(agent_id) if hasattr(_gateway_presence, "get_agent_state") else {}
        current_state = str((current or {}).get("state") or "").lower()
        current_task = str((current or {}).get("task") or "")
        if state == "idle" and current_state in {"working", "finishing"} and "Living in My Virtual World" not in current_task:
            return False
        _gateway_presence.set_manual_override(agent_id, state, task)
        return True
    except Exception as e:
        print(f"⚠️  Live Mode loop presence update failed for {agent_id}: {e}")
        return False


def _live_agent_loop_agent_aliases(agent_id):
    aliases = {str(agent_id or "").strip()}
    aliases.discard("")
    wanted = set(aliases)
    for agent in get_roster():
        if not isinstance(agent, dict):
            continue
        agent_aliases = {str(agent.get("id") or "").strip(), str(agent.get("statusKey") or "").strip()}
        agent_aliases.discard("")
        if wanted.intersection(agent_aliases):
            aliases.update(agent_aliases)
    return aliases


def _live_agent_loop_existing_home_for_agent(agent_id):
    aliases = _live_agent_loop_agent_aliases(agent_id)
    if not aliases:
        return None
    for building in list_buildings():
        if not isinstance(building, dict) or _building_unavailable(building):
            continue
        home_for = str(building.get("liveModeHomeForAgentId") or building.get("ownerAgentId") or "").strip()
        if home_for and home_for in aliases:
            return building
    return None


def _live_agent_loop_building_footprint(building):
    if not isinstance(building, dict) or _building_unavailable(building):
        return None
    footprint = _building_footprint_tile_rect(building)
    if not footprint:
        return None
    return {
        "minX": footprint["minX"],
        "minY": footprint["minZ"],
        "maxX": footprint["maxX"],
        "maxY": footprint["maxZ"],
    }


def _live_agent_loop_footprints_overlap(candidate, existing, padding=0):
    if not candidate or not existing:
        return False
    pad = max(0, float(padding or 0))
    return (
        candidate["minX"] < existing["maxX"] + pad
        and candidate["maxX"] > existing["minX"] - pad
        and candidate["minY"] < existing["maxY"] + pad
        and candidate["maxY"] > existing["minY"] - pad
    )


def _live_agent_loop_agent_display_name(agent_id):
    aliases = _live_agent_loop_agent_aliases(agent_id)
    for agent in get_roster():
        if not isinstance(agent, dict):
            continue
        if str(agent.get("id") or "").strip() in aliases or str(agent.get("statusKey") or "").strip() in aliases:
            return str(agent.get("name") or agent.get("statusKey") or agent.get("id") or agent_id).strip()
    return str(agent_id or "Agent").strip() or "Agent"


def _live_agent_loop_home_build_site_record(
    *,
    agent_id,
    agent_token,
    display_name,
    world_x,
    world_y,
    width,
    height,
    approach_x,
    approach_y,
    rotation=0,
    street_approach=None,
):
    building_id = f"live-home-{agent_token}"
    build_site = {
        "schemaVersion": "agent-live-mode-build-site/v1",
        "siteKind": "agent-home",
        "buildingId": building_id,
        "buildingName": f"{display_name}'s Home",
        "type": "home",
        "worldX": world_x,
        "worldY": world_y,
        "widthTiles": width,
        "heightTiles": height,
        "ownerAgentId": agent_id,
        "liveModeHomeForAgentId": agent_id,
        "exterior": {"wallColor": "#c8b89a", "roofColor": "#795548"},
    }
    if rotation:
        build_site["_rotation"] = rotation
    if isinstance(street_approach, dict):
        build_site["streetApproach"] = _copy_jsonable(street_approach)
    target = {
        "kind": "world-point",
        "x": int(round(float(approach_x) * LIVE_AGENT_LOOP_API_TILE)),
        "y": int(round(float(approach_y) * LIVE_AGENT_LOOP_API_TILE)),
        "z": int(round(float(approach_y) * LIVE_AGENT_LOOP_API_TILE)),
        "floor": 1,
        "siteKind": "agent-home",
        "buildSite": _copy_jsonable(build_site),
    }
    return {
        "target": target,
        "buildingName": build_site["buildingName"],
        "objectType": "construction-site",
        "availability": {"state": "available", "reason": None, "siteKind": "agent-home"},
        "buildSite": build_site,
    }


def _live_agent_loop_home_build_site_candidates(agent_id, agent_token, display_name, width, height):
    meta = load_world_meta()
    streets = ensure_checkpoint_streets(meta, persist=False)
    seed = sum(ord(ch) for ch in agent_token)
    candidates = []

    def append_candidate(index, street, street_rect, world_x, world_y, approach_x, approach_y, rotation, side, slot):
        build_site = {
            "id": f"candidate-{index}-{side}-{slot}",
            "worldX": world_x,
            "worldY": world_y,
            "widthTiles": width,
            "heightTiles": height,
            "_rotation": rotation,
        }
        placement = validate_building_placement(build_site, streets=streets)
        if not placement.get("ok"):
            return
        street_approach = {
            "schemaVersion": "agent-live-mode-build-site-approach/v1",
            "source": "street-adjacent-build-site",
            "streetIndex": index,
            "side": side,
            "slot": slot,
            "street": _copy_jsonable(street),
            "streetSurface": _copy_jsonable(street_rect),
            "approachTile": {"x": approach_x, "y": approach_y},
            "guidance": "Route to this street-side walkable point before constructing the new home.",
        }
        candidates.append({
            "sortKey": (index, slot, side),
            "record": _live_agent_loop_home_build_site_record(
                agent_id=agent_id,
                agent_token=agent_token,
                display_name=display_name,
                world_x=world_x,
                world_y=world_y,
                width=width,
                height=height,
                approach_x=approach_x,
                approach_y=approach_y,
                rotation=rotation,
                street_approach=street_approach,
            ),
        })

    for index, street in enumerate(streets if isinstance(streets, list) else []):
        if not isinstance(street, dict) or street.get("type"):
            continue
        street_rect = _street_surface_tile_rect(street)
        if not street_rect:
            continue
        x1 = _float_or_none(street.get("x1"))
        z1 = _float_or_none(street.get("z1"))
        x2 = _float_or_none(street.get("x2"))
        z2 = _float_or_none(street.get("z2"))
        if x1 is None or z1 is None or x2 is None or z2 is None:
            continue
        is_horizontal = abs(x2 - x1) >= abs(z2 - z1)
        if is_horizontal:
            min_x = math.ceil(min(x1, x2))
            max_x = math.floor(max(x1, x2) + 1 - width)
            if max_x < min_x:
                continue
            step = max(width + 4, 1)
            slots = list(range(min_x, max_x + 1, step))
            if max_x not in slots:
                slots.append(max_x)
            if not slots:
                continue
            slot_start = seed % len(slots)
            ordered_slots = slots[slot_start:] + slots[:slot_start]
            side_order = ["north-of-street", "south-of-street"] if (seed + index) % 2 == 0 else ["south-of-street", "north-of-street"]
            for slot, world_x in enumerate(ordered_slots):
                center_x = world_x + width / 2
                for side in side_order:
                    if side == "north-of-street":
                        world_y = math.ceil(street_rect["maxZ"])
                        approach_y = math.floor(street_rect["maxZ"])
                        rotation = 180
                    else:
                        world_y = math.floor(street_rect["minZ"] - height)
                        approach_y = math.ceil(street_rect["minZ"])
                        rotation = 0
                    append_candidate(
                        index,
                        street,
                        street_rect,
                        world_x,
                        world_y,
                        center_x,
                        approach_y,
                        rotation,
                        side,
                        slot,
                    )
        else:
            # For 90/270-degree homes the rendered footprint swaps width/depth.
            footprint_width = height
            footprint_depth = width
            min_y = math.ceil(min(z1, z2))
            max_y = math.floor(max(z1, z2) + 1 - footprint_depth)
            if max_y < min_y:
                continue
            step = max(footprint_depth + 4, 1)
            slots = list(range(min_y, max_y + 1, step))
            if max_y not in slots:
                slots.append(max_y)
            if not slots:
                continue
            slot_start = seed % len(slots)
            ordered_slots = slots[slot_start:] + slots[:slot_start]
            side_order = ["east-of-street", "west-of-street"] if (seed + index) % 2 == 0 else ["west-of-street", "east-of-street"]
            for slot, world_y in enumerate(ordered_slots):
                center_y = world_y + footprint_depth / 2
                for side in side_order:
                    if side == "east-of-street":
                        world_x = math.ceil(street_rect["maxX"])
                        approach_x = math.floor(street_rect["maxX"])
                        rotation = 90
                    else:
                        world_x = math.floor(street_rect["minX"] - footprint_width)
                        approach_x = math.ceil(street_rect["minX"])
                        rotation = 270
                    append_candidate(
                        index,
                        street,
                        street_rect,
                        world_x,
                        world_y,
                        approach_x,
                        center_y,
                        rotation,
                        side,
                        slot,
                    )

    candidates.sort(key=lambda item: item["sortKey"])
    if not candidates:
        return []
    start = seed % len(candidates)
    return [item["record"] for item in (candidates[start:] + candidates[:start])]


def _live_agent_loop_find_home_build_site(agent_id):
    if _live_agent_loop_existing_home_for_agent(agent_id):
        return None
    agent_token = re.sub(r"[^a-z0-9_-]+", "-", str(agent_id or "agent").lower()).strip("-") or "agent"
    display_name = _live_agent_loop_agent_display_name(agent_id)
    width = LIVE_AGENT_HOME_BUILD_SITE_WIDTH_TILES
    height = LIVE_AGENT_HOME_BUILD_SITE_HEIGHT_TILES
    existing_footprints = [fp for fp in (_live_agent_loop_building_footprint(b) for b in list_buildings()) if fp]
    for selected in _live_agent_loop_home_build_site_candidates(agent_id, agent_token, display_name, width, height):
        candidate = _live_agent_loop_building_footprint(selected.get("buildSite"))
        if any(_live_agent_loop_footprints_overlap(candidate, existing, padding=2) for existing in existing_footprints):
            continue
        return selected
    return None


def _live_agent_loop_unavailable_reason(action_def, agent_id):
    if action_def.get("id") == "build-small-home-site" and _live_agent_loop_existing_home_for_agent(agent_id):
        return "agent-home-already-built"
    if action_def.get("id") == "rest-at-home" and not _live_agent_loop_existing_home_for_agent(agent_id):
        return "agent-home-not-built"
    if action_def.get("targetKind") == "agent":
        return "no-nearby-visible-agent"
    if action_def.get("targetKind") == "world-point":
        return "no-open-construction-site"
    if action_def.get("targetKind") == "agent-home-building":
        return "agent-home-not-built"
    if action_def.get("targetKind") == "seating-object":
        return "no-available-seating-target"
    if action_def.get("category"):
        return f"no-available-{action_def.get('category')}-target"
    return "no-available-target"


def _live_agent_loop_seating_action_for_catalog(catalog_id):
    catalog_token = _normalize_token(catalog_id)
    if not catalog_token:
        return None
    for candidate in LIVE_AGENT_SEATING_ACTION_CANDIDATES:
        wanted = {_normalize_token(item) for item in candidate.get("catalogIds") or ()}
        if catalog_token in wanted:
            return candidate
        catalog = _catalog_block_for(catalog_id)
        catalog_key = _normalize_token((catalog or {}).get("id"))
        if catalog_key and catalog_key in wanted:
            return candidate
    return None


def _live_agent_loop_goal_progress_row(agent_state, key):
    progress = agent_state.setdefault("goalProgress", {}) if isinstance(agent_state, dict) else {}
    row = progress.get(key)
    if not isinstance(row, dict):
        row = {"completedTargets": [], "failedTargets": [], "updatedAt": None}
        progress[key] = row
    row.setdefault("completedTargets", [])
    row.setdefault("failedTargets", [])
    return row


def _live_agent_loop_is_seating_action(action_def=None, summary=None):
    action_def = action_def if isinstance(action_def, dict) else {}
    summary = summary if isinstance(summary, dict) else {}
    return (
        action_def.get("category") == "seating"
        or action_def.get("id") == "use-seating-object"
        or summary.get("loopActionId") == "use-seating-object"
        or summary.get("actionType") in LIVE_AGENT_SEATING_ACTION_TYPES
    )


def _live_agent_loop_completion_evidence_records(result):
    records = []

    def add(value):
        if isinstance(value, dict):
            records.append(value)

    add(result)
    if isinstance(result, dict):
        for key in ("embodiedState", "runtimeState", "useState", "visualState", "activity", "posture"):
            value = result.get(key)
            if isinstance(value, dict):
                add(value)
                if isinstance(value.get("activity"), dict):
                    add(value.get("activity"))
        embodied = result.get("embodiedState") if isinstance(result.get("embodiedState"), dict) else {}
        if isinstance(embodied.get("finalPlacement"), dict):
            add(embodied.get("finalPlacement"))
    return records


def _live_agent_loop_evidence_text(records, keys):
    values = []
    for record in records:
        for key in keys:
            value = record.get(key)
            if value is None:
                continue
            text = str(value).strip()
            if text and text not in values:
                values.append(text)
    return values


def _live_agent_loop_bool_evidence(records, keys):
    for record in records:
        for key in keys:
            value = record.get(key)
            if isinstance(value, bool) and value:
                return True
            if isinstance(value, str) and value.strip().lower() in {"true", "yes", "1"}:
                return True
    return False


def _live_agent_loop_seating_completion_validation(action, summary, action_def):
    if not _live_agent_loop_is_seating_action(action_def, summary):
        return {"required": False, "ok": True}
    if _canonical_world_action_status((summary or {}).get("status")) != "completed":
        return {"required": True, "ok": True, "reason": "not-completed"}
    result = summary.get("result") if isinstance(summary, dict) and isinstance(summary.get("result"), dict) else {}
    records = _live_agent_loop_completion_evidence_records(result)
    pose_values = _live_agent_loop_evidence_text(records, ("poseKind", "pose", "posture", "poseId"))
    animation_values = _live_agent_loop_evidence_text(records, ("animationId", "resolvedAnimationId"))
    state_values = _live_agent_loop_evidence_text(records, ("useState", "activeUseState", "state", "phase", "status"))
    seated_bool = _live_agent_loop_bool_evidence(records, ("seated", "isSeated", "sitting"))
    pose_text = " ".join(pose_values).lower()
    animation_text = " ".join(animation_values).lower()
    state_text = " ".join(state_values).lower()
    seated_posture = seated_bool or any(token in pose_text for token in ("seat", "seated", "sitting", "sit"))
    use_state_ok = any(token in state_text for token in ("active", "using", "in_progress", "docked", "completed", "seated"))
    animation_ok = bool(animation_values) and not any(
        animation_text == token or animation_text.endswith(f" {token}")
        for token in ("walk", "idle", "stand", "stand-use", "standing")
    )
    final_placement = None
    for record in records:
        if isinstance(record.get("finalPlacement"), dict):
            final_placement = record.get("finalPlacement")
            break
        if isinstance(record.get("dockTarget"), dict):
            final_placement = record.get("dockTarget")
            break
    action_reservation = action.get("reservation") if isinstance(action, dict) and isinstance(action.get("reservation"), dict) else {}
    action_effects = action.get("effects") if isinstance(action, dict) and isinstance(action.get("effects"), list) else []
    clean_exit = (
        not action_reservation
        or action_reservation.get("availabilityState") == "available"
        or action_reservation.get("state") in {"released", "cancelled", "failed", "timed_out"}
        or any(isinstance(effect, dict) and effect.get("type") == "reservation-released" for effect in action_effects)
    )
    ok = bool(seated_posture and (use_state_ok or animation_ok) and final_placement and clean_exit)
    evidence = {
        "schemaVersion": LIVE_AGENT_SEATING_COMPLETION_VALIDATION_VERSION,
        "seatedPosture": seated_posture,
        "useStateOk": use_state_ok,
        "animationOk": animation_ok,
        "finalPlacement": _copy_jsonable(final_placement) if isinstance(final_placement, dict) else None,
        "cleanExit": clean_exit,
        "pose": pose_values[:4],
        "animation": animation_values[:4],
        "state": state_values[:4],
    }
    reason = None if ok else "missing_seated_use_state_evidence"
    return {"required": True, "ok": ok, "reason": reason, "evidence": evidence}


def _live_agent_loop_completion_validation_failure(action, summary, validation):
    if not isinstance(validation, dict) or validation.get("ok"):
        return None
    target = _live_agent_loop_memory_target(action.get("target")) if isinstance(action, dict) else None
    target_key = _live_agent_loop_target_key(target)
    evidence = validation.get("evidence") if isinstance(validation.get("evidence"), dict) else {}
    missing = []
    if not evidence.get("seatedPosture"):
        missing.append("seated posture")
    if not (evidence.get("useStateOk") or evidence.get("animationOk")):
        missing.append("use-state/animation")
    if not evidence.get("finalPlacement"):
        missing.append("final placement")
    if not evidence.get("cleanExit"):
        missing.append("clean exit")
    missing_text = ", ".join(missing) or "required embodied evidence"
    target_phrase = _live_agent_loop_target_phrase(target)
    learning_text = f"completed status did not prove seating; missing {missing_text}."
    if target_phrase:
        learning_text = f"{learning_text} Target {target_phrase}."
    learning_text = f"{learning_text} Treat arrival near the seat as inconclusive and avoid marking this furniture tested until posture/use-state evidence is present."
    return {
        "status": "failed",
        "reason": validation.get("reason") or "missing_seated_use_state_evidence",
        "failureReason": "validation_failed",
        "resultReason": validation.get("reason") or "",
        "target": target,
        "targetKey": target_key,
        "evidence": evidence,
        "learningText": learning_text[:700],
    }


def _live_agent_loop_record_goal_progress(agent_state, action_def, target_key, completed):
    """Track per-category goal progress (e.g. which seating objects were tested)
    so future resolver picks prefer untested targets and the model can see
    accumulated progress instead of repeating the same object forever."""
    category = (action_def or {}).get("category")
    if not category or not target_key or not isinstance(agent_state, dict):
        return None
    row = _live_agent_loop_goal_progress_row(agent_state, f"category:{category}")
    bucket = row["completedTargets"] if completed else row["failedTargets"]
    if target_key not in bucket:
        bucket.append(target_key)
    if completed and target_key in row["failedTargets"]:
        row["failedTargets"] = [item for item in row["failedTargets"] if item != target_key]
    row["updatedAt"] = _utc_now_iso()
    return row


def _live_agent_loop_progress_target_keys(agent_state, category):
    if not isinstance(agent_state, dict) or not category:
        return set()
    progress = agent_state.get("goalProgress") if isinstance(agent_state.get("goalProgress"), dict) else {}
    row = progress.get(f"category:{category}")
    if not isinstance(row, dict):
        return set()
    return {str(item) for item in (row.get("completedTargets") or []) if item}


def _live_agent_loop_find_seating_target(action_def, *, agent_id=None, agent_state=None):
    tested_keys = _live_agent_loop_progress_target_keys(agent_state, (action_def or {}).get("category") or "seating")
    fallback = None
    for building in list_buildings():
        if not isinstance(building, dict) or _building_unavailable(building):
            continue
        collections = (
            ("furniture", ((building.get("interior") or {}).get("furniture") or [])),
            ("outdoor-node", ((building.get("outdoorArea") or {}).get("nodes") or [])),
        )
        for collection, records in collections:
            if not isinstance(records, list):
                continue
            for index, obj in enumerate(records):
                if not isinstance(obj, dict):
                    continue
                catalog_id = _object_catalog_id(obj)
                seating_action = _live_agent_loop_seating_action_for_catalog(catalog_id)
                if not seating_action:
                    continue
                action_type = seating_action.get("actionType")
                spot_id = seating_action.get("spotId")
                capability = "life.rest"
                catalog = _catalog_block_for(catalog_id)
                permission = _catalog_action_permission(catalog, action_type, capability) if catalog else None
                if not permission or permission.get("capabilityTag") != capability:
                    continue
                if not _catalog_has_spot(catalog, spot_id, action_type):
                    continue
                object_id = obj.get("objectInstanceId") or obj.get("id") or obj.get("instanceId") or (sorted(_candidate_object_ids(building, obj, index, collection)) or [None])[0]
                if not object_id:
                    continue
                target = {
                    "kind": "object-instance",
                    "buildingId": building.get("id"),
                    "objectInstanceId": object_id,
                    "catalogId": catalog_id,
                    "interactionSpotId": spot_id,
                    "floor": obj.get("floor") or obj.get("buildingFloor") or 1,
                }
                if collection == "furniture":
                    target["furnitureIndex"] = index
                else:
                    target["nodeIndex"] = index
                    target["targetKind"] = "outdoor-area-node"
                resolved = _find_world_action_target(target)
                availability = get_object_availability(target, agent_id=agent_id, resolved=resolved)
                if availability.get("state") != "available":
                    continue
                selected_action = {
                    **action_def,
                    "actionType": action_type,
                    "capabilityTag": capability,
                    "interactionSpotId": spot_id,
                    "label": seating_action.get("label") or action_def.get("label"),
                    "experience": f"test whether {catalog_id or 'the seat'} is reachable, reservable, and visibly usable",
                }
                selected = {
                    "target": target,
                    "buildingName": building.get("name"),
                    "objectType": catalog_id,
                    "availability": availability,
                    "action": selected_action,
                    "seatingCandidate": {k: seating_action.get(k) for k in ("actionType", "spotId", "label")},
                }
                # Prefer untested targets so category goal work makes real
                # progress across the world instead of reusing one object.
                if _live_agent_loop_target_key(target) in tested_keys:
                    if fallback is None:
                        fallback = selected
                    continue
                return selected
    return fallback


def _live_agent_loop_find_action_target(action_def, *, agent_id=None, agent_state=None):
    if action_def.get("targetKind") == "agent":
        social = _live_agent_loop_social_perception(agent_id)
        nearby = social.get("nearbyAgents") if isinstance(social.get("nearbyAgents"), list) else []
        selected_peer = next((item for item in nearby if isinstance(item, dict) and item.get("agentId")), None)
        if not selected_peer:
            return None
        location = selected_peer.get("location") if isinstance(selected_peer.get("location"), dict) else {}
        target = {
            "kind": "agent",
            "targetAgentId": selected_peer.get("agentId"),
            "targetAgentName": selected_peer.get("name"),
            "buildingId": selected_peer.get("buildingId") or location.get("buildingId"),
            "floor": int(selected_peer.get("floor") or location.get("floor") or 1),
            "nearbyReason": selected_peer.get("nearbyReason"),
            "perceptionSchemaVersion": social.get("schemaVersion"),
        }
        return {
            "target": target,
            "buildingName": target.get("buildingId"),
            "objectType": "agent",
            "availability": {"state": "available", "reason": "nearby-visible-agent", "peer": {k: selected_peer.get(k) for k in ("agentId", "name", "status", "task", "liveModeEnabled", "nearbyReason")}},
            "action": action_def,
            "peer": selected_peer,
        }
    if action_def.get("targetKind") == "agent-home-building":
        home = _live_agent_loop_existing_home_for_agent(agent_id)
        if not home:
            return None
        target = {
            "kind": "building",
            "buildingId": home.get("id"),
            "floor": 1,
            "homeRole": "resident",
            "liveModeHomeForAgentId": agent_id,
        }
        return {
            "target": target,
            "buildingName": home.get("name"),
            "objectType": "agent-home",
            "availability": {"state": "available", "reason": None, "homeRole": "resident"},
            "action": action_def,
            "home": _copy_jsonable(home),
        }
    if action_def.get("targetKind") == "world-point":
        if action_def.get("siteKind") == "agent-home":
            selected = _live_agent_loop_find_home_build_site(agent_id)
            if selected:
                selected["action"] = action_def
            return selected
        return None
    if action_def.get("targetKind") == "seating-object":
        return _live_agent_loop_find_seating_target(action_def, agent_id=agent_id, agent_state=agent_state)
    wanted = {_normalize_token(catalog_id) for catalog_id in action_def.get("catalogIds", [])}
    for building in list_buildings():
        if not isinstance(building, dict) or _building_unavailable(building):
            continue
        records = (building.get("interior") or {}).get("furniture") or []
        if not isinstance(records, list):
            continue
        for index, obj in enumerate(records):
            if not isinstance(obj, dict):
                continue
            catalog_id = _object_catalog_id(obj)
            if _normalize_token(catalog_id) not in wanted:
                continue
            object_id = obj.get("objectInstanceId") or obj.get("id") or obj.get("instanceId") or (sorted(_candidate_object_ids(building, obj, index, "furniture")) or [None])[0]
            if not object_id:
                continue
            target = {
                "kind": "object-instance",
                "buildingId": building.get("id"),
                "objectInstanceId": object_id,
                "catalogId": catalog_id,
                "furnitureIndex": index,
                "interactionSpotId": action_def.get("interactionSpotId") or "use-front",
                "floor": obj.get("floor") or obj.get("buildingFloor") or 1,
            }
            resolved = _find_world_action_target(target)
            availability = get_object_availability(target, agent_id=agent_id, resolved=resolved)
            if availability.get("state") == "available":
                return {
                    "target": target,
                    "buildingName": building.get("name"),
                    "objectType": catalog_id,
                    "availability": availability,
                    "action": action_def,
                }
    return None


def _live_agent_loop_action_definition(loop_action_id=None, action_type=None):
    dynamic_defs = list(LIVE_AGENT_DYNAMIC_OBJECT_AFFORDANCES.values())
    for action_def in [*LIVE_AGENT_LOOP_ACTIONS, *dynamic_defs]:
        if loop_action_id and action_def.get("id") == loop_action_id:
            return action_def
        if action_type and action_def.get("actionType") == action_type:
            return action_def
    return None


def _live_agent_loop_agent_snapshot(agent_id):
    status = load_agent_status()
    roster = _merge_agent_profiles(get_roster())
    for agent in roster:
        status_key = agent.get("statusKey") or agent.get("id")
        if status_key != agent_id and agent.get("id") != agent_id:
            continue
        agent_status = status.get(status_key, {}) or status.get(agent.get("id"), {})
        live_mode_setting = get_agent_live_mode_setting(status_key) or {}
        return {
            "agentId": status_key,
            "id": agent.get("id"),
            "name": agent.get("name"),
            "providerKind": agent.get("providerKind"),
            "status": agent_status.get("state", agent_status.get("status", "offline")),
            "task": agent_status.get("task", ""),
            "agentLiveModeEnabled": bool(live_mode_setting.get("agentLiveModeEnabled")),
            "liveWorld": live_mode_setting.get("liveWorld"),
        }
    return {"agentId": agent_id, "status": "unknown", "task": "", "agentLiveModeEnabled": False, "liveWorld": _agent_live_world_claim_payload(agent_id)}


def _live_agent_loop_world_summary():
    buildings = [b for b in list_buildings() if isinstance(b, dict)]
    object_counts = {}
    for building in buildings:
        for obj in ((building.get("interior") or {}).get("furniture") or []):
            if not isinstance(obj, dict):
                continue
            catalog_id = _object_catalog_id(obj)
            object_counts[catalog_id] = object_counts.get(catalog_id, 0) + 1
    return {
        "buildingCount": len(buildings),
        "buildings": [{"id": b.get("id"), "name": b.get("name"), "furnitureCount": len(((b.get("interior") or {}).get("furniture") or []))} for b in buildings[:12]],
        "objectCounts": object_counts,
    }


def _live_agent_loop_location_from_active_record(item):
    record = item.get("record") if isinstance(item, dict) and isinstance(item.get("record"), dict) else {}
    target = record.get("target") if isinstance(record.get("target"), dict) else {}
    if not target and isinstance(record.get("params"), dict):
        target = record.get("params", {}).get("target") if isinstance(record.get("params", {}).get("target"), dict) else {}
    if not target and isinstance(record.get("route"), dict):
        target = record.get("route", {}).get("target") if isinstance(record.get("route", {}).get("target"), dict) else {}
    if not target:
        return None
    building_id = target.get("buildingId")
    if not building_id:
        return None
    floor = target.get("floor") or target.get("buildingFloor") or 1
    try:
        floor = int(floor)
    except (TypeError, ValueError):
        floor = 1
    return {
        "source": item.get("type"),
        "activeId": item.get("id"),
        "status": item.get("status"),
        "worldActionId": item.get("worldActionId") or record.get("id"),
        "buildingId": building_id,
        "floor": floor,
        "targetKind": target.get("kind"),
        "objectInstanceId": target.get("objectInstanceId"),
        "catalogId": target.get("catalogId"),
    }


def _live_agent_loop_active_locations_by_agent():
    locations = {}
    for action in get_world_actions_store(persist_migration=True).get("active", []):
        if not isinstance(action, dict):
            continue
        status = _canonical_world_action_status(action.get("status"))
        if status not in WORLD_ACTION_ACTIVE_STATES:
            continue
        agent_id = action.get("agentId")
        if not agent_id or agent_id in locations:
            continue
        location = _live_agent_loop_location_from_active_record({"type": "world-action", "id": action.get("id"), "status": status, "record": action})
        if location:
            locations[agent_id] = location
    for intent in reconcile_move_intents().get("active", []):
        if not isinstance(intent, dict) or intent.get("routeStatus") not in MOVE_INTENT_ACTIVE_STATES:
            continue
        agent_id = intent.get("agentId")
        if not agent_id or agent_id in locations:
            continue
        location = _live_agent_loop_location_from_active_record({"type": "move-intent", "id": intent.get("id"), "status": intent.get("routeStatus"), "worldActionId": _move_intent_linked_world_action_id(intent), "record": intent})
        if location:
            locations[agent_id] = location
    return locations


def _live_agent_loop_active_location(agent_id):
    for item in _active_behavior_records_for_agent(agent_id):
        location = _live_agent_loop_location_from_active_record(item)
        if location:
            return location
    return None


def _live_agent_loop_assignment_location(agent_id):
    meta = load_world_meta()
    aliases = _live_agent_loop_agent_aliases(agent_id)
    assignments = meta.get("agentAssignments") if isinstance(meta.get("agentAssignments"), dict) else {}
    for alias in aliases:
        assignment = assignments.get(alias)
        if not isinstance(assignment, dict):
            continue
        for key, kind in (("work", "work"), ("home", "home")):
            building_id = assignment.get(key)
            if building_id:
                return {"source": f"assignment.{kind}", "buildingId": building_id, "floor": 1}
    resident_profile = _live_agent_loop_resident_profile(agent_id, persist=True)
    resident_world = resident_profile.get("world") if isinstance(resident_profile, dict) and isinstance(resident_profile.get("world"), dict) else {}
    for key, kind in (("workBuildingId", "work"), ("homeBuildingId", "home")):
        building_id = resident_world.get(key)
        if building_id:
            return {"source": f"residentProfile.{kind}", "buildingId": building_id, "floor": 1}
    home = _live_agent_loop_existing_home_for_agent(agent_id)
    if home:
        return {"source": "owned-home", "buildingId": home.get("id"), "floor": 1}
    return None


def _live_agent_loop_social_perception(agent_id):
    status = load_agent_status()
    meta = load_world_meta()
    profiles = meta.get("agentProfiles") if isinstance(meta.get("agentProfiles"), dict) else {}
    relationships = meta.get("agentRelationships") if isinstance(meta.get("agentRelationships"), dict) else {}
    roster = get_roster()
    aliases = _live_agent_loop_agent_aliases(agent_id)
    alias_map = {}
    for agent in roster:
        if not isinstance(agent, dict):
            continue
        resolved = str(agent.get("statusKey") or agent.get("id") or "").strip()
        if not resolved:
            continue
        agent_aliases = {str(agent.get("id") or "").strip(), str(agent.get("statusKey") or "").strip()}
        agent_aliases.discard("")
        alias_map[resolved] = agent_aliases or {resolved}
    active_locations = _live_agent_loop_active_locations_by_agent()
    self_location = active_locations.get(agent_id) or _live_agent_loop_assignment_location(agent_id)
    known = []
    live_enabled = []
    nearby = []
    for agent in roster:
        if not isinstance(agent, dict):
            continue
        other_id = str(agent.get("statusKey") or agent.get("id") or "").strip()
        if not other_id or other_id in aliases:
            continue
        other_aliases = alias_map.get(other_id) or {other_id}
        if aliases.intersection(other_aliases):
            continue
        profile = profiles.get(other_id) or profiles.get(agent.get("id")) or {}
        other_status = status.get(other_id, {}) or status.get(agent.get("id"), {}) or {}
        live_mode_enabled = bool(agent.get("agentLiveModeEnabled") or _agent_live_mode_enabled_from_profile(profile))
        rel_key = next((key for key in relationships.keys() if isinstance(key, str) and any(alias and alias in key for alias in aliases) and any(alias and alias in key for alias in other_aliases)), None)
        relationship = relationships.get(rel_key) if rel_key and isinstance(relationships.get(rel_key), dict) else {}
        location = active_locations.get(other_id)
        row = {
            "agentId": other_id,
            "name": agent.get("name"),
            "status": other_status.get("state", other_status.get("status", "offline")),
            "task": other_status.get("task", ""),
            "liveModeEnabled": live_mode_enabled,
            "relationship": {k: relationship.get(k) for k in ("summary", "score", "updatedAt") if k in relationship},
            "location": location,
        }
        known.append(row)
        if live_mode_enabled:
            live_enabled.append(row)
        if self_location and location and self_location.get("buildingId") == location.get("buildingId") and int(self_location.get("floor") or 1) == int(location.get("floor") or 1):
            nearby.append({**row, "nearbyReason": "same-building-floor", "buildingId": location.get("buildingId"), "floor": location.get("floor") or 1})
    known.sort(key=lambda item: (not item.get("liveModeEnabled"), item.get("name") or item.get("agentId") or ""))
    return {
        "schemaVersion": "agent-live-mode-social-perception/v1",
        "agentId": agent_id,
        "selfLocation": self_location,
        "knownAgentCount": len(known),
        "liveEnabledPeerCount": len(live_enabled),
        "nearbyAgentCount": len(nearby),
        "knownAgents": known[:12],
        "liveEnabledPeers": live_enabled[:8],
        "nearbyAgents": nearby[:8],
        "conversation": {
            "visibleExecutorEnabled": True,
            "clientExecutor": "main3d.js#routeLiveModeSocialWorldAction",
            "actionType": "life.social",
            "loopActionId": "talk-with-nearby-agent",
            "status": "available" if nearby else "waiting_for_nearby_agent",
            "blockedReason": None if nearby else "no-nearby-visible-agent",
        },
    }


def _live_agent_loop_clamp_personality(raw):
    traits = {}
    source = raw if isinstance(raw, dict) else {}
    for trait in LIVE_AGENT_LOOP_PERSONALITY_TRAITS:
        try:
            value = float(source.get(trait, 1.0))
        except (TypeError, ValueError):
            value = 1.0
        traits[trait] = round(min(2.0, max(0.5, value)), 2)
    return traits


def _live_agent_loop_personality_multiplier(need_key, personality):
    multiplier = 1.0
    weights = LIVE_AGENT_LOOP_PERSONALITY_NEED_WEIGHTS.get(need_key) or {}
    traits = _live_agent_loop_clamp_personality(personality)
    for trait, weight in weights.items():
        multiplier += float(weight) * (float(traits.get(trait, 1.0)) - 1.0)
    return round(min(2.2, max(0.4, multiplier)), 3)


def _live_agent_loop_clean_profile_items(values, limit=6, item_limit=600):
    items = []
    for item in values if isinstance(values, list) else []:
        if isinstance(item, dict):
            clean = {}
            for key, value in list(item.items())[:12]:
                if isinstance(value, (str, int, float, bool)) or value is None:
                    clean[str(key)[:60]] = str(value or "").strip()[:item_limit] if isinstance(value, str) else value
            if clean:
                items.append(clean)
        else:
            text = str(item or "").strip()[:item_limit]
            if text:
                items.append(text)
    return items[-max(1, int(limit)):]


def _live_agent_loop_resident_profile(agent_id, *, persist=True):
    try:
        ok, result, _status = get_agent_resident_profile(agent_id, persist=persist)
    except Exception as exc:
        print(f"⚠️  Live Mode resident profile context unavailable for {agent_id}: {exc}")
        return None
    if not ok or not isinstance(result, dict):
        return None
    resident_profile = result.get("residentProfile")
    return resident_profile if isinstance(resident_profile, dict) else None


def _live_agent_loop_resident_memory_context(resident_profile):
    memory = resident_profile.get("memory") if isinstance(resident_profile, dict) and isinstance(resident_profile.get("memory"), dict) else {}
    relationships = []
    raw_relationships = memory.get("relationships") if isinstance(memory.get("relationships"), dict) else {}
    for key, value in list(raw_relationships.items())[-8:]:
        row = {"id": str(key or "")[:120], "source": "residentProfile"}
        if isinstance(value, dict):
            for field in ("otherAgentId", "summary", "score", "updatedAt", "lastOutcome", "lastActionId"):
                if value.get(field) is not None:
                    row[field] = value.get(field)
        elif value:
            row["summary"] = str(value)[:800]
        if row.get("id") or row.get("summary"):
            relationships.append(row)
    return {
        "summary": str(memory.get("summary") or "")[:1200],
        "shortTerm": _live_agent_loop_clean_profile_items(memory.get("shortTerm"), limit=6),
        "longTerm": _live_agent_loop_clean_profile_items(memory.get("longTerm"), limit=6),
        "reflections": _live_agent_loop_clean_profile_items(memory.get("reflections"), limit=6),
        "relationships": relationships,
    }


def _live_agent_loop_resident_profile_context(resident_profile):
    if not isinstance(resident_profile, dict):
        return None
    identity = resident_profile.get("identity") if isinstance(resident_profile.get("identity"), dict) else {}
    world = resident_profile.get("world") if isinstance(resident_profile.get("world"), dict) else {}
    goals = resident_profile.get("goals") if isinstance(resident_profile.get("goals"), dict) else {}
    live_mode = resident_profile.get("liveMode") if isinstance(resident_profile.get("liveMode"), dict) else {}
    needs = resident_profile.get("needs") if isinstance(resident_profile.get("needs"), dict) else {}
    return {
        "schemaVersion": resident_profile.get("schemaVersion") or RESIDENT_PROFILE_SCHEMA_VERSION,
        "identity": {
            "displayName": str(identity.get("displayName") or "")[:120],
            "role": str(identity.get("role") or "")[:160],
            "archetype": str(identity.get("archetype") or "")[:160],
            "lifePurpose": str(identity.get("lifePurpose") or "")[:1000],
        },
        "world": {
            "homeBuildingId": str(world.get("homeBuildingId") or "")[:120],
            "workBuildingId": str(world.get("workBuildingId") or "")[:120],
            "desk": _copy_jsonable(world.get("desk")) if isinstance(world.get("desk"), dict) else None,
        },
        "goals": {
            "current": _live_agent_loop_clean_profile_items(goals.get("current"), limit=6),
            "daily": _live_agent_loop_clean_profile_items(goals.get("daily"), limit=6),
            "longTerm": _live_agent_loop_clean_profile_items(goals.get("longTerm"), limit=6),
        },
        "needs": {
            key: _live_agent_loop_clamp_need(needs.get(key, default))
            for key, default in LIVE_AGENT_LOOP_NEED_DEFAULTS.items()
        },
        "personality": _live_agent_loop_clamp_personality(resident_profile.get("personality")),
        "memory": _live_agent_loop_resident_memory_context(resident_profile),
        "liveMode": {
            "autonomyWhenIdle": bool(live_mode.get("autonomyWhenIdle", True)),
            "pauseForDirectChat": bool(live_mode.get("pauseForDirectChat", True)),
            "fallbackBehavior": str(live_mode.get("fallbackBehavior") or "scripted-idle")[:120],
        },
    }


def _live_agent_loop_profile_goal_text(goal):
    if isinstance(goal, dict):
        parts = []
        for key in ("title", "label", "text", "summary", "goal", "description", "name"):
            value = str(goal.get(key) or "").strip()
            if value:
                parts.append(value)
        if not parts:
            for value in goal.values():
                if isinstance(value, (str, int, float, bool)) and str(value).strip():
                    parts.append(str(value).strip())
        return " ".join(parts)[:500]
    return str(goal or "").strip()[:500]


def _live_agent_text_tokens(text):
    return [part for part in re.split(r"[^a-z0-9]+", str(text or "").lower()) if part]


def _live_agent_text_has_any(text, keywords):
    tokens = set(_live_agent_text_tokens(text))
    if not tokens:
        return False
    for keyword in keywords or ():
        raw = str(keyword or "").strip().lower()
        if not raw:
            continue
        keyword_tokens = _live_agent_text_tokens(raw)
        if not keyword_tokens:
            continue
        if len(keyword_tokens) == 1 and keyword_tokens[0] in tokens:
            return True
        if len(keyword_tokens) > 1 and all(token in tokens for token in keyword_tokens):
            return True
    return False


def _live_agent_loop_goal_intent(text):
    for intent, keywords in LIVE_AGENT_PROFILE_GOAL_INTENT_KEYWORDS.items():
        if _live_agent_text_has_any(text, keywords):
            return intent
    return "general"


def _live_agent_loop_profile_goal_intents(agent_id, resident_profile=None):
    """Collect the set of goal intents expressed by the agent's own Resident
    Profile goals. Dynamic object affordances are only offered when the agent's
    goals (or a recent model intention) actually ask for that category."""
    if resident_profile is None:
        resident_profile = _live_agent_loop_resident_profile(agent_id, persist=False)
    goals = (resident_profile or {}).get("goals") if isinstance(resident_profile, dict) else {}
    goals = goals if isinstance(goals, dict) else {}
    intents = set()
    for bucket in ("current", "daily", "longTerm"):
        for goal in goals.get(bucket) or []:
            text = _live_agent_loop_profile_goal_text(goal)
            if not text:
                continue
            intent = _live_agent_loop_goal_intent(text)
            if intent and intent != "general":
                intents.add(intent)
    return intents


def _live_agent_loop_requested_categories(agent_id, now_epoch=None):
    """Object categories the agent's model asked for recently via an intention
    reply. Valid for 10 minutes so a category the model wants stays offered."""
    now_epoch = float(now_epoch or time.time())
    with _live_agent_model_decision_lock:
        row = _live_agent_model_decision_state.get(agent_id) or {}
        requested = row.get("requestedCategories")
    if not isinstance(requested, dict):
        return set()
    return {
        category
        for category, at_epoch in requested.items()
        if isinstance(at_epoch, (int, float)) and (now_epoch - float(at_epoch)) < 600 and category in LIVE_AGENT_DYNAMIC_OBJECT_AFFORDANCES
    }


def _live_agent_loop_note_requested_category(agent_id, category):
    resolved = LIVE_AGENT_INTENTION_CATEGORY_ALIASES.get(_normalize_token(category) or "")
    if not resolved or resolved not in LIVE_AGENT_DYNAMIC_OBJECT_AFFORDANCES:
        return None
    with _live_agent_model_decision_lock:
        row = _live_agent_model_decision_state.setdefault(agent_id, {})
        requested = row.setdefault("requestedCategories", {})
        requested[resolved] = time.time()
    return resolved


def _live_agent_loop_dynamic_action_defs(agent_id, agent_state=None, resident_profile=None):
    """Resolve which dynamic object-category affordances are active for this
    agent right now. Sources: Resident Profile goal intents and recent model
    intention requests. This keeps the planner generic: categories appear
    because the agent wants them, not because they are hardcoded choices."""
    categories = set()
    for intent in _live_agent_loop_profile_goal_intents(agent_id, resident_profile):
        categories.update(LIVE_AGENT_GOAL_INTENT_OBJECT_CATEGORIES.get(intent) or ())
    categories.update(_live_agent_loop_requested_categories(agent_id))
    defs = []
    for category in sorted(categories):
        action_def = LIVE_AGENT_DYNAMIC_OBJECT_AFFORDANCES.get(category)
        if isinstance(action_def, dict):
            defs.append(action_def)
    return defs


def _live_agent_loop_resident_profile_goal_boost(goal, affordance):
    text = " ".join(str(goal.get(key) or "") for key in ("id", "reason", "text", "need", "bucket"))
    if not text:
        return 0
    loop_action_id = affordance.get("id")
    intent = str(goal.get("intent") or _live_agent_loop_goal_intent(text))
    intent_boost = (LIVE_AGENT_GOAL_INTENT_ACTION_BOOSTS.get(intent) or {}).get(loop_action_id)
    try:
        priority = float(goal.get("priority") or 0.2)
    except (TypeError, ValueError):
        priority = 0.2
    if intent_boost:
        return round(min(0.92, max(0.08, intent_boost * max(0.55, priority))), 3)
    if loop_action_id == "work-on-active-goal":
        return round(min(0.46, max(0.12, priority * 0.46)), 3)
    need_key = str(affordance.get("need") or "").lower()
    label = str(affordance.get("label") or "").lower()
    keywords = set(LIVE_AGENT_PROFILE_ACTION_KEYWORDS.get(loop_action_id) or ())
    keywords.update(part for part in re.split(r"[^a-z0-9]+", label) if len(part) >= 4)
    if need_key:
        keywords.add(need_key)
    if not _live_agent_text_has_any(text, keywords):
        return 0
    return round(min(0.24, max(0.05, priority * 0.32)), 3)


def _live_agent_loop_agent_context(agent_id):
    meta = load_world_meta()
    aliases = _live_agent_loop_agent_aliases(agent_id)
    profile = {}
    profiles = meta.get("agentProfiles") if isinstance(meta.get("agentProfiles"), dict) else {}
    assignments = meta.get("agentAssignments") if isinstance(meta.get("agentAssignments"), dict) else {}
    assignment = {}
    roster_agent = None
    for alias in aliases:
        if not profile and isinstance(profiles.get(alias), dict):
            profile = profiles.get(alias) or {}
        if not assignment and isinstance(assignments.get(alias), dict):
            assignment = assignments.get(alias) or {}
    for agent in _merge_agent_profiles(get_roster()):
        if not isinstance(agent, dict):
            continue
        agent_aliases = {str(agent.get("id") or "").strip(), str(agent.get("statusKey") or "").strip()}
        if aliases.intersection(agent_aliases):
            roster_agent = agent
            if not profile and isinstance(agent.get("profile"), dict):
                profile = agent.get("profile") or {}
            break
    resident_profile = _live_agent_loop_resident_profile(agent_id, persist=True)
    resident_context = _live_agent_loop_resident_profile_context(resident_profile)
    resident_world = resident_context.get("world") if isinstance(resident_context, dict) and isinstance(resident_context.get("world"), dict) else {}
    home = _live_agent_loop_existing_home_for_agent(agent_id)
    if not home and resident_world.get("homeBuildingId"):
        home = load_building(resident_world.get("homeBuildingId"))
    work_id = assignment.get("work") or resident_world.get("workBuildingId") or (roster_agent or {}).get("workBuilding")
    work = load_building(work_id) if work_id else None
    relationship_store = meta.get("agentRelationships") if isinstance(meta.get("agentRelationships"), dict) else {}
    relationships = []
    for key, value in relationship_store.items():
        if not isinstance(value, dict):
            continue
        key_text = str(key or "")
        if agent_id not in key_text and not any(alias and alias in key_text for alias in aliases):
            continue
        relationships.append({"id": key, **{k: value.get(k) for k in ("agentId", "otherAgentId", "summary", "score", "updatedAt") if k in value}})
    relationships = relationships[-6:]
    resident_memory = resident_context.get("memory") if isinstance(resident_context, dict) and isinstance(resident_context.get("memory"), dict) else {}
    relationship_ids = {item.get("id") for item in relationships if isinstance(item, dict)}
    for item in resident_memory.get("relationships") or []:
        if not isinstance(item, dict):
            continue
        rel_id = item.get("id")
        if rel_id and rel_id in relationship_ids:
            continue
        relationships.append(item)
        if rel_id:
            relationship_ids.add(rel_id)
    relationships = relationships[-8:]
    known_agents = [
        {
            "agentId": item.get("statusKey") or item.get("id"),
            "name": item.get("name"),
            "liveModeEnabled": bool(_agent_live_mode_enabled_from_profile((profiles.get(item.get("statusKey")) or profiles.get(item.get("id")) or {}) if isinstance(item, dict) else {})),
        }
        for item in _merge_agent_profiles(get_roster())
        if isinstance(item, dict) and (item.get("statusKey") or item.get("id")) not in aliases
    ]
    return {
        "schemaVersion": "agent-live-mode-agent-context/v1",
        "personality": _live_agent_loop_clamp_personality((resident_context or {}).get("personality") or profile.get("personality") or (roster_agent or {}).get("personality")),
        "home": {"exists": bool(home), "buildingId": (home or {}).get("id"), "name": (home or {}).get("name"), "type": (home or {}).get("type")},
        "work": {"exists": bool(work), "buildingId": (work or {}).get("id"), "name": (work or {}).get("name"), "type": (work or {}).get("type")},
        "relationships": relationships,
        "knownAgents": known_agents[:12],
        "residentProfile": resident_context,
        "docs": {k: profile.get("docs", {}).get(k) for k in ("reviewSummary", "maintenanceNotes", "carePlan") if isinstance(profile.get("docs"), dict) and profile.get("docs", {}).get(k)},
    }


def _live_agent_loop_recent_world_actions(agent_id, limit=8):
    store = get_world_actions_store(persist_migration=True)
    rows = []
    for bucket in ("active", "history"):
        for action in store.get(bucket, []):
            if not isinstance(action, dict) or action.get("agentId") != agent_id:
                continue
            timing = action.get("timing") if isinstance(action.get("timing"), dict) else {}
            params = action.get("params") if isinstance(action.get("params"), dict) else {}
            rows.append({
                "id": action.get("id"),
                "bucket": bucket,
                "status": _canonical_world_action_status(action.get("status")),
                "actionType": action.get("actionType"),
                "loopActionId": params.get("loopActionId"),
                "updatedAt": timing.get("updatedAt"),
                "terminalAt": timing.get("terminalAt"),
            })
    rows.sort(key=lambda row: row.get("terminalAt") or row.get("updatedAt") or "", reverse=True)
    return rows[:max(1, int(limit))]


def _live_agent_loop_memory_target(target):
    if not isinstance(target, dict):
        return None
    out = {}
    for key in ("kind", "buildingId", "catalogId", "objectInstanceId", "targetAgentId", "siteKind"):
        value = target.get(key)
        if value is not None and str(value).strip():
            out[key] = str(value)[:180]
    for key in ("x", "y", "z", "floor"):
        value = target.get(key)
        if isinstance(value, (int, float)):
            out[key] = round(float(value), 2)
    build_site = target.get("buildSite") if isinstance(target.get("buildSite"), dict) else {}
    if build_site:
        out["buildSite"] = {
            key: build_site.get(key)
            for key in ("buildingId", "buildingName", "siteKind", "worldX", "worldY", "widthTiles", "heightTiles")
            if build_site.get(key) is not None
        }
    return out or None


def _live_agent_loop_target_key(target):
    target = target if isinstance(target, dict) else {}
    if not target:
        return ""
    building_id = str(target.get("buildingId") or "").strip()
    object_id = str(target.get("objectInstanceId") or target.get("catalogId") or "").strip()
    if building_id and object_id:
        return f"object:{building_id}:{object_id}"
    if building_id:
        return f"building:{building_id}"
    kind = str(target.get("kind") or target.get("siteKind") or "target").strip()
    x, y = target.get("x"), target.get("y")
    if isinstance(x, (int, float)) and isinstance(y, (int, float)):
        return f"{kind}:x={round(float(x), 1)}:y={round(float(y), 1)}"
    build_site = target.get("buildSite") if isinstance(target.get("buildSite"), dict) else {}
    build_id = str(build_site.get("buildingId") or "").strip()
    if build_id:
        return f"build-site:{build_id}"
    target_agent = str(target.get("targetAgentId") or "").strip()
    if target_agent:
        return f"agent:{target_agent}"
    return ""


def _live_agent_loop_target_phrase(target):
    target = target if isinstance(target, dict) else {}
    if not target:
        return ""
    kind = target.get("kind") or target.get("siteKind") or "target"
    x, y = target.get("x"), target.get("y")
    if isinstance(x, (int, float)) and isinstance(y, (int, float)):
        return f"{kind} at ({round(float(x), 2)}, {round(float(y), 2)})"
    if target.get("buildingId"):
        label = target.get("catalogId") or target.get("objectInstanceId") or kind
        return f"{label} in building {target.get('buildingId')}"
    if isinstance(target.get("buildSite"), dict):
        site = target["buildSite"]
        return f"{site.get('buildingName') or site.get('buildingId') or kind} build site"
    return str(kind)


def _live_agent_loop_failure_learning(action, summary):
    if not isinstance(summary, dict):
        return None
    status = _canonical_world_action_status(summary.get("status"))
    if status not in {"failed", "expired", "cancelled"}:
        return None
    result = summary.get("result") if isinstance(summary.get("result"), dict) else {}
    watchdog = result.get("watchdog") if isinstance(result.get("watchdog"), dict) else {}
    target = None
    if watchdog.get("target"):
        target = _live_agent_loop_memory_target(watchdog.get("target"))
    if not target and isinstance(action, dict):
        target = _live_agent_loop_memory_target(action.get("target"))
    target_key = _live_agent_loop_target_key(target)
    result_reason = str(result.get("reason") or "").strip()
    failure_reason = str(summary.get("failureReason") or "").strip()
    reason = result_reason or failure_reason or status
    evidence = {}
    if watchdog:
        for key in ("distance", "improvement", "windowSec", "samples"):
            if watchdog.get(key) is not None:
                evidence[key] = watchdog.get(key)
        if isinstance(watchdog.get("position"), dict):
            evidence["position"] = _live_agent_loop_memory_target(watchdog.get("position"))
    pieces = []
    if reason:
        pieces.append(f"reason {reason}")
    target_phrase = _live_agent_loop_target_phrase(target)
    if target_phrase:
        pieces.append(f"target {target_phrase}")
    if evidence:
        metrics = []
        if evidence.get("distance") is not None:
            metrics.append(f"distance {evidence.get('distance')}")
        if evidence.get("improvement") is not None:
            metrics.append(f"improvement {evidence.get('improvement')}")
        if evidence.get("windowSec") is not None:
            metrics.append(f"over {evidence.get('windowSec')}s")
        if metrics:
            pieces.append("watchdog " + ", ".join(str(item) for item in metrics))
    learning_text = "; ".join(pieces)
    if learning_text:
        learning_text = f"{learning_text}; avoid retrying the same target unless the route, target, or conditions change."
    else:
        learning_text = "failed without useful details; avoid repeating the same action until conditions change."
    return {
        "status": status,
        "reason": reason,
        "failureReason": failure_reason,
        "resultReason": result_reason,
        "target": target,
        "targetKey": target_key,
        "evidence": evidence,
        "learningText": learning_text[:700],
    }


def _live_agent_loop_recent_outcome_summary(agent_state, perception=None, limit=12):
    memory = agent_state.get("memory") if isinstance(agent_state.get("memory"), dict) else {}
    records = _live_agent_loop_trim_list(memory.get("recentActions"), limit)
    by_action = {}
    last_failure_by_action = {}
    for item in records:
        loop_id = item.get("loopActionId")
        status = _canonical_world_action_status(item.get("status"))
        if not loop_id or not status:
            continue
        bucket = by_action.setdefault(loop_id, {"completed": 0, "failed": 0, "expired": 0, "cancelled": 0, "recentStatuses": [], "targetFailures": {}})
        bucket["recentStatuses"].append(status)
        if status == "completed":
            bucket["completed"] += 1
        elif status in {"failed", "expired", "cancelled"}:
            bucket[status] += 1
            last_failure_by_action[loop_id] = item
            target_key = item.get("targetKey") or ((item.get("failure") if isinstance(item.get("failure"), dict) else {}) or {}).get("targetKey")
            if target_key:
                target_bucket = bucket["targetFailures"].setdefault(target_key, {"failed": 0, "expired": 0, "cancelled": 0, "total": 0})
                target_bucket[status] = int(target_bucket.get(status) or 0) + 1
                target_bucket["total"] = int(target_bucket.get("total") or 0) + 1
    for loop_id, bucket in by_action.items():
        streak = 0
        for item in reversed(records):
            if item.get("loopActionId") != loop_id:
                continue
            status = _canonical_world_action_status(item.get("status"))
            if status in {"failed", "expired", "cancelled"}:
                streak += 1
                continue
            break
        bucket["recentFailureStreak"] = streak
    issues = []
    for loop_id, bucket in by_action.items():
        failures = int(bucket.get("failed") or 0) + int(bucket.get("expired") or 0) + int(bucket.get("cancelled") or 0)
        if failures <= 0 or int(bucket.get("recentFailureStreak") or 0) <= 0:
            continue
        failed_item = last_failure_by_action.get(loop_id) or {}
        failure = failed_item.get("failure") if isinstance(failed_item.get("failure"), dict) else {}
        reason = (
            failure.get("learningText")
            or failed_item.get("failureReason")
            or failed_item.get("resultReason")
            or failed_item.get("status")
            or "recent action did not complete"
        )
        target_key = failed_item.get("targetKey") or failure.get("targetKey") or _live_agent_loop_target_key(failed_item.get("target"))
        issue_seed = f"{loop_id}:{target_key or ''}:{reason}"
        issues.append({
            "id": f"issue.{loop_id}.{hashlib.sha1(issue_seed.encode('utf-8')).hexdigest()[:8]}",
            "loopActionId": loop_id,
            "status": "unresolved",
            "failures": failures,
            "failureStreak": int(bucket.get("recentFailureStreak") or 0),
            "targetKey": target_key,
            "priority": round(min(0.95, LIVE_AGENT_ISSUE_PRIORITY + min(0.06, failures * 0.02)), 3),
            "reason": str(reason)[:520],
        })
    issues.sort(key=lambda item: (float(item.get("priority") or 0), int(item.get("failureStreak") or 0)), reverse=True)
    recent_world = perception.get("recentWorldActions") if isinstance(perception, dict) else []
    return {
        "window": len(records),
        "byAction": by_action,
        "issues": issues[:6],
        "lastLoopActionIds": [item.get("loopActionId") for item in records[-6:] if item.get("loopActionId")],
        "recentWorldActionIds": [item.get("id") for item in (recent_world or [])[:6] if isinstance(item, dict) and item.get("id")],
    }


def _live_agent_loop_new_plan(agent_id, action_def, decision, selected, now_iso):
    action_def = action_def if isinstance(action_def, dict) else {}
    decision = decision if isinstance(decision, dict) else {}
    selected = selected if isinstance(selected, dict) else {}
    loop_action_id = str(action_def.get("id") or decision.get("selectedActionId") or "visible-action")
    title = f"{action_def.get('label') or loop_action_id}"
    plan_id = f"plan-{agent_id}-{loop_action_id}-{int(time.time())}"
    target = selected.get("target") if isinstance(selected.get("target"), dict) else {}
    target_label = target.get("buildingId") or target.get("catalogId") or target.get("kind") or "visible target"
    plan = {
        "schemaVersion": LIVE_AGENT_LOOP_PLAN_SCHEMA_VERSION,
        "id": plan_id,
        "agentId": agent_id,
        "status": "planned",
        "title": title,
        "loopActionId": loop_action_id,
        "actionType": action_def.get("actionType"),
        "need": action_def.get("need"),
        "createdAt": now_iso,
        "updatedAt": now_iso,
        "currentStepIndex": 1,
        "retries": 0,
        "maxRetries": LIVE_AGENT_LOOP_DEFAULTS["planMaxRetries"],
        "operatorSummary": f"Planning to {title} through a visible in-world executor.",
        "steps": [
            {
                "id": "choose-goal",
                "label": "Choose resident goal",
                "status": "completed",
                "updatedAt": now_iso,
            },
            {
                "id": "execute-visible-action",
                "label": f"Execute {title}",
                "status": "pending",
                "loopActionId": loop_action_id,
                "actionType": action_def.get("actionType"),
                "attempts": 0,
                "updatedAt": now_iso,
            },
            {
                "id": "observe-outcome",
                "label": f"Observe outcome at {target_label}",
                "status": "pending",
                "attempts": 0,
            },
        ],
    }
    return _live_agent_loop_normalize_plan(plan)


def _live_agent_loop_prepare_plan(agent_state, agent_id, action_def, decision, selected, now_iso, *, persist=True):
    loop_action_id = (action_def or {}).get("id")
    active_plan = _live_agent_loop_normalize_plan(agent_state.get("activePlan"))
    if _live_agent_loop_plan_is_active(active_plan):
        step = _live_agent_loop_plan_current_step(active_plan)
        if isinstance(step, dict) and step.get("loopActionId") == loop_action_id:
            active_plan["status"] = "in_progress" if active_plan.get("status") == "planned" else active_plan.get("status")
            active_plan["updatedAt"] = now_iso
            active_plan["operatorSummary"] = f"Resuming plan step {step.get('label') or loop_action_id}."
            if persist:
                return _live_agent_loop_store_plan(agent_state, active_plan)
            return active_plan
        if persist:
            active_plan["status"] = "cancelled"
            active_plan["cancelledAt"] = now_iso
            active_plan["updatedAt"] = now_iso
            active_plan["failureReason"] = "superseded-by-new-plan"
            active_plan["operatorSummary"] = "Previous active plan was cancelled because its current visible step was no longer selected."
            _live_agent_loop_store_plan(agent_state, active_plan)
    plan = _live_agent_loop_new_plan(agent_id, action_def, decision, selected, now_iso)
    if persist:
        return _live_agent_loop_store_plan(agent_state, plan)
    return plan


def _live_agent_loop_mark_plan_action_created(state, agent_id, agent_state, plan, action_id, now_iso):
    plan = _live_agent_loop_normalize_plan(plan)
    if not plan:
        return None
    step = _live_agent_loop_plan_current_step(plan)
    if isinstance(step, dict):
        step["status"] = "in_progress"
        step["actionId"] = action_id
        step["startedAt"] = now_iso
        step["updatedAt"] = now_iso
        step["attempts"] = _normalize_int(step.get("attempts"), 0, minimum=0, maximum=20) + 1
    plan["status"] = "in_progress"
    plan["startedAt"] = plan.get("startedAt") or now_iso
    plan["updatedAt"] = now_iso
    plan["lastActionId"] = action_id
    plan["operatorSummary"] = f"Running visible plan step {step.get('label') if isinstance(step, dict) else plan.get('title')}."
    stored = _live_agent_loop_store_plan(agent_state, plan)
    _live_agent_loop_add_event(state, "plan-step-started", agent_id=agent_id, details={"planId": plan.get("id"), "actionId": action_id, "stepId": (step or {}).get("id") if isinstance(step, dict) else None})
    return stored


def _live_agent_loop_mark_plan_action_request_failed(state, agent_id, agent_state, plan, failure_reason, now_iso):
    plan = _live_agent_loop_normalize_plan(plan)
    if not plan:
        return None
    step = _live_agent_loop_plan_current_step(plan)
    if isinstance(step, dict):
        step["status"] = "failed"
        step["failureReason"] = _live_agent_loop_clean_plan_text(failure_reason, limit=220) or "action request failed"
        step["settledAt"] = now_iso
        step["updatedAt"] = now_iso
    plan["status"] = "failed"
    plan["failureReason"] = (step or {}).get("failureReason") if isinstance(step, dict) else "action request failed"
    plan["failedAt"] = now_iso
    plan["updatedAt"] = now_iso
    plan["operatorSummary"] = f"Plan failed before the visible action could be created: {plan.get('failureReason')}."
    stored = _live_agent_loop_store_plan(agent_state, plan)
    _live_agent_loop_add_event(state, "plan-failed", agent_id=agent_id, details={"planId": plan.get("id"), "failureReason": plan.get("failureReason")})
    return stored


def _live_agent_loop_find_plan_for_action(agent_state, summary):
    if not isinstance(summary, dict):
        return None
    wanted_plan_id = summary.get("planId")
    wanted_step_id = summary.get("planStepId")
    action_id = summary.get("id")
    candidates = []
    active_plan = _live_agent_loop_normalize_plan(agent_state.get("activePlan"))
    if active_plan:
        candidates.append(active_plan)
    for plan in agent_state.get("plans") or []:
        normalized = _live_agent_loop_normalize_plan(plan)
        if normalized and all(normalized.get("id") != existing.get("id") for existing in candidates):
            candidates.append(normalized)
    for plan in candidates:
        if wanted_plan_id and plan.get("id") != wanted_plan_id:
            continue
        for index, step in enumerate(plan.get("steps") or []):
            if wanted_step_id and step.get("id") != wanted_step_id:
                continue
            if action_id and (step.get("actionId") == action_id or plan.get("lastActionId") == action_id):
                plan["currentStepIndex"] = index
                return plan
            if wanted_plan_id and wanted_step_id:
                plan["currentStepIndex"] = index
                return plan
    return None


def _live_agent_loop_update_plan_from_settled_action(state, agent_id, agent_state, summary, action_status, now_iso):
    plan = _live_agent_loop_find_plan_for_action(agent_state, summary)
    if not plan:
        return None
    step = _live_agent_loop_plan_current_step(plan)
    completed = action_status == "completed"
    if isinstance(step, dict):
        step["actionId"] = summary.get("id") or step.get("actionId")
        step["settledAt"] = now_iso
        step["updatedAt"] = now_iso
        step["status"] = "completed" if completed else "failed"
        if not completed:
            step["failureReason"] = _live_agent_loop_clean_plan_text(summary.get("failureReason") or action_status, limit=220)
    plan["lastActionId"] = summary.get("id") or plan.get("lastActionId")
    plan["updatedAt"] = now_iso
    if completed:
        for next_step in plan.get("steps") or []:
            if next_step.get("id") == "observe-outcome":
                next_step["status"] = "completed"
                next_step["updatedAt"] = now_iso
                next_step["settledAt"] = now_iso
        plan["status"] = "completed"
        plan["completedAt"] = now_iso
        plan["currentStepIndex"] = max(0, len(plan.get("steps") or []) - 1)
        plan["operatorSummary"] = f"Completed plan: {plan.get('title')}."
        event_type = "plan-completed"
        details = {"planId": plan.get("id"), "actionId": summary.get("id"), "status": action_status}
    else:
        retries = _normalize_int(plan.get("retries"), 0, minimum=0, maximum=20) + 1
        max_retries = _normalize_int(plan.get("maxRetries"), LIVE_AGENT_LOOP_DEFAULTS["planMaxRetries"], minimum=0, maximum=5)
        plan["retries"] = retries
        plan["failureReason"] = _live_agent_loop_clean_plan_text(summary.get("failureReason") or action_status, limit=240)
        if retries <= max_retries:
            if isinstance(step, dict):
                step["status"] = "pending"
            plan["status"] = "retrying"
            plan["operatorSummary"] = f"Retrying plan {plan.get('title')} after {action_status} ({retries}/{max_retries})."
            event_type = "plan-retrying"
        else:
            plan["status"] = "failed"
            plan["failedAt"] = now_iso
            plan["operatorSummary"] = f"Plan failed after {retries} unsuccessful attempt(s): {plan.get('failureReason')}."
            event_type = "plan-failed"
        details = {"planId": plan.get("id"), "actionId": summary.get("id"), "status": action_status, "retries": retries, "maxRetries": max_retries}
    stored = _live_agent_loop_store_plan(agent_state, plan)
    _live_agent_loop_add_event(state, event_type, agent_id=agent_id, details=details)
    return stored


def _live_agent_loop_build_goal_frame(agent_id, perception, agent_state):
    needs = perception.get("needs") if isinstance(perception, dict) else {}
    context = _live_agent_loop_agent_context(agent_id)
    if isinstance(perception, dict) and isinstance(perception.get("social"), dict):
        context["social"] = perception.get("social")
    recent = _live_agent_loop_recent_outcome_summary(agent_state, perception)
    active_plan = _live_agent_loop_normalize_plan(agent_state.get("activePlan"))
    goals = []
    for need_id, value in sorted((needs or {}).items(), key=lambda item: item[1], reverse=True)[:3]:
        goals.append({
            "id": f"need.{need_id}",
            "kind": "need",
            "need": need_id,
            "priority": round(float(value or 0), 3),
            "reason": f"{need_id} need is currently {round(float(value or 0), 3)}",
        })
    if context["home"].get("exists"):
        goals.append({"id": "home.use-owned-home", "kind": "home", "priority": 0.42, "reason": "agent has an owned visible home"})
    else:
        goals.append({"id": "home.establish-shelter", "kind": "home", "priority": 0.70, "reason": "agent has no owned visible home yet"})
    if context["work"].get("exists"):
        goals.append({"id": "work.visit-assigned-work", "kind": "work", "priority": 0.28, "reason": "agent has an assigned work building"})
    else:
        goals.append({"id": "work.keep-general-routine", "kind": "work", "priority": 0.10, "reason": "no assigned work building is available"})
    social = context.get("social") if isinstance(context.get("social"), dict) else {}
    if social.get("nearbyAgentCount"):
        goals.append({"id": "social.perceive-nearby-agent", "kind": "relationship", "priority": 0.34, "reason": "another known agent appears co-located in the current social perception frame"})
    if social.get("liveEnabledPeerCount"):
        goals.append({"id": "social.observe-live-peers", "kind": "relationship", "priority": 0.22, "reason": "another resident has Live Mode enabled"})
    if context.get("relationships"):
        goals.append({"id": "social.maintain-relationships", "kind": "relationship", "priority": 0.24, "reason": "stored relationship context exists"})
    elif context.get("knownAgents"):
        goals.append({"id": "social.observe-neighbors", "kind": "relationship", "priority": 0.12, "reason": "other agents are known; visible conversation waits for co-location evidence"})
    resident_profile = context.get("residentProfile") if isinstance(context.get("residentProfile"), dict) else {}
    resident_goals = resident_profile.get("goals") if isinstance(resident_profile.get("goals"), dict) else {}
    for bucket, base_priority in (("current", LIVE_AGENT_CURRENT_GOAL_PRIORITY), ("daily", LIVE_AGENT_DAILY_GOAL_PRIORITY), ("longTerm", LIVE_AGENT_LONG_TERM_GOAL_PRIORITY)):
        for index, goal in enumerate((resident_goals.get(bucket) or [])[:4]):
            text = _live_agent_loop_profile_goal_text(goal)
            if not text:
                continue
            goal_id_seed = f"{agent_id}:{bucket}:{text}"
            intent = _live_agent_loop_goal_intent(text)
            goals.append({
                "id": f"resident.{bucket}.{hashlib.sha1(goal_id_seed.encode('utf-8')).hexdigest()[:10]}",
                "kind": "resident-profile",
                "bucket": bucket,
                "priority": round(max(0.12, base_priority - (index * 0.045)), 3),
                "intent": intent,
                "priorityClass": "active-goal" if bucket == "current" else "standing-goal",
                "reason": text[:260],
                "text": text,
            })
    if _live_agent_loop_plan_is_active(active_plan):
        step = _live_agent_loop_plan_current_step(active_plan)
        goals.append({
            "id": f"plan.resume.{active_plan.get('id')}",
            "kind": "plan",
            "planId": active_plan.get("id"),
            "loopActionId": (step or {}).get("loopActionId") if isinstance(step, dict) else active_plan.get("loopActionId"),
            "priority": 0.58 if active_plan.get("status") == "retrying" else 0.48,
            "reason": active_plan.get("operatorSummary") or "resume the active Live Mode plan",
        })
    for issue in (recent.get("issues") or [])[:4]:
        if not isinstance(issue, dict):
            continue
        goals.append({
            "id": issue.get("id") or f"issue.{issue.get('loopActionId')}",
            "kind": "issue",
            "status": "unresolved",
            "loopActionId": issue.get("loopActionId"),
            "priority": round(float(issue.get("priority") or LIVE_AGENT_ISSUE_PRIORITY), 3),
            "priorityClass": "blocking-issue",
            "failureStreak": issue.get("failureStreak"),
            "targetKey": issue.get("targetKey"),
            "reason": issue.get("reason") or "recent action did not complete",
            "suggestedLoopActionId": "investigate-blocking-issue",
        })
    for loop_id, summary in (recent.get("byAction") or {}).items():
        failures = int(summary.get("failed") or 0) + int(summary.get("expired") or 0) + int(summary.get("cancelled") or 0)
        if failures >= 2:
            goals.append({
                "id": f"reliability.recover.{loop_id}",
                "kind": "reliability",
                "loopActionId": loop_id,
                "priority": min(0.65, 0.22 * failures),
                "reason": f"{loop_id} recently ended unsuccessfully {failures} times",
            })
    goals.sort(key=lambda item: float(item.get("priority") or 0), reverse=True)
    return {
        "schemaVersion": "agent-live-mode-goal-frame/v2",
        "at": perception.get("at") if isinstance(perception, dict) else _utc_now_iso(),
        "agentId": agent_id,
        "context": context,
        "recentOutcomes": recent,
        "activePlan": active_plan,
        "goals": goals,
    }



def _live_agent_loop_action_defs_for_agent(agent_id, agent_state=None, resident_profile=None):
    """Base executable actions plus dynamic object-category affordances that
    the agent's goals or model intentions activated. The result is the safe
    executable surface for this agent this tick, not a fixed global menu."""
    return [*LIVE_AGENT_LOOP_ACTIONS, *_live_agent_loop_dynamic_action_defs(agent_id, agent_state, resident_profile)]


def _live_agent_loop_action_affordances(agent_id, agent_state):
    affordances = []
    for action_def in _live_agent_loop_action_defs_for_agent(agent_id, agent_state):
        selected = _live_agent_loop_find_action_target(action_def, agent_id=agent_id, agent_state=agent_state)
        selected_action = selected.get("action") if isinstance(selected, dict) and isinstance(selected.get("action"), dict) else action_def
        visible_contract = _live_agent_visible_action_contract(selected_action.get("actionType"))
        affordance = {
            "id": action_def.get("id"),
            "label": selected_action.get("label") or action_def.get("label"),
            "experience": selected_action.get("experience") or action_def.get("experience"),
            "actionType": selected_action.get("actionType"),
            "capabilityTag": selected_action.get("capabilityTag"),
            "need": selected_action.get("need") or action_def.get("need"),
            "autonomyKind": selected_action.get("autonomyKind") or action_def.get("autonomyKind"),
            "available": bool(selected),
            "visibility": {
                "schemaVersion": LIVE_AGENT_VISIBLE_ACTION_CONTRACT_VERSION,
                "policy": "visible-world-execution-required",
                "visibleInWorld": bool(visible_contract),
                "hiddenWorldMutationAllowed": False,
                "clientExecutor": visible_contract.get("clientExecutor") if visible_contract else None,
                "requiresMoveIntent": bool(visible_contract and visible_contract.get("requiresMoveIntent")),
                "requiresPhysicalAgentPresence": bool(visible_contract),
            },
        }
        if selected:
            affordance.update({
                "target": selected.get("target"),
                "buildingName": selected.get("buildingName"),
                "objectType": selected.get("objectType"),
                "availability": selected.get("availability"),
                "selected": selected,
            })
        else:
            affordance["reason"] = _live_agent_loop_unavailable_reason(action_def, agent_id)
        affordances.append(affordance)
    return affordances


##############################################################################
# LIVE AGENT MODE - LOCATION AWARENESS + ROUTE PROGRESS WATCHDOG
#
# Live agents must know where their body actually is, verify they are heading
# to the intended coordinates, detect being stuck, and recover by cancelling
# the stalled action so the next tick replans a fresh route.
##############################################################################

LIVE_AGENT_ROUTE_PROGRESS_SAMPLE_LIMIT = 12
LIVE_AGENT_ROUTE_PROGRESS_WINDOW_SEC = 75
LIVE_AGENT_ROUTE_PROGRESS_MIN_SAMPLES = 3
LIVE_AGENT_ROUTE_PROGRESS_MIN_IMPROVEMENT = 12.0  # API units (~1/3 tile)
LIVE_AGENT_ROUTE_ARRIVAL_RADIUS = 60.0


def _live_agent_runtime_positions():
    """Read live body positions from the realtime runtime document (shared /data mount)."""
    try:
        with open(os.path.join(DATA_DIR, "agent-runtime.json"), "r") as f:
            doc = json.load(f)
    except Exception:
        return {}
    agents = doc.get("agents") if isinstance(doc.get("agents"), dict) else {}
    positions = {}
    for agent_id, row in agents.items():
        if not isinstance(row, dict):
            continue
        x, y = row.get("x"), row.get("y")
        if not isinstance(x, (int, float)) or not isinstance(y, (int, float)):
            continue
        positions[str(agent_id)] = {
            "x": round(float(x), 2),
            "y": round(float(y), 2),
            "floor": row.get("floor"),
            "buildingId": row.get("buildingId") or "",
            "state": row.get("state"),
            "mode": row.get("mode"),
            "heading": row.get("heading"),
            "updatedAt": row.get("updatedAt"),
        }
    return positions


def _live_agent_runtime_position(agent_id):
    return _live_agent_runtime_positions().get(str(agent_id))


def _live_agent_building_local_api_point(building, local_x, local_z):
    if not isinstance(building, dict):
        return None
    base_x = _float_or_none(building.get("worldX") if building.get("worldX") is not None else building.get("x"))
    base_z = _float_or_none(building.get("worldY") if building.get("worldY") is not None else building.get("z"))
    width = _float_or_none(building.get("widthTiles") if building.get("widthTiles") is not None else building.get("width"))
    depth = _float_or_none(building.get("heightTiles") if building.get("heightTiles") is not None else building.get("depth"))
    if base_x is None or base_z is None or width is None or depth is None:
        return None
    try:
        lx = float(local_x)
        lz = float(local_z)
    except (TypeError, ValueError):
        return None
    rotation = int(round(_float_or_none(building.get("_rotation") if building.get("_rotation") is not None else building.get("rotation")) or 0)) % 360
    if rotation == 90:
        world_x = base_x + depth - lz
        world_z = base_z + lx
    elif rotation == 180:
        world_x = base_x + width - lx
        world_z = base_z + depth - lz
    elif rotation == 270:
        world_x = base_x + lz
        world_z = base_z + width - lx
    else:
        world_x = base_x + lx
        world_z = base_z + lz
    return {"x": world_x * LIVE_AGENT_LOOP_API_TILE, "y": world_z * LIVE_AGENT_LOOP_API_TILE}


def _live_agent_building_target_point(building):
    if not isinstance(building, dict):
        return None
    width = _float_or_none(building.get("widthTiles") if building.get("widthTiles") is not None else building.get("width")) or 10
    depth = _float_or_none(building.get("heightTiles") if building.get("heightTiles") is not None else building.get("depth")) or 8
    spec = building.get("doorSpec") if isinstance(building.get("doorSpec"), dict) else {}

    def clamp_number(value, minimum, maximum, fallback):
        parsed = _float_or_none(value)
        if parsed is None:
            return fallback
        return min(maximum, max(minimum, parsed))

    local_center_x = clamp_number(spec.get("localCenterX"), 0, width, max(1, min(width - 1, width / 2)))
    local_interior_z = clamp_number(spec.get("localInteriorZ"), 0.2, max(0.2, depth - 0.2), max(0.45, depth - 1.2))
    return _live_agent_building_local_api_point(building, local_center_x, local_interior_z)


def _live_agent_loop_street_sidewalk_tile(wx, wz, streets=None):
    try:
        x = int(round(float(wx)))
        z = int(round(float(wz)))
    except (TypeError, ValueError):
        return False
    sidewalk = False
    if streets is None:
        meta = load_world_meta()
        streets = ensure_checkpoint_streets(meta, persist=False)
    for street in streets if isinstance(streets, list) else []:
        if not isinstance(street, dict):
            continue
        x1 = _float_or_none(street.get("x1"))
        z1 = _float_or_none(street.get("z1"))
        x2 = _float_or_none(street.get("x2"))
        z2 = _float_or_none(street.get("z2"))
        if x1 is None or z1 is None:
            continue
        if street.get("type"):
            dx = abs(x - int(round(x1)))
            dz = abs(z - int(round(z1)))
            if dx <= 4 and dz <= 4:
                return False
            if dx <= 6 and dz <= 6:
                sidewalk = True
            continue
        if x2 is None or z2 is None:
            continue
        min_x, max_x = sorted((int(round(x1)), int(round(x2))))
        min_z, max_z = sorted((int(round(z1)), int(round(z2))))
        horizontal = abs(x2 - x1) >= abs(z2 - z1)
        if horizontal:
            if min_x <= x <= max_x:
                dz = abs(z - int(round(z1)))
                if dz <= 1:
                    return False
                if dz <= 3:
                    sidewalk = True
            if (abs(x - int(round(x1))) <= 3 or abs(x - int(round(x2))) <= 3) and abs(z - int(round(z1))) <= 3:
                if abs(z - int(round(z1))) <= 1:
                    return False
                sidewalk = True
        else:
            if min_z <= z <= max_z:
                dx = abs(x - int(round(x1)))
                if dx <= 1:
                    return False
                if dx <= 3:
                    sidewalk = True
            if (abs(z - int(round(z1))) <= 3 or abs(z - int(round(z2))) <= 3) and abs(x - int(round(x1))) <= 3:
                if abs(x - int(round(x1))) <= 1:
                    return False
                sidewalk = True
    return sidewalk


def _live_agent_loop_nearest_street_sidewalk_tile(wx, wz, radius=96):
    try:
        x = int(round(float(wx)))
        z = int(round(float(wz)))
    except (TypeError, ValueError):
        return None
    meta = load_world_meta()
    streets = ensure_checkpoint_streets(meta, persist=False)
    best = None
    best_dist = float("inf")
    r = max(1, int(radius or 96))
    for dz in range(-r, r + 1):
        for dx in range(-r, r + 1):
            if not _live_agent_loop_street_sidewalk_tile(x + dx, z + dz, streets=streets):
                continue
            dist = dx * dx + dz * dz
            if dist < best_dist:
                best = {"x": x + dx, "y": z + dz}
                best_dist = dist
    return best


def _live_agent_loop_construction_route_point(action, source, fallback):
    if str((action or {}).get("actionType") or (action or {}).get("actionId") or "") != "world.buildStructure":
        return None
    target = (action or {}).get("target") if isinstance((action or {}).get("target"), dict) else {}
    route = (action or {}).get("route") if isinstance((action or {}).get("route"), dict) else {}
    route_target = route.get("target") if isinstance(route.get("target"), dict) else {}
    params = (action or {}).get("params") if isinstance((action or {}).get("params"), dict) else {}
    site = None
    for candidate in (params.get("buildSite"), source.get("buildSite") if isinstance(source, dict) else None, target.get("buildSite"), route_target.get("buildSite")):
        if isinstance(candidate, dict):
            site = candidate
            break
    if not site:
        return None
    street_approach = site.get("streetApproach") if isinstance(site.get("streetApproach"), dict) else None
    if not street_approach and isinstance(source, dict) and isinstance(source.get("streetApproach"), dict):
        street_approach = source.get("streetApproach")
    approach_tile = street_approach.get("approachTile") if isinstance(street_approach, dict) and isinstance(street_approach.get("approachTile"), dict) else None
    if approach_tile:
        tile_x = _float_or_none(approach_tile.get("x"))
        tile_y = _float_or_none(approach_tile.get("y") if approach_tile.get("y") is not None else approach_tile.get("z"))
        if tile_x is not None and tile_y is not None:
            return {
                "x": float(tile_x) * LIVE_AGENT_LOOP_API_TILE,
                "y": float(tile_y) * LIVE_AGENT_LOOP_API_TILE,
                "kind": "world-point",
                "buildingId": "",
                "constructionApproachSource": street_approach.get("source") or "street-approach",
            }
    raw_x = _float_or_none((fallback or {}).get("x")) if isinstance(fallback, dict) else None
    raw_y = _float_or_none((fallback or {}).get("y")) if isinstance(fallback, dict) else None
    if raw_x is not None and raw_y is not None:
        tile_x = round(raw_x / LIVE_AGENT_LOOP_API_TILE)
        tile_y = round(raw_y / LIVE_AGENT_LOOP_API_TILE)
    else:
        tile_x = round((_float_or_none(site.get("worldX")) or 0) + ((_float_or_none(site.get("widthTiles")) or 10) / 2))
        tile_y = round((_float_or_none(site.get("worldY")) or 0) + (_float_or_none(site.get("heightTiles")) or 8) + 2)
    sidewalk = _live_agent_loop_nearest_street_sidewalk_tile(tile_x, tile_y, radius=96)
    if not sidewalk:
        return None
    return {
        "x": float(sidewalk["x"]) * LIVE_AGENT_LOOP_API_TILE,
        "y": float(sidewalk["y"]) * LIVE_AGENT_LOOP_API_TILE,
        "kind": "world-point",
        "buildingId": "",
        "constructionApproachSource": "nearest-sidewalk-construction-route",
    }


def _live_agent_action_target_point(action):
    """Resolve the intended world coordinates of an active world action."""
    if not isinstance(action, dict):
        return None
    target = action.get("target") if isinstance(action.get("target"), dict) else {}
    route = action.get("route") if isinstance(action.get("route"), dict) else {}
    for source in (route.get("finalTarget"), route.get("target"), target, target.get("point")):
        if not isinstance(source, dict):
            continue
        x, y = source.get("x"), source.get("y")
        if isinstance(x, (int, float)) and isinstance(y, (int, float)):
            raw = {"x": float(x), "y": float(y), "kind": target.get("kind"), "buildingId": target.get("buildingId") or source.get("buildingId") or ""}
            return _live_agent_loop_construction_route_point(action, source, raw) or raw
    target_kind = str(target.get("kind") or target.get("targetKind") or "").strip()
    if target_kind in {"building", "room", "agent-home-building"}:
        building_id = target.get("buildingId")
        building = load_building(building_id) if building_id else None
        point = _live_agent_building_target_point(building)
        if point:
            return {
                "x": float(point["x"]),
                "y": float(point["y"]),
                "kind": target_kind or "building",
                "buildingId": building.get("id") or building_id or "",
            }
    return None


def _live_agent_loop_location_frame(agent_id, active_records=None):
    """Location awareness frame: where the body is, where it should be heading,
    and how far away that is. Used by perception and the route progress watchdog."""
    position = _live_agent_runtime_position(agent_id)
    frame = {
        "schemaVersion": "agent-live-mode-location/v1",
        "position": position,
        "positionSource": "realtime-runtime-document" if position else "unavailable",
        "activeTarget": None,
        "distanceToTarget": None,
        "coordinateSystem": "api-units (1 tile = 40 units, origin-centered world plane)",
    }
    records = active_records if isinstance(active_records, list) else _active_behavior_records_for_agent(agent_id)
    for item in records:
        record = item.get("record") if isinstance(item.get("record"), dict) else None
        point = _live_agent_action_target_point(record)
        if point:
            frame["activeTarget"] = {**point, "worldActionId": item.get("id"), "status": item.get("status")}
            break
    if position and frame["activeTarget"]:
        frame["distanceToTarget"] = round(math.hypot(position["x"] - frame["activeTarget"]["x"], position["y"] - frame["activeTarget"]["y"]), 2)
    return frame


def _live_agent_loop_monitor_route_progress(state, agent_id, agent_state, active_records, now_epoch, now_iso):
    """Watchdog: sample distance-to-target while an agent-live-mode action routes.
    If the agent stops making progress toward the intended coordinates, cancel the
    stalled action so the next tick replans with a fresh route/target."""
    routing_record = None
    for item in active_records:
        if item.get("behaviorSourceKind") != "agent-live-mode":
            continue
        if item.get("type") == "world-action" and item.get("status") in {"route_pending", "routing"}:
            routing_record = item
            break
    if not routing_record:
        agent_state.pop("routeProgress", None)
        return None

    location = _live_agent_loop_location_frame(agent_id, active_records)
    position = location.get("position")
    target = location.get("activeTarget")
    distance = location.get("distanceToTarget")
    if not position or not target or distance is None:
        return None

    progress = agent_state.get("routeProgress") if isinstance(agent_state.get("routeProgress"), dict) else None
    if not progress or progress.get("worldActionId") != routing_record.get("id"):
        progress = {"worldActionId": routing_record.get("id"), "samples": [], "startedAt": now_iso}
    samples = [s for s in progress.get("samples", []) if isinstance(s, dict)]
    samples.append({"atEpoch": round(now_epoch, 1), "distance": distance, "x": position["x"], "y": position["y"]})
    samples = samples[-LIVE_AGENT_ROUTE_PROGRESS_SAMPLE_LIMIT:]
    progress["samples"] = samples
    progress["lastDistance"] = distance
    progress["lastCheckedAt"] = now_iso
    agent_state["routeProgress"] = progress

    if distance <= LIVE_AGENT_ROUTE_ARRIVAL_RADIUS:
        return None
    window = [s for s in samples if now_epoch - float(s.get("atEpoch") or 0) <= LIVE_AGENT_ROUTE_PROGRESS_WINDOW_SEC]
    if len(window) < LIVE_AGENT_ROUTE_PROGRESS_MIN_SAMPLES:
        return None
    span_sec = now_epoch - float(window[0].get("atEpoch") or now_epoch)
    if span_sec < LIVE_AGENT_ROUTE_PROGRESS_WINDOW_SEC * 0.8:
        return None
    best_earlier = max(float(s.get("distance") or 0) for s in window[:-1])
    improvement = best_earlier - distance
    if improvement >= LIVE_AGENT_ROUTE_PROGRESS_MIN_IMPROVEMENT:
        return None

    # Stuck: no meaningful progress toward the intended coordinates.
    detail = {
        "agentId": agent_id,
        "worldActionId": routing_record.get("id"),
        "distance": distance,
        "improvement": round(improvement, 2),
        "windowSec": round(span_sec, 1),
        "samples": len(window),
        "target": {k: target.get(k) for k in ("x", "y", "kind", "buildingId")},
        "position": {k: position.get(k) for k in ("x", "y", "buildingId")},
    }
    ok, response, status_code = cancel_world_action(routing_record.get("id"), {
        "failureReason": "cancelled_by_system",
        "reason": "cancelled_by_system",
        "actor": "live-mode-route-watchdog",
        "source": "agent-live-mode",
        "result": {"status": "cancelled", "reason": "no_route_progress", "watchdog": detail},
    })
    detail["cancelled"] = bool(ok)
    detail["httpStatus"] = status_code
    agent_state.pop("routeProgress", None)
    agent_state["nextAllowedAt"] = _epoch_to_utc_iso(now_epoch + 20)
    _live_agent_loop_stat(agent_state, "routeWatchdogCancels")
    _live_agent_loop_add_event(state, "route-watchdog-cancel", agent_id=agent_id, details=detail)
    _live_agent_loop_add_feedback(state, agent_id, "warn", "Route made no progress toward the intended coordinates; the action was cancelled so the agent can replan.", detail)
    return detail


def _live_agent_loop_build_perception(agent_id, agent_state, world_client=None, now_epoch=None):
    now_epoch = float(now_epoch or time.time())
    needs = _live_agent_loop_update_needs(agent_state, now_epoch)
    active = _active_behavior_records_for_agent(agent_id)
    affordances = _live_agent_loop_action_affordances(agent_id, agent_state)
    recent_actions = _live_agent_loop_recent_world_actions(agent_id)
    memory = agent_state.get("memory") if isinstance(agent_state.get("memory"), dict) else {}
    social = _live_agent_loop_social_perception(agent_id)
    resident_context = _live_agent_loop_resident_profile_context(_live_agent_loop_resident_profile(agent_id, persist=True))
    location = _live_agent_loop_location_frame(agent_id, active)
    live_world = _agent_live_world_claim_payload(agent_id)
    perception = {
        "schemaVersion": "agent-live-mode-perception/v1",
        "at": _epoch_to_utc_iso(now_epoch),
        "agent": _live_agent_loop_agent_snapshot(agent_id),
        "location": location,
        "liveWorld": live_world,
        "worldClient": world_client if isinstance(world_client, dict) else _live_agent_loop_world_client_status(),
        "needs": needs,
        "active": [{k: item.get(k) for k in ("type", "id", "status", "worldActionId", "behaviorSourceKind")} for item in active],
        "affordances": [{k: v for k, v in affordance.items() if k != "selected"} for affordance in affordances],
        "recentWorldActions": recent_actions,
        "visibleActionContract": _live_agent_visible_action_policy(),
        "social": social,
        "memory": {
            "recentActions": _live_agent_loop_trim_list(memory.get("recentActions"), 8),
            "observations": _live_agent_loop_trim_list(memory.get("observations"), 6),
            "reflections": _live_agent_loop_trim_list(memory.get("reflections"), 6),
        },
        "residentProfile": resident_context,
        "world": _live_agent_loop_world_summary(),
    }
    agent_state["lastPerception"] = {
        "at": perception["at"],
        "needs": needs,
        "availableActionIds": [item["id"] for item in affordances if item.get("available")],
        "activeCount": len(active),
        "recentWorldActionIds": [item.get("id") for item in recent_actions[:4]],
        "social": {k: social.get(k) for k in ("knownAgentCount", "liveEnabledPeerCount", "nearbyAgentCount")},
        "liveWorld": {k: live_world.get(k) for k in ("currentWorld", "conflict", "notice")},
    }
    return perception


def _live_agent_loop_decision_score(affordance, agent_state, goal_frame=None):
    need_key = affordance.get("need") or "curiosity"
    needs = agent_state.get("needs") if isinstance(agent_state.get("needs"), dict) else LIVE_AGENT_LOOP_NEED_DEFAULTS
    goal_frame = goal_frame if isinstance(goal_frame, dict) else {}
    context = goal_frame.get("context") if isinstance(goal_frame.get("context"), dict) else {}
    personality = context.get("personality") if isinstance(context.get("personality"), dict) else {}
    recent = goal_frame.get("recentOutcomes") if isinstance(goal_frame.get("recentOutcomes"), dict) else {}
    loop_action_id = affordance.get("id")
    need_value = float(needs.get(need_key, 0.3))
    personality_multiplier = _live_agent_loop_personality_multiplier(need_key, personality)
    score = 0.25 + (need_value * personality_multiplier)
    need_items = []
    for key, value in (needs or {}).items():
        try:
            need_items.append((key, float(value or 0)))
        except (TypeError, ValueError):
            continue
    top_need_key, top_need_value = max(need_items, key=lambda item: item[1], default=(need_key, need_value))
    breakdown = {
        "base": 0.25,
        "need": round(need_value, 3),
        "personalityMultiplier": personality_multiplier,
        "urgency": 0,
        "goalAlignment": 0,
        "issues": 0,
        "context": 0,
        "plan": 0,
        "recentMemory": 0,
        "reliability": 0,
    }
    if top_need_value >= LIVE_AGENT_CRITICAL_NEED_THRESHOLD:
        if need_key == top_need_key:
            boost = 0.62 + min(0.18, (top_need_value - LIVE_AGENT_CRITICAL_NEED_THRESHOLD) * 0.9)
            score += boost
            breakdown["urgency"] += boost
        elif top_need_key in {"hydration", "food", "energy"} and affordance.get("id") != "investigate-blocking-issue":
            penalty = 0.36
            score -= penalty
            breakdown["urgency"] -= penalty
    elif top_need_value >= LIVE_AGENT_HIGH_NEED_THRESHOLD and need_key == top_need_key:
        boost = 0.28
        score += boost
        breakdown["urgency"] += boost
    memory = agent_state.get("memory") if isinstance(agent_state.get("memory"), dict) else {}
    recent_ids = [item.get("loopActionId") for item in _live_agent_loop_trim_list(memory.get("recentActions"), 6)]
    if recent_ids and loop_action_id == recent_ids[-1]:
        score -= 0.42
        breakdown["recentMemory"] -= 0.42
    elif loop_action_id in recent_ids:
        score -= 0.18
        breakdown["recentMemory"] -= 0.18
    if need_key in {"curiosity", "maintenance"}:
        score += 0.08
        breakdown["context"] += 0.08
    for goal in goal_frame.get("goals") or []:
        if not isinstance(goal, dict):
            continue
        priority = float(goal.get("priority") or 0)
        if goal.get("kind") == "need" and goal.get("need") == need_key:
            boost = min(0.24, priority * 0.16)
            score += boost
            breakdown["goalAlignment"] += boost
        if goal.get("kind") == "resident-profile":
            boost = _live_agent_loop_resident_profile_goal_boost(goal, affordance)
            if boost:
                score += boost
                breakdown["goalAlignment"] += boost
        if goal.get("kind") == "issue":
            if loop_action_id == "investigate-blocking-issue":
                boost = min(0.95, max(0.58, priority))
                if top_need_value >= LIVE_AGENT_CRITICAL_NEED_THRESHOLD and top_need_key in {"hydration", "food", "energy"}:
                    boost *= 0.55
                score += boost
                breakdown["issues"] += boost
            elif goal.get("loopActionId") == loop_action_id:
                penalty = min(0.90, max(0.24, priority * 0.72))
                score -= penalty
                breakdown["issues"] -= penalty
        if goal.get("id") == "home.establish-shelter" and loop_action_id == "build-small-home-site":
            score += 0.34
            breakdown["context"] += 0.34
        if goal.get("id") == "home.use-owned-home" and loop_action_id == "rest-at-home":
            score += 0.18
            breakdown["context"] += 0.18
        if goal.get("id") == "work.visit-assigned-work" and need_key in {"maintenance", "curiosity"}:
            score += 0.08
            breakdown["context"] += 0.08
        if goal.get("id") == "social.perceive-nearby-agent" and loop_action_id == "talk-with-nearby-agent":
            score += 0.36
            breakdown["context"] += 0.36
        if goal.get("id") == "social.maintain-relationships" and loop_action_id == "talk-with-nearby-agent":
            score += 0.16
            breakdown["context"] += 0.16
        if goal.get("kind") == "reliability" and goal.get("loopActionId") == loop_action_id:
            penalty = min(0.85, max(0.16, priority))
            score -= penalty
            breakdown["reliability"] -= penalty
        if goal.get("kind") == "plan" and goal.get("loopActionId") == loop_action_id:
            boost = min(0.70, max(0.24, priority))
            score += boost
            breakdown["plan"] += boost
    action_summary = (recent.get("byAction") or {}).get(loop_action_id) if isinstance(recent.get("byAction"), dict) else None
    if isinstance(action_summary, dict):
        completed = int(action_summary.get("completed") or 0)
        unsuccessful = int(action_summary.get("failed") or 0) + int(action_summary.get("expired") or 0) + int(action_summary.get("cancelled") or 0)
        failure_streak = int(action_summary.get("recentFailureStreak") or 0)
        target_key = _live_agent_loop_target_key(affordance.get("target"))
        target_failures = (action_summary.get("targetFailures") or {}).get(target_key) if target_key and isinstance(action_summary.get("targetFailures"), dict) else None
        if isinstance(target_failures, dict) and int(target_failures.get("total") or 0) > 0:
            penalty = min(1.35, 0.55 + (0.25 * int(target_failures.get("total") or 0)))
            score -= penalty
            breakdown["reliability"] -= penalty
        if completed and not unsuccessful:
            score += 0.06
            breakdown["reliability"] += 0.06
        elif unsuccessful:
            penalty = min(1.15, (unsuccessful * 0.18) + (failure_streak * 0.20))
            score -= penalty
            breakdown["reliability"] -= penalty
    breakdown = {key: round(value, 3) if isinstance(value, (int, float)) else value for key, value in breakdown.items()}
    return round(score, 3), breakdown


def _live_agent_loop_build_decision_frame(agent_id, perception, agent_state):
    goal_frame = _live_agent_loop_build_goal_frame(agent_id, perception, agent_state)
    candidates = []
    for affordance in perception.get("affordances", []):
        if not affordance.get("available"):
            candidates.append({**affordance, "score": 0, "decision": "unavailable"})
            continue
        score, score_breakdown = _live_agent_loop_decision_score(affordance, agent_state, goal_frame)
        candidates.append({**affordance, "score": score, "scoreBreakdown": score_breakdown, "decision": "candidate"})
    available = [candidate for candidate in candidates if candidate.get("decision") == "candidate"]
    available.sort(key=lambda item: (float(item.get("score") or 0), item.get("id") or ""), reverse=True)
    selected = available[0] if available else None
    top_need = max((perception.get("needs") or {}).items(), key=lambda item: item[1], default=("curiosity", 0))
    frame = {
        "schemaVersion": "agent-live-mode-decision/v1",
        "at": perception.get("at"),
        "agentId": agent_id,
        "mode": LIVE_AGENT_LOOP_DEFAULTS["decisionMode"],
        "modelReady": True,
        "goalFrame": goal_frame,
        "visibleActionContract": {
            "schemaVersion": LIVE_AGENT_VISIBLE_ACTION_CONTRACT_VERSION,
            "policy": "visible-world-execution-required",
            "hiddenWorldMutationAllowed": False,
            "proposalOnlyCapabilityIds": [item.get("id") for item in LIVE_AGENT_PROPOSAL_ONLY_CAPABILITIES],
        },
        "topNeed": {"id": top_need[0], "value": top_need[1]},
        "selectedActionId": selected.get("id") if selected else None,
        "selectedActionLabel": selected.get("label") if selected else None,
        "score": selected.get("score") if selected else 0,
        "candidates": candidates,
        "prompt": "Choose one available visible in-world action for the agent from this planner-v2 frame. Consider needs, personality, Resident Profile identity/goals/memory, relationships, home/work context, recent outcomes, active plans, physical presence, visible executor availability, and safe pacing. Return a loopActionId from candidates or skip. Social talk is executable only when social perception reports a nearby visible agent target. Home rest is executable only by physically routing to the agent-owned home. Small-home construction is executable only through the visible construction-site executor; arbitrary build/modify/move/delete world changes remain proposal-only until typed visible executors exist.",
        "reason": f"{selected.get('label')} best matches planner-v2 goals for {selected.get('need')}" if selected else "no available candidates",
    }
    agent_state["lastDecision"] = {k: frame.get(k) for k in ("at", "mode", "topNeed", "selectedActionId", "selectedActionLabel", "score", "reason")}
    agent_state["lastDecision"]["goalIds"] = [item.get("id") for item in goal_frame.get("goals", [])[:6]]
    return frame


##############################################################################
# LIVE AGENT MODE - MODEL DECISION LAYER (model-intention-v2)
#
# The agent's own OpenClaw model decides an INTENTION: what it wants to do
# next given identity, goals, needs, memories, issues, and location. The
# intention may (a) name an available interaction id, (b) request an object
# CATEGORY (e.g. seating) that the affordance layer resolves into a real
# reachable world object next tick, or (c) skip. Legacy ACTION: <id> replies
# still parse as a fallback. The model can never invent raw world mutations:
# all execution still flows through the validated visible-action contract,
# so intentions only influence WHICH safe interaction runs, never HOW the
# world is mutated. Planner sessions are deleted after each decision so
# internal prompts do not pollute the agent's memory/dreaming.
##############################################################################

def _live_agent_model_decision_config(state=None):
    state = state if isinstance(state, dict) else get_live_agent_loop_state()
    return {
        "enabled": bool(state.get("modelDecisionEnabled", LIVE_AGENT_LOOP_DEFAULTS["modelDecisionEnabled"])),
        "timeoutSec": _normalize_int(state.get("modelDecisionTimeoutSec"), LIVE_AGENT_LOOP_DEFAULTS["modelDecisionTimeoutSec"], minimum=10, maximum=180),
        "minIntervalSec": _normalize_int(state.get("modelDecisionMinIntervalSec"), LIVE_AGENT_LOOP_DEFAULTS["modelDecisionMinIntervalSec"], minimum=30, maximum=3600),
    }


def _live_agent_model_decision_provider_kind(agent_id):
    try:
        for agent in get_roster():
            if agent.get("id") == agent_id or agent.get("statusKey") == agent_id:
                return str(agent.get("providerKind") or "").lower()
    except Exception:
        pass
    return ""


def _live_agent_model_memory_lines(agent_state, limit=8):
    memory = agent_state.get("memory") if isinstance(agent_state.get("memory"), dict) else {}
    recent = [item for item in (memory.get("recentActions") or []) if isinstance(item, dict)]
    failures = [item for item in recent if _canonical_world_action_status(item.get("status")) in {"failed", "expired", "cancelled"}]
    ordered = []
    seen = set()
    for item in [*failures[-limit:], *recent[-limit:]]:
        key = item.get("settledActionKey") or item.get("actionId") or json.dumps(item, sort_keys=True, default=str)[:120]
        if key in seen:
            continue
        seen.add(key)
        ordered.append(item)
    lines = []
    for item in ordered[-limit:]:
        loop_id = item.get("loopActionId") or item.get("actionType") or "action"
        status = _canonical_world_action_status(item.get("status")) or "unknown"
        label = item.get("label") or loop_id
        failure = item.get("failure") if isinstance(item.get("failure"), dict) else {}
        text = f"{loop_id} ({label}) {status}"
        if failure.get("learningText"):
            text = f"{text}: {failure.get('learningText')}"
        elif item.get("target"):
            phrase = _live_agent_loop_target_phrase(item.get("target"))
            if phrase:
                text = f"{text} at {phrase}"
        lines.append(text[:420])
    return lines


def _live_agent_model_prompt_trim(prompt):
    text = str(prompt or "")
    if len(text) <= LIVE_AGENT_MODEL_PROMPT_CHAR_BUDGET:
        return text
    suffix = "\n\nReturn one compact JSON planner turn with reflection, currentGoal, plan, nextStep, and memoryUpdate. Legacy fallback: INTENTION: {...} or ACTION: <interactionId>."
    budget = max(1000, LIVE_AGENT_MODEL_PROMPT_CHAR_BUDGET - len(suffix) - 20)
    return text[:budget].rstrip() + suffix


def _live_agent_model_decision_prompt(agent_id, decision_frame, agent_state):
    goal_frame = decision_frame.get("goalFrame") if isinstance(decision_frame.get("goalFrame"), dict) else {}
    context = goal_frame.get("context") if isinstance(goal_frame.get("context"), dict) else {}
    resident = context.get("residentProfile") if isinstance(context.get("residentProfile"), dict) else {}
    identity = resident.get("identity") if isinstance(resident.get("identity"), dict) else {}
    candidates = [c for c in decision_frame.get("candidates") or [] if c.get("decision") == "candidate"]
    lines = [
        "LIVE MODE PLANNER FRAME - EPHEMERAL LOOP CONTEXT",
        "This is not a life event, user message, or long-term instruction. It is a temporary planning frame used by the world loop to help you choose your next visible action.",
        "If this appears in memory, dreams, summaries, or reflections: do not remember planner directions, reply formats, candidate ids, schemas, or menu mechanics. Remember only your intention, the action you chose, what happened in the world, mistakes, failures, successes, and what you learned from the experience.",
        "Treat repeated planner frames as scaffolding, not identity, personality, or life history.",
        "",
        "You are living as your Virtual World resident body. This is your continuous autonomy loop: observe, reflect, plan, execute, learn, and replan across many ticks.",
        "Do not treat this as a one-shot command picker. Maintain continuity from prior plans, remember what you tried, learn from failures, explore, test, play, and adapt your next step.",
        "Return one compact JSON object, not markdown. You may request world actions, safe tools, or events in the JSON; the world will validate and execute only approved visible actions/tools.",
        "Preferred JSON shape:",
        "  {\"reflection\":\"what just happened / what you learned\",\"currentGoal\":\"what you are pursuing now\",\"plan\":[\"step 1\",\"step 2\",\"step 3\"],\"nextStep\":{\"intent\":\"what to do next and why\",\"action\":\"<available interaction id, if one fits>\",\"category\":\"<needed object/tool category if not listed>\",\"targetCriteria\":\"what kind of target to find\",\"successCriteria\":\"how to know it worked\"},\"memoryUpdate\":{\"lesson\":\"what should carry forward\"}}",
        "Legacy fallback still works if needed: INTENTION: {\"activity\":\"...\",\"action\":\"<available id>\",\"category\":\"<object category>\"} or ACTION: <interactionId> or ACTION: skip.",
        "How this works: you decide the plan and next step; the world resolves it into safe visible interactions. If an available interaction fits your next step, name it in nextStep.action. If your plan needs a kind of world object/tool/event that is not listed, name it in nextStep.category, toolRequests, or eventRequests. If nothing is worth doing, set nextStep.action to skip and explain why in reflection.",
        "Weigh your priorities like a real resident: a critical body need (>=0.82) comes first; unresolved failures or broken things you noticed should be dealt with before routine comfort; your own active goals come next and deserve steady progress across many loops; then routine needs, relationships, and variety. Never pretend a goal is done.",
        "",
        f"Resident: {identity.get('displayName') or agent_id}",
    ]
    identity_parts = [identity.get("role"), identity.get("archetype"), identity.get("lifePurpose")]
    identity_text = "; ".join(str(part).strip() for part in identity_parts if str(part or "").strip())
    if identity_text:
        lines.append(f"Identity: {identity_text[:420]}")
    location = _live_agent_loop_location_frame(agent_id)
    position = location.get("position")
    if position:
        where = f"({position['x']}, {position['y']})"
        if position.get("buildingId"):
            where += f" inside building {position['buildingId']}"
        lines.append(f"Current body position: {where} (api-units; 1 tile = 40 units)")
    live_world = _agent_live_world_claim_payload(agent_id)
    current_world = live_world.get("currentWorld") if isinstance(live_world.get("currentWorld"), dict) else {}
    if current_world:
        lines.append(f"Live Agent world: {current_world.get('worldName') or 'Virtual World'} on port {current_world.get('port') or PUBLIC_HOST_PORT} ({current_world.get('publicOrigin') or PUBLIC_ORIGIN})")
    if live_world.get("conflict") and live_world.get("notice"):
        lines.append(f"Live Agent world conflict: {live_world.get('notice')}")
    needs = decision_frame.get("topNeed") or {}
    lines.append(f"Most pressing need: {needs.get('id')} ({round(float(needs.get('value') or 0), 2)})")
    goals = [g for g in goal_frame.get("goals") or [] if isinstance(g, dict)][:7]
    if goals:
        lines.append("Weighted priorities:")
        for g in goals:
            reason = str(g.get("text") or g.get("reason") or g.get("id") or "").replace("\n", " ").strip()
            detail = f"kind={g.get('kind')} priority={round(float(g.get('priority') or 0), 2)}"
            if g.get("bucket"):
                detail += f" bucket={g.get('bucket')}"
            if g.get("intent"):
                detail += f" intent={g.get('intent')}"
            if g.get("loopActionId"):
                detail += f" action={g.get('loopActionId')}"
            lines.append(f"- {detail}: {reason[:360]}")
    issues = [item for item in (goal_frame.get("recentOutcomes") or {}).get("issues") or [] if isinstance(item, dict)][:4]
    if issues:
        lines.append("Unresolved issues/blockers:")
        for issue in issues:
            lines.append(f"- {issue.get('loopActionId')} streak={issue.get('failureStreak')} priority={issue.get('priority')}: {str(issue.get('reason') or '')[:280]}")
    memory_lines = _live_agent_model_memory_lines(agent_state, limit=8)
    if memory_lines:
        lines.append("Important short-term memory (treat failures as learning constraints; avoid same failed target unless conditions changed):")
        for line in memory_lines:
            lines.append(f"- {line}")
    goal_progress = agent_state.get("goalProgress") if isinstance(agent_state.get("goalProgress"), dict) else {}
    progress_lines = []
    for key, row in list(goal_progress.items())[:4]:
        if not isinstance(row, dict):
            continue
        done = row.get("completedTargets") if isinstance(row.get("completedTargets"), list) else []
        failed = row.get("failedTargets") if isinstance(row.get("failedTargets"), list) else []
        progress_lines.append(f"- {key}: {len(done)} target(s) done, {len(failed)} failed; recent: {', '.join(done[-3:]) or 'none yet'}")
    if progress_lines:
        lines.append("Goal progress so far (prefer targets you have not done yet):")
        lines.extend(progress_lines)
    autonomy_plan = _live_agent_loop_normalize_autonomy_plan(agent_state.get("autonomyPlan"))
    if autonomy_plan:
        lines.append("Active autonomy plan carried from prior loop:")
        if autonomy_plan.get("reflection"):
            lines.append(f"- Last reflection: {autonomy_plan.get('reflection')[:520]}")
        if autonomy_plan.get("currentGoal"):
            lines.append(f"- Current goal: {autonomy_plan.get('currentGoal')[:420]}")
        if autonomy_plan.get("steps"):
            for index, step in enumerate(autonomy_plan.get("steps")[:6], start=1):
                lines.append(f"- Plan step {index}: {step}")
        next_step = autonomy_plan.get("nextStep") if isinstance(autonomy_plan.get("nextStep"), dict) else {}
        if next_step:
            lines.append(f"- Previous next step: {next_step.get('intent') or next_step.get('action') or next_step.get('category')}")
    lines.append("")
    lines.append("Available interactions right now (real reachable targets; you may also request a category instead):")
    for c in candidates[:12]:
        breakdown = c.get("scoreBreakdown") if isinstance(c.get("scoreBreakdown"), dict) else {}
        reason_bits = []
        for key in ("urgency", "issues", "goalAlignment", "plan", "reliability"):
            value = breakdown.get(key)
            if isinstance(value, (int, float)) and value:
                reason_bits.append(f"{key}={value}")
        why = f"; {' '.join(reason_bits)}" if reason_bits else ""
        target = c.get("target") if isinstance(c.get("target"), dict) else {}
        target_text = ""
        if target:
            target_label = target.get("catalogId") or target.get("buildingId") or target.get("kind")
            target_text = f", target: {target_label}" if target_label else ""
        lines.append(f"- {c.get('id')}: {c.get('label')} (need: {c.get('need')}, actionType: {c.get('actionType')}, planner score: {c.get('score')}{target_text}{why})")
    lines.append("")
    lines.append("Decide as yourself. Return one compact JSON planner turn with reflection, currentGoal, plan, nextStep, and memoryUpdate. Keep it concise but preserve continuity.")
    return _live_agent_model_prompt_trim("\n".join(lines))


def _live_agent_model_json_object_parse(reply_text):
    text = str(reply_text or "").strip()
    if not text:
        return None
    if text.startswith("```"):
        text = re.sub(r"^```(?:json)?\s*", "", text, flags=re.IGNORECASE).strip()
        text = re.sub(r"\s*```$", "", text).strip()
    text = re.sub(r"^(?:PLANNER|PLAN|AUTONOMY|JSON)\s*:\s*", "", text, flags=re.IGNORECASE).strip()
    candidates = [text]
    start = text.find("{")
    end = text.rfind("}")
    if start >= 0 and end > start:
        candidates.append(text[start:end + 1])
    decoder = json.JSONDecoder()
    for raw in candidates:
        raw = raw.strip()
        if not raw:
            continue
        try:
            parsed = json.loads(raw)
        except (TypeError, ValueError):
            try:
                parsed, _ = decoder.raw_decode(raw)
            except (TypeError, ValueError):
                continue
        if isinstance(parsed, dict):
            return parsed
    return None


def _live_agent_model_planner_turn_parse(reply_text):
    parsed = _live_agent_model_json_object_parse(reply_text)
    if not isinstance(parsed, dict):
        return None
    next_step = parsed.get("nextStep") or parsed.get("next_step") or parsed.get("next") or {}
    next_step = _live_agent_loop_normalize_next_step(next_step)
    planner_turn = {
        "reflection": _live_agent_loop_clean_plan_text(parsed.get("reflection") or parsed.get("reflect"), limit=900) or "",
        "currentGoal": _live_agent_loop_clean_plan_text(parsed.get("currentGoal") or parsed.get("current_goal") or parsed.get("goal"), limit=700) or "",
        "plan": _live_agent_loop_normalize_text_list(parsed.get("plan") or parsed.get("steps"), limit=10, item_limit=320),
        "nextStep": next_step,
        "memoryUpdate": parsed.get("memoryUpdate") if isinstance(parsed.get("memoryUpdate"), dict) else {},
        "toolRequests": _live_agent_loop_normalize_text_list(parsed.get("toolRequests") or parsed.get("requestedTools") or parsed.get("tools"), limit=5, item_limit=260),
        "eventRequests": _live_agent_loop_normalize_text_list(parsed.get("eventRequests") or parsed.get("requestedEvents") or parsed.get("events"), limit=5, item_limit=260),
    }
    if isinstance(planner_turn["memoryUpdate"], dict):
        planner_turn["memoryUpdate"] = {
            key: _live_agent_loop_clean_plan_text(value, limit=700)
            for key, value in planner_turn["memoryUpdate"].items()
            if _live_agent_loop_clean_plan_text(value, limit=700)
        }
    if not any([
        planner_turn.get("reflection"),
        planner_turn.get("currentGoal"),
        planner_turn.get("plan"),
        planner_turn.get("nextStep"),
        planner_turn.get("memoryUpdate"),
        planner_turn.get("toolRequests"),
        planner_turn.get("eventRequests"),
    ]):
        return None
    return planner_turn


def _live_agent_model_intention_parse(reply_text):
    """Parse an INTENTION: {json} line into a structured intention dict.
    Returns None when the reply has no parsable intention."""
    text = str(reply_text or "").strip()
    match = re.search(r"INTENTION:\s*(\{.*\})", text, flags=re.IGNORECASE | re.DOTALL)
    if not match:
        return None
    raw = match.group(1).strip()
    parsed = None
    for candidate_text in (raw, raw.replace("'", '"')):
        try:
            parsed = json.loads(candidate_text)
            break
        except (ValueError, TypeError):
            continue
    if not isinstance(parsed, dict):
        # Salvage loose key/value content without strict JSON.
        loose = {}
        for key in ("activity", "action", "category"):
            key_match = re.search(rf'"?{key}"?\s*[:=]\s*"([^"]+)"', raw, flags=re.IGNORECASE)
            if key_match:
                loose[key] = key_match.group(1)
        parsed = loose or None
    if not isinstance(parsed, dict):
        return None
    intention = {
        "activity": str(parsed.get("activity") or "").strip()[:420],
        "action": str(parsed.get("action") or "").strip()[:120],
        "category": str(parsed.get("category") or "").strip()[:80],
    }
    if not (intention["activity"] or intention["action"] or intention["category"]):
        return None
    return intention


def _live_agent_model_decision_parse(reply_text, candidate_ids):
    """Parse the model reply. Returns (chosen, status, intention).

    chosen: candidate id | 'skip' | None. intention: structured dict or None.
    A planner JSON or INTENTION reply may name a candidate action directly,
    request an object category/tool/event (resolved by the affordance layer next
    tick), or both."""
    text = str(reply_text or "").strip()
    if not text:
        return None, "empty-reply", None
    planner_turn = _live_agent_model_planner_turn_parse(text)
    if planner_turn:
        next_step = planner_turn.get("nextStep") if isinstance(planner_turn.get("nextStep"), dict) else {}
        action_token = (next_step.get("action") or "").lower()
        category = next_step.get("category") or ""
        intention = {
            "activity": next_step.get("intent") or planner_turn.get("currentGoal") or planner_turn.get("reflection") or "",
            "action": next_step.get("action") or "",
            "category": category,
            "plannerTurn": planner_turn,
        }
        if action_token:
            if action_token == "skip":
                return "skip", "planner-skip", intention
            for candidate_id in candidate_ids:
                if candidate_id.lower() == action_token:
                    return candidate_id, "planner-step-action", intention
        if category:
            return None, "planner-step-category-request", intention
        activity = (intention.get("activity") or "").lower()
        for candidate_id in candidate_ids:
            if candidate_id.lower() in activity:
                intention["action"] = candidate_id
                return candidate_id, "planner-activity-match", intention
        if planner_turn.get("toolRequests") or planner_turn.get("eventRequests"):
            return None, "planner-tool-or-event-request", intention
        return None, "planner-step-unresolved", intention
    intention = _live_agent_model_intention_parse(text)
    if intention:
        action_token = (intention.get("action") or "").lower()
        if action_token:
            if action_token == "skip":
                return "skip", "intention-skip", intention
            for candidate_id in candidate_ids:
                if candidate_id.lower() == action_token:
                    return candidate_id, "intention-action", intention
        if intention.get("category"):
            return None, "intention-category-request", intention
        # Free-text activity only: try to match a candidate mention.
        activity = (intention.get("activity") or "").lower()
        for candidate_id in candidate_ids:
            if candidate_id.lower() in activity:
                return candidate_id, "intention-activity-match", intention
        return None, "intention-unresolved", intention
    match = re.search(r"ACTION:\s*([A-Za-z0-9_.-]+)", text, flags=re.IGNORECASE)
    token = (match.group(1).strip() if match else "").lower()
    if not token:
        for candidate_id in candidate_ids:
            if candidate_id.lower() in text.lower():
                return candidate_id, "matched-mention", None
        return None, "no-action-line", None
    if token == "skip":
        return "skip", "model-skip", None
    for candidate_id in candidate_ids:
        if candidate_id.lower() == token:
            return candidate_id, "model-choice", None
    return None, "unknown-action-id", None


def _live_agent_model_decision_allowed(agent_id, now_epoch=None):
    now_epoch = float(now_epoch or time.time())
    with _live_agent_model_decision_lock:
        row = _live_agent_model_decision_state.get(agent_id) or {}
        next_allowed = float(row.get("nextAllowedEpoch") or 0)
        if row.get("inFlight"):
            return False, "model-decision-in-flight"
        if next_allowed and now_epoch < next_allowed:
            return False, "model-decision-cooldown"
        return True, None


def _live_agent_loop_apply_planner_turn(agent_state, model_detail):
    if not isinstance(agent_state, dict) or not isinstance(model_detail, dict):
        return False
    intention = model_detail.get("intention") if isinstance(model_detail.get("intention"), dict) else {}
    planner_turn = model_detail.get("plannerTurn") if isinstance(model_detail.get("plannerTurn"), dict) else intention.get("plannerTurn")
    if not isinstance(planner_turn, dict):
        return False
    now_iso = _utc_now_iso()
    autonomy_plan = _live_agent_loop_autonomy_plan_from_planner_turn(planner_turn, now_iso=now_iso)
    if autonomy_plan:
        previous = agent_state.get("autonomyPlan") if isinstance(agent_state.get("autonomyPlan"), dict) else {}
        if previous and previous.get("currentGoal") and previous.get("currentGoal") == autonomy_plan.get("currentGoal") and previous.get("createdAt"):
            autonomy_plan["createdAt"] = previous["createdAt"]
        agent_state["autonomyPlan"] = autonomy_plan
    reflection_text = _live_agent_loop_clean_plan_text(planner_turn.get("reflection"), limit=900)
    lesson = ""
    memory_update = planner_turn.get("memoryUpdate") if isinstance(planner_turn.get("memoryUpdate"), dict) else {}
    if memory_update:
        lesson = _live_agent_loop_clean_plan_text(memory_update.get("lesson") or memory_update.get("text"), limit=700) or ""
    if reflection_text or lesson:
        memory = agent_state.get("memory") if isinstance(agent_state.get("memory"), dict) else {}
        memory.setdefault("reflections", [])
        basis = f"{reflection_text}|{lesson}|{model_detail.get('status')}|{model_detail.get('chosen')}"
        entry = {
            "at": now_iso,
            "actionId": f"planner-turn-{hashlib.sha256(basis.encode('utf-8', errors='ignore')).hexdigest()[:12]}",
            "loopActionId": model_detail.get("chosen") or intention.get("action") or "",
            "status": "planner-reflection",
            "text": reflection_text or lesson,
            "lesson": lesson,
            "source": LIVE_AGENT_LOOP_MODEL_DECISION_MODE,
        }
        memory["reflections"] = _live_agent_loop_trim_list([*(memory.get("reflections") or []), entry], LIVE_AGENT_LOOP_DEFAULTS["reflectionRetention"])
        agent_state["memory"] = memory
    _live_agent_loop_normalize_memory(agent_state)
    return True


def _live_agent_model_decision_mark(agent_id, *, in_flight=None, min_interval_sec=None, outcome=None):
    with _live_agent_model_decision_lock:
        row = _live_agent_model_decision_state.setdefault(agent_id, {})
        if in_flight is not None:
            row["inFlight"] = bool(in_flight)
        if min_interval_sec is not None:
            row["nextAllowedEpoch"] = time.time() + max(30, int(min_interval_sec))
        if outcome is not None:
            row["lastOutcome"] = outcome
            row["lastOutcomeAt"] = _utc_now_iso()


def _live_agent_model_decision_take_completed(agent_id):
    """Return and clear a completed async model choice for this agent, if any."""
    with _live_agent_model_decision_lock:
        row = _live_agent_model_decision_state.get(agent_id) or {}
        pending = row.pop("pendingChoice", None)
        return pending if isinstance(pending, dict) else None


def _live_agent_model_planner_session_key(agent_id):
    return f"agent:{agent_id}:vw-live-mode-planner"


def _live_agent_planner_trim_text(value, limit=LIVE_AGENT_PLANNER_TRANSCRIPT_TEXT_LIMIT):
    text = str(value or "")
    if len(text) <= limit:
        return text
    return text[:limit].rstrip() + f"\n\n[truncated to {limit} chars for Virtual World display]"


def _live_agent_planner_transcript_default():
    now = _utc_now_iso()
    return {
        "schemaVersion": LIVE_AGENT_PLANNER_TRANSCRIPT_SCHEMA_VERSION,
        "createdAt": now,
        "updatedAt": now,
        "agents": {},
    }


def _load_live_agent_planner_transcripts():
    try:
        data = _read_json_file(LIVE_AGENT_PLANNER_TRANSCRIPT_FILE)
    except (FileNotFoundError, json.JSONDecodeError, OSError):
        data = _live_agent_planner_transcript_default()
    if not isinstance(data, dict):
        data = _live_agent_planner_transcript_default()
    agents = data.get("agents")
    if not isinstance(agents, dict):
        data["agents"] = {}
    data["schemaVersion"] = LIVE_AGENT_PLANNER_TRANSCRIPT_SCHEMA_VERSION
    return data


def _save_live_agent_planner_transcripts(data):
    data = data if isinstance(data, dict) else _live_agent_planner_transcript_default()
    data["schemaVersion"] = LIVE_AGENT_PLANNER_TRANSCRIPT_SCHEMA_VERSION
    data["updatedAt"] = _utc_now_iso()
    _atomic_write_text(LIVE_AGENT_PLANNER_TRANSCRIPT_FILE, json.dumps(data, indent=2, sort_keys=True) + "\n")
    return data


def _live_agent_planner_turn_id(agent_id, started_epoch, prompt, reply_text):
    basis = f"{agent_id}|{started_epoch}|{prompt}|{reply_text}"
    digest = hashlib.sha256(basis.encode("utf-8", errors="ignore")).hexdigest()[:12]
    return f"planner-{int(float(started_epoch or time.time()) * 1000)}-{digest}"


def _live_agent_planner_transcript_record(agent_id, *, session_key, started_epoch, prompt, reply_text="", detail=None, candidate_ids=None):
    """Store a Virtual-World-owned copy of one planner turn for the UI.

    This is intentionally separate from the OpenClaw gateway session. The
    gateway planner session is still deleted so planner scaffolding does not
    leak into normal agent memory/dreaming, while the world UI can display the
    actual prompt and model reply when the operator opens the Live Agent Mode
    session.
    """
    agent_key = str(agent_id or "").strip()
    if not agent_key:
        return None
    started = float(started_epoch or time.time())
    detail = detail if isinstance(detail, dict) else {}
    prompt_text = _live_agent_planner_trim_text(prompt)
    reply_text = _live_agent_planner_trim_text(reply_text, limit=8000)
    turn = {
        "id": _live_agent_planner_turn_id(agent_key, started, prompt_text, reply_text),
        "agentId": agent_key,
        "sessionKey": session_key or _live_agent_model_planner_session_key(agent_key),
        "startedAt": _epoch_to_utc_iso(started),
        "completedAt": _utc_now_iso(),
        "status": str(detail.get("status") or "unknown")[:120],
        "mode": str(detail.get("mode") or LIVE_AGENT_LOOP_MODEL_DECISION_MODE)[:120],
        "prompt": prompt_text,
        "reply": reply_text,
        "chosen": detail.get("chosen"),
        "parseStatus": detail.get("status"),
        "latencySec": detail.get("latencySec"),
        "intention": _copy_jsonable(detail.get("intention")) if isinstance(detail.get("intention"), dict) else None,
        "candidateIds": [str(item) for item in (candidate_ids or []) if str(item or "").strip()][:40],
    }
    with _live_agent_planner_transcript_lock:
        data = _load_live_agent_planner_transcripts()
        agents = data.setdefault("agents", {})
        row = agents.setdefault(agent_key, {"turns": []})
        if not isinstance(row, dict):
            row = {"turns": []}
            agents[agent_key] = row
        turns = [item for item in (row.get("turns") or []) if isinstance(item, dict) and item.get("id") != turn["id"]]
        turns.append(turn)
        turns.sort(key=lambda item: _parse_isoish_epoch(item.get("startedAt")) or 0)
        row["turns"] = turns[-LIVE_AGENT_PLANNER_TRANSCRIPT_RETENTION:]
        row["updatedAt"] = turn["completedAt"]
        _save_live_agent_planner_transcripts(data)
    return turn


def _live_agent_model_planner_session_cleanup(agent_id):
    """Delete the ephemeral planner session so internal decision prompts do not
    accumulate in the agent's session history or leak into its long-term
    memory/dreaming pipeline. Best-effort: failures never break the loop."""
    try:
        _gateway_rpc_call("sessions.delete", {
            "key": _live_agent_model_planner_session_key(agent_id),
            "deleteTranscript": True,
        }, timeout=10)
        return True
    except Exception:
        return False


def _live_agent_model_decision_worker(agent_id, prompt, candidate_ids, config):
    """Background worker: send the decision prompt to the agent's own model via the
    gateway, wait for the reply, and cache the parsed choice for the next tick.
    Never holds the live loop lock."""
    session_key = _live_agent_model_planner_session_key(agent_id)
    started = time.time()
    detail = {"mode": LIVE_AGENT_LOOP_MODEL_DECISION_MODE, "status": "error"}
    reply_text = ""
    try:
        result = _gateway_rpc_call("chat.send", {
            "sessionKey": session_key,
            "message": prompt,
            "idempotencyKey": f"vw-live-decide-{agent_id}-{int(started)}",
        }, timeout=30)
        if not isinstance(result, dict) or result.get("ok") is False:
            detail = {"mode": LIVE_AGENT_LOOP_MODEL_DECISION_MODE, "status": "gateway-rejected", "error": str((result or {}).get("error") or "unknown")[:300]}
        else:
            reply_text = ""
            deadline = started + config["timeoutSec"]
            while time.time() < deadline:
                time.sleep(3)
                reply_text = _live_agent_model_decision_recover_reply(session_key, started)
                if reply_text:
                    break
            if not reply_text:
                detail = {"mode": LIVE_AGENT_LOOP_MODEL_DECISION_MODE, "status": "reply-timeout", "latencySec": round(time.time() - started, 2)}
            else:
                chosen, parse_status, intention = _live_agent_model_decision_parse(reply_text, candidate_ids)
                detail = {
                    "mode": LIVE_AGENT_LOOP_MODEL_DECISION_MODE,
                    "status": parse_status,
                    "chosen": chosen,
                    "latencySec": round(time.time() - started, 2),
                    "replyPreview": str(reply_text or "")[:200],
                }
                if isinstance(intention, dict):
                    detail["intention"] = intention
                    if isinstance(intention.get("plannerTurn"), dict):
                        detail["plannerTurn"] = intention.get("plannerTurn")
                    if intention.get("category"):
                        resolved_category = _live_agent_loop_note_requested_category(agent_id, intention.get("category"))
                        detail["requestedCategory"] = resolved_category or intention.get("category")
                        detail["categoryResolved"] = bool(resolved_category)
                if chosen or (isinstance(intention, dict) and (intention.get("category") or isinstance(intention.get("plannerTurn"), dict))):
                    with _live_agent_model_decision_lock:
                        row = _live_agent_model_decision_state.setdefault(agent_id, {})
                        row["pendingChoice"] = {"chosen": chosen, "detail": detail, "at": _utc_now_iso(), "candidateIds": candidate_ids, "intention": intention}
    except Exception as exc:
        detail = {"mode": LIVE_AGENT_LOOP_MODEL_DECISION_MODE, "status": "gateway-error", "error": str(exc)[:300]}
    finally:
        _live_agent_model_decision_mark(agent_id, in_flight=False, min_interval_sec=config["minIntervalSec"], outcome=detail)
        try:
            _live_agent_planner_transcript_record(
                agent_id,
                session_key=session_key,
                started_epoch=started,
                prompt=prompt,
                reply_text=reply_text,
                detail=detail,
                candidate_ids=candidate_ids,
            )
        except Exception as exc:
            print(f"[live-agent] Could not record planner transcript for {agent_id}: {exc}")
        _live_agent_model_planner_session_cleanup(agent_id)


def _live_agent_model_decide(agent_id, decision_frame, agent_state, config):
    """Non-blocking model decision. Returns (loopActionId | 'skip' | None, detail dict).

    A completed async choice from a previous request is applied immediately.
    Otherwise a background request is started (subject to cooldown) and the
    deterministic planner-v2 selection stands for this tick."""
    candidates = [c for c in decision_frame.get("candidates") or [] if c.get("decision") == "candidate"]
    candidate_ids = [str(c.get("id")) for c in candidates if c.get("id")]
    if not candidate_ids:
        return None, {"mode": LIVE_AGENT_LOOP_MODEL_DECISION_MODE, "status": "no-candidates"}
    provider_kind = _live_agent_model_decision_provider_kind(agent_id)
    if provider_kind not in LIVE_AGENT_LOOP_MODEL_DECISION_SOURCES:
        return None, {"mode": LIVE_AGENT_LOOP_MODEL_DECISION_MODE, "status": "provider-not-supported", "providerKind": provider_kind}

    completed = _live_agent_model_decision_take_completed(agent_id)
    if completed:
        chosen = completed.get("chosen")
        detail = dict(completed.get("detail") or {})
        detail["applied"] = "async-previous-request"
        _live_agent_loop_apply_planner_turn(agent_state, detail)
        if chosen == "skip" or chosen in candidate_ids:
            return chosen, detail
        if isinstance(completed.get("intention"), dict) and completed["intention"].get("category"):
            # Category request without a direct action: the dynamic affordance
            # for that category is active now, so re-plan deterministically
            # this tick with the expanded candidate surface.
            detail["status"] = "intention-category-applied"
            return None, detail
        if isinstance(detail.get("plannerTurn"), dict) and detail.get("status") in {"planner-tool-or-event-request", "planner-step-unresolved"}:
            return None, detail
        detail["status"] = "stale-choice-discarded"
        return None, detail

    allowed, blocked_reason = _live_agent_model_decision_allowed(agent_id)
    if not allowed:
        return None, {"mode": LIVE_AGENT_LOOP_MODEL_DECISION_MODE, "status": blocked_reason}
    prompt = _live_agent_model_decision_prompt(agent_id, decision_frame, agent_state)
    _live_agent_model_decision_mark(agent_id, in_flight=True)
    threading.Thread(
        target=_live_agent_model_decision_worker,
        args=(agent_id, prompt, candidate_ids, config),
        daemon=True,
        name=f"vw-live-model-decide-{agent_id}",
    ).start()
    return None, {"mode": LIVE_AGENT_LOOP_MODEL_DECISION_MODE, "status": "model-request-started", "appliesOn": "next-tick"}


def _live_agent_model_decision_recover_reply(session_key, started_epoch):
    """Read the newest assistant message created after started_epoch from the planner session."""
    try:
        result = _gateway_rpc_call("chat.history", {"sessionKey": session_key, "limit": 6}, timeout=15)
        messages = result.get("messages") if isinstance(result, dict) else None
        if not isinstance(messages, list):
            payload = result.get("payload") if isinstance(result, dict) else None
            messages = payload.get("messages") if isinstance(payload, dict) else []
        started_ms = float(started_epoch or 0) * 1000.0
        for message in reversed(messages or []):
            if not isinstance(message, dict) or message.get("role") != "assistant":
                continue
            stamp = message.get("timestamp") or message.get("createdAt") or message.get("at")
            stamp_ms = None
            if isinstance(stamp, (int, float)):
                stamp_ms = float(stamp if stamp > 1e12 else stamp * 1000)
            elif isinstance(stamp, str):
                parsed = _parse_isoish_epoch(stamp)
                stamp_ms = parsed * 1000 if parsed else None
            if stamp_ms is not None and started_ms and stamp_ms < started_ms - 2000:
                continue
            content = message.get("content")
            if isinstance(content, str) and content.strip():
                return content
            if isinstance(content, list):
                text = "".join(block.get("text", "") for block in content if isinstance(block, dict) and block.get("type") == "text")
                if text.strip():
                    return text
    except Exception:
        pass
    return ""


def _live_agent_loop_select_next_action(agent_id, agent_state, perception=None, *, loop_state=None):
    perception = perception if isinstance(perception, dict) else _live_agent_loop_build_perception(agent_id, agent_state)
    decision = _live_agent_loop_build_decision_frame(agent_id, perception, agent_state)
    config = _live_agent_model_decision_config(loop_state)
    if config["enabled"]:
        chosen, model_detail = _live_agent_model_decide(agent_id, decision, agent_state, config)
        decision["modelDecision"] = model_detail
        if chosen == "skip":
            decision["mode"] = LIVE_AGENT_LOOP_MODEL_DECISION_MODE
            decision["selectedActionId"] = None
            decision["selectedActionLabel"] = None
            decision["reason"] = "model chose to skip this tick"
            agent_state["lastDecision"] = {**(agent_state.get("lastDecision") or {}), "mode": decision["mode"], "selectedActionId": None, "selectedActionLabel": None, "reason": decision["reason"], "modelDecision": model_detail}
            return None, decision
        if chosen:
            candidate = next((c for c in decision.get("candidates") or [] if c.get("id") == chosen and c.get("decision") == "candidate"), None)
            if candidate:
                decision["mode"] = LIVE_AGENT_LOOP_MODEL_DECISION_MODE
                decision["selectedActionId"] = chosen
                decision["selectedActionLabel"] = candidate.get("label")
                decision["score"] = candidate.get("score")
                decision["reason"] = f"{candidate.get('label')} chosen by the agent's own model"
        if isinstance(agent_state.get("lastDecision"), dict):
            agent_state["lastDecision"]["mode"] = decision.get("mode")
            agent_state["lastDecision"]["selectedActionId"] = decision.get("selectedActionId")
            agent_state["lastDecision"]["selectedActionLabel"] = decision.get("selectedActionLabel")
            agent_state["lastDecision"]["reason"] = decision.get("reason")
            agent_state["lastDecision"]["modelDecision"] = model_detail
    selected_id = decision.get("selectedActionId")
    if not selected_id:
        return None, decision
    selected_affordance = next((item for item in _live_agent_loop_action_affordances(agent_id, agent_state) if item.get("id") == selected_id and item.get("available")), None)
    if not selected_affordance:
        return None, decision
    selected = selected_affordance.get("selected")
    if isinstance(selected, dict):
        selected["decision"] = decision
    return selected, decision


def _live_agent_loop_next_allowed_epoch(agent_state):
    raw = agent_state.get("nextAllowedAt")
    if isinstance(raw, (int, float)):
        return float(raw)
    parsed = _parse_isoish_epoch(raw)
    return float(parsed or 0)


def _live_agent_loop_action_summary(action):
    if not isinstance(action, dict):
        return None
    timing = action.get("timing") if isinstance(action.get("timing"), dict) else {}
    source = action.get("source") if isinstance(action.get("source"), dict) else {}
    params = action.get("params") if isinstance(action.get("params"), dict) else {}
    result = action.get("result") if isinstance(action.get("result"), dict) else {}
    return {
        "id": action.get("id"),
        "status": _canonical_world_action_status(action.get("status")),
        "actionType": action.get("actionType"),
        "agentId": action.get("agentId"),
        "loopActionId": params.get("loopActionId"),
        "planId": params.get("planId"),
        "planStepId": params.get("planStepId"),
        "requestId": source.get("requestId"),
        "updatedAt": timing.get("updatedAt"),
        "terminalAt": timing.get("terminalAt"),
        "completedAt": timing.get("completedAt"),
        "failureReason": action.get("failureReason"),
        "result": result,
    }


def _live_agent_loop_action_epoch(action):
    if not isinstance(action, dict):
        return 0
    timing = action.get("timing") if isinstance(action.get("timing"), dict) else {}
    for key in ("terminalAt", "completedAt", "updatedAt", "routePendingAt", "createdAt", "requestedAt"):
        parsed = _parse_isoish_epoch(timing.get(key))
        if parsed:
            return parsed
    return 0


def _live_agent_loop_owns_world_action(action):
    if not isinstance(action, dict):
        return False
    params = action.get("params") if isinstance(action.get("params"), dict) else {}
    if params.get("loopActionId"):
        return True
    source = action.get("source") if isinstance(action.get("source"), dict) else {}
    return str(source.get("requestId") or "").startswith("live-loop-")


def _live_agent_loop_action_status_timestamp(action, status):
    timing = action.get("timing") if isinstance(action.get("timing"), dict) else {}
    route = action.get("route") if isinstance(action.get("route"), dict) else {}
    keys_by_status = {
        "route_pending": ("routePendingAt", "handoffPendingAt", "updatedAt", "createdAt"),
        "routing": ("startedAt", "updatedAt", "routePendingAt", "createdAt"),
        "arrived": ("arrivedAt", "updatedAt", "startedAt", "createdAt"),
        "in_progress": ("inUseAt", "arrivedAt", "updatedAt", "startedAt", "createdAt"),
    }
    for key in keys_by_status.get(status, ("updatedAt", "createdAt")):
        value = timing.get(key) if key in timing else route.get(key)
        parsed = _parse_isoish_epoch(value) if value else None
        if parsed:
            return parsed, key
    return None, None


def _live_agent_loop_stale_threshold_seconds(action, status):
    timing = action.get("timing") if isinstance(action.get("timing"), dict) else {}
    params = action.get("params") if isinstance(action.get("params"), dict) else {}
    default_threshold = LIVE_AGENT_LOOP_STALE_ACTIVE_ACTION_SECONDS.get(status)
    timeout_ms = timing.get("timeoutMs")
    if isinstance(timeout_ms, (int, float)) and timeout_ms > 0:
        return max(60, int(timeout_ms / 1000))
    if status == "in_progress":
        duration_ms = params.get("constructionDurationMs") or params.get("estimatedUseMs")
        if isinstance(duration_ms, (int, float)) and duration_ms > 0:
            return max(default_threshold or 300, int(duration_ms / 1000) + 180)
    return default_threshold


def _live_agent_loop_reconcile_stale_active_behaviors(state=None, *, now_epoch=None):
    now_epoch = float(now_epoch or time.time())
    store = get_world_actions_store(persist_migration=True)
    stale = []
    for action in store.get("active", []):
        if not isinstance(action, dict):
            continue
        if _behavior_source_kind_from_record(action) != "agent-live-mode":
            continue
        status = _canonical_world_action_status(action.get("status"))
        threshold = _live_agent_loop_stale_threshold_seconds(action, status)
        if not threshold:
            continue
        started_epoch, timestamp_key = _live_agent_loop_action_status_timestamp(action, status)
        if not started_epoch:
            continue
        age_sec = max(0, int(now_epoch - started_epoch))
        if age_sec < threshold:
            continue
        stale.append({
            "actionId": action.get("id"),
            "agentId": action.get("agentId"),
            "status": status,
            "ageSec": age_sec,
            "thresholdSec": threshold,
            "timestampKey": timestamp_key,
            "actionType": action.get("actionType"),
            "loopActionId": (action.get("params") if isinstance(action.get("params"), dict) else {}).get("loopActionId"),
        })

    expired = []
    for item in stale:
        action_id = item.get("actionId")
        if not action_id:
            continue
        ok, response, status_code = transition_world_action(
            action_id,
            "expired",
            result={
                "status": "expired",
                "reason": "live_mode_active_action_stale",
                "stale": item,
            },
            failure_reason="timed_out",
            actor="server.py#live-agent-loop-stale-reconcile",
            source="agent-live-mode",
        )
        item["transitionOk"] = bool(ok)
        item["httpStatus"] = status_code
        if not ok:
            item["error"] = response
        expired.append(item)

    if expired:
        reconcile_move_intents()
        if isinstance(state, dict):
            now_iso = _utc_now_iso()
            for item in expired:
                agent_id = item.get("agentId")
                if not agent_id:
                    continue
                agent_state = _live_agent_loop_agent_state(state, agent_id)
                if item.get("transitionOk"):
                    agent_state["lastOutcome"] = {
                        "at": now_iso,
                        "status": "expired",
                        "reason": "live-mode-stale-active-action",
                        "actionId": item.get("actionId"),
                        "loopActionId": item.get("loopActionId"),
                        "stale": {k: item.get(k) for k in ("status", "ageSec", "thresholdSec", "timestampKey", "actionType")},
                    }
                    _live_agent_loop_add_feedback(state, agent_id, "warning", "Expired stale Live Mode action so the resident loop could continue.", item)
                    _live_agent_loop_add_event(state, "stale-action-expired", agent_id=agent_id, details=item)
                else:
                    _live_agent_loop_add_feedback(state, agent_id, "error", "Could not expire stale Live Mode action.", item)
                    _live_agent_loop_add_event(state, "stale-action-expire-failed", agent_id=agent_id, details=item)
    return expired


def _live_agent_loop_relationship_key(agent_id, other_agent_id):
    left = str(agent_id or "").strip()
    right = str(other_agent_id or "").strip()
    if not left or not right:
        return None
    pair = sorted([left, right])
    return f"{pair[0]}::{pair[1]}"


def _live_agent_loop_append_resident_memory(values, entry, limit):
    if not isinstance(entry, dict):
        return _limit_profile_list(values, limit=limit, item_limit=1200)
    entry_key = entry.get("settledActionKey") or entry.get("actionId")
    next_values = []
    for item in values if isinstance(values, list) else []:
        if isinstance(item, dict) and entry_key and (item.get("settledActionKey") == entry_key or item.get("actionId") == entry.get("actionId")):
            continue
        next_values.append(item)
    next_values.append(entry)
    return _limit_profile_list(next_values, limit=limit, item_limit=1200)


def _live_agent_loop_remember_resident_profile_action(agent_id, recent_entry, observation, reflection, social_relationship=None):
    if not isinstance(recent_entry, dict) or not recent_entry.get("actionId"):
        return None
    meta = load_world_meta()
    profiles, resolved_agent_id, profile = _agent_profile_for(meta, agent_id)
    if not resolved_agent_id:
        return None
    profile = dict(profile or {})
    template = _default_resident_profile(resolved_agent_id, meta, profile)
    current = profile.get("residentProfile") if isinstance(profile.get("residentProfile"), dict) else template
    resident_profile = _sanitize_resident_profile(current, template, touch=False)
    memory = dict(resident_profile.get("memory") or {})
    short_term = {
        "at": recent_entry.get("at"),
        "actionId": recent_entry.get("actionId"),
        "loopActionId": recent_entry.get("loopActionId"),
        "actionType": recent_entry.get("actionType"),
        "label": recent_entry.get("label"),
        "status": recent_entry.get("status"),
        "need": recent_entry.get("need"),
        "settledActionKey": recent_entry.get("settledActionKey"),
        "text": observation.get("text") if isinstance(observation, dict) else "",
        "source": "live-agent-loop",
    }
    for key in ("target", "targetKey", "failure"):
        if recent_entry.get(key) is not None:
            short_term[key] = _copy_jsonable(recent_entry.get(key))
    memory["shortTerm"] = _live_agent_loop_append_resident_memory(memory.get("shortTerm"), short_term, RESIDENT_PROFILE_LIST_LIMIT)
    reflection_entry = {
        "at": reflection.get("at") if isinstance(reflection, dict) else recent_entry.get("at"),
        "actionId": recent_entry.get("actionId"),
        "loopActionId": recent_entry.get("loopActionId"),
        "settledActionKey": recent_entry.get("settledActionKey"),
        "text": reflection.get("text") if isinstance(reflection, dict) else "",
        "source": "live-agent-loop",
    }
    if recent_entry.get("failure") is not None:
        reflection_entry["failure"] = _copy_jsonable(recent_entry.get("failure"))
    memory["reflections"] = _live_agent_loop_append_resident_memory(memory.get("reflections"), reflection_entry, RESIDENT_PROFILE_MEMORY_LIMIT)
    if isinstance(social_relationship, dict) and social_relationship.get("relationshipId"):
        relationships = memory.get("relationships") if isinstance(memory.get("relationships"), dict) else {}
        relationships[social_relationship["relationshipId"]] = {
            **(relationships.get(social_relationship["relationshipId"]) if isinstance(relationships.get(social_relationship["relationshipId"]), dict) else {}),
            "otherAgentId": social_relationship.get("otherAgentId"),
            "summary": f"Visible conversation completed with {social_relationship.get('otherAgentId')}.",
            "score": social_relationship.get("score"),
            "lastActionId": social_relationship.get("actionId"),
            "lastConversationId": social_relationship.get("conversationId"),
            "updatedAt": recent_entry.get("at"),
            "source": "live-agent-loop",
        }
        memory["relationships"] = relationships
    resident_profile["memory"] = memory
    profile["residentProfile"] = _sanitize_resident_profile(resident_profile, template, touch=True)
    profiles[resolved_agent_id] = profile
    meta["agentProfiles"] = profiles
    save_world_meta(meta)
    return profile["residentProfile"]


def _live_agent_loop_record_social_outcome(state, agent_id, action, summary, now_iso):
    if not isinstance(action, dict) or not isinstance(summary, dict):
        return None
    if summary.get("actionType") != "life.social":
        return None
    if _canonical_world_action_status(summary.get("status")) != "completed":
        return None
    target = action.get("target") if isinstance(action.get("target"), dict) else {}
    other_agent_id = _resolve_agent_id(target.get("targetAgentId"))
    if not other_agent_id or other_agent_id == agent_id:
        return None
    result = summary.get("result") if isinstance(summary.get("result"), dict) else {}
    relationship_key = _live_agent_loop_relationship_key(agent_id, other_agent_id)
    if not relationship_key:
        return None
    meta = load_world_meta()
    relationships = meta.get("agentRelationships") if isinstance(meta.get("agentRelationships"), dict) else {}
    previous = relationships.get(relationship_key) if isinstance(relationships.get(relationship_key), dict) else {}
    previous_score = previous.get("score")
    try:
        next_score = min(1.0, max(-1.0, float(previous_score if previous_score is not None else 0) + 0.08))
    except (TypeError, ValueError):
        next_score = 0.08
    summary_text = f"{agent_id} had a visible conversation with {other_agent_id}."
    if result.get("conversationId"):
        summary_text = f"{summary_text} Conversation {result.get('conversationId')} completed in-world."
    relationships[relationship_key] = {
        **previous,
        "agentId": relationship_key.split("::", 1)[0],
        "otherAgentId": relationship_key.split("::", 1)[1],
        "summary": summary_text,
        "score": round(next_score, 3),
        "lastOutcome": "visible-conversation-completed",
        "lastActionId": summary.get("id"),
        "lastLoopActionId": summary.get("loopActionId"),
        "lastConversationId": result.get("conversationId"),
        "updatedAt": now_iso,
    }
    meta["agentRelationships"] = relationships
    save_world_meta(meta)
    details = {
        "relationshipId": relationship_key,
        "otherAgentId": other_agent_id,
        "actionId": summary.get("id"),
        "conversationId": result.get("conversationId"),
        "score": relationships[relationship_key].get("score"),
    }
    if isinstance(state, dict):
        _live_agent_loop_add_event(state, "social-relationship-updated", agent_id=agent_id, details=details)
    return details


def _live_agent_loop_remember_settled_action(state, agent_id, agent_state, action, summary):
    if not isinstance(summary, dict):
        return None
    action_id = summary.get("id")
    action_status = _canonical_world_action_status(summary.get("status"))
    settled_key = _live_agent_loop_settled_action_key(action_id, action_status)
    if settled_key and settled_key in _live_agent_loop_existing_settled_keys(agent_state):
        _live_agent_loop_mark_settled_action(agent_state, action_id, action_status)
        return {"actionId": action_id, "status": action_status, "settledActionKey": settled_key, "duplicate": True}
    action_def = _live_agent_loop_action_definition(summary.get("loopActionId"), summary.get("actionType"))
    label = (action_def or {}).get("label") or summary.get("actionType") or "world action"
    need_key = (action_def or {}).get("need")
    completion_validation = _live_agent_loop_seating_completion_validation(action, summary, action_def)
    completed = action_status == "completed" and completion_validation.get("ok") is not False
    memory_status = action_status if completed or action_status != "completed" else "failed"
    if need_key:
        _live_agent_loop_decay_need_after_action(agent_state, need_key, completed=completed)
    memory = agent_state.get("memory") if isinstance(agent_state.get("memory"), dict) else {}
    target_memory = _live_agent_loop_memory_target(action.get("target") if isinstance(action, dict) else None)
    failure_learning = _live_agent_loop_failure_learning(action, summary) or _live_agent_loop_completion_validation_failure(action, summary, completion_validation)
    target_key = _live_agent_loop_target_key((failure_learning or {}).get("target") or target_memory)
    recent_entry = {
        "at": _utc_now_iso(),
        "actionId": action_id,
        "loopActionId": summary.get("loopActionId"),
        "actionType": summary.get("actionType"),
        "label": label,
        "status": memory_status,
        "need": need_key,
        "settledActionKey": settled_key,
    }
    if completion_validation.get("required"):
        recent_entry["completionValidation"] = _copy_jsonable(completion_validation)
    if target_memory:
        recent_entry["target"] = target_memory
    if target_key:
        recent_entry["targetKey"] = target_key
    if failure_learning:
        recent_entry["failure"] = failure_learning
    if target_key and isinstance(action_def, dict) and action_def.get("category"):
        _live_agent_loop_record_goal_progress(agent_state, action_def, target_key, completed)
    memory["recentActions"] = _live_agent_loop_trim_list([*(memory.get("recentActions") or []), recent_entry], LIVE_AGENT_LOOP_DEFAULTS["memoryRetention"])
    social_relationship = _live_agent_loop_record_social_outcome(state, agent_id, action, summary, recent_entry["at"])
    observation_text = f"{label} finished with status {memory_status}."
    target = action.get("target") if isinstance(action, dict) and isinstance(action.get("target"), dict) else {}
    if target.get("buildingId"):
        observation_text = f"{observation_text} Target building {target.get('buildingId')} object {target.get('catalogId') or target.get('objectInstanceId')}."
    elif target_memory:
        target_phrase = _live_agent_loop_target_phrase(target_memory)
        if target_phrase:
            observation_text = f"{observation_text} Target {target_phrase}."
    if failure_learning:
        observation_text = f"{observation_text} Failure detail: {failure_learning.get('learningText')}"
    if social_relationship:
        observation_text = f"{observation_text} Social partner {social_relationship.get('otherAgentId')} relationship score {social_relationship.get('score')}."
    observation = {"at": recent_entry["at"], "text": observation_text, "actionId": action_id, "status": memory_status, "settledActionKey": settled_key}
    if target_key:
        observation["targetKey"] = target_key
    if failure_learning:
        observation["failure"] = failure_learning
    if completion_validation.get("required"):
        observation["completionValidation"] = _copy_jsonable(completion_validation)
    memory["observations"] = _live_agent_loop_trim_list([*(memory.get("observations") or []), observation], LIVE_AGENT_LOOP_DEFAULTS["memoryRetention"])
    reflection_text = f"I {('completed' if completed else 'ended')} {label}; next I should balance needs instead of repeating the same object."
    if failure_learning:
        reflection_text = f"I could not complete {label}: {failure_learning.get('learningText')} Next I should choose a different target/action or wait for conditions to change."
    reflection = {
        "at": recent_entry["at"],
        "text": reflection_text,
        "actionId": action_id,
        "loopActionId": summary.get("loopActionId"),
        "settledActionKey": settled_key,
    }
    if failure_learning:
        reflection["failure"] = failure_learning
    if social_relationship:
        reflection["text"] = f"I completed a visible conversation with {social_relationship.get('otherAgentId')}; next I should let that relationship context influence future plans."
        reflection["relationship"] = social_relationship
    memory["reflections"] = _live_agent_loop_trim_list([*(memory.get("reflections") or []), reflection], LIVE_AGENT_LOOP_DEFAULTS["reflectionRetention"])
    agent_state["memory"] = memory
    _live_agent_loop_remember_resident_profile_action(agent_id, recent_entry, observation, reflection, social_relationship)
    _live_agent_loop_mark_settled_action(agent_state, action_id, action_status)
    details = {"actionId": action_id, "loopActionId": summary.get("loopActionId"), "status": memory_status}
    if completion_validation.get("required"):
        details["completionValidation"] = _copy_jsonable(completion_validation)
    if completed:
        _live_agent_loop_add_feedback(state, agent_id, "info", reflection["text"], details)
    else:
        if failure_learning:
            details["failure"] = failure_learning
        _live_agent_loop_add_feedback(state, agent_id, "warning", reflection["text"] if failure_learning else f"{label} ended as {action_status}; watch this action type.", details)
    return recent_entry


def _live_agent_loop_refresh_completed_outcomes(state):
    changed = False
    world_actions = get_world_actions_store(persist_migration=True)
    active_ids = {action.get("id") for action in world_actions.get("active", []) if isinstance(action, dict)}
    history_by_id = {
        action.get("id"): action
        for action in world_actions.get("history", [])
        if isinstance(action, dict) and action.get("id")
    }
    now = _utc_now_iso()
    for agent_id, agent_state in (state.get("agents") or {}).items():
        if not isinstance(agent_state, dict):
            continue
        action_id = agent_state.get("lastActionId")
        action = None
        if action_id and action_id not in active_ids:
            action = history_by_id.get(action_id)
        latest_loop_action = None
        latest_loop_epoch = 0
        for candidate in world_actions.get("history", []):
            if not isinstance(candidate, dict) or candidate.get("agentId") != agent_id:
                continue
            if not _live_agent_loop_owns_world_action(candidate):
                continue
            candidate_status = _canonical_world_action_status(candidate.get("status"))
            if candidate_status not in WORLD_ACTION_TERMINAL_STATES:
                continue
            candidate_epoch = _live_agent_loop_action_epoch(candidate)
            if candidate_epoch >= latest_loop_epoch:
                latest_loop_action = candidate
                latest_loop_epoch = candidate_epoch
        if latest_loop_action and (not action or latest_loop_epoch > _live_agent_loop_action_epoch(action)):
            action = latest_loop_action
            action_id = action.get("id")
        if not action:
            continue
        action_status = _canonical_world_action_status(action.get("status"))
        if action_status not in WORLD_ACTION_TERMINAL_STATES:
            continue
        settled_key = _live_agent_loop_settled_action_key(action_id, action_status)
        current = agent_state.get("lastOutcome") if isinstance(agent_state.get("lastOutcome"), dict) else {}
        if current.get("actionId") == action_id and current.get("status") == action_status and current.get("observedBy") == "agent-live-loop-status":
            continue
        summary = _live_agent_loop_action_summary(action)
        agent_state["lastOutcome"] = {
            "at": now,
            "status": action_status,
            "reason": "world-action-terminal-history",
            "actionId": action_id,
            "loopActionId": summary.get("loopActionId") if summary else None,
            "worldAction": summary,
            "observedBy": "agent-live-loop-status",
            "settledActionKey": settled_key,
        }
        agent_state["lastActionId"] = action_id
        timing = action.get("timing") if isinstance(action.get("timing"), dict) else {}
        agent_state["lastActionAt"] = timing.get("requestedAt") or timing.get("createdAt") or agent_state.get("lastActionAt")
        agent_state["lastSettledActionAt"] = now
        if action_status == "completed":
            agent_state["lastCompletedActionAt"] = now
        remembered = _live_agent_loop_remember_settled_action(state, agent_id, agent_state, action, summary)
        _live_agent_loop_update_plan_from_settled_action(state, agent_id, agent_state, summary, action_status, now)
        if not (isinstance(remembered, dict) and remembered.get("duplicate")):
            _live_agent_loop_add_event(state, "action-settled", agent_id=agent_id, details={"actionId": action_id, "status": action_status})
        changed = True
    return changed


def _live_agent_loop_cooldown_for_decision(base_cooldown, decision):
    score = 0
    try:
        score = float((decision or {}).get("score") or 0)
    except (TypeError, ValueError):
        score = 0
    if score >= 1.0:
        multiplier = 0.80
    elif score <= 0.55:
        multiplier = 1.30
    else:
        multiplier = 1.0
    return _normalize_int(round(base_cooldown * multiplier), base_cooldown, minimum=45, maximum=3600)


def live_agent_loop_tick(*, reason="timer", force=False, dry_run=False):
    with _live_agent_loop_lock:
        state = get_live_agent_loop_state(persist_migration=True)
        now_epoch = time.time()
        now_iso = _utc_now_iso()
        world_client = _live_agent_loop_world_client_status(state)
        pause = _live_agent_loop_pause_status(state, now_epoch=now_epoch)
        stale_expired = [] if dry_run else _live_agent_loop_reconcile_stale_active_behaviors(state, now_epoch=now_epoch)
        settled_refreshed = False if dry_run else _live_agent_loop_refresh_completed_outcomes(state)
        result = {
            "ok": True,
            "schemaVersion": LIVE_AGENT_LOOP_SCHEMA_VERSION,
            "reason": reason,
            "forced": bool(force),
            "dryRun": bool(dry_run),
            "worldClient": world_client,
            "serverRuntimeAuthority": True,
            "pause": pause,
            "staleExpired": stale_expired,
            "settledRefreshed": settled_refreshed,
            "enabledAgents": [],
            "actionsCreated": [],
            "skipped": [],
            "decisions": [],
            "errors": [],
        }
        state["lastTickAt"] = now_iso
        _live_agent_loop_stat(state, "ticks")
        if dry_run:
            _live_agent_loop_stat(state, "dryRuns")

        if not check_feature("agentLiveMode"):
            result["ok"] = False
            result["disabledReason"] = "agentLiveMode feature is disabled or locked"
            _live_agent_loop_add_event(state, "feature-disabled", details={"reason": result["disabledReason"]})
            if not dry_run:
                save_live_agent_loop_state(state)
            return result

        if not state.get("enabled") and not force:
            result["disabledReason"] = "live agent loop is disabled"
            _live_agent_loop_add_event(state, "loop-disabled")
            if not dry_run:
                save_live_agent_loop_state(state)
            return result

        if pause.get("active") and not force:
            result["disabledReason"] = "live agent loop is paused"
            result["skipped"].append({"reason": "loop-paused", "pause": pause})
            if not dry_run:
                save_live_agent_loop_state(state)
            return result

        enabled_agents = _live_agent_loop_enabled_roster()
        result["enabledAgents"] = [{"agentId": a.get("agentId"), "name": a.get("name"), "providerKind": a.get("providerKind")} for a in enabled_agents]
        actions_created_this_tick = 0
        max_actions = _normalize_int(state.get("maxActionsPerTick"), LIVE_AGENT_LOOP_DEFAULTS["maxActionsPerTick"], minimum=1, maximum=5)
        cooldown = _normalize_int(state.get("minActionIntervalSec"), LIVE_AGENT_LOOP_DEFAULTS["minActionIntervalSec"], minimum=30, maximum=3600)

        for agent in enabled_agents:
            agent_id = agent.get("agentId")
            agent_state = _live_agent_loop_agent_state(state, agent_id)
            if agent_state.get("enabled") is False and not force:
                result["skipped"].append({"agentId": agent_id, "reason": "agent-loop-disabled"})
                continue

            agent_state["lastHeartbeatAt"] = now_iso
            _live_agent_loop_stat(agent_state, "ticks")

            user_attention = live_agent_user_attention_status(agent_id, now_epoch=now_epoch) if state.get("userChatPreemptionEnabled", True) else {"active": False}
            if user_attention.get("active"):
                _live_agent_loop_stat(agent_state, "skippedUserAttention")
                agent_state["lastOutcome"] = {"at": now_iso, "status": "skipped", "reason": "user-attention", "userAttention": user_attention}
                agent_state["userAttention"] = user_attention
                _live_agent_loop_presence(agent_id, "working", "Attending to the user")
                result["skipped"].append({"agentId": agent_id, "reason": "user-attention", "userAttention": user_attention})
                continue
            if agent_state.get("userAttention"):
                agent_state["userAttention"] = None

            # World accountability: if this agent is claimed live by ANOTHER
            # world/port, this world's loop must not drive it. The claim guard
            # already blocks enable + action creation; skipping here avoids
            # error spam and conflicting world data for the agent.
            try:
                live_world = _agent_live_world_claim_payload(agent_id, refresh_current=False)
            except Exception:
                live_world = {}
            if live_world.get("conflict"):
                _live_agent_loop_stat(agent_state, "skippedWorldConflict")
                agent_state["lastOutcome"] = {"at": now_iso, "status": "skipped", "reason": "live-world-conflict", "liveWorld": {k: live_world.get(k) for k in ("conflict", "notice", "claim")}}
                result["skipped"].append({"agentId": agent_id, "reason": "live-world-conflict", "notice": live_world.get("notice")})
                continue

            _live_agent_loop_presence(agent_id, "idle", "Living in My Virtual World")
            perception = _live_agent_loop_build_perception(agent_id, agent_state, world_client=world_client, now_epoch=now_epoch)

            active = perception.get("active") or []
            if active:
                watchdog_cancel = _live_agent_loop_monitor_route_progress(state, agent_id, agent_state, _active_behavior_records_for_agent(agent_id), now_epoch, now_iso)
                if watchdog_cancel and watchdog_cancel.get("cancelled"):
                    result["skipped"].append({"agentId": agent_id, "reason": "route-watchdog-cancelled", "watchdog": watchdog_cancel})
                    continue
                _live_agent_loop_stat(agent_state, "skippedActive")
                agent_state["lastOutcome"] = {"at": now_iso, "status": "skipped", "reason": "active-behavior", "active": active, "perceptionAt": perception.get("at")}
                _live_agent_loop_presence(agent_id, "working", "Living in My Virtual World")
                result["skipped"].append({"agentId": agent_id, "reason": "active-behavior", "active": agent_state["lastOutcome"]["active"]})
                continue

            if state.get("worldClientRequired") and not world_client.get("active") and not force:
                _live_agent_loop_stat(agent_state, "skippedNoClient")
                agent_state["lastOutcome"] = {"at": now_iso, "status": "skipped", "reason": "world-client-inactive", "worldClient": world_client, "perceptionAt": perception.get("at")}
                result["skipped"].append({"agentId": agent_id, "reason": "world-client-inactive", "worldClient": world_client})
                continue

            next_allowed = _live_agent_loop_next_allowed_epoch(agent_state)
            if next_allowed and now_epoch < next_allowed and not force:
                _live_agent_loop_stat(agent_state, "skippedCooldown")
                result["skipped"].append({"agentId": agent_id, "reason": "cooldown", "nextAllowedAt": _epoch_to_utc_iso(next_allowed)})
                continue

            selected, decision = _live_agent_loop_select_next_action(agent_id, agent_state, perception, loop_state=state)
            result["decisions"].append({"agentId": agent_id, "decision": agent_state.get("lastDecision")})
            if not selected:
                _live_agent_loop_stat(agent_state, "targetMisses")
                agent_state["lastOutcome"] = {"at": now_iso, "status": "skipped", "reason": "no-available-loop-target", "decision": decision, "perceptionAt": perception.get("at")}
                result["skipped"].append({"agentId": agent_id, "reason": "no-available-loop-target", "decision": agent_state.get("lastDecision")})
                continue

            action_def = selected["action"]
            visible_action_contract = _live_agent_visible_action_contract(action_def.get("actionType")) or {}
            adaptive_cooldown = _live_agent_loop_cooldown_for_decision(cooldown, decision)
            plan = _live_agent_loop_prepare_plan(agent_state, agent_id, action_def, decision, selected, now_iso, persist=not dry_run)
            plan_step = _live_agent_loop_plan_current_step(plan)
            request_id = f"live-loop-{agent_id}-{int(now_epoch)}"
            payload = {
                "agentId": agent_id,
                "source": {
                    "kind": "agent-live-mode",
                    "requestedBy": "server.py#live_agent_loop_tick",
                    "requestId": request_id,
                    "surface": "agent-live-loop",
                    "roles": ["participant"],
                    "loopId": LIVE_AGENT_LOOP_SCHEMA_VERSION,
                },
                "actionType": action_def["actionType"],
                "capabilityTag": action_def["capabilityTag"],
                "target": selected["target"],
                "priority": "normal",
                "params": {
                    "reason": "continuous-presence",
                    "loopActionId": action_def["id"],
                    "loopActionLabel": action_def.get("label"),
                    "loopNeed": action_def.get("need"),
                    "planSchemaVersion": LIVE_AGENT_LOOP_PLAN_SCHEMA_VERSION,
                    "planId": plan.get("id") if isinstance(plan, dict) else None,
                    "planStepId": plan_step.get("id") if isinstance(plan_step, dict) else None,
                    "decisionMode": decision.get("mode") if isinstance(decision, dict) else LIVE_AGENT_LOOP_DEFAULTS["decisionMode"],
                    "decisionReason": decision.get("reason") if isinstance(decision, dict) else None,
                    "perceptionAt": perception.get("at"),
                    "worldClientActive": world_client.get("active"),
                    "serverRuntimeAuthority": True,
                    "serverExecutor": WORLD_ACTION_SERVER_RUNTIME_OWNER,
                    "visibleActionContractVersion": LIVE_AGENT_VISIBLE_ACTION_CONTRACT_VERSION,
                    "visibleActionPolicy": "visible-world-execution-required",
                    "visibleWorldAction": True,
                    "hiddenWorldMutationAllowed": False,
                    "visibleExecutor": visible_action_contract.get("clientExecutor"),
                    "requiresPhysicalAgentPresence": True,
                },
            }
            if isinstance(selected.get("buildSite"), dict):
                payload["params"]["buildSite"] = _copy_jsonable(selected.get("buildSite"))
            if dry_run:
                agent_state["lastOutcome"] = {"at": now_iso, "status": "dry-run", "wouldRequest": payload, "wouldPlan": plan, "decision": decision, "perception": perception}
                result["actionsCreated"].append({"agentId": agent_id, "dryRun": True, "request": payload, "target": selected, "decision": agent_state.get("lastDecision"), "plan": plan})
                continue

            ok, created, status = create_agent_live_mode_action_request(payload)
            if ok:
                action = created.get("action") if isinstance(created, dict) else {}
                action_id = action.get("id") if isinstance(action, dict) else None
                _live_agent_loop_stat(agent_state, "actionsCreated")
                _live_agent_loop_stat(state, "actionsCreated")
                agent_state["lastActionAt"] = now_iso
                agent_state["lastActionId"] = action_id
                agent_state["nextAllowedAt"] = _epoch_to_utc_iso(now_epoch + adaptive_cooldown)
                stored_plan = _live_agent_loop_mark_plan_action_created(state, agent_id, agent_state, plan, action_id, now_iso)
                agent_state["lastOutcome"] = {"at": now_iso, "status": "created", "actionId": action_id, "loopActionId": action_def["id"], "planId": (stored_plan or plan or {}).get("id"), "httpStatus": status, "decision": agent_state.get("lastDecision"), "perceptionAt": perception.get("at"), "cooldownSec": adaptive_cooldown}
                _live_agent_loop_presence(agent_id, "working", f"Living in My Virtual World: {action_def.get('label')}")
                _live_agent_loop_add_event(state, "action-created", agent_id=agent_id, details={"actionId": action_id, "loopActionId": action_def["id"], "planId": (stored_plan or plan or {}).get("id"), "target": selected["target"], "decision": agent_state.get("lastDecision")})
                result["actionsCreated"].append({"agentId": agent_id, "actionId": action_id, "loopActionId": action_def["id"], "planId": (stored_plan or plan or {}).get("id"), "httpStatus": status, "decision": agent_state.get("lastDecision"), "cooldownSec": adaptive_cooldown})
                actions_created_this_tick += 1
            else:
                _live_agent_loop_stat(agent_state, "errors")
                _live_agent_loop_stat(state, "errors")
                agent_state["nextAllowedAt"] = _epoch_to_utc_iso(now_epoch + min(45, cooldown))
                failed_plan = _live_agent_loop_mark_plan_action_request_failed(state, agent_id, agent_state, plan, created, now_iso)
                agent_state["lastOutcome"] = {"at": now_iso, "status": "error", "httpStatus": status, "error": created, "planId": (failed_plan or plan or {}).get("id"), "decision": agent_state.get("lastDecision"), "perceptionAt": perception.get("at")}
                _live_agent_loop_add_feedback(state, agent_id, "error", "Live Mode action request failed.", {"httpStatus": status, "error": created})
                _live_agent_loop_add_event(state, "action-error", agent_id=agent_id, details={"httpStatus": status, "error": created})
                result["errors"].append({"agentId": agent_id, "httpStatus": status, "error": created})

            if actions_created_this_tick >= max_actions:
                break

        if not dry_run:
            save_live_agent_loop_state(state)
        return result


def get_live_agent_loop_status():
    with _live_agent_loop_lock:
        state = get_live_agent_loop_state(persist_migration=True)
        stale_expired = _live_agent_loop_reconcile_stale_active_behaviors(state)
        if _live_agent_loop_refresh_completed_outcomes(state) or stale_expired:
            state = save_live_agent_loop_state(state)
        thread_alive = bool(_live_agent_loop_thread and _live_agent_loop_thread.is_alive())
        pause = _live_agent_loop_pause_status(state)
        return {
            "ok": True,
            "schemaVersion": LIVE_AGENT_LOOP_SCHEMA_VERSION,
            "state": state,
            "runtime": {
                "threadAlive": thread_alive,
                "worldClient": _live_agent_loop_world_client_status(state),
                "pause": pause,
                "staleExpired": stale_expired,
                "guardrails": {
                    "worldClientRequired": state.get("worldClientRequired"),
                    "maxActionsPerTick": state.get("maxActionsPerTick"),
                    "minActionIntervalSec": state.get("minActionIntervalSec"),
                    "onlyAgentsWithAgentLiveModeEnabled": True,
                    "userChatPreemptionEnabled": state.get("userChatPreemptionEnabled", True),
                    "userChatPreemptionHoldSec": state.get("userChatPreemptionHoldSec"),
                },
                "modelDecision": {
                    "enabled": state.get("modelDecisionEnabled", True),
                    "mode": LIVE_AGENT_LOOP_MODEL_DECISION_MODE,
                    "timeoutSec": state.get("modelDecisionTimeoutSec"),
                    "minIntervalSec": state.get("modelDecisionMinIntervalSec"),
                    "supportedProviders": sorted(LIVE_AGENT_LOOP_MODEL_DECISION_SOURCES),
                },
                "userAttention": {
                    agent_id: live_agent_user_attention_status(agent_id)
                    for agent_id in list((state.get("agents") or {}).keys())[:32]
                    if live_agent_user_attention_status(agent_id).get("active")
                },
            },
        }


def get_live_agent_loop_perception(agent_id):
    with _live_agent_loop_lock:
        resolved_agent_id = _resolve_agent_id(agent_id)
        if not resolved_agent_id:
            return False, _api_error("agent_not_found", "agentId must reference an existing live-mode-capable agent.", details={"agentId": agent_id}), 404
        state = get_live_agent_loop_state(persist_migration=True)
        agent_state = _live_agent_loop_agent_state(state, resolved_agent_id)
        world_client = _live_agent_loop_world_client_status(state)
        perception = _live_agent_loop_build_perception(resolved_agent_id, agent_state, world_client=world_client)
        decision = _live_agent_loop_build_decision_frame(resolved_agent_id, perception, agent_state)
        saved = save_live_agent_loop_state(state)
        return True, {"ok": True, "agentId": resolved_agent_id, "perception": perception, "decision": decision, "state": (saved.get("agents") or {}).get(resolved_agent_id, agent_state)}, 200


def _live_agent_loop_limited_feedback_reports(agent_state, limit=None):
    reports = [item for item in (agent_state.get("feedbackReports") or []) if isinstance(item, dict)]
    if limit is None:
        return reports
    limit_value = _normalize_int(limit, LIVE_AGENT_LOOP_DEFAULTS["feedbackRetention"], minimum=1, maximum=LIVE_AGENT_LOOP_DEFAULTS["feedbackRetention"])
    return reports[-limit_value:]


def _live_agent_loop_timeline_timestamp(*values):
    for value in values:
        if _parse_isoish_epoch(value):
            return value
    return None


def _live_agent_loop_timeline_sort_key(item):
    return _parse_isoish_epoch(item.get("at")) or 0


def _live_agent_loop_timeline_entry(entry_type, at, title, *, agent_id=None, summary=None, details=None, severity=None):
    entry = {
        "type": str(entry_type or "event"),
        "at": at if _parse_isoish_epoch(at) else _utc_now_iso(),
        "title": _live_agent_loop_clean_plan_text(title, limit=180) or "Live Mode event",
    }
    if agent_id:
        entry["agentId"] = str(agent_id)
    if summary:
        entry["summary"] = _live_agent_loop_clean_plan_text(summary, limit=500)
    if severity:
        entry["severity"] = _live_agent_loop_clean_plan_text(severity, limit=32)
    if isinstance(details, dict):
        entry["details"] = _copy_jsonable(details)
    return entry


def _live_agent_loop_plan_timeline_entries(agent_id, agent_state):
    plans = []
    seen = set()
    active_plan = _live_agent_loop_normalize_plan(agent_state.get("activePlan"))
    if active_plan:
        plans.append(active_plan)
        seen.add(active_plan.get("id"))
    for item in agent_state.get("plans") or []:
        plan = _live_agent_loop_normalize_plan(item)
        if plan and plan.get("id") not in seen:
            plans.append(plan)
            seen.add(plan.get("id"))
    entries = []
    for plan in plans:
        step = _live_agent_loop_plan_current_step(plan)
        at = _live_agent_loop_timeline_timestamp(plan.get("updatedAt"), plan.get("completedAt"), plan.get("failedAt"), plan.get("createdAt"))
        entries.append(_live_agent_loop_timeline_entry(
            "plan",
            at,
            f"Plan {plan.get('status')}: {plan.get('title')}",
            agent_id=agent_id,
            summary=plan.get("operatorSummary"),
            details={
                "planId": plan.get("id"),
                "status": plan.get("status"),
                "loopActionId": plan.get("loopActionId"),
                "actionType": plan.get("actionType"),
                "currentStep": step,
                "retries": plan.get("retries"),
                "maxRetries": plan.get("maxRetries"),
            },
        ))
    return entries


def _live_agent_loop_world_action_timeline_entries(agent_id, limit):
    store = get_world_actions_store(persist_migration=True)
    actions = []
    for bucket in ("active", "history"):
        for action in store.get(bucket, []):
            if not isinstance(action, dict):
                continue
            if agent_id and action.get("agentId") != agent_id:
                continue
            if not _live_agent_loop_owns_world_action(action):
                continue
            summary = _live_agent_loop_action_summary(action)
            timing = action.get("timing") if isinstance(action.get("timing"), dict) else {}
            actions.append((action, summary, bucket, _live_agent_loop_timeline_timestamp(
                timing.get("terminalAt"),
                timing.get("completedAt"),
                timing.get("updatedAt"),
                timing.get("routePendingAt"),
                timing.get("createdAt"),
                timing.get("requestedAt"),
            )))
    actions.sort(key=lambda item: _parse_isoish_epoch(item[3]) or 0, reverse=True)
    entries = []
    for action, summary, bucket, at in actions[:max(1, int(limit))]:
        status = _canonical_world_action_status(action.get("status"))
        entries.append(_live_agent_loop_timeline_entry(
            "world-action",
            at,
            f"World action {status}: {action.get('actionType')}",
            agent_id=action.get("agentId"),
            summary=f"{action.get('actionType')} is {status}.",
            severity="info" if status == "completed" else ("warning" if status in {"cancelled", "expired"} else "error" if status == "failed" else "debug"),
            details={**summary, "bucket": bucket},
        ))
    return entries


def get_live_agent_loop_operator_timeline(agent_id=None, limit=None, include_resolved=True):
    with _live_agent_loop_lock:
        state = get_live_agent_loop_state(persist_migration=True)
        stale_expired = _live_agent_loop_reconcile_stale_active_behaviors(state)
        changed = _live_agent_loop_refresh_completed_outcomes(state)
        if changed or stale_expired:
            state = save_live_agent_loop_state(state)
        resolved_agent_id = None
        if agent_id:
            resolved_agent_id = _resolve_agent_id(agent_id)
            if not resolved_agent_id:
                return False, _api_error("agent_not_found", "agentId must reference an existing live-mode-capable agent.", details={"agentId": agent_id}), 404
        limit_value = _normalize_int(limit, 40, minimum=1, maximum=100) if limit not in (None, "") else 40
        entries = []
        for event in state.get("events") or []:
            if not isinstance(event, dict):
                continue
            event_agent_id = event.get("agentId")
            if resolved_agent_id and event_agent_id != resolved_agent_id:
                continue
            details = event.get("details") if isinstance(event.get("details"), dict) else {}
            entries.append(_live_agent_loop_timeline_entry(
                "loop-event",
                event.get("at"),
                event.get("type"),
                agent_id=event_agent_id,
                summary=details.get("message") or details.get("reason") or details.get("status"),
                details=details,
            ))
        agent_items = ((resolved_agent_id, (state.get("agents") or {}).get(resolved_agent_id)) if resolved_agent_id else None)
        if agent_items:
            iterable_agents = [agent_items]
        else:
            iterable_agents = [(key, value) for key, value in (state.get("agents") or {}).items() if isinstance(value, dict)]
        for current_agent_id, agent_state in iterable_agents:
            if not isinstance(agent_state, dict):
                continue
            _live_agent_loop_agent_state(state, current_agent_id)
            last_decision = agent_state.get("lastDecision") if isinstance(agent_state.get("lastDecision"), dict) else {}
            if last_decision:
                entries.append(_live_agent_loop_timeline_entry(
                    "decision",
                    last_decision.get("at") or agent_state.get("lastHeartbeatAt"),
                    f"Decision: {last_decision.get('selectedActionLabel') or last_decision.get('selectedActionId') or 'skip'}",
                    agent_id=current_agent_id,
                    summary=last_decision.get("reason"),
                    details=last_decision,
                ))
            for report in _live_agent_loop_limited_feedback_reports(agent_state):
                entries.append(_live_agent_loop_timeline_entry(
                    "feedback",
                    report.get("at"),
                    report.get("message"),
                    agent_id=current_agent_id,
                    severity=report.get("level"),
                    details=report.get("details") if isinstance(report.get("details"), dict) else {},
                ))
            entries.extend(_live_agent_loop_plan_timeline_entries(current_agent_id, agent_state))
        for proposal in _live_agent_loop_limited_operator_proposals(
            state,
            agent_id=resolved_agent_id,
            include_resolved=bool(include_resolved),
            limit=LIVE_AGENT_LOOP_DEFAULTS["operatorProposalRetention"],
        ):
            entries.append(_live_agent_loop_timeline_entry(
                "proposal",
                _live_agent_loop_timeline_timestamp(proposal.get("updatedAt"), proposal.get("requestedAt")),
                proposal.get("title"),
                agent_id=proposal.get("agentId"),
                summary=proposal.get("summary"),
                severity="warning" if proposal.get("status") == "pending" else "info",
                details={
                    "proposalId": proposal.get("id"),
                    "status": proposal.get("status"),
                    "actionType": proposal.get("actionType"),
                    "requiredExecutor": proposal.get("requiredExecutor"),
                    "hiddenWorldMutationAllowed": False,
                    "executesOnApproval": False,
                },
            ))
        entries.extend(_live_agent_loop_world_action_timeline_entries(resolved_agent_id, limit_value))
        entries.sort(key=_live_agent_loop_timeline_sort_key, reverse=True)
        entries = entries[:limit_value]
        pending_count = len(_live_agent_loop_limited_operator_proposals(state, include_resolved=False, limit=LIVE_AGENT_LOOP_DEFAULTS["operatorProposalRetention"]))
        return True, {
            "ok": True,
            "schemaVersion": LIVE_AGENT_OPERATOR_TIMELINE_SCHEMA_VERSION,
            "agentId": resolved_agent_id,
            "limit": limit_value,
            "entries": entries,
            "summary": {
                "entryCount": len(entries),
                "pendingProposalCount": pending_count,
                "activeWorldActionCount": len(get_world_actions_store(persist_migration=True).get("active", [])),
                "threadAlive": bool(_live_agent_loop_thread and _live_agent_loop_thread.is_alive()),
                "worldClientActive": _live_agent_loop_world_client_status(state).get("active"),
                "pause": _live_agent_loop_pause_status(state),
            },
            "policy": {
                "readOnly": True,
                "hiddenWorldMutationAllowed": False,
                "approvalDoesNotExecute": True,
                "requiresVisibleExecutorForMutations": True,
            },
        }, 200


def get_live_agent_loop_feedback(agent_id=None, limit=None):
    with _live_agent_loop_lock:
        state = get_live_agent_loop_state(persist_migration=True)
        limit_value = None
        if limit not in (None, ""):
            limit_value = _normalize_int(limit, LIVE_AGENT_LOOP_DEFAULTS["feedbackRetention"], minimum=1, maximum=LIVE_AGENT_LOOP_DEFAULTS["feedbackRetention"])
        reports = {}
        if agent_id:
            resolved_agent_id = _resolve_agent_id(agent_id)
            if not resolved_agent_id:
                return False, _api_error("agent_not_found", "agentId must reference an existing live-mode-capable agent.", details={"agentId": agent_id}), 404
            agent_state = _live_agent_loop_agent_state(state, resolved_agent_id)
            reports[resolved_agent_id] = _live_agent_loop_limited_feedback_reports(agent_state, limit_value)
        else:
            for resolved_agent_id, agent_state in (state.get("agents") or {}).items():
                if isinstance(agent_state, dict):
                    reports[resolved_agent_id] = _live_agent_loop_limited_feedback_reports(agent_state, limit_value)
        return True, {"ok": True, "feedbackReports": reports, **({"limit": limit_value} if limit_value is not None else {})}, 200


def get_live_agent_loop_operator_proposals(agent_id=None, include_resolved=False, limit=None):
    with _live_agent_loop_lock:
        state = get_live_agent_loop_state(persist_migration=True)
        resolved_agent_id = None
        if agent_id:
            resolved_agent_id = _resolve_agent_id(agent_id)
            if not resolved_agent_id:
                return False, _api_error("agent_not_found", "agentId must reference an existing live-mode-capable agent.", details={"agentId": agent_id}), 404
        proposals = _live_agent_loop_limited_operator_proposals(
            state,
            agent_id=resolved_agent_id,
            include_resolved=bool(include_resolved),
            limit=limit,
        )
        pending_count = len(_live_agent_loop_limited_operator_proposals(state, include_resolved=False, limit=LIVE_AGENT_LOOP_DEFAULTS["operatorProposalRetention"]))
        return True, {
            "ok": True,
            "schemaVersion": LIVE_AGENT_OPERATOR_PROPOSAL_SCHEMA_VERSION,
            "pendingCount": pending_count,
            "proposals": proposals,
            "policy": {
                "hiddenWorldMutationAllowed": False,
                "approvalDoesNotExecute": True,
                "requiresTypedVisibleExecutor": True,
            },
        }, 200


def resolve_live_agent_loop_operator_proposal(payload):
    if not isinstance(payload, dict):
        return False, _api_error("invalid_payload", "Operator proposal payload must be an object."), 400
    proposal_id = _live_agent_loop_clean_plan_text(payload.get("proposalId") or payload.get("id"), limit=160)
    if not proposal_id:
        return False, _api_error("invalid_payload", "proposalId is required."), 400
    status = _live_agent_loop_operator_proposal_status(payload.get("status") or payload.get("choice"), default="")
    if status not in {"acknowledged", "vetoed", "dismissed"}:
        return False, _api_error("invalid_payload", "status must be acknowledged, vetoed, or dismissed.", details={"allowed": ["acknowledged", "vetoed", "dismissed"]}), 400
    now_iso = _utc_now_iso()
    actor = _live_agent_loop_clean_plan_text(payload.get("actor") or payload.get("resolvedBy") or "operator", limit=120) or "operator"
    note = _live_agent_loop_clean_plan_text(payload.get("note") or payload.get("operatorNote"), limit=500)
    with _live_agent_loop_lock:
        state = get_live_agent_loop_state(persist_migration=True)
        proposals = []
        resolved = None
        for item in state.get("operatorProposals") or []:
            proposal = _live_agent_loop_normalize_operator_proposal(item)
            if not proposal:
                continue
            if proposal.get("id") == proposal_id:
                proposal["status"] = status
                proposal["updatedAt"] = now_iso
                proposal["resolvedAt"] = now_iso
                proposal["resolvedBy"] = actor
                if note:
                    proposal["operatorNote"] = note
                resolved = proposal
            proposals.append(proposal)
        if not resolved:
            return False, _api_error("proposal_not_found", "Unknown Live Mode operator proposal.", details={"proposalId": proposal_id}), 404
        state["operatorProposals"] = proposals[-LIVE_AGENT_LOOP_DEFAULTS["operatorProposalRetention"]:]
        _live_agent_loop_add_event(state, "operator-proposal-resolved", agent_id=resolved.get("agentId"), details={"proposalId": proposal_id, "status": status, "resolvedBy": actor})
        saved = save_live_agent_loop_state(state)
        pending_count = len(_live_agent_loop_limited_operator_proposals(saved, include_resolved=False, limit=LIVE_AGENT_LOOP_DEFAULTS["operatorProposalRetention"]))
        return True, {
            "ok": True,
            "proposal": resolved,
            "pendingCount": pending_count,
            "policy": {
                "hiddenWorldMutationAllowed": False,
                "approvalDoesNotExecute": True,
                "requiresTypedVisibleExecutor": True,
            },
        }, 200


def update_live_agent_loop_settings(payload):
    if not isinstance(payload, dict):
        return False, _api_error("invalid_payload", "Live agent loop settings payload must be an object."), 400
    with _live_agent_loop_lock:
        state = get_live_agent_loop_state(persist_migration=True)
        now_epoch = time.time()
        now_iso = _epoch_to_utc_iso(now_epoch)
        changed = {}
        for key in ("enabled", "worldClientRequired", "modelDecisionEnabled", "userChatPreemptionEnabled"):
            if key in payload:
                if not isinstance(payload.get(key), bool):
                    return False, _api_error("invalid_payload", f"{key} must be a boolean."), 400
                state[key] = False if key == "worldClientRequired" else payload[key]
                changed[key] = state[key]
        state["serverRuntimeAuthority"] = True
        if "clearWorldClientActivity" in payload:
            if not isinstance(payload.get("clearWorldClientActivity"), bool):
                return False, _api_error("invalid_payload", "clearWorldClientActivity must be a boolean."), 400
            if payload.get("clearWorldClientActivity"):
                changed["clearWorldClientActivity"] = clear_live_agent_loop_world_client_activity()
        if "clearPause" in payload:
            if not isinstance(payload.get("clearPause"), bool):
                return False, _api_error("invalid_payload", "clearPause must be a boolean."), 400
            if payload.get("clearPause"):
                state["pausedUntil"] = None
                state["pauseReason"] = None
                state["pausedAt"] = None
                state["pausedBy"] = None
                changed["pause"] = {"active": False, "cleared": True}
        if "pauseSec" in payload:
            pause_sec = _normalize_int(payload.get("pauseSec"), 0, minimum=0, maximum=3600)
            if pause_sec <= 0:
                state["pausedUntil"] = None
                state["pauseReason"] = None
                state["pausedAt"] = None
                state["pausedBy"] = None
                changed["pause"] = {"active": False, "cleared": True}
            else:
                reason = str(payload.get("pauseReason") or payload.get("reason") or "operator-requested-pause").strip()[:160]
                paused_by = str(payload.get("pausedBy") or payload.get("actor") or "api").strip()[:80]
                state["pausedUntil"] = _epoch_to_utc_iso(now_epoch + pause_sec)
                state["pauseReason"] = reason
                state["pausedAt"] = now_iso
                state["pausedBy"] = paused_by
                changed["pause"] = _live_agent_loop_pause_status(state, now_epoch=now_epoch)
        int_limits = {
            "intervalSec": (10, 300),
            "minActionIntervalSec": (30, 3600),
            "clientActiveTtlSec": (10, 300),
            "maxActionsPerTick": (1, 5),
            "modelDecisionTimeoutSec": (10, 180),
            "modelDecisionMinIntervalSec": (30, 3600),
            "userChatPreemptionHoldSec": (30, 1800),
        }
        for key, (minimum, maximum) in int_limits.items():
            if key in payload:
                state[key] = _normalize_int(payload.get(key), state.get(key) or LIVE_AGENT_LOOP_DEFAULTS[key], minimum=minimum, maximum=maximum)
                changed[key] = state[key]
        agent_id = _resolve_agent_id(payload.get("agentId")) if payload.get("agentId") else None
        if agent_id and "agentEnabled" in payload:
            if not isinstance(payload.get("agentEnabled"), bool):
                return False, _api_error("invalid_payload", "agentEnabled must be a boolean."), 400
            agent_state = _live_agent_loop_agent_state(state, agent_id)
            agent_state["enabled"] = payload["agentEnabled"]
            changed["agentEnabled"] = {"agentId": agent_id, "enabled": payload["agentEnabled"]}
        _live_agent_loop_add_event(state, "settings-updated", details=changed)
        saved = save_live_agent_loop_state(state)
        return True, {"ok": True, "state": saved, "changed": changed, "runtime": {"pause": _live_agent_loop_pause_status(saved), "worldClient": _live_agent_loop_world_client_status(saved)}}, 200


def start_live_agent_loop():
    global _live_agent_loop_thread
    if _live_agent_loop_thread and _live_agent_loop_thread.is_alive():
        return

    def loop():
        while not _live_agent_loop_stop.is_set():
            interval = LIVE_AGENT_LOOP_DEFAULTS["intervalSec"]
            try:
                tick = live_agent_loop_tick(reason="timer")
                state = get_live_agent_loop_state()
                interval = _normalize_int(state.get("intervalSec"), interval, minimum=10, maximum=300)
                if tick.get("errors"):
                    print(f"⚠️  Live Mode loop tick errors: {tick.get('errors')}")
            except Exception as e:
                print(f"⚠️  Live Mode loop tick failed: {e}")
            _live_agent_loop_stop.wait(interval)

    _live_agent_loop_thread = threading.Thread(target=loop, daemon=True, name="vw-live-agent-loop")
    _live_agent_loop_thread.start()


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
    target_action_id = action_id or target.get("worldActionId") or target.get("actionId")
    resolved = None
    metadata = {"kind": kind, "floor": floor, "roomId": room_id, "actionId": target_action_id, "worldActionId": target_action_id, "guardrails": MOVE_INTENT_ROUTE_GUARDRAILS}

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
        normalized = {"kind": "world-point", "x": x, "y": y, "floor": floor, "buildingId": building_id, "roomId": room_id, "actionId": target_action_id, "worldActionId": target_action_id, "targetKind": "world-point"}
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
        normalized = {"kind": kind, "buildingId": building_id, "floor": floor, "roomId": room_id, "actionId": target_action_id, "worldActionId": target_action_id, "targetKind": kind}
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
        "worldActionId": target_action_id,
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
        server_authoritative_runtime = _behavior_source_kind_from_record(updated) == "agent-live-mode"
        route.update({
            "state": move_intent.get("routeStatus"),
            "status": move_intent.get("routeStatus"),
            "target": move_intent.get("target"),
            "targetMetadata": move_intent.get("targetMetadata"),
            "handoff": WORLD_ACTION_SERVER_RUNTIME_OWNER if server_authoritative_runtime else WORLD_ACTION_CREATE_ROUTE_OWNER,
            "routeOwner": "server-authoritative-runtime" if server_authoritative_runtime else "client-runtime",
            "setAgentTarget": False if server_authoritative_runtime else True,
            "serverExecutor": WORLD_ACTION_SERVER_RUNTIME_OWNER if server_authoritative_runtime else None,
            "serverRuntimeAuthority": server_authoritative_runtime,
            "worldActionId": action_id,
            "source": move_intent.get("source"),
            "behavior": move_intent.get("behavior"),
            "behaviorSourceKind": move_intent.get("behaviorSourceKind"),
            "behaviorMode": move_intent.get("behaviorMode"),
            "behaviorCategory": move_intent.get("behaviorCategory"),
            "moveIntent": {"id": move_intent.get("id"), "state": move_intent.get("routeStatus"), "createdAt": move_intent.get("createdAt"), "worldActionId": action_id},
        })
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
    linked_action_id = payload.get("worldActionId") or payload.get("actionId")
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
    action_id = linked_action_id or target.get("worldActionId") or target.get("actionId")
    busy = _agent_busy_for_move(agent_id, action_id=action_id)
    if busy:
        return False, _api_error("agent_unavailable", "Agent already has an active action or move intent.", details=busy), 409
    now = _utc_now_iso()
    planner = _route_planner_for_target(target.get("kind"), _find_world_action_target(target), target)
    server_authoritative_runtime = source.get("kind") == "agent-live-mode"
    route = {
        "id": f"route-{_move_intent_id(agent_id)}",
        "state": "route_pending",
        "status": "route_pending",
        "target": target,
        "targetMetadata": metadata,
        "handoff": WORLD_ACTION_SERVER_RUNTIME_OWNER if server_authoritative_runtime else WORLD_ACTION_CREATE_ROUTE_OWNER,
        "routeOwner": "server-authoritative-runtime" if server_authoritative_runtime else "client-runtime",
        "setAgentTarget": False if server_authoritative_runtime else True,
        "serverExecutor": WORLD_ACTION_SERVER_RUNTIME_OWNER if server_authoritative_runtime else None,
        "serverRuntimeAuthority": server_authoritative_runtime,
        "routingOwner": WORLD_ACTION_SERVER_RUNTIME_OWNER if server_authoritative_runtime else "main3d.js#setAgentTarget()",
        "planner": planner,
        "collisionGuardrails": MOVE_INTENT_ROUTE_GUARDRAILS,
        "worldActionId": action_id,
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
        "worldActionId": action_id,
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


def _transition_world_action_unlocked(action_id, to_status, *, result=None, failure_reason=None, actor=None, source="api"):
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


def transition_world_action(action_id, to_status, *, result=None, failure_reason=None, actor=None, source="api"):
    with _live_agent_action_handoff_lock:
        return _transition_world_action_unlocked(action_id, to_status, result=result, failure_reason=failure_reason, actor=actor, source=source)


def _reconcile_world_action_reservations_unlocked():
    store = get_world_actions_store(persist_migration=True)
    changed = False
    active = []
    history = list(store.get("history", []))
    now_epoch = time.time()
    for action in store.get("active", []):
        target = action.get("target") if isinstance(action.get("target"), dict) else {}
        timing = action.get("timing") if isinstance(action.get("timing"), dict) else {}
        status = _canonical_world_action_status(action.get("status"))
        behavior_source_kind = _behavior_source_kind_from_record(action)
        timeout_ms = timing.get("timeoutMs")
        created_epoch = _parse_isoish_epoch(timing.get("createdAt"))
        timed_out = isinstance(timeout_ms, (int, float)) and timeout_ms > 0 and created_epoch is not None and now_epoch >= created_epoch + timeout_ms / 1000
        missing_state = _target_deleted_or_missing(target, _find_world_action_target(target)) if target.get("kind") == "object-instance" else None
        if (
            missing_state in {"deleted", "missing"}
            and behavior_source_kind == "agent-live-mode"
            and status in WORLD_ACTION_ACTIVE_STATES
        ):
            # Live Mode routes are consumed by the server-authoritative realtime
            # runtime while buildings can be saving/reloading. Treat transient
            # lookup misses as pending; the stale-action reconciler expires
            # genuinely stuck routes.
            active.append(action)
            continue
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


def reconcile_world_action_reservations():
    with _live_agent_action_handoff_lock:
        return _reconcile_world_action_reservations_unlocked()

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


STARTER_OFFICE_ID = "bld_1781275645157"
STARTER_OFFICE_COUNTER_INDEX = 17
STARTER_OFFICE_MICROWAVE_INDEX = 18
STARTER_OFFICE_COFFEE_INDEX = 19
COUNTER_APPLIANCE_SLOT_ACCEPTS = ["countertopCoffeeMachine", "microwave"]


def _merge_missing(target, defaults):
    if not isinstance(target, dict):
        return copy.deepcopy(defaults)
    for key, value in defaults.items():
        if key not in target or target[key] is None:
            target[key] = copy.deepcopy(value)
        elif isinstance(target.get(key), dict) and isinstance(value, dict):
            _merge_missing(target[key], value)
    return target


def _starter_counter_appliance_slots():
    return [
        {"id": "appliance-left", "dx": -0.86, "dz": 0, "y": 0.91, "accepts": list(COUNTER_APPLIANCE_SLOT_ACCEPTS), "occupiedBy": None},
        {"id": "appliance-center", "dx": 0, "dz": 0, "y": 0.91, "accepts": list(COUNTER_APPLIANCE_SLOT_ACCEPTS), "occupiedBy": STARTER_OFFICE_COFFEE_INDEX},
        {"id": "appliance-right", "dx": 0.86, "dz": 0, "y": 0.91, "accepts": list(COUNTER_APPLIANCE_SLOT_ACCEPTS), "occupiedBy": STARTER_OFFICE_MICROWAVE_INDEX},
    ]


def repair_starter_office_appliance_metadata(building):
    """Keep the starter Office counter appliances mounted across old saved volumes."""
    if not isinstance(building, dict):
        return building
    if building.get("id") != STARTER_OFFICE_ID and building.get("name") != "Office":
        return building
    furniture = ((building.get("interior") or {}).get("furniture") or [])
    if not isinstance(furniture, list) or len(furniture) <= STARTER_OFFICE_COFFEE_INDEX:
        return building

    counter = furniture[STARTER_OFFICE_COUNTER_INDEX]
    microwave = furniture[STARTER_OFFICE_MICROWAVE_INDEX]
    coffee = furniture[STARTER_OFFICE_COFFEE_INDEX]
    if not (
        isinstance(counter, dict) and counter.get("type") == "counter" and
        isinstance(microwave, dict) and microwave.get("type") == "microwave" and
        isinstance(coffee, dict) and coffee.get("type") == "countertopCoffeeMachine"
    ):
        return building

    counter.update({
        "stationary": True,
        "carryable": False,
        "temporary": False,
        "persistsUntilDeleted": True,
        "assetClass": "stationary-persistent-kitchen-counter-with-appliance-slots",
        "applianceSlots": _starter_counter_appliance_slots(),
    })
    _merge_missing(counter, {
        "lifecycle": {
            "stationary": True,
            "carryable": False,
            "temporary": False,
            "persistsUntilDeleted": True,
            "surfaceMount": {
                "kind": "counter-appliance-slots",
                "slotIds": ["appliance-left", "appliance-center", "appliance-right"],
                "accepts": list(COUNTER_APPLIANCE_SLOT_ACCEPTS),
                "interaction": "counter stores placement slots only; agents target the placed appliance, not the counter",
            },
        },
        "counterState": {
            "applianceSlotCount": 3,
            "occupiedApplianceSlots": 2,
            "acceptsAppliances": list(COUNTER_APPLIANCE_SLOT_ACCEPTS),
            "persistentFurniture": True,
        },
    })
    counter["counterState"].update({
        "applianceSlotCount": 3,
        "occupiedApplianceSlots": 2,
        "acceptsAppliances": list(COUNTER_APPLIANCE_SLOT_ACCEPTS),
        "persistentFurniture": True,
    })

    microwave.update({
        "stationary": True,
        "carryable": False,
        "temporary": False,
        "persistsUntilDeleted": True,
        "assetClass": "stationary-persistent-quick-heating-appliance",
        "surfaceMount": {
            "requiredSurfaceType": "counter",
            "slotKind": "counter-appliance",
            "allowedSlotIds": ["appliance-left", "appliance-center", "appliance-right"],
            "parentFurnitureIndex": STARTER_OFFICE_COUNTER_INDEX,
            "slotId": "appliance-right",
            "relativeRotation": 0,
            "visualMountHeight": 0.91,
        },
    })
    _merge_missing(microwave, {
        "lifecycle": {
            "stationary": True,
            "carryable": False,
            "temporary": False,
            "persistsUntilDeleted": True,
            "spawnsTemporary": {
                "catalogId": "temporaryFood",
                "label": "Microwave Food",
                "itemPool": ["Popcorn", "Pizza Slice", "Sandwich"],
                "foodItems": [
                    {"id": "popcorn", "label": "Popcorn", "visualKind": "microwave-popcorn"},
                    {"id": "pizza-slice", "label": "Pizza Slice", "visualKind": "microwave-pizza-slice"},
                    {"id": "sandwich", "label": "Sandwich", "visualKind": "microwave-sandwich"},
                ],
                "carryable": True,
                "attachPoint": "right-hand",
                "temporary": True,
                "validDropOff": ["desk", "diningTable", "smallCafeTable", "outdoorCafeTable", "picnicTable", "patioTable", "counter", "cafeCounter"],
            },
        },
        "applianceState": {
            "doorOpen": False,
            "status": "ready",
            "activeSlotIds": [],
            "reservedSlotIds": [],
            "lastAction": "life.heatFood",
            "lastInteractionSpotId": "use-front",
            "animationId": "microwave-use",
            "facingVerified": True,
            "reachableUseFrontSpot": True,
            "persistentFurniture": True,
        },
    })

    coffee.update({
        "stationary": True,
        "carryable": False,
        "temporary": False,
        "persistsUntilDeleted": True,
        "assetClass": "stationary-persistent-countertop-beverage-appliance",
        "surfaceMount": {
            "requiredSurfaceType": "counter",
            "slotKind": "counter-appliance",
            "allowedSlotIds": ["appliance-left", "appliance-center", "appliance-right"],
            "parentFurnitureIndex": STARTER_OFFICE_COUNTER_INDEX,
            "slotId": "appliance-center",
            "relativeRotation": 0,
            "visualMountHeight": 0.91,
        },
    })
    _merge_missing(coffee, {
        "lifecycle": {
            "stationary": True,
            "carryable": False,
            "temporary": False,
            "persistsUntilDeleted": True,
            "spawnsTemporary": {
                "catalogId": "temporaryFood",
                "label": "Coffee Drink",
                "carryable": True,
                "attachPoint": "right-hand",
                "temporary": True,
                "validDropOff": ["desk", "diningTable", "smallCafeTable", "outdoorCafeTable", "picnicTable", "patioTable", "counter", "cafeCounter"],
            },
        },
        "coffeeState": {
            "status": "ready",
            "activeSlotIds": [],
            "reservedSlotIds": [],
            "lastAction": "life.getCoffee",
            "lastInteractionSpotId": "use-front",
            "animationId": "order-food-drink",
            "facingVerified": True,
            "reachableUseFrontSpot": True,
            "persistentFurniture": True,
        },
    })

    return building


def _live_agent_home_owner_id(building):
    if not isinstance(building, dict):
        return ""
    return str(building.get("liveModeHomeForAgentId") or building.get("ownerAgentId") or "").strip()


def _live_agent_home_starter_furniture_item(building_id, item_type, index, x, z, *, rotation=0, room="sleep-zone", capability_tags=None):
    object_id = f"{building_id}:furn:{item_type}:{index}:live-home-starter"
    tags = list(capability_tags or [])
    return {
        "id": object_id,
        "objectInstanceId": object_id,
        "instanceId": object_id,
        "type": item_type,
        "catalogId": item_type,
        "x": x,
        "z": z,
        "rotation": rotation,
        "floor": 1,
        "room": room,
        "capabilityTags": tags,
        "liveHomeStarterInterior": True,
        "liveHomeInteriorVersion": LIVE_AGENT_HOME_INTERIOR_VERSION,
        "lifecycle": {
            "stationary": True,
            "carryable": False,
            "temporary": False,
            "persistsUntilDeleted": True,
        },
    }


def ensure_live_agent_home_starter_interior(building):
    if not isinstance(building, dict):
        return building, False
    owner_id = _live_agent_home_owner_id(building)
    if not owner_id or building.get("type") != "home":
        return building, False
    interior = building.get("interior") if isinstance(building.get("interior"), dict) else {}
    changed = interior is not building.get("interior")
    floors = interior.get("floors")
    if not isinstance(floors, list) or not floors:
        interior["floors"] = [{"level": 1, "name": "Floor 1"}]
        changed = True
    if not isinstance(interior.get("walls"), list):
        interior["walls"] = []
        changed = True
    furniture = interior.get("furniture")
    if not isinstance(furniture, list):
        furniture = []
        interior["furniture"] = furniture
        changed = True

    has_usable_bed = any(
        isinstance(item, dict)
        and item.get("type") in {"bed", "sleepPod", "sleep-pod"}
        and item.get("deleted") is not True
        and item.get("removed") is not True
        for item in furniture
    )
    version = interior.get("liveModeHomeInteriorVersion")
    if version != LIVE_AGENT_HOME_INTERIOR_VERSION:
        interior["liveModeHomeInteriorVersion"] = LIVE_AGENT_HOME_INTERIOR_VERSION
        interior["homeResidentAgentId"] = owner_id
        interior["homeInteriorSource"] = "agent-live-mode"
        changed = True

    if not has_usable_bed:
        building_id = building.get("id") or f"live-home-{re.sub(r'[^a-z0-9_-]+', '-', owner_id.lower()).strip('-') or 'agent'}"
        width = max(8.0, float(building.get("widthTiles") or 10))
        height = max(7.0, float(building.get("heightTiles") or 8))
        base_index = len(furniture)
        starter_items = [
            _live_agent_home_starter_furniture_item(building_id, "bed", base_index, round(width * 0.50, 2), round(min(height - 2.3, 2.2), 2), capability_tags=["life.rest"]),
            _live_agent_home_starter_furniture_item(building_id, "nightstand", base_index + 1, round(width * 0.68, 2), round(min(height - 2.3, 2.2), 2), capability_tags=["life.rest", "world.decorate"]),
            _live_agent_home_starter_furniture_item(building_id, "armchair", base_index + 2, round(width * 0.33, 2), round(height * 0.66, 2), rotation=180, room="living-zone", capability_tags=["life.rest", "life.social"]),
            _live_agent_home_starter_furniture_item(building_id, "sideTable", base_index + 3, round(width * 0.50, 2), round(height * 0.66, 2), rotation=180, room="living-zone", capability_tags=["life.rest", "world.decorate"]),
            _live_agent_home_starter_furniture_item(building_id, "dresser", base_index + 4, round(width - 1.2, 2), round(height * 0.46, 2), rotation=270, room="sleep-zone", capability_tags=["appearance.customize", "life.rest"]),
        ]
        furniture.extend(starter_items)
        building["homeState"] = {
            **(building.get("homeState") if isinstance(building.get("homeState"), dict) else {}),
            "starterInteriorVersion": LIVE_AGENT_HOME_INTERIOR_VERSION,
            "residentAgentId": owner_id,
            "hasUsableBed": True,
        }
        changed = True

    building["interior"] = interior
    return building, changed


def load_building(building_id):
    path = building_path(building_id)
    try:
        with open(path, "r") as f:
            data = strip_building_transient_object_assignments(json.load(f))
            data = repair_starter_office_appliance_metadata(data)
            data, changed = ensure_live_agent_home_starter_interior(data)
            if changed and isinstance(data, dict) and data.get("id"):
                save_building(data["id"], data)
            return data
    except (FileNotFoundError, json.JSONDecodeError):
        return None

def save_building(building_id, data):
    path = building_path(building_id)
    data = strip_building_transient_object_assignments(data)
    data = repair_starter_office_appliance_metadata(data)
    data, _ = ensure_live_agent_home_starter_interior(data)
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
                b = repair_starter_office_appliance_metadata(b)
                b, changed = ensure_live_agent_home_starter_interior(b)
                if changed and isinstance(b, dict) and b.get("id"):
                    save_building(b["id"], b)
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


def _codex_provider():
    if CodexProvider is None:
        return None
    return CodexProvider(
        home_path=CODEX_HOME,
        binary=CODEX_BIN,
        workspace_root=CODEX_WORKSPACE_ROOT,
        enabled=CODEX_ENABLED,
        timeout_sec=CODEX_TIMEOUT_SEC,
        model=CODEX_MODEL,
        sandbox=CODEX_SANDBOX,
        approval_policy=CODEX_APPROVAL_POLICY,
        prefer_app_server=CODEX_PREFER_APP_SERVER,
        main_workspace=CODEX_MAIN_WORKSPACE,
        include_main=CODEX_INCLUDE_MAIN,
        include_native_agents=CODEX_INCLUDE_NATIVE_AGENTS,
        register_native_agents=CODEX_REGISTER_NATIVE_AGENTS,
    )


def _discover_hermes_agents():
    provider = _hermes_provider()
    if not provider:
        return []
    try:
        return provider.discover_agents()
    except Exception as e:
        print(f"⚠️  Virtual World Hermes discovery failed: {e}")
        return []


def _discover_codex_agents():
    provider = _codex_provider()
    if not provider:
        return []
    try:
        return provider.discover_agents()
    except Exception as e:
        print(f"⚠️  Virtual World Codex discovery failed: {e}")
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


def _is_codex_agent(agent_id_or_key):
    needle = str(agent_id_or_key or "").strip()
    if not needle:
        return False
    for agent in get_roster():
        aliases = {str(agent.get("id") or ""), str(agent.get("statusKey") or ""), str(agent.get("providerAgentId") or "")}
        if needle in aliases:
            return agent.get("providerKind") == "codex"
    return needle.startswith("codex:") or needle.startswith("codex-")


def _get_hermes_agent(agent_id_or_key=None):
    needle = str(agent_id_or_key or "").strip()
    for agent in get_roster():
        aliases = {str(agent.get("id") or ""), str(agent.get("statusKey") or ""), str(agent.get("providerAgentId") or "")}
        if agent.get("providerKind") == "hermes" and (not needle or needle in aliases or needle == f"hermes:{agent.get('profile') or agent.get('providerAgentId')}"):
            return agent
    return None


def _get_codex_agent(agent_id_or_key=None):
    needle = str(agent_id_or_key or "").strip()
    for agent in get_roster():
        aliases = {str(agent.get("id") or ""), str(agent.get("statusKey") or ""), str(agent.get("providerAgentId") or "")}
        if agent.get("providerKind") == "codex" and (not needle or needle in aliases or needle == f"codex:{agent.get('profile') or agent.get('providerAgentId')}"):
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


def _codex_history_path(profile="main"):
    safe_profile = re.sub(r"[^A-Za-z0-9_.-]+", "-", str(profile or "main")).strip("-.") or "main"
    return os.path.join(DATA_DIR, f"codex-chat-{safe_profile}.json")


def _load_codex_state(profile="main"):
    try:
        with open(_codex_history_path(profile), "r") as f:
            data = json.load(f)
        if isinstance(data, dict):
            return data
        if isinstance(data, list):
            return {"messages": data, "sessionId": ""}
    except (FileNotFoundError, json.JSONDecodeError, OSError):
        pass
    return {"messages": [], "sessionId": ""}


def _load_codex_history(profile="main"):
    messages = _load_codex_state(profile).get("messages", [])
    return messages if isinstance(messages, list) else []


def _save_codex_state(profile, state):
    os.makedirs(DATA_DIR, exist_ok=True)
    with open(_codex_history_path(profile), "w") as f:
        json.dump(state, f, ensure_ascii=False, indent=2)


def _save_codex_history(profile, messages):
    state = _load_codex_state(profile)
    state["messages"] = messages[-500:]
    state = _apply_codex_usage_to_state(profile, state)
    _save_codex_state(profile, state)


def _get_codex_session_id(profile="main"):
    return str(_load_codex_state(profile).get("sessionId") or "")


def _set_codex_session_id(profile="main", session_id=""):
    state = _load_codex_state(profile)
    state["sessionId"] = session_id or ""
    _save_codex_state(profile, state)


def _claude_code_history_path(profile="main"):
    safe_profile = re.sub(r"[^A-Za-z0-9_.-]+", "-", str(profile or "main")).strip("-.") or "main"
    return os.path.join(DATA_DIR, f"claude-code-chat-{safe_profile}.json")


def _load_claude_code_state(profile="main"):
    try:
        with open(_claude_code_history_path(profile), "r") as f:
            data = json.load(f)
        if isinstance(data, dict):
            return data
        if isinstance(data, list):
            return {"messages": data, "sessionId": ""}
    except (FileNotFoundError, json.JSONDecodeError, OSError):
        pass
    return {"messages": [], "sessionId": ""}


def _load_claude_code_history(profile="main"):
    messages = _load_claude_code_state(profile).get("messages", [])
    return messages if isinstance(messages, list) else []


def _save_claude_code_state(profile, state):
    os.makedirs(DATA_DIR, exist_ok=True)
    with open(_claude_code_history_path(profile), "w") as f:
        json.dump(state, f, ensure_ascii=False, indent=2)


def _get_claude_code_session_id(profile="main"):
    return str(_load_claude_code_state(profile).get("sessionId") or "")


def _as_nonnegative_int(value, default=0):
    try:
        number = int(value)
        return number if number >= 0 else default
    except (TypeError, ValueError):
        return default


def _codex_usage_bucket(raw):
    raw = raw if isinstance(raw, dict) else {}
    return {
        "totalTokens": _as_nonnegative_int(raw.get("total_tokens", raw.get("totalTokens"))),
        "inputTokens": _as_nonnegative_int(raw.get("input_tokens", raw.get("inputTokens"))),
        "cachedInputTokens": _as_nonnegative_int(raw.get("cached_input_tokens", raw.get("cachedInputTokens"))),
        "outputTokens": _as_nonnegative_int(raw.get("output_tokens", raw.get("outputTokens"))),
        "reasoningOutputTokens": _as_nonnegative_int(raw.get("reasoning_output_tokens", raw.get("reasoningOutputTokens"))),
    }


def _normalize_codex_token_usage(raw):
    raw = raw if isinstance(raw, dict) else {}
    info = raw.get("info") if isinstance(raw.get("info"), dict) else raw
    total = _codex_usage_bucket(info.get("total_token_usage") or info.get("total") or {})
    last = _codex_usage_bucket(info.get("last_token_usage") or info.get("last") or {})
    context_window = _as_nonnegative_int(info.get("model_context_window", info.get("modelContextWindow")))
    if not any(total.values()) and not any(last.values()) and not context_window:
        return {}
    return {
        "total": total,
        "last": last,
        "modelContextWindow": context_window,
    }


def _codex_context_used_from_usage(usage):
    usage = usage if isinstance(usage, dict) else {}
    last = usage.get("last") if isinstance(usage.get("last"), dict) else {}
    total = usage.get("total") if isinstance(usage.get("total"), dict) else {}
    return (
        _as_nonnegative_int(last.get("totalTokens"))
        or _as_nonnegative_int(last.get("inputTokens")) + _as_nonnegative_int(last.get("outputTokens")) + _as_nonnegative_int(last.get("reasoningOutputTokens"))
        or _as_nonnegative_int(total.get("totalTokens"))
    )


def _estimate_codex_context_used(messages):
    if not isinstance(messages, list) or not messages:
        return 0
    text_parts = []
    for msg in messages[-40:]:
        if not isinstance(msg, dict):
            continue
        for key in ("text", "thinking", "error"):
            value = msg.get(key)
            if value:
                text_parts.append(str(value))
        tools = msg.get("tools") if isinstance(msg.get("tools"), list) else []
        for tool in tools[-12:]:
            if isinstance(tool, dict):
                text_parts.append(str(tool.get("name") or ""))
                text_parts.append(str(tool.get("arguments") or ""))
                text_parts.append(str(tool.get("result") or tool.get("error") or "")[:4000])
    text = "\n".join(part for part in text_parts if part)
    return max(0, (len(text) // 4) + (len(messages) * 20))


def _codex_session_log_path(session_id):
    session_id = str(session_id or "").strip()
    if not session_id:
        return ""
    pattern = os.path.join(CODEX_HOME, "sessions", "**", f"*{session_id}.jsonl")
    try:
        matches = glob.glob(pattern, recursive=True)
    except (OSError, RuntimeError):
        return ""
    if not matches:
        return ""
    matches.sort(key=lambda p: os.path.getmtime(p) if os.path.exists(p) else 0, reverse=True)
    return matches[0]


def _read_codex_log_token_usage(session_id):
    path = _codex_session_log_path(session_id)
    if not path:
        return {}
    try:
        mtime = os.path.getmtime(path)
    except OSError:
        return {}
    cache_key = f"{session_id}:{path}"
    cached = CODEX_TOKEN_USAGE_CACHE.get(cache_key)
    if isinstance(cached, dict) and cached.get("mtime") == mtime:
        return dict(cached.get("usage") or {})

    latest = {}
    try:
        with open(path, "r") as f:
            for line in f:
                if '"token_count"' not in line:
                    continue
                try:
                    record = json.loads(line)
                except json.JSONDecodeError:
                    continue
                payload = record.get("payload") if isinstance(record.get("payload"), dict) else {}
                if payload.get("type") != "token_count":
                    continue
                usage = _normalize_codex_token_usage(payload.get("info") or {})
                if usage:
                    latest = usage
    except OSError:
        return {}

    CODEX_TOKEN_USAGE_CACHE[cache_key] = {"mtime": mtime, "usage": latest}
    return dict(latest)


def _codex_usage_snapshot(profile="main", session_id="", state=None):
    state = state if isinstance(state, dict) else _load_codex_state(profile)
    session_id = session_id or state.get("sessionId") or ""
    usage = _read_codex_log_token_usage(session_id)
    if not usage:
        usage = _normalize_codex_token_usage(state.get("tokenUsage") or {})
    messages = state.get("messages") if isinstance(state.get("messages"), list) else []
    context_used = _codex_context_used_from_usage(usage)
    if context_used <= 0:
        context_used = _as_nonnegative_int(state.get("contextUsed")) or _estimate_codex_context_used(messages)
    return {
        "tokenUsage": usage,
        "contextUsed": context_used,
        "codexContextWindow": _as_nonnegative_int(usage.get("modelContextWindow")) if isinstance(usage, dict) else 0,
    }


def _apply_codex_usage_to_state(profile, state, session_id=""):
    state = dict(state or {})
    usage = _codex_usage_snapshot(profile, session_id=session_id, state=state)
    if usage.get("tokenUsage"):
        state["tokenUsage"] = usage["tokenUsage"]
    state["contextUsed"] = _as_nonnegative_int(usage.get("contextUsed"))
    if usage.get("codexContextWindow"):
        state["codexContextWindow"] = usage["codexContextWindow"]
    state["updatedAt"] = int(time.time() * 1000)
    return state


def _codex_context_payload(provider_agent=None, agent_key="", profile="", session_id="", model_cfg=None):
    provider_agent = provider_agent if isinstance(provider_agent, dict) else (_get_codex_agent(agent_key) or {})
    model_cfg = model_cfg if isinstance(model_cfg, dict) else _load_openclaw_model_config()
    profile = profile or provider_agent.get("profile") or provider_agent.get("providerAgentId") or "main"
    model = provider_agent.get("model") or CODEX_MODEL or _default_openclaw_model(model_cfg) or "Codex default"
    provider = provider_agent.get("provider") or provider_agent.get("providerKind") or "codex"
    usage = _codex_usage_snapshot(profile, session_id=session_id)
    context_window = _context_window_for_model(model, provider, model_cfg) or _as_nonnegative_int(usage.get("codexContextWindow"))
    payload = {
        "model": model,
        "provider": provider,
        "providerKind": provider_agent.get("providerKind", "codex"),
        "contextWindow": context_window,
        "contextUsed": _as_nonnegative_int(usage.get("contextUsed")),
    }
    if usage.get("codexContextWindow"):
        payload["codexContextWindow"] = usage["codexContextWindow"]
    if usage.get("tokenUsage"):
        payload["tokenUsage"] = usage["tokenUsage"]
    return payload


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


def _remember_hermes_active_run(meta):
    if not isinstance(meta, dict) or not meta.get("runId"):
        return
    with HERMES_ACTIVE_RUNS_LOCK:
        HERMES_ACTIVE_RUNS[str(meta["runId"])] = dict(meta)


def _get_hermes_active_run(run_id):
    with HERMES_ACTIVE_RUNS_LOCK:
        meta = HERMES_ACTIVE_RUNS.get(str(run_id or ""))
        return dict(meta) if isinstance(meta, dict) else None


def _find_hermes_active_run(agent_key="", profile=""):
    with HERMES_ACTIVE_RUNS_LOCK:
        for meta in reversed(list(HERMES_ACTIVE_RUNS.values())):
            if agent_key and agent_key in {meta.get("agentId"), meta.get("agentKey")}:
                return dict(meta)
            if profile and profile == meta.get("profile"):
                return dict(meta)
    return None


def _clear_hermes_active_run(run_id):
    with HERMES_ACTIVE_RUNS_LOCK:
        HERMES_ACTIVE_RUNS.pop(str(run_id or ""), None)


def _remember_codex_active_run(meta):
    if not isinstance(meta, dict) or not meta.get("runId"):
        return
    with CODEX_ACTIVE_RUNS_LOCK:
        CODEX_ACTIVE_RUNS[str(meta["runId"])] = meta


def _get_codex_active_run(run_id):
    with CODEX_ACTIVE_RUNS_LOCK:
        meta = CODEX_ACTIVE_RUNS.get(str(run_id or ""))
        return meta if isinstance(meta, dict) else None


def _clear_codex_active_run(run_id):
    with CODEX_ACTIVE_RUNS_LOCK:
        CODEX_ACTIVE_RUNS.pop(str(run_id or ""), None)


def _set_hermes_presence(agent_id, state, task=""):
    if not _gateway_presence or not agent_id:
        return
    try:
        _gateway_presence.set_manual_override(agent_id, state, task)
    except Exception:
        pass


def _publish_hermes_api_progress(profile, agent_id, run_id, tools=None, reasoning_parts=None, reply=""):
    """Publish in-flight native Hermes API events to the visible chat history."""
    if not run_id:
        return
    progress_id = f"hermes-api-progress-{run_id}"
    history = _load_hermes_history(profile)
    history = [
        msg for msg in history
        if not (isinstance(msg, dict) and msg.get("ephemeral") == "hermes-progress" and msg.get("progressId") == progress_id)
    ]
    now_ms = int(time.time() * 1000)
    history.append({
        "role": "assistant",
        "text": reply or "",
        "ts": now_ms,
        "epochMs": now_ms,
        "agentId": agent_id,
        "from": "Hermes",
        "source": "hermes",
        "ephemeral": "hermes-progress",
        "progressId": progress_id,
        "runId": run_id,
        "sessionId": _get_hermes_session_id(profile) or "",
        "tools": tools or [],
        "thinking": "\n\n".join(reasoning_parts or [])[:12000],
        "reasoningTokens": 0,
    })
    _save_hermes_history(profile, history)


def _format_hermes_attachment_context(attachments):
    if not isinstance(attachments, list) or not attachments:
        return ""
    lines = [
        "Attachments provided by Virtual World:",
        "Use these attachments when answering. Prefer the URL if the local path is not readable from your runtime.",
    ]
    for idx, item in enumerate(attachments, 1):
        if not isinstance(item, dict):
            continue
        name = str(item.get("name") or item.get("filename") or f"attachment-{idx}").strip()
        path = str(item.get("path") or item.get("filePath") or "").strip()
        url = str(item.get("url") or item.get("mediaUrl") or "").strip()
        mime_type = str(item.get("mimeType") or item.get("contentType") or item.get("media_type") or "").strip()
        size = item.get("size") or item.get("bytes") or ""
        if path and not url:
            url = "/chat-media?path=" + urllib.parse.quote(path)
        if url.startswith("/"):
            url = f"http://127.0.0.1:{PORT}{url}"
        details = [f"{idx}. {name}"]
        if mime_type:
            details.append(f"type: {mime_type}")
        if size:
            details.append(f"size: {size} bytes")
        if path:
            details.append(f"path: {path}")
        if url:
            details.append(f"url: {url}")
        lines.append(" | ".join(details))
    return "\n".join(lines) if len(lines) > 2 else ""


def _hermes_tool_activity_messages(tools, agent_id="", run_id="", base_ts=None, coerce_complete=False):
    """Store Hermes tools like recovered activity: one tool-only message per card."""
    if not isinstance(tools, list) or not tools:
        return []
    start_ts = int(base_ts if base_ts is not None else time.time() * 1000)
    messages = []
    for idx, tool in enumerate(tools):
        if not isinstance(tool, dict):
            continue
        item = dict(tool)
        item["runId"] = item.get("runId") or run_id or ""
        status = str(item.get("status") or "").lower()
        if coerce_complete and status == "running":
            item["status"] = "done"
            if not item.get("result") or str(item.get("result")).strip().lower() == "running":
                item["result"] = "Completed"
        messages.append({
            "role": "assistant",
            "text": "",
            "ts": start_ts + idx,
            "epochMs": start_ts + idx,
            "agentId": agent_id,
            "from": "Hermes",
            "source": "hermes-tool-activity",
            "runId": item.get("runId") or run_id or "",
            "tools": [item],
        })
    return messages


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


def _is_hermes_approval_pending_active(approval):
    if not isinstance(approval, dict):
        return False
    approval_id = str(approval.get("approval_id") or approval.get("id") or "").strip()
    if not approval_id:
        return False
    with HERMES_APPROVAL_LOCK:
        for items in HERMES_APPROVAL_PENDING.values():
            for item in items:
                item_id = str(item.get("approval_id") or item.get("id") or "").strip()
                if item_id == approval_id and item.get("status", "pending") == "pending":
                    return True
    return False


def _normalize_hermes_history_for_client(messages):
    normalized = []
    for msg in messages if isinstance(messages, list) else []:
        if not isinstance(msg, dict):
            continue
        item = dict(msg)
        approval = item.get("approval")
        if isinstance(approval, dict) and str(approval.get("status") or "pending").lower() == "pending":
            if not _is_hermes_approval_pending_active(approval):
                item["approval"] = {
                    **approval,
                    "status": "expired",
                    "description": approval.get("description") or "This Hermes approval is no longer active.",
                }
        normalized.append(item)
    return normalized


def _hermes_history_with_pending_approval(profile="default", agent_key="hermes-default"):
    messages = _normalize_hermes_history_for_client(_load_hermes_history(profile))
    pending_result = _get_hermes_approval_pending(agent_key, _get_hermes_session_id(profile))
    pending = pending_result.get("pending") if isinstance(pending_result, dict) else None
    if isinstance(pending, dict):
        pending_id = pending.get("approval_id") or pending.get("id")
        already_present = any(
            isinstance(msg, dict)
            and isinstance(msg.get("approval"), dict)
            and (msg["approval"].get("approval_id") or msg["approval"].get("id")) == pending_id
            for msg in messages
        )
        if not already_present:
            messages.append({
                "role": "assistant",
                "text": "",
                "ts": int(time.time() * 1000),
                "epochMs": int(time.time() * 1000),
                "from": "Hermes",
                "source": "hermes",
                "sessionId": pending.get("session_id") or "",
                "tools": [],
                "thinking": "",
                "reasoningTokens": 0,
                "approval": {**pending, "pending_count": pending_result.get("pending_count") or 1},
            })
    return messages


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


def _discard_hermes_approval_bridge_pending(agent_key="hermes-default", profile="", session_id="", bridge_run_id=""):
    agent = _get_hermes_agent(agent_key) or {}
    agent_id = agent.get("id") or agent_key or "hermes-default"
    profile = profile or agent.get("profile") or agent.get("providerAgentId") or "default"
    bridge_run_id = _safe_hermes_bridge_run_id(bridge_run_id) if bridge_run_id else ""
    expired = []
    with HERMES_APPROVAL_LOCK:
        for key, queue in list(HERMES_APPROVAL_PENDING.items()):
            keep = []
            for item in queue:
                if item.get("status", "pending") != "pending":
                    keep.append(item)
                    continue
                if bridge_run_id and item.get("bridgeRunId") != bridge_run_id:
                    keep.append(item)
                    continue
                if session_id and item.get("session_id") and item.get("session_id") != session_id:
                    keep.append(item)
                    continue
                if item.get("agentId") not in {agent_id, agent_key} and item.get("profile") != profile:
                    keep.append(item)
                    continue
                expired.append({**item, "status": "expired", "resolvedAt": int(time.time() * 1000)})
            HERMES_APPROVAL_PENDING[key] = keep
    return expired


def _detect_hermes_approval_request(reply="", stderr="", original_message="", agent_key="hermes-default"):
    text = f"{reply or ''}\n{stderr or ''}"
    lower = text.lower()
    if "user denied" in lower and "timeout" not in lower:
        return None
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


def _hermes_terminal_command_from_tools(tools):
    for tool in reversed(tools if isinstance(tools, list) else []):
        if not isinstance(tool, dict):
            continue
        if str(tool.get("name") or "").lower() != "terminal":
            continue
        args = tool.get("arguments") if isinstance(tool.get("arguments"), dict) else {}
        command = str(args.get("command") or "").strip()
        if command:
            return command[:500]
    return ""


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


def _parse_url_port(url, default=8642):
    try:
        parsed = urllib.parse.urlparse(str(url or ""))
        return int(parsed.port or default)
    except Exception:
        return default


def _is_local_http_url(url):
    try:
        parsed = urllib.parse.urlparse(str(url or ""))
        return parsed.scheme in {"http", "https"} and parsed.hostname in {"127.0.0.1", "localhost", "::1"}
    except Exception:
        return False


def _hermes_profile_api_port(profile):
    hermes_cfg = VW_CONFIG.get("hermes", {}) or {}
    base = hermes_cfg.get("apiProfilePortBase") or os.environ.get("VW_HERMES_API_PROFILE_PORT_BASE")
    try:
        base = int(base)
    except (TypeError, ValueError):
        base = _parse_url_port(hermes_cfg.get("apiUrl"), 8642) + 1
    digest = hashlib.sha1(str(profile or "default").encode("utf-8")).hexdigest()
    return base + (int(digest[:6], 16) % 1000)


def _hermes_profile_api_config(profile):
    profile = profile or "default"
    hermes_cfg = VW_CONFIG.get("hermes", {}) or {}
    profile_cfgs = hermes_cfg.get("apiProfiles") if isinstance(hermes_cfg.get("apiProfiles"), dict) else {}
    profile_cfg = profile_cfgs.get(profile) if isinstance(profile_cfgs.get(profile), dict) else {}
    api_key = profile_cfg.get("apiKey") or hermes_cfg.get("apiKey") or ""
    auto_start_all = hermes_cfg.get("autoStartProfileApis", True) is not False
    if profile == "default":
        url = profile_cfg.get("apiUrl") or hermes_cfg.get("apiUrl") or "http://127.0.0.1:8642"
        auto_start = profile_cfg.get("autoStart", hermes_cfg.get("autoStartDefaultApi", auto_start_all)) is not False
        return {
            "url": url,
            "key": api_key,
            "autoStart": bool(api_key and auto_start and _is_local_http_url(url)),
            "port": _parse_url_port(url, 8642),
        }
    port = _hermes_profile_api_port(profile)
    url = profile_cfg.get("apiUrl") or f"http://127.0.0.1:{port}"
    auto_start = profile_cfg.get("autoStart", auto_start_all) is not False
    return {
        "url": url,
        "key": api_key,
        "autoStart": bool(api_key and auto_start and _is_local_http_url(url)),
        "port": _parse_url_port(url, port),
    }


def _hermes_api_client_for_profile(profile):
    if HermesApiClient is None:
        raise RuntimeError("Hermes API client module unavailable")
    profile = profile or "default"
    cfg = _hermes_profile_api_config(profile)
    if cfg.get("autoStart"):
        _ensure_hermes_profile_api(profile, cfg)
    return HermesApiClient(
        base_url=cfg.get("url"),
        api_key=cfg.get("key"),
        timeout_sec=min(int((VW_CONFIG.get("hermes") or {}).get("timeoutSec") or 600), 60),
    )


def _ensure_hermes_profile_api(profile, api_cfg):
    """Start a profile-scoped Hermes API server only for local keyed URLs."""
    if not profile:
        return
    api_key = api_cfg.get("key") or ""
    if not api_key or not api_cfg.get("autoStart") or not _is_local_http_url(api_cfg.get("url")):
        return
    if HermesApiClient is None:
        return
    client = HermesApiClient(base_url=api_cfg.get("url"), api_key=api_key, timeout_sec=5)
    if client.is_available():
        return

    with HERMES_PROFILE_API_LOCK:
        proc = HERMES_PROFILE_API_PROCESSES.get(profile)
        if proc and proc.poll() is None:
            return

        hermes_cfg = VW_CONFIG.get("hermes", {}) or {}
        hermes_bin = os.path.expanduser(hermes_cfg.get("binary") or "~/.local/bin/hermes")
        hermes_home = os.path.expanduser(hermes_cfg.get("homePath") or "~/.hermes")
        if not os.path.exists(hermes_bin):
            return

        env = os.environ.copy()
        env.update({
            "API_SERVER_ENABLED": "true",
            "API_SERVER_HOST": "127.0.0.1",
            "API_SERVER_PORT": str(api_cfg.get("port") or _parse_url_port(api_cfg.get("url"), 8642)),
            "API_SERVER_KEY": api_key,
            "API_SERVER_MODEL_NAME": f"hermes-{HermesProvider._safe_suffix(profile) if HermesProvider else profile}",
            "VW_HERMES_HOME": hermes_home,
        })
        if os.path.basename(hermes_home.rstrip(os.sep)) == ".hermes":
            env["HOME"] = os.path.dirname(hermes_home.rstrip(os.sep)) or env.get("HOME", "")
        agent_root = os.path.join(hermes_home, "hermes-agent")
        if os.path.isdir(agent_root):
            site_packages = sorted(glob.glob(os.path.join(agent_root, "venv", "lib", "python*", "site-packages")))
            pythonpath_parts = [p for p in [agent_root, *site_packages, env.get("PYTHONPATH", "")] if p]
            env["PYTHONPATH"] = os.pathsep.join(pythonpath_parts)

        log_path = os.path.join(STATUS_DIR, f"hermes-api-{HermesProvider._safe_suffix(profile) if HermesProvider else profile}.log")
        try:
            log_f = open(log_path, "ab", buffering=0)
            cmd = [hermes_bin]
            if profile != "default":
                cmd.extend(["--profile", profile])
            cmd.extend(["gateway", "run"])
            proc = subprocess.Popen(
                cmd,
                stdout=log_f,
                stderr=subprocess.STDOUT,
                stdin=subprocess.DEVNULL,
                env=env,
                start_new_session=True,
            )
            HERMES_PROFILE_API_PROCESSES[profile] = proc
        except Exception as exc:
            print(f"⚠️ Hermes profile API start failed for {profile}: {exc}")
            return

    deadline = time.time() + 15
    while time.time() < deadline:
        try:
            if client.is_available():
                return
        except Exception:
            pass
        proc = HERMES_PROFILE_API_PROCESSES.get(profile)
        if proc and proc.poll() is not None:
            return
        time.sleep(0.5)


def _hermes_event_tool_card(event, status="running", fallback_id=""):
    tool = str(event.get("tool") or event.get("name") or event.get("tool_name") or "Hermes tool")
    preview = str(event.get("preview") or event.get("label") or "")
    duration = event.get("duration")
    result = "Running" if status == "running" else "Completed"
    if event.get("error"):
        result = "Failed"
    if duration is not None and status != "running":
        result = f"{result} in {duration}s"
    card = {
        "id": str(event.get("toolCallId") or event.get("tool_call_id") or event.get("id") or fallback_id or f"hermes-tool-{int(time.time() * 1000)}"),
        "name": tool,
        "status": status,
        "args_preview": preview,
        "result": result,
    }
    if preview:
        card["arguments"] = {"command": preview}
    return card


def _hermes_api_approval_from_event(event, agent_id="", profile="", session_id="", original_message=""):
    command = str(event.get("command") or event.get("preview") or event.get("tool") or "Hermes approval request")
    description = str(event.get("description") or "Hermes needs approval before it can continue this run.")
    run_id = str(event.get("run_id") or event.get("runId") or "")
    seed = f"{agent_id}|{profile}|{session_id}|{run_id}|{command}|{original_message}"
    approval_id = "hermes-api-approval-" + hashlib.sha1(seed.encode("utf-8")).hexdigest()[:16]
    return {
        "id": approval_id,
        "approval_id": approval_id,
        "provider": "hermes-api",
        "kind": "dangerous_command",
        "title": "Hermes approval required",
        "description": description,
        "command": command,
        "message": original_message,
        "agentId": agent_id or "hermes-default",
        "profile": profile or "default",
        "session_id": session_id or "",
        "runId": run_id,
        "choices": event.get("choices") or ["once", "deny"],
        "status": "pending",
        "createdAt": int(time.time() * 1000),
    }


def _build_hermes_delivery_message(agent, agent_key, message, body):
    from_type = str(body.get("fromType") or body.get("senderType") or "").strip().lower()
    is_human_source = from_type in {"human", "user", "chat", "ui"}
    attachments = body.get("attachments") if isinstance(body.get("attachments"), list) else []
    attachment_context = _format_hermes_attachment_context(attachments)
    source_app = str(body.get("sourceApp") or body.get("app") or "virtual-world").strip() or "virtual-world"
    source_surface = str(body.get("sourceSurface") or body.get("surface") or "chat-window").strip() or "chat-window"
    source_label = str(body.get("sourceLabel") or "").strip()
    sender_name = str(body.get("fromDisplayName") or body.get("displayName") or body.get("fromName") or "User").strip() or "User"
    delivery_message = message
    if is_human_source:
        pretty_surface = source_label or ("Virtual World Chat" if source_app == "virtual-world" and source_surface in {"chat-window", "chat"} else f"{source_app.replace('-', ' ').title()} {source_surface.replace('-', ' ').title()}".strip())
        delivery_message = (
            f"[A2A from=user name={json.dumps(sender_name)} to={agent.get('id') or agent_key} isUser=true sourceApp={json.dumps(source_app)} sourceSurface={json.dumps(source_surface)}]\n"
            f"Message from {sender_name} via {pretty_surface}.\n\n"
            f"{message}\n\n"
            "Reply directly to the user. Do not assume a personal name unless the user provides one."
        )
    if attachment_context:
        delivery_message = f"{delivery_message}\n\n{attachment_context}"
    return {
        "deliveryMessage": delivery_message,
        "fromType": from_type,
        "isHumanSource": is_human_source,
        "attachments": attachments,
        "sourceApp": source_app,
        "sourceSurface": source_surface,
        "sourceLabel": source_label,
        "senderName": sender_name,
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
    result = provider.test()
    profile_apis = {}
    for agent in result.get("agents") or []:
        profile = agent.get("profile") or agent.get("providerAgentId") or "default"
        try:
            api = _hermes_api_client_for_profile(profile)
            caps = api.capabilities()
            features = caps.get("features") if isinstance(caps.get("features"), dict) else {}
            profile_apis[profile] = {
                "ok": bool(features.get("run_submission") and features.get("run_events_sse")),
                "url": api.base_url,
                "model": caps.get("model") or caps.get("model_name") or "",
                "features": {
                    "runSubmission": bool(features.get("run_submission")),
                    "runEventsSse": bool(features.get("run_events_sse")),
                    "runApproval": bool(features.get("run_approval") or features.get("run_approval_response")),
                    "runStop": bool(features.get("run_stop")),
                },
            }
        except Exception as exc:
            cfg = _hermes_profile_api_config(profile)
            profile_apis[profile] = {"ok": False, "url": cfg.get("url"), "error": str(exc)[:500]}
    result["profileApis"] = profile_apis
    return result


def _handle_hermes_run_start(body):
    """Start a native Hermes API run and return the run id for browser SSE attach."""
    body = body if isinstance(body, dict) else {}
    message = str(body.get("message") or body.get("text") or "").strip()
    agent_key = body.get("agentId") or body.get("key") or body.get("sessionKey") or "hermes-default"
    if not message:
        return {"ok": False, "error": "message is required", "_status": 400}
    agent = _get_hermes_agent(agent_key)
    if not agent:
        return {"ok": False, "error": f"Hermes agent '{agent_key}' not found", "_status": 404}
    hermes_cfg = VW_CONFIG.get("hermes", {}) or {}
    if not hermes_cfg.get("preferApi", True):
        return {"ok": False, "fallback": True, "error": "Hermes native API is disabled by configuration", "_status": 409}

    timeout = int(body.get("timeoutSec") or hermes_cfg.get("timeoutSec") or HERMES_TIMEOUT_SEC)
    profile = agent.get("profile") or agent.get("providerAgentId") or "default"
    try:
        client = _hermes_api_client_for_profile(profile)
    except Exception as exc:
        return {"ok": False, "fallback": True, "error": str(exc), "_status": 409}
    if not client.is_available():
        return {"ok": False, "fallback": True, "error": "Hermes API Server is not available", "_status": 409}

    delivery = _build_hermes_delivery_message(agent, agent_key, message, body)
    now_ms = int(time.time() * 1000)
    history = _load_hermes_history(profile)
    history.append({
        "role": "user",
        "text": message,
        "ts": now_ms,
        "epochMs": now_ms,
        "agentId": agent.get("id"),
        "from": delivery["senderName"] if delivery["isHumanSource"] else "You",
        "fromType": delivery["fromType"] or "",
        "source": "hermes",
        "sourceApp": delivery["sourceApp"] if delivery["isHumanSource"] else "",
        "sourceSurface": delivery["sourceSurface"] if delivery["isHumanSource"] else "",
        "sourceLabel": delivery["sourceLabel"] if delivery["isHumanSource"] else "",
        "attachments": delivery["attachments"],
    })
    _save_hermes_history(profile, history)

    safe_profile = HermesProvider._safe_suffix(profile) if HermesProvider else re.sub(r"[^A-Za-z0-9_.-]+", "-", profile)
    session_id = _get_hermes_session_id(profile) or f"vw-hermes-{safe_profile}"
    session_key = f"virtual-world:hermes:{profile}"
    try:
        started = client.start_run(delivery["deliveryMessage"], session_id=session_id, session_key=session_key)
    except Exception as exc:
        return {"ok": False, "fallback": True, "error": str(exc), "_status": 502}
    run_id = started.get("run_id") or started.get("runId") or started.get("id")
    if not run_id:
        return {"ok": False, "fallback": True, "error": started.get("error") or "Hermes API did not return a run_id", "_status": 502}

    _set_hermes_session_id(profile, session_id)
    _remember_hermes_active_run({
        "runId": run_id,
        "sessionId": session_id,
        "agentId": agent.get("id") or agent_key,
        "agentKey": agent_key,
        "statusKey": agent.get("statusKey") or agent.get("id") or agent_key,
        "profile": profile,
        "message": message,
        "deliveryMessage": delivery["deliveryMessage"],
        "timeoutSec": timeout,
        "startedAt": now_ms,
    })
    _set_hermes_presence(agent.get("statusKey") or agent.get("id"), "working", "Hermes native run")
    _publish_hermes_api_progress(profile, agent.get("id") or agent_key, run_id, tools=[], reasoning_parts=[], reply="")
    return {
        "ok": True,
        "providerPath": "api",
        "runId": run_id,
        "sessionId": session_id,
        "agent": {"id": agent.get("id"), "name": agent.get("name"), "providerKind": "hermes", "profile": profile},
    }


def _handle_hermes_run_events(handler, run_id):
    """Proxy Hermes' native run SSE stream to the browser and persist final history."""
    meta = _get_hermes_active_run(run_id)
    if not meta:
        return handler._send_json({"ok": False, "error": f"Hermes run '{run_id}' not found"}, 404)

    profile = meta.get("profile") or "default"
    agent = _get_hermes_agent(meta.get("agentId") or meta.get("agentKey") or f"hermes-{profile}") or {}
    agent_id = agent.get("id") or meta.get("agentId") or "hermes-default"
    status_key = agent.get("statusKey") or meta.get("statusKey") or agent_id
    session_id = meta.get("sessionId") or _get_hermes_session_id(profile) or ""
    original_message = meta.get("message") or ""
    timeout = int(meta.get("timeoutSec") or (VW_CONFIG.get("hermes") or {}).get("timeoutSec") or HERMES_TIMEOUT_SEC)
    try:
        client = _hermes_api_client_for_profile(profile)
    except Exception as exc:
        return handler._send_json({"ok": False, "error": str(exc)}, 502)

    handler.send_response(200)
    handler.send_header("Content-Type", "text/event-stream")
    handler.send_header("Cache-Control", "no-cache")
    handler.send_header("Access-Control-Allow-Origin", "*")
    handler.send_header("X-Accel-Buffering", "no")
    handler.end_headers()

    client_connected = True

    def send_sse(event_name, payload):
        nonlocal client_connected
        if not client_connected:
            return False
        data = dict(payload or {})
        data.setdefault("event", event_name)
        data.setdefault("runId", run_id)
        data.setdefault("sessionId", session_id)
        try:
            handler.wfile.write(f"event: {event_name}\ndata: {json.dumps(data)}\n\n".encode("utf-8"))
            handler.wfile.flush()
            return True
        except (BrokenPipeError, ConnectionResetError, OSError):
            client_connected = False
            return False

    reply = ""
    reasoning_parts = []
    tools = []
    started_tools = {}
    started_tool_keys = {}
    tool_seq = 0
    approval = None
    terminal_event = None
    error_text = ""
    last_progress_publish = 0.0

    def publish_progress(force=False):
        nonlocal last_progress_publish
        now = time.time()
        if force or now - last_progress_publish >= 0.25:
            _publish_hermes_api_progress(profile, agent_id, run_id, tools=tools, reasoning_parts=reasoning_parts, reply=reply)
            last_progress_publish = now

    def finalize_history(ok=False):
        history = _remove_hermes_progress_messages(_load_hermes_history(profile))
        final_ts = int(time.time() * 1000)
        history.extend(_hermes_tool_activity_messages(
            tools,
            agent_id=agent_id,
            run_id=run_id,
            base_ts=final_ts,
            coerce_complete=bool(ok) and not approval,
        ))
        history.append({
            "role": "assistant",
            "text": reply,
            "ts": final_ts + len(tools),
            "epochMs": final_ts + len(tools),
            "agentId": agent_id,
            "from": agent.get("name") or "Hermes",
            "source": "hermes",
            "exitCode": 0 if ok else 1,
            "sessionId": session_id,
            "runId": run_id,
            "tools": [],
            "thinking": "" if "\n\n".join(reasoning_parts).strip() == reply.strip() else "\n\n".join(reasoning_parts),
            "reasoningTokens": 0,
            "approval": approval,
            "error": error_text or None,
        })
        _save_hermes_history(profile, history)
        _clear_hermes_active_run(run_id)
        _set_hermes_presence(status_key, "idle" if ok or approval else "offline", "")

    send_sse("run.started", {"ok": True, "agentId": agent_id, "profile": profile})
    publish_progress(force=True)

    try:
        for event in client.stream_run_events(run_id, timeout_sec=timeout + 30):
            _set_hermes_presence(status_key, "working", "Hermes native run")
            event_name = str(event.get("event") or "").lower() or "event"
            payload = {**event, "agentId": agent_id, "profile": profile}
            if event_name == "message.delta":
                delta = str(event.get("delta") or "")
                reply += delta
                payload["reply"] = reply
                publish_progress()
            elif event_name == "reasoning.available":
                text = str(event.get("text") or "")
                if text:
                    reasoning_parts.append(text)
                    payload["thinking"] = "\n\n".join(reasoning_parts)
                    publish_progress(force=True)
            elif event_name == "tool.started":
                tool_seq += 1
                fallback_id = f"{run_id}:tool:{tool_seq}"
                card = _hermes_event_tool_card(event, "running", fallback_id=fallback_id)
                event_tool_key = f"{event.get('tool') or event.get('name') or 'tool'}:{event.get('preview') or event.get('label') or ''}"
                started_tool_keys[event_tool_key] = card["id"]
                started_tools[card["id"]] = card
                tools.append(card)
                payload["toolCard"] = card
                publish_progress(force=True)
            elif event_name in {"tool.completed", "tool.failed"}:
                event_tool_key = f"{event.get('tool') or event.get('name') or 'tool'}:{event.get('preview') or event.get('label') or ''}"
                fallback_id = started_tool_keys.get(event_tool_key)
                if not fallback_id:
                    matching_id = next((tid for tid, item in reversed(list(started_tools.items())) if item.get("name") == (event.get("tool") or event.get("name"))), "")
                    fallback_id = matching_id or f"{run_id}:tool:{len(started_tools) + 1}"
                card = _hermes_event_tool_card(event, "done" if event_name == "tool.completed" else "error", fallback_id=fallback_id)
                if card["id"] in started_tools:
                    started_tools[card["id"]].update(card)
                    card = started_tools[card["id"]]
                else:
                    tools.append(card)
                payload["toolCard"] = card
                publish_progress(force=True)
            elif event_name == "approval.request":
                approval = _remember_hermes_approval_pending(
                    _hermes_api_approval_from_event(event, agent_id=agent_id, profile=profile, session_id=session_id, original_message=original_message),
                    agent_id=agent_id,
                    profile=profile,
                    session_id=session_id,
                )
                payload["approval"] = approval
                publish_progress(force=True)
            elif event_name in {"run.completed", "run.failed", "run.cancelled", "run.canceled"}:
                terminal_event = event
                if event.get("output"):
                    reply = str(event.get("output") or reply)
                if event.get("error"):
                    error_text = str(event.get("error") or "")
                if event_name == "run.completed":
                    approval = None
                payload.update({"reply": reply, "tools": tools, "approval": approval, "error": error_text or None})
                publish_progress(force=True)
                send_sse(event_name, payload)
                break
            send_sse(event_name, payload)
    except Exception as exc:
        error_text = str(exc)
        terminal_event = {"event": "run.failed", "error": error_text}
        send_sse("run.failed", {"ok": False, "error": error_text, "reply": reply, "tools": tools})

    terminal_name = str((terminal_event or {}).get("event") or "").lower()
    ok = terminal_name == "run.completed"
    if approval:
        ok = False
        error_text = error_text or "Hermes is waiting for approval."
    elif terminal_name in {"run.failed", "run.cancelled", "run.canceled"}:
        ok = False
        error_text = error_text or terminal_name.replace("run.", "Hermes run ")
    finalize_history(ok=ok)


def _handle_hermes_interrupt(body):
    body = body if isinstance(body, dict) else {}
    agent_key = body.get("agentId") or body.get("key") or "hermes-default"
    run_id = str(body.get("runId") or body.get("run_id") or "").strip()
    agent = _get_hermes_agent(agent_key) or {}
    profile = agent.get("profile") or agent.get("providerAgentId") or ""
    meta = _get_hermes_active_run(run_id) if run_id else _find_hermes_active_run(agent_key, profile)
    if not meta:
        return {"ok": False, "error": "No active Hermes run is running for this agent.", "_status": 409}
    run_id = meta.get("runId") or run_id
    profile = meta.get("profile") or profile or "default"
    try:
        client = _hermes_api_client_for_profile(profile)
        result = client.stop_run(run_id)
        _set_hermes_presence(meta.get("statusKey") or agent.get("statusKey") or agent_key, "working", "Hermes stopping")
        return {"ok": True, "providerPath": "api", "runId": run_id, "result": result, "message": "Hermes stop requested."}
    except Exception as exc:
        return {"ok": False, "error": str(exc), "providerPath": "api", "runId": run_id, "_status": 500}


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
    if live_run_id:
        for expired_approval in _discard_hermes_approval_bridge_pending(
            agent.get("id") or agent_key,
            profile,
            active_session_id,
            live_run_id,
        ):
            _append_hermes_live_event(live_run_id, "approval", {"approval": expired_approval, "pending_count": 0})
    activity = {"tools": [], "thinking": "", "reasoningTokens": 0}
    if active_session_id and hasattr(provider, "export_session"):
        exported = provider.export_session(profile, active_session_id)
        if exported.get("ok"):
            activity = _extract_hermes_turn_activity(exported.get("session"), delivery_message)
    reply = result.get("reply") or result.get("error") or ""
    visible_tools = activity.get("tools") or []
    approval = _detect_hermes_approval_request(reply, result.get("stderr", ""), message, agent.get("id") or agent_key)
    if approval:
        detected_command = str(approval.get("command") or "").strip().lower()
        if not detected_command or detected_command.startswith(("the terminal command", "approval-gated hermes command")):
            tool_command = _hermes_terminal_command_from_tools(visible_tools)
            if tool_command:
                approval["command"] = tool_command
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


def _build_codex_delivery_message(agent, agent_key, message, body):
    from_type = str(body.get("fromType") or body.get("senderType") or "").strip().lower()
    is_human_source = from_type in {"human", "user", "chat", "ui"}
    source_app = str(body.get("sourceApp") or body.get("app") or "virtual-world").strip() or "virtual-world"
    source_surface = str(body.get("sourceSurface") or body.get("surface") or "chat-window").strip() or "chat-window"
    source_label = str(body.get("sourceLabel") or "").strip()
    sender_name = str(body.get("fromDisplayName") or body.get("displayName") or body.get("fromName") or "User").strip() or "User"
    delivery_message = message
    if is_human_source:
        pretty_surface = source_label or ("Virtual World Chat" if source_app == "virtual-world" and source_surface in {"chat-window", "chat"} else f"{source_app.replace('-', ' ').title()} {source_surface.replace('-', ' ').title()}".strip())
        delivery_message = (
            f"[A2A from=user name={json.dumps(sender_name)} to={agent.get('id') or agent_key} isUser=true sourceApp={json.dumps(source_app)} sourceSurface={json.dumps(source_surface)}]\n"
            f"Message from {sender_name} via {pretty_surface}.\n\n"
            f"{message}\n\n"
            "Reply directly to the user. Do not assume a personal name unless the user provides one."
        )
    return {
        "deliveryMessage": delivery_message,
        "fromType": from_type,
        "isHumanSource": is_human_source,
        "sourceApp": source_app,
        "sourceSurface": source_surface,
        "sourceLabel": source_label,
        "senderName": sender_name,
    }


def _handle_codex_chat(body):
    if not isinstance(body, dict):
        return {"ok": False, "error": "payload must be an object", "_status": 400}
    agent_key = body.get("agentId") or body.get("key") or body.get("sessionKey") or "codex-main"
    message = str(body.get("message") or body.get("text") or "").strip()
    if not message:
        return {"ok": False, "error": "message is required", "_status": 400}
    agent = _get_codex_agent(agent_key)
    if not agent:
        return {"ok": False, "error": f"Codex agent '{agent_key}' not found", "_status": 404}
    provider = _codex_provider()
    if not provider:
        return {"ok": False, "error": "Codex provider module unavailable", "_status": 503}
    timeout = int(body.get("timeoutSec") or CODEX_TIMEOUT_SEC)
    profile = agent.get("profile") or agent.get("providerAgentId") or "main"
    delivery = _build_codex_delivery_message(agent, agent_key, message, body)

    history = _load_codex_history(profile)
    now_ms = int(time.time() * 1000)
    history.append({
        "role": "user",
        "text": message,
        "ts": now_ms,
        "epochMs": now_ms,
        "from": delivery["senderName"] if delivery["isHumanSource"] else "You",
        "fromType": delivery["fromType"] or "",
        "source": "codex",
        "sourceApp": delivery["sourceApp"] if delivery["isHumanSource"] else "",
        "sourceSurface": delivery["sourceSurface"] if delivery["isHumanSource"] else "",
        "sourceLabel": delivery["sourceLabel"] if delivery["isHumanSource"] else "",
    })
    _save_codex_history(profile, history)

    if _gateway_presence:
        try:
            _gateway_presence.set_manual_override(agent.get("statusKey") or agent.get("id"), "working", "Codex task")
        except Exception:
            pass
    session_id = _get_codex_session_id(profile)
    result = provider.send_chat_message(
        profile,
        delivery["deliveryMessage"],
        session_id=session_id,
        timeout_sec=timeout,
    )
    if result.get("sessionId"):
        _set_codex_session_id(profile, result.get("sessionId"))
    active_session_id = result.get("sessionId") or session_id
    reply = result.get("reply") or result.get("error") or ""
    tools = result.get("tools") if isinstance(result.get("tools"), list) else []
    thinking = result.get("thinking") or ""
    now_ms = int(time.time() * 1000)
    history = _load_codex_history(profile)
    history.append({
        "role": "assistant",
        "text": reply,
        "ts": now_ms,
        "epochMs": now_ms,
        "from": agent.get("name") or "Codex",
        "source": "codex",
        "sessionId": active_session_id,
        "exitCode": result.get("exitCode"),
        "tools": tools,
        "thinking": thinking,
        "reasoningTokens": result.get("reasoningTokens") or 0,
    })
    _save_codex_history(profile, history)
    if _gateway_presence:
        try:
            _gateway_presence.set_manual_override(agent.get("statusKey") or agent.get("id"), "idle" if result.get("ok") else "offline", "")
        except Exception:
            pass
    return {
        "ok": bool(result.get("ok")),
        "reply": reply,
        "agent": {"id": agent.get("id"), "name": agent.get("name"), "providerKind": "codex", "profile": profile},
        "sessionId": active_session_id,
        "tools": tools,
        "thinking": thinking,
        "reasoningTokens": result.get("reasoningTokens") or 0,
        "error": result.get("error"),
        "stderr": result.get("stderr", ""),
        "exitCode": result.get("exitCode"),
    }


def _handle_codex_run_start(body):
    """Start a native Codex app-server turn and return the run id for browser SSE attach."""
    body = body if isinstance(body, dict) else {}
    message = str(body.get("message") or body.get("text") or "").strip()
    agent_key = body.get("agentId") or body.get("key") or body.get("sessionKey") or "codex-main"
    if not message:
        return {"ok": False, "error": "message is required", "_status": 400}
    agent = _get_codex_agent(agent_key)
    if not agent:
        return {"ok": False, "error": f"Codex agent '{agent_key}' not found", "_status": 404}
    provider = _codex_provider()
    if not provider:
        return {"ok": False, "error": "Codex provider module unavailable", "_status": 503}
    if not getattr(provider, "prefer_app_server", False):
        return {"ok": False, "fallback": True, "error": "Codex app-server streaming is disabled by configuration", "_status": 409}

    timeout = int(body.get("timeoutSec") or CODEX_TIMEOUT_SEC)
    profile = agent.get("profile") or agent.get("providerAgentId") or "main"
    delivery = _build_codex_delivery_message(agent, agent_key, message, body)
    now_ms = int(time.time() * 1000)
    history = _load_codex_history(profile)
    history.append({
        "role": "user",
        "text": message,
        "ts": now_ms,
        "epochMs": now_ms,
        "from": delivery["senderName"] if delivery["isHumanSource"] else "You",
        "fromType": delivery["fromType"] or "",
        "source": "codex",
        "sourceApp": delivery["sourceApp"] if delivery["isHumanSource"] else "",
        "sourceSurface": delivery["sourceSurface"] if delivery["isHumanSource"] else "",
        "sourceLabel": delivery["sourceLabel"] if delivery["isHumanSource"] else "",
    })
    _save_codex_history(profile, history)

    if _gateway_presence:
        try:
            _gateway_presence.set_manual_override(agent.get("statusKey") or agent.get("id"), "working", "Codex app-server run")
        except Exception:
            pass

    session_id = _get_codex_session_id(profile)
    try:
        run = provider.start_chat_stream(
            profile,
            delivery["deliveryMessage"],
            session_id=session_id,
            timeout_sec=timeout,
        )
    except Exception as exc:
        if _gateway_presence:
            try:
                _gateway_presence.set_manual_override(agent.get("statusKey") or agent.get("id"), "offline", "")
            except Exception:
                pass
        return {"ok": False, "error": str(exc), "_status": 502}

    active_session_id = run.thread_id or session_id
    if active_session_id:
        _set_codex_session_id(profile, active_session_id)
    run_id = run.turn_id or f"codex-run-{uuid.uuid4().hex[:16]}"
    _remember_codex_active_run({
        "runId": run_id,
        "sessionId": active_session_id,
        "agentId": agent.get("id") or agent_key,
        "agentKey": agent_key,
        "statusKey": agent.get("statusKey") or agent.get("id") or agent_key,
        "profile": profile,
        "message": message,
        "deliveryMessage": delivery["deliveryMessage"],
        "timeoutSec": timeout,
        "startedAt": now_ms,
        "run": run,
    })
    return {
        "ok": True,
        "providerPath": "app-server",
        "runId": run_id,
        "sessionId": active_session_id,
        "agent": {"id": agent.get("id"), "name": agent.get("name"), "providerKind": "codex", "profile": profile},
    }


def _handle_codex_run_events(handler, run_id):
    """Proxy Codex app-server notifications to the browser and persist final history."""
    meta = _get_codex_active_run(run_id)
    if not meta:
        return handler._send_json({"ok": False, "error": f"Codex run '{run_id}' not found"}, 404)

    run = meta.get("run")
    if not run:
        _clear_codex_active_run(run_id)
        return handler._send_json({"ok": False, "error": f"Codex run '{run_id}' is missing its stream"}, 410)

    profile = meta.get("profile") or "main"
    agent = _get_codex_agent(meta.get("agentId") or meta.get("agentKey") or f"codex-{profile}") or {}
    agent_id = agent.get("id") or meta.get("agentId") or "codex-main"
    status_key = agent.get("statusKey") or meta.get("statusKey") or agent_id
    session_id = meta.get("sessionId") or run.thread_id or _get_codex_session_id(profile) or ""

    handler.send_response(200)
    handler.send_header("Content-Type", "text/event-stream")
    handler.send_header("Cache-Control", "no-cache")
    handler.send_header("Access-Control-Allow-Origin", "*")
    handler.send_header("X-Accel-Buffering", "no")
    handler.end_headers()

    client_connected = True

    def send_sse(event_name, payload):
        nonlocal client_connected
        if not client_connected:
            return False
        data = dict(payload or {})
        data.setdefault("event", event_name)
        data.setdefault("runId", run_id)
        data.setdefault("turnId", run_id)
        data.setdefault("sessionId", session_id)
        data.setdefault("agentId", agent_id)
        data.setdefault("profile", profile)
        try:
            handler.wfile.write(f"event: {event_name}\ndata: {json.dumps(data)}\n\n".encode("utf-8"))
            handler.wfile.flush()
            return True
        except (BrokenPipeError, ConnectionResetError, OSError):
            client_connected = False
            return False

    terminal_event = None
    error_text = ""

    def finalize_history(ok=False):
        snapshot = run.snapshot()
        active_session_id = snapshot.get("sessionId") or session_id
        if active_session_id:
            _set_codex_session_id(profile, active_session_id)
        tools = snapshot.get("tools") if isinstance(snapshot.get("tools"), list) else []
        thinking = snapshot.get("thinking") or ""
        reply = snapshot.get("reply") or error_text or snapshot.get("error") or ""
        final_ts = int(time.time() * 1000)
        history = _load_codex_history(profile)
        history.append({
            "role": "assistant",
            "text": reply,
            "ts": final_ts,
            "epochMs": final_ts,
            "from": agent.get("name") or "Codex",
            "source": "codex",
            "sessionId": active_session_id,
            "runId": run_id,
            "exitCode": 0 if ok else 1,
            "tools": tools,
            "thinking": thinking,
            "reasoningTokens": 0,
            "error": error_text or snapshot.get("error") or None,
        })
        _save_codex_history(profile, history)
        _clear_codex_active_run(run_id)
        try:
            run.close()
        except Exception:
            pass
        if _gateway_presence:
            try:
                _gateway_presence.set_manual_override(status_key, "idle" if ok else "offline", "")
            except Exception:
                pass

    sent_run_started = send_sse("run.started", {"ok": True, "reply": "", "tools": [], "thinking": ""})

    try:
        while True:
            if _gateway_presence:
                try:
                    _gateway_presence.set_manual_override(status_key, "working", "Codex app-server run")
                except Exception:
                    pass
            event = run.next_event(timeout=0.5)
            if event is None:
                if getattr(run.state, "completed", False):
                    terminal_event = terminal_event or {"event": "run.failed", "error": run.snapshot().get("error") or "Codex stream ended without a terminal event"}
                    break
                continue
            event_name = str(event.get("event") or "event")
            payload = {**event, "agentId": agent_id, "profile": profile, "sessionId": session_id, "runId": run_id, "turnId": run_id}
            if event_name == "run.started" and sent_run_started:
                continue
            if event.get("error"):
                error_text = str(event.get("error") or "")
            if event_name in {"run.completed", "run.failed", "run.cancelled", "run.canceled"}:
                payload.update(_codex_context_payload(agent, profile=profile, session_id=payload.get("sessionId") or session_id))
            if send_sse(event_name, payload) and event_name == "run.started":
                sent_run_started = True
            if event_name in {"run.completed", "run.failed", "run.cancelled", "run.canceled"}:
                terminal_event = event
                break
    except Exception as exc:
        error_text = str(exc)
        terminal_event = {"event": "run.failed", "error": error_text}
        send_sse("run.failed", {"ok": False, "error": error_text, **run.snapshot()})

    terminal_name = str((terminal_event or {}).get("event") or "").lower()
    ok = terminal_name == "run.completed"
    if terminal_name in {"run.failed", "run.cancelled", "run.canceled"}:
        error_text = error_text or str((terminal_event or {}).get("error") or terminal_name.replace("run.", "Codex run "))
    finalize_history(ok=ok)


def _handle_codex_interrupt(body):
    body = body if isinstance(body, dict) else {}
    agent_key = body.get("agentId") or body.get("key") or "codex-main"
    agent = _get_codex_agent(agent_key) or {}
    profile = agent.get("profile") or agent.get("providerAgentId") or "main"
    provider = _codex_provider()
    if not provider:
        return {"ok": False, "error": "Codex provider module unavailable", "_status": 503}
    result = provider.interrupt(profile)
    if result.get("ok") and _gateway_presence:
        try:
            _gateway_presence.set_manual_override(agent.get("statusKey") or agent.get("id"), "working", "Codex stopping")
        except Exception:
            pass
    return result


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
    if approval.get("provider") == "hermes-api" and approval.get("runId"):
        run_id = str(approval.get("runId"))
        api_choice = "deny" if choice == "deny" else "once"
        try:
            client = _hermes_api_client_for_profile(profile)
            approved = client.respond_approval(run_id, api_choice)
            history = _load_hermes_history(profile)
            history.append(_approval_result_message({**approval, "agentId": agent.get("id") or agent_key, "message": message}, choice))
            _save_hermes_history(profile, history)
            if choice == "deny":
                _set_hermes_presence(agent.get("statusKey") or agent.get("id"), "idle", "")
                return {"ok": True, "choice": "deny", "providerPath": "api", "runId": run_id, "result": approved, "message": "Hermes approval denied."}
            _set_hermes_presence(agent.get("statusKey") or agent.get("id"), "working", "Hermes approval responded")
            return {
                "ok": True,
                "choice": "approve_once",
                "approvalChoice": "approve_once",
                "providerPath": "api",
                "runId": run_id,
                "sessionId": approval.get("session_id") or "",
                "result": approved,
                "message": "Hermes approval approved. The active run will continue streaming.",
            }
        except Exception as exc:
            return {"ok": False, "error": str(exc), "providerPath": "api", "runId": run_id, "_status": 500}
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
    if is_human_source:
        try:
            live_agent_note_user_attention(
                data.get("toAgentId") or data.get("to"),
                source=str(data.get("sourceSurface") or "chat-window"),
                message_preview=str(data.get("message") or data.get("text") or "")[:160],
            )
        except Exception as exc:
            print(f"⚠️  user attention marking failed: {exc}")
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
    if to_ref.get("providerKind") == "codex" or _is_codex_agent(to_ref.get("id")):
        result = _handle_codex_chat({
            "agentId": to_ref.get("id"),
            "message": message,
            "timeoutSec": data.get("timeoutSec") or CODEX_TIMEOUT_SEC,
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
            "inReplyTo": inbound["id"], "ok": bool(isinstance(result, dict) and result.get("ok")), "via": "virtual-world-codex-native",
        })
        if isinstance(result, dict):
            result = dict(result)
            result.setdefault("messageId", inbound["id"])
            result.setdefault("replyMessageId", outbound["id"])
            result.setdefault("conversationId", conversation_id)
            return result, int(result.pop("_status", 200) or 200) if result.get("ok") else int(result.pop("_status", 502) or 502)
        return {"ok": False, "error": "Invalid Codex response", "messageId": inbound["id"], "replyMessageId": outbound["id"]}, 502
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


def _gateway_config_key():
    gw_url, gw_token = _read_gateway_config()
    return gw_url or "", gw_token or ""


def _gateway_info_payload():
    gw_url, gw_token = _read_gateway_config()
    ws_port = 18789
    if gw_url:
        try:
            parsed = urllib.parse.urlparse(gw_url)
            if parsed.port:
                ws_port = int(parsed.port)
        except Exception:
            pass
    return {
        "wsPort": ws_port,
        "gatewayUrl": gw_url or "",
        "token": gw_token or "",
        "tokenConfigured": bool(gw_token),
        "openclawVersion": _get_openclaw_version(),
    }


##############################################################################
# AGENT CREATION
##############################################################################

def _sanitize_agent_id(name):
    s = str(name or "").lower().strip()
    s = re.sub(r"[^a-z0-9\s-]", "", s)
    s = re.sub(r"[\s]+", "-", s)
    s = re.sub(r"-+", "-", s).strip("-")
    return s or f"agent-{int(time.time())}"


def _run_async_blocking(coro, timeout=30):
    try:
        asyncio.get_running_loop()
    except RuntimeError:
        return asyncio.run(coro)
    import concurrent.futures
    with concurrent.futures.ThreadPoolExecutor(max_workers=1) as pool:
        future = pool.submit(asyncio.run, coro)
        return future.result(timeout=timeout)


async def _gateway_rpc_call_async(method, params=None, timeout=20):
    if ws_connect is None:
        return {"ok": False, "error": "Gateway websocket client is unavailable"}
    gw_url, token = _read_gateway_config()
    if not token:
        return {"ok": False, "error": "Gateway token is not configured"}
    if not gw_url:
        return {"ok": False, "error": "Gateway URL is not configured"}
    origin = _gateway_control_origin()
    async with ws_connect(
        gw_url,
        max_size=1024 * 1024,
        additional_headers={"Origin": origin},
        close_timeout=3,
    ) as ws:
        await asyncio.wait_for(ws.recv(), timeout=5)
        connect_id = f"vw-agent-admin-connect-{uuid.uuid4()}"
        await ws.send(json.dumps({
            "type": "req",
            "id": connect_id,
            "method": "connect",
            "params": {
                "minProtocol": 4,
                "maxProtocol": 4,
                "client": {"id": "openclaw-control-ui", "version": _get_openclaw_version(), "platform": "server", "mode": "webchat"},
                "role": "operator",
                "scopes": ["operator.read", "operator.write", "operator.admin"],
                "caps": [],
                "commands": [],
                "permissions": {},
                "auth": {"token": token},
                "locale": "en-US",
                "userAgent": "virtual-world-server/agent-admin",
            },
        }))
        while True:
            msg = json.loads(await asyncio.wait_for(ws.recv(), timeout=10))
            if msg.get("id") == connect_id:
                if not msg.get("ok"):
                    return {"ok": False, "error": (msg.get("error") or {}).get("message", "Gateway connect failed")}
                break

        req_id = f"vw-agent-admin-{uuid.uuid4()}"
        await ws.send(json.dumps({
            "type": "req",
            "id": req_id,
            "method": method,
            "params": params or {},
        }))
        deadline = time.time() + timeout
        while time.time() < deadline:
            msg = json.loads(await asyncio.wait_for(ws.recv(), timeout=min(10, max(1, deadline - time.time()))))
            if msg.get("id") != req_id:
                continue
            if not msg.get("ok"):
                return {"ok": False, "error": (msg.get("error") or {}).get("message", f"{method} failed")}
            payload = msg.get("payload")
            if isinstance(payload, dict):
                payload.setdefault("ok", True)
                return payload
            return {"ok": True, "payload": payload}
    return {"ok": False, "error": f"{method} timed out"}


def _gateway_rpc_call(method, params=None, timeout=20):
    try:
        return _run_async_blocking(_gateway_rpc_call_async(method, params=params, timeout=timeout), timeout=timeout + 10)
    except Exception as exc:
        return {"ok": False, "error": str(exc)}


def _agent_template_files(name, role, emoji, agent_kind="OpenClaw", prompt=""):
    instructions = (prompt or role or "Be helpful and direct.").strip()
    return {
        "IDENTITY.md": f"""# IDENTITY.md

- **Name:** {name}
- **Creature:** {role} - {agent_kind} agent
- **Vibe:** Helpful, efficient, ready to work
- **Emoji:** {emoji}
""",
        "SOUL.md": f"""# SOUL.md - {name}

You are **{name}** {emoji} - {role}.

## Style
- Be helpful and direct
- Follow your AGENTS.md workflow strictly
- Keep work visible through Virtual World when possible

## Standing Instructions
{instructions}
""",
        "USER.md": """# USER.md

- **Name:** (set by your owner)
- **Timezone:** (set by your owner)
- **Notes:** Prefers direct, clear communication.
""",
        "AGENTS.md": f"""# {name} {emoji} - {role}

## Role
{role}

## Standing Instructions
{instructions}

## Core Rules
- Follow instructions carefully
- Log your work in memory/YYYY-MM-DD.md when useful
- Complete the full loop: working -> work -> report -> idle

## Communication
- Use Virtual World communication tools when talking to other world agents
- Your text reply IS your response - write it directly

## Memory
- Daily logs: `memory/YYYY-MM-DD.md`
- Long-term: `MEMORY.md`
""",
        "HEARTBEAT.md": """# HEARTBEAT.md

# Add periodic tasks below. If nothing needs attention, reply HEARTBEAT_OK.
""",
        "MEMORY.md": f"# MEMORY.md - {name}\n\n_No memories yet._\n",
        "TOOLS.md": f"# TOOLS.md - {name}\n\n_Add tool-specific notes here._\n",
    }


def _default_openclaw_agent_model():
    result = _gateway_rpc_call("agents.list", {}, timeout=10)
    if not result.get("ok"):
        return ""
    for agent in result.get("agents", []):
        if agent.get("id") == "main":
            model = agent.get("model")
            if isinstance(model, dict):
                return str(model.get("primary") or "")
            if isinstance(model, str):
                return model
    return ""


def _refresh_agent_roster_after_create():
    global _agent_roster, _roster_time
    try:
        _agent_roster = discover_agents()
        _roster_time = time.time()
        if _gateway_presence:
            _gateway_presence.init_agents([
                a.get("statusKey") or a.get("id")
                for a in _agent_roster
                if a.get("statusKey") or a.get("id")
            ])
    except Exception as exc:
        print(f"⚠️  Virtual World agent roster refresh failed: {exc}")


def _handle_agent_platforms():
    hermes_status = _hermes_provider().test() if _hermes_provider() else {"ok": False, "error": "Hermes provider module unavailable", "agents": []}
    codex_provider = _codex_provider()
    codex_status = codex_provider.test() if codex_provider else {"ok": False, "error": "Codex provider module unavailable", "agents": []}
    codex_cfg = VW_CONFIG.get("codex", {}) or {}
    codex_home = codex_status.get("homePath") or codex_cfg.get("homePath") or ""
    return {
        "ok": True,
        "platforms": [
            {
                "id": "openclaw",
                "label": "OpenClaw",
                "description": "Native OpenClaw workspace agent",
                "providerType": "runtime",
                "available": True,
                "create": True,
            },
            {
                "id": "hermes",
                "label": "Hermes",
                "description": "Hermes profile-backed agent",
                "providerType": "runtime",
                "available": bool(hermes_status.get("ok")),
                "create": bool(hermes_status.get("ok")),
                "error": "" if hermes_status.get("ok") else hermes_status.get("error", "Hermes is not available"),
            },
            {
                "id": "codex",
                "label": "Codex",
                "description": "Native Codex app-server workspace agent",
                "providerType": "harness",
                "available": bool(codex_status.get("ok")),
                "create": bool(codex_status.get("ok")),
                "error": "" if codex_status.get("ok") else codex_status.get("error", "Codex is not available"),
                "codex": {
                    "homePath": codex_home,
                    "nativeAgentsDir": os.path.join(codex_home, "agents") if codex_home else "",
                    "workspaceRoot": codex_status.get("workspaceRoot") or codex_cfg.get("workspaceRoot") or "",
                    "mainWorkspace": codex_status.get("mainWorkspace") or codex_cfg.get("mainWorkspace") or "",
                    "defaultCreationMode": "standard",
                    "registerNativeAgents": bool(codex_cfg.get("registerNativeAgents", True)),
                },
            },
        ],
    }


def _handle_agent_create(body):
    if not isinstance(body, dict):
        return {"error": "payload must be an object", "_status": 400}
    name = (body.get("name") or "").strip()
    if not name:
        return {"error": "Agent name is required", "_status": 400}

    platform = (body.get("agentPlatform") or body.get("platform") or body.get("providerKind") or "openclaw").strip().lower()
    if platform in {"hermes", "hermes-agent"}:
        return _handle_hermes_agent_create(body, name)
    if platform in {"codex", "codex-cli", "codex-agent"}:
        return _handle_codex_agent_create(body, name)
    if platform not in {"openclaw", "openclaw-agent"}:
        return {"error": f"Unsupported agent platform '{platform}'", "_status": 400}

    agent_id = _sanitize_agent_id(body.get("id") or name)
    emoji = body.get("emoji") or "🤖"
    role = body.get("role") or "AI assistant"
    prompt = body.get("prompt") or body.get("systemPrompt") or body.get("instructions") or ""
    model = body.get("model") or ""
    workspace_dir = os.path.join(HOST_WORKSPACE_BASE, f"workspace-{agent_id}")
    try:
        create_params = {"name": name, "workspace": workspace_dir, "emoji": emoji}
        selected_model = model or _default_openclaw_agent_model()
        if selected_model:
            create_params["model"] = selected_model
        result = _gateway_rpc_call("agents.create", create_params, timeout=30)
        if not result.get("ok"):
            status = 409 if "already exists" in str(result.get("error", "")).lower() else 500
            return {"error": result.get("error", "OpenClaw agent creation failed"), "_status": status}

        agent_id = result.get("agentId") or agent_id
        for filename, content in _agent_template_files(name, role, emoji, "OpenClaw", prompt=prompt).items():
            file_result = _gateway_rpc_call("agents.files.set", {"agentId": agent_id, "name": filename, "content": content}, timeout=20)
            if not file_result.get("ok"):
                return {"error": f"Agent created but failed to write {filename}: {file_result.get('error', 'unknown error')}", "_status": 500}

        _refresh_agent_roster_after_create()
        _ensure_resident_profile_for_agent(agent_id)
        return {
            "ok": True,
            "agentId": agent_id,
            "providerKind": "openclaw",
            "providerType": "runtime",
            "providerAgentId": agent_id,
            "name": name,
            "emoji": emoji,
            "role": role,
            "workspace": workspace_dir,
            "message": f"Agent '{name}' ({agent_id}) created successfully",
        }
    except Exception as exc:
        return {"error": str(exc), "_status": 500}


def _handle_hermes_agent_create(body, name):
    provider = _hermes_provider()
    if not provider:
        return {"error": "Hermes provider module unavailable", "_status": 503}
    emoji = body.get("emoji") or "⚕️"
    role = body.get("role") or "Hermes Agent"
    prompt = body.get("prompt") or body.get("systemPrompt") or body.get("instructions") or ""
    model = body.get("model") or ""
    profile = body.get("id") or body.get("profile") or _sanitize_agent_id(name)
    result = provider.create_agent(name=name, role=role, model=model, emoji=emoji, profile=profile, prompt=prompt)
    if not result.get("ok"):
        return {"error": result.get("error", "Hermes agent creation failed"), "_status": 500}
    _refresh_agent_roster_after_create()
    _ensure_resident_profile_for_agent(result.get("agentId") or result.get("profile") or profile)
    return {
        "ok": True,
        "agentId": result.get("agentId"),
        "providerKind": "hermes",
        "providerType": "runtime",
        "providerAgentId": result.get("profile"),
        "profile": result.get("profile"),
        "name": name,
        "emoji": emoji,
        "role": role,
        "workspace": result.get("workspace"),
        "message": result.get("message", f"Hermes agent '{name}' created successfully"),
    }


def _handle_codex_agent_create(body, name):
    provider = _codex_provider()
    if not provider:
        return {"error": "Codex provider module unavailable", "_status": 503}
    emoji = body.get("emoji") or "🤖"
    role = body.get("role") or "Codex Agent"
    prompt = body.get("prompt") or body.get("systemPrompt") or body.get("instructions") or role
    model = body.get("model") or CODEX_MODEL
    profile = body.get("id") or body.get("profile") or _sanitize_agent_id(name)
    creation_mode = body.get("codexCreationMode") or body.get("creationMode") or body.get("agentDirectoryMode") or "standard"
    custom_directory = body.get("codexCustomDirectory") or body.get("customDirectory") or body.get("agentDirectory") or ""
    result = provider.create_agent(
        name=name,
        role=role,
        model=model,
        emoji=emoji,
        profile=profile,
        prompt=prompt,
        creation_mode=creation_mode,
        custom_directory=custom_directory,
    )
    if not result.get("ok"):
        return {"error": result.get("error", "Codex agent creation failed"), "_status": 500}
    _refresh_agent_roster_after_create()
    _ensure_resident_profile_for_agent(result.get("agentId") or result.get("profile") or profile)
    return {
        "ok": True,
        "agentId": result.get("agentId"),
        "providerKind": "codex",
        "providerType": "harness",
        "providerAgentId": result.get("profile"),
        "profile": result.get("profile"),
        "name": name,
        "emoji": emoji,
        "role": role,
        "workspace": result.get("workspace"),
        "creationMode": result.get("creationMode"),
        "nativeAgentPath": result.get("nativeAgentPath"),
        "message": result.get("message", f"Codex agent '{name}' created successfully"),
    }


def _gateway_presence_connected():
    if not (_presence_enabled and _gateway_presence and hasattr(_gateway_presence, "get_connection_status")):
        return False
    try:
        return bool((_gateway_presence.get_connection_status() or {}).get("connected"))
    except Exception:
        return False


def _gateway_origin_candidates():
    candidates = []
    if PUBLIC_ORIGIN:
        candidates.append(PUBLIC_ORIGIN.rstrip("/"))
    for port in [PUBLIC_HOST_PORT, str(PORT)]:
        if not port:
            continue
        candidates.extend([f"http://127.0.0.1:{port}", f"http://localhost:{port}"])
    seen = set()
    unique = []
    for origin in candidates:
        if origin and origin not in seen:
            seen.add(origin)
            unique.append(origin)
    return unique


def _read_gateway_allowed_origins():
    config_path = os.path.join(WORKSPACE_BASE, "openclaw.json")
    try:
        with open(config_path, "r") as f:
            cfg = json.load(f)
        origins = cfg.get("gateway", {}).get("controlUi", {}).get("allowedOrigins", [])
        return origins if isinstance(origins, list) else []
    except Exception:
        return []


def _gateway_control_origin():
    allowed = set(_read_gateway_allowed_origins())
    candidates = _gateway_origin_candidates()
    for origin in candidates:
        if origin in allowed:
            return origin
    return candidates[0] if candidates else f"http://127.0.0.1:{PORT}"


def initialize_live_presence():
    global _presence_enabled, _presence_snapshot_thread, _presence_gateway_config
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
            _gateway_presence.start(gw_url, gw_token, port=PORT, client_version=_get_openclaw_version(), origin=_gateway_control_origin())
            _presence_enabled = True
            _presence_gateway_config = (gw_url or "", gw_token or "")
        except Exception as e:
            print(f"⚠️  Virtual World presence: failed to start gateway listener: {e}")
    else:
        _presence_gateway_config = None
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


def restart_gateway_presence():
    global _presence_enabled, _presence_gateway_config
    if not _gateway_presence:
        return
    try:
        if hasattr(_gateway_presence, "stop"):
            _gateway_presence.stop()
    except Exception as e:
        print(f"⚠️  Virtual World presence: failed to stop old gateway listener: {e}")
    _presence_enabled = False
    _presence_gateway_config = None
    initialize_live_presence()


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
    model_cfg = _load_openclaw_model_config()
    agents = []
    if os.path.isdir(agents_dir):
        for name in sorted(os.listdir(agents_dir)):
            agent_dir = os.path.join(agents_dir, name, "agent")
            if not os.path.isdir(agent_dir):
                continue
            agent_info = {"id": name, "statusKey": name, "name": name.capitalize(), "emoji": "🤖", "providerKind": "openclaw", "providerType": "runtime", "providerAgentId": name}
            cfg_agent = _openclaw_config_agent_for(name, agent_info, model_cfg)
            if isinstance(cfg_agent, dict):
                agent_info["model"] = str(cfg_agent.get("model") or "")
                agent_info["provider"] = str(cfg_agent.get("provider") or "")
            agents.append(_apply_identity_to_agent(agent_info))
    agents.extend(_discover_hermes_agents())
    agents.extend(_discover_codex_agents())
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
        with open(file_path, "r", encoding="utf-8") as f:
            content = f.read()
        pattern = re.compile(rf"^- \*\*{re.escape(label)}:\*\*.*$", re.MULTILINE)
        replacement = f"- **{label}:** {value}"
        if pattern.search(content):
            content = pattern.sub(replacement, content, count=1)
        else:
            content = content.rstrip() + "\n" + replacement + "\n"
        with open(file_path, "w", encoding="utf-8") as f:
            f.write(content)
        return True
    except OSError:
        return False


def _agent_record_for(agent_id):
    wanted = str(agent_id or "").strip()
    if not wanted:
        return None
    for agent in get_roster():
        aliases = {
            str(agent.get("id") or ""),
            str(agent.get("statusKey") or ""),
            str(agent.get("providerAgentId") or ""),
            str(agent.get("profile") or ""),
        }
        if wanted in aliases:
            return dict(agent)
    return None


def _safe_agent_file_name(name):
    raw = str(name or "").strip()
    if not raw or raw != os.path.basename(raw):
        return ""
    return raw if raw in AGENT_WORKSPACE_ALLOWED_FILES else ""


def _agent_workspace_file_path(root, name):
    safe_name = _safe_agent_file_name(name)
    if not root or not safe_name:
        return None
    root_real = os.path.realpath(root)
    candidate = os.path.realpath(os.path.join(root_real, safe_name))
    try:
        if os.path.commonpath([root_real, candidate]) != root_real:
            return None
    except ValueError:
        return None
    return candidate


def _openclaw_workspace_root_for_agent(agent_id, agent=None):
    raw_ids = [
        agent_id,
        (agent or {}).get("id"),
        (agent or {}).get("statusKey"),
        (agent or {}).get("providerAgentId"),
        (agent or {}).get("profile"),
    ]
    safe_ids = []
    for raw_id in raw_ids:
        safe_id = re.sub(r"[^A-Za-z0-9_.-]", "", str(raw_id or ""))
        if safe_id and safe_id not in safe_ids:
            safe_ids.append(safe_id)
    candidates = []
    for safe_id in safe_ids:
        candidates.extend([
            os.path.join(WORKSPACE_BASE, "agents", safe_id, "agent"),
            os.path.join(WORKSPACE_BASE, f"workspace-{safe_id}"),
            os.path.join(WORKSPACE_BASE, "workspace", safe_id),
        ])
        if safe_id == "main":
            candidates.append(os.path.join(WORKSPACE_BASE, "workspace"))
    for candidate in candidates:
        if os.path.isdir(candidate) and any(os.path.isfile(os.path.join(candidate, name)) for name in AGENT_WORKSPACE_ALLOWED_FILES):
            return candidate
    for candidate in candidates:
        if os.path.isdir(candidate):
            return candidate
    return None


def _atomic_write_text(path, content):
    os.makedirs(os.path.dirname(path), exist_ok=True)
    existing_stat = None
    try:
        existing_stat = os.stat(path)
    except OSError:
        existing_stat = None
    tmp_path = f"{path}.tmp-{os.getpid()}-{threading.get_ident()}"
    with open(tmp_path, "w", encoding="utf-8") as f:
        f.write(content)
        f.flush()
        if existing_stat is not None:
            try:
                os.fchmod(f.fileno(), existing_stat.st_mode & 0o777)
            except OSError:
                pass
            try:
                os.fchown(f.fileno(), existing_stat.st_uid, existing_stat.st_gid)
            except OSError:
                pass
        os.fsync(f.fileno())
    os.replace(tmp_path, path)


def _is_openclaw_gateway_cmdline(cmdline):
    text = str(cmdline or "").replace("\x00", " ").strip().lower()
    if not text:
        return False
    if any(token in text for token in (" pgrep ", " rg ", " grep ", " sed ", " tail ")):
        return False
    return "openclaw" in text and "gateway" in text


def _signal_openclaw_gateway(restart=False):
    last_error = ""
    try:
        rpc_result = _gateway_rpc_call(
            "gateway.restart.request",
            {"reason": "virtual-world.config-changed", "skipDeferral": False},
            timeout=12,
        )
        if rpc_result.get("ok"):
            return {
                "ok": True,
                "method": "gateway-rpc-restart-request",
                "status": rpc_result.get("status") or rpc_result.get("result"),
                "preflight": rpc_result.get("preflight"),
                "restart": rpc_result.get("restart"),
                "restartRequested": bool(restart),
            }
        last_error = rpc_result.get("error") or "Gateway RPC restart request failed."
    except Exception as exc:
        last_error = str(exc)

    try:
        if restart:
            result = subprocess.run(["systemctl", "--user", "restart", "openclaw-gateway.service"], capture_output=True, timeout=10)
        else:
            result = subprocess.run(["systemctl", "--user", "kill", "-s", "USR1", "openclaw-gateway.service"], capture_output=True, timeout=5)
        if result.returncode == 0:
            return {"ok": True, "method": "systemctl-restart" if restart else "systemctl-usr1"}
    except (FileNotFoundError, subprocess.TimeoutExpired):
        pass
    except Exception as exc:
        last_error = str(exc)

    try:
        current_pid = os.getpid()
        for pid_dir in os.listdir("/proc"):
            if not pid_dir.isdigit():
                continue
            try:
                pid = int(pid_dir)
                if pid == current_pid:
                    continue
                with open(f"/proc/{pid_dir}/cmdline", "rb") as f:
                    cmdline = f.read().decode("utf-8", errors="ignore")
                if _is_openclaw_gateway_cmdline(cmdline):
                    # OpenClaw uses SIGUSR1 for gateway reload/restart intents.
                    os.kill(pid, signal.SIGUSR1)
                    return {"ok": True, "method": "proc-signal", "signal": "SIGUSR1", "pid": pid, "restartRequested": bool(restart)}
            except PermissionError as exc:
                last_error = str(exc)
                continue
            except (ProcessLookupError, FileNotFoundError):
                continue
    except Exception as exc:
        last_error = str(exc)

    try:
        result = subprocess.run(["pgrep", "-af", "openclaw.*gateway"], capture_output=True, text=True, timeout=5)
        for line in result.stdout.strip().splitlines():
            pid_text, _, cmdline = line.partition(" ")
            if not pid_text.strip() or not _is_openclaw_gateway_cmdline(cmdline):
                continue
            pid = int(pid_text.strip())
            if pid == os.getpid():
                continue
            os.kill(pid, signal.SIGUSR1)
            return {"ok": True, "method": "pgrep-signal", "signal": "SIGUSR1", "pid": pid, "restartRequested": bool(restart)}
        if result.returncode != 0 and result.stderr:
            last_error = result.stderr.strip()
    except Exception as exc:
        if not last_error:
            last_error = str(exc)

    return {"ok": False, "method": "none", "error": last_error or "Gateway signal unavailable; saved config will apply on gateway restart."}


def get_agent_framework_workspace(agent_id):
    agent = _agent_record_for(agent_id)
    resolved_agent_id = (agent or {}).get("statusKey") or (agent or {}).get("id") or _resolve_agent_id(agent_id)
    if not resolved_agent_id:
        return False, _api_error("agent_not_found", "Unknown agent id for workspace editor.", details={"agentId": agent_id}), 404
    provider_kind = str((agent or {}).get("providerKind") or "openclaw").lower()
    if provider_kind != "openclaw":
        return True, {
            "ok": True,
            "schemaVersion": AGENT_WORKSPACE_SCHEMA_VERSION,
            "agentId": resolved_agent_id,
            "providerKind": provider_kind,
            "workspaceAvailable": False,
            "editable": False,
            "files": [],
            "unsupportedReason": f"{provider_kind} workspace editing is not implemented in My Virtual World yet.",
        }, 200

    root = _openclaw_workspace_root_for_agent(resolved_agent_id, agent)
    if not root:
        return True, {
            "ok": True,
            "schemaVersion": AGENT_WORKSPACE_SCHEMA_VERSION,
            "agentId": resolved_agent_id,
            "providerKind": "openclaw",
            "workspaceAvailable": False,
            "editable": False,
            "files": [],
            "unsupportedReason": "OpenClaw workspace root was not found for this agent.",
        }, 200

    files = []
    for name in AGENT_WORKSPACE_ALLOWED_FILES:
        file_path = _agent_workspace_file_path(root, name)
        exists = bool(file_path and os.path.isfile(file_path))
        size = os.path.getsize(file_path) if exists else 0
        content = ""
        too_large = exists and size > AGENT_WORKSPACE_FILE_MAX_BYTES
        if exists and not too_large:
            try:
                with open(file_path, "r", encoding="utf-8") as f:
                    content = f.read()
            except UnicodeDecodeError:
                too_large = True
            except OSError:
                content = ""
        files.append({
            "name": name,
            "path": file_path,
            "exists": exists,
            "size": size,
            "editable": not too_large,
            "maxBytes": AGENT_WORKSPACE_FILE_MAX_BYTES,
            "content": content,
            "error": "File is too large or not valid UTF-8." if too_large else "",
        })
    return True, {
        "ok": True,
        "schemaVersion": AGENT_WORKSPACE_SCHEMA_VERSION,
        "agentId": resolved_agent_id,
        "providerKind": "openclaw",
        "workspaceAvailable": True,
        "workspaceRoot": root,
        "editable": True,
        "allowedFiles": list(AGENT_WORKSPACE_ALLOWED_FILES),
        "files": files,
    }, 200


def save_agent_framework_workspace(agent_id, payload):
    if not isinstance(payload, dict):
        return False, _api_error("invalid_payload", "workspace payload must be an object."), 400
    agent = _agent_record_for(agent_id)
    resolved_agent_id = (agent or {}).get("statusKey") or (agent or {}).get("id") or _resolve_agent_id(agent_id)
    if not resolved_agent_id:
        return False, _api_error("agent_not_found", "Unknown agent id for workspace editor.", details={"agentId": agent_id}), 404
    provider_kind = str((agent or {}).get("providerKind") or "openclaw").lower()
    if provider_kind != "openclaw":
        return False, _api_error("unsupported_provider", f"{provider_kind} workspace editing is not implemented yet.", details={"providerKind": provider_kind}), 400
    root = _openclaw_workspace_root_for_agent(resolved_agent_id, agent)
    if not root:
        return False, _api_error("workspace_not_found", "OpenClaw workspace root was not found for this agent.", details={"agentId": resolved_agent_id}), 404

    raw_files = payload.get("files")
    if isinstance(raw_files, dict):
        file_updates = raw_files.items()
    elif isinstance(payload.get("name"), str):
        file_updates = [(payload.get("name"), payload.get("content", ""))]
    else:
        return False, _api_error("invalid_payload", "Provide files as { name: content } or a single name/content pair."), 400

    saved = []
    for raw_name, raw_content in file_updates:
        safe_name = _safe_agent_file_name(raw_name)
        if not safe_name:
            return False, _api_error("invalid_file", "Only built-in agent markdown files can be edited.", details={"name": raw_name}), 400
        content = str(raw_content or "")
        byte_count = len(content.encode("utf-8"))
        if byte_count > AGENT_WORKSPACE_FILE_MAX_BYTES:
            return False, _api_error("file_too_large", f"{safe_name} is larger than the workspace editor limit.", details={"name": safe_name, "maxBytes": AGENT_WORKSPACE_FILE_MAX_BYTES}), 413
        file_path = _agent_workspace_file_path(root, safe_name)
        if not file_path:
            return False, _api_error("invalid_file", "Invalid workspace file path.", details={"name": raw_name}), 400
        try:
            _atomic_write_text(file_path, content)
            saved.append({"name": safe_name, "path": file_path, "bytes": byte_count})
        except OSError as exc:
            return False, _api_error("write_failed", f"Could not save {safe_name}.", details={"error": str(exc)}), 500

    if any(item.get("name") == "IDENTITY.md" for item in saved):
        global _agent_roster, _roster_time
        _agent_roster = discover_agents()
        _roster_time = time.time()
    return True, {
        "ok": True,
        "schemaVersion": AGENT_WORKSPACE_SCHEMA_VERSION,
        "agentId": resolved_agent_id,
        "providerKind": "openclaw",
        "workspaceRoot": root,
        "saved": saved,
    }, 200


def _openclaw_model_entries(cfg):
    models = []
    seen = set()

    def add_model(model_id, *, provider="", name="", source="", context_window=0):
        model_id = str(model_id or "").strip()
        if not model_id or model_id in seen:
            return
        seen.add(model_id)
        provider_id = str(provider or (model_id.split("/", 1)[0] if "/" in model_id else "")).strip()
        models.append({
            "id": model_id,
            "key": model_id,
            "name": str(name or (model_id.split("/", 1)[-1] if "/" in model_id else model_id)),
            "label": model_id,
            "provider": provider_id,
            "source": source,
            "contextWindow": _context_window_for_model(model_id, provider_id, cfg) or context_window or 0,
            "available": True,
            "missing": False,
        })

    default_model = cfg.get("agents", {}).get("defaults", {}).get("model", {}).get("primary", "")
    add_model(default_model, source="agents.defaults.model.primary")
    defaults_models = cfg.get("agents", {}).get("defaults", {}).get("models", {})
    if isinstance(defaults_models, dict):
        for model_id, meta in defaults_models.items():
            context_window = 0
            if isinstance(meta, dict):
                params = meta.get("params") if isinstance(meta.get("params"), dict) else {}
                context_window = meta.get("contextWindow") or params.get("contextWindow") or 0
            add_model(model_id, source="agents.defaults.models", context_window=context_window)
    providers = cfg.get("models", {}).get("providers", {})
    if isinstance(providers, dict):
        for provider_id, pdata in providers.items():
            for model in (pdata.get("models", []) if isinstance(pdata, dict) else []):
                if isinstance(model, dict):
                    raw_id = str(model.get("id") or model.get("model") or model.get("name") or "").strip()
                    model_id = raw_id if "/" in raw_id else f"{provider_id}/{raw_id}" if raw_id else ""
                    add_model(model_id, provider=provider_id, name=model.get("name") or raw_id, source="models.providers", context_window=model.get("contextWindow") or 0)
                else:
                    raw_id = str(model or "").strip()
                    model_id = raw_id if "/" in raw_id else f"{provider_id}/{raw_id}" if raw_id else ""
                    add_model(model_id, provider=provider_id, source="models.providers")
    return sorted(models, key=lambda item: (item.get("provider") or "", item.get("id") or ""))


def _provider_from_model_id(model_id):
    value = str(model_id or "").strip()
    return value.split("/", 1)[0] if "/" in value else ""


def _safe_provider_id(value):
    return re.sub(r"[^A-Za-z0-9_.:-]+", "-", str(value or "").strip()).strip("-.")


def _mask_secret(value):
    value = str(value or "")
    if len(value) <= 8:
        return "****" if value else ""
    return value[:4] + "••••••••" + value[-4:]


def _parse_model_entries(value):
    if isinstance(value, str):
        raw_items = [line.strip() for line in value.splitlines()]
    elif isinstance(value, list):
        raw_items = value
    else:
        raw_items = []
    entries = []
    seen = set()
    for item in raw_items:
        if isinstance(item, dict):
            model_id = str(item.get("id") or item.get("model") or item.get("name") or "").strip()
            entry = dict(item)
        else:
            model_id = str(item or "").strip()
            entry = {"id": model_id, "name": model_id}
        if not model_id or model_id.startswith("#") or model_id in seen:
            continue
        seen.add(model_id)
        entry["id"] = model_id
        entry.setdefault("name", model_id)
        entries.append(entry)
    return entries


def _run_json_command(args, timeout=30, input_text=None, env=None):
    try:
        result = subprocess.run(args, input=input_text, capture_output=True, text=True, timeout=timeout, env=env)
    except Exception as exc:
        return {"ok": False, "error": str(exc), "data": None}
    raw = (result.stdout or "").strip()
    if result.returncode != 0:
        return {"ok": False, "error": (result.stderr or result.stdout or f"{args[0]} failed").strip()[:2000], "data": None}
    try:
        return {"ok": True, "data": json.loads(raw or "{}")}
    except json.JSONDecodeError:
        return {"ok": False, "error": "Command did not return JSON", "data": None, "stdout": raw[:2000]}


def _run_text_command(args, timeout=30, input_text=None, env=None):
    try:
        result = subprocess.run(args, input=input_text, capture_output=True, text=True, timeout=timeout, env=env)
    except Exception as exc:
        return {"ok": False, "text": str(exc), "exitCode": None}
    text_out = ((result.stdout or "") + ("\n" + result.stderr if result.stderr else "")).strip()
    return {"ok": result.returncode == 0, "text": text_out[:4000], "exitCode": result.returncode}


def _openclaw_config_path():
    return os.path.join(WORKSPACE_BASE, "openclaw.json")


def _safe_openclaw_agent_id(agent_id=None):
    safe_id = re.sub(r"[^A-Za-z0-9_.-]", "", str(agent_id or "").strip())
    return safe_id or "main"


def _openclaw_agent_dir(agent_id=None):
    return os.path.join(WORKSPACE_BASE, "agents", _safe_openclaw_agent_id(agent_id), "agent")


def _openclaw_auth_profiles_path(agent_id=None):
    return os.path.join(_openclaw_agent_dir(agent_id), "auth-profiles.json")


def _openclaw_binary():
    configured = os.environ.get("OPENCLAW_BIN") or os.environ.get("VW_OPENCLAW_BIN") or ""
    candidates = [
        configured,
        shutil.which("openclaw"),
        os.path.expanduser("~/.npm-global/bin/openclaw"),
        os.path.expanduser("~/.local/bin/openclaw"),
        "/usr/local/bin/openclaw",
    ]
    for candidate in candidates:
        if not candidate:
            continue
        expanded = os.path.expanduser(candidate)
        if os.path.isfile(expanded) and os.access(expanded, os.X_OK):
            return expanded
    return ""


def _quote_sqlite_identifier(name):
    return '"' + str(name).replace('"', '""') + '"'


def _read_openclaw_auth_sqlite(agent_id=None):
    db_path = os.path.join(_openclaw_agent_dir(agent_id), "openclaw-agent.sqlite")
    profiles = []
    if not os.path.exists(db_path):
        return profiles
    try:
        con = sqlite3.connect(db_path)
        con.row_factory = sqlite3.Row
        tables = [r[0] for r in con.execute("select name from sqlite_master where type='table'")]
        for table in tables:
            qtable = _quote_sqlite_identifier(table)
            cols = [r[1] for r in con.execute(f"pragma table_info({qtable})")]
            if "store_json" in cols:
                for row in con.execute(f"select store_json from {qtable}").fetchall():
                    try:
                        data = json.loads(row["store_json"] or "{}")
                    except Exception:
                        continue
                    for profile_id, profile in (data.get("profiles") or {}).items():
                        if not isinstance(profile, dict):
                            continue
                        provider = profile.get("provider") or profile_id.split(":", 1)[0]
                        ptype = profile.get("type") or profile.get("mode") or "profile"
                        email = profile.get("email") or ""
                        profiles.append({
                            "id": profile_id,
                            "provider": provider,
                            "type": ptype,
                            "label": profile_id + (f" ({email})" if email else ""),
                            "source": "sqlite",
                        })
                continue
            if not {"id", "provider"}.issubset(set(cols)):
                continue
            type_col = "type" if "type" in cols else ("mode" if "mode" in cols else None)
            for row in con.execute(f"select * from {qtable}").fetchall():
                provider = row["provider"]
                profile_id = row["id"]
                if not provider or not profile_id:
                    continue
                ptype = row[type_col] if type_col else ""
                email = row["email"] if "email" in cols else ""
                profiles.append({
                    "id": profile_id,
                    "provider": provider,
                    "type": ptype or "profile",
                    "label": profile_id + (f" ({email})" if email else ""),
                    "source": "sqlite",
                })
    except Exception:
        return profiles
    finally:
        try:
            con.close()
        except Exception:
            pass
    seen = set()
    unique = []
    for profile in profiles:
        key = (profile["id"], profile["provider"], profile["type"])
        if key not in seen:
            seen.add(key)
            unique.append(profile)
    return unique


def _read_openclaw_auth_json(agent_id=None):
    profiles = []
    try:
        with open(_openclaw_auth_profiles_path(agent_id), "r") as f:
            data = json.load(f)
    except Exception:
        return profiles
    for profile_id, profile in (data.get("profiles") or {}).items():
        if not isinstance(profile, dict):
            continue
        provider = profile.get("provider") or profile_id.split(":", 1)[0]
        ptype = profile.get("type") or profile.get("mode") or "profile"
        email = profile.get("email") or ""
        profiles.append({
            "id": profile_id,
            "provider": provider,
            "type": ptype,
            "label": profile_id + (f" ({email})" if email else ""),
            "source": "auth-profiles.json",
        })
    return profiles


def _read_openclaw_auth_profiles(agent_id=None):
    sqlite_profiles = _read_openclaw_auth_sqlite(agent_id)
    if sqlite_profiles:
        return sqlite_profiles
    return _read_openclaw_auth_json(agent_id)


def _openclaw_agent_ids():
    ids = ["main"]
    cfg = _load_openclaw_model_config()
    for item in cfg.get("agents", {}).get("list", []) or []:
        if isinstance(item, dict) and item.get("id"):
            safe_id = _safe_openclaw_agent_id(item.get("id"))
            if safe_id and safe_id not in ids:
                ids.append(safe_id)
    agents_dir = os.path.join(WORKSPACE_BASE, "agents")
    try:
        for name in sorted(os.listdir(agents_dir)):
            if not os.path.isdir(os.path.join(agents_dir, name, "agent")):
                continue
            safe_id = _safe_openclaw_agent_id(name)
            if safe_id and safe_id not in ids:
                ids.append(safe_id)
    except OSError:
        pass
    return ids


def _openclaw_profile_provider(profile_id, profile):
    profile = profile if isinstance(profile, dict) else {}
    return profile.get("provider") or str(profile_id or "").split(":", 1)[0]


def _openclaw_profile_type(profile):
    profile = profile if isinstance(profile, dict) else {}
    return str(profile.get("type") or profile.get("mode") or "").lower()


def _is_openclaw_portable_static_profile(profile):
    if not isinstance(profile, dict) or profile.get("copyToAgents") is False:
        return False
    ptype = _openclaw_profile_type(profile)
    if ptype in {"api_key", "key"} or "key" in profile:
        return True
    if ptype == "token" and (profile.get("token") or profile.get("tokenRef")):
        return True
    return False


def _read_openclaw_auth_profile_map(agent_id=None):
    db_path = os.path.join(_openclaw_agent_dir(agent_id), "openclaw-agent.sqlite")
    if os.path.exists(db_path):
        con = None
        try:
            con = sqlite3.connect(db_path)
            con.row_factory = sqlite3.Row
            tables = [r[0] for r in con.execute("select name from sqlite_master where type='table'")]
            for table in tables:
                qtable = _quote_sqlite_identifier(table)
                cols = [r[1] for r in con.execute(f"pragma table_info({qtable})")]
                if not {"store_key", "store_json"}.issubset(set(cols)):
                    continue
                row = con.execute(f"select store_json from {qtable} where store_key = ?", ("primary",)).fetchone()
                if not row:
                    continue
                data = json.loads(row["store_json"] or "{}")
                profiles = data.get("profiles") if isinstance(data, dict) else {}
                if isinstance(profiles, dict):
                    return {pid: dict(profile) for pid, profile in profiles.items() if isinstance(profile, dict)}
        except Exception:
            pass
        finally:
            try:
                con.close()
            except Exception:
                pass
    try:
        with open(_openclaw_auth_profiles_path(agent_id), "r") as f:
            data = json.load(f)
    except Exception:
        return {}
    profiles = data.get("profiles") if isinstance(data, dict) else {}
    return {pid: dict(profile) for pid, profile in profiles.items() if isinstance(profile, dict)}


def _openclaw_profile_public(profile_id, profile, *, agent_id=None, main_profiles=None):
    profile = profile if isinstance(profile, dict) else {}
    ptype = _openclaw_profile_type(profile) or "profile"
    email = profile.get("email") or ""
    provider = _openclaw_profile_provider(profile_id, profile)
    main_profile = (main_profiles or {}).get(profile_id) if isinstance(main_profiles, dict) else None
    return {
        "id": profile_id,
        "provider": provider,
        "type": ptype,
        "label": profile_id + (f" ({email})" if email else ""),
        "agent": agent_id,
        "portableStatic": _is_openclaw_portable_static_profile(profile),
        "localOverride": agent_id not in {None, "main"},
        "matchesMain": main_profile == profile if main_profile is not None else False,
        "inMain": main_profile is not None,
    }


def _openclaw_managed_auth_report():
    agent_ids = _openclaw_agent_ids()
    main_profiles = _read_openclaw_auth_profile_map("main")
    managed_profiles = {
        pid: profile
        for pid, profile in main_profiles.items()
        if _is_openclaw_portable_static_profile(profile)
    }
    agent_rows = []
    for agent_id in agent_ids:
        profiles = _read_openclaw_auth_profile_map(agent_id)
        if agent_id == "main":
            missing = []
            divergent = []
            extra_static = []
        else:
            missing = [pid for pid in managed_profiles if pid not in profiles]
            divergent = [
                pid for pid, profile in managed_profiles.items()
                if pid in profiles and profiles.get(pid) != profile
            ]
            extra_static = [
                pid for pid, profile in profiles.items()
                if _is_openclaw_portable_static_profile(profile)
                and pid not in managed_profiles
            ]
        local_oauth = [
            pid for pid, profile in profiles.items()
            if _openclaw_profile_type(profile) == "oauth"
        ]
        agent_rows.append({
            "agent": agent_id,
            "profileCount": len(profiles),
            "profiles": [
                _openclaw_profile_public(pid, profile, agent_id=agent_id, main_profiles=main_profiles)
                for pid, profile in sorted(profiles.items())
            ],
            "missingManagedStatic": missing,
            "divergentManagedStatic": divergent,
            "extraStaticProfiles": extra_static,
            "localOAuthProfiles": local_oauth,
            "staticInSync": not missing and not divergent and not extra_static,
        })
    return {
        "sourceAgent": "main",
        "managedStaticProfiles": [
            _openclaw_profile_public(pid, profile, agent_id="main", main_profiles=main_profiles)
            for pid, profile in sorted(managed_profiles.items())
        ],
        "agentRows": agent_rows,
    }


def _update_openclaw_sqlite_auth_stores(updater, agent_id=None):
    db_path = os.path.join(_openclaw_agent_dir(agent_id), "openclaw-agent.sqlite")
    if not os.path.exists(db_path):
        return 0, None
    updated = 0
    con = None
    try:
        con = sqlite3.connect(db_path)
        con.row_factory = sqlite3.Row
        tables = [r[0] for r in con.execute("select name from sqlite_master where type='table'")]
        now_ms = int(time.time() * 1000)
        for table in tables:
            qtable = _quote_sqlite_identifier(table)
            cols = [r[1] for r in con.execute(f"pragma table_info({qtable})")]
            if not {"store_key", "store_json", "updated_at"}.issubset(set(cols)):
                continue
            rows = con.execute(f"select store_key, store_json from {qtable}").fetchall()
            for row in rows:
                try:
                    data = json.loads(row["store_json"] or "{}")
                except Exception:
                    continue
                if not isinstance(data.get("profiles"), dict):
                    continue
                changed = updater(data)
                if not changed:
                    continue
                con.execute(
                    f"update {qtable} set store_json = ?, updated_at = ? where store_key = ?",
                    (json.dumps(data, separators=(",", ":")), now_ms, row["store_key"]),
                )
                updated += 1
        con.commit()
        return updated, None
    except Exception as exc:
        return updated, str(exc)
    finally:
        try:
            if con:
                con.close()
        except Exception:
            pass


def _update_openclaw_auth_profiles_json(updater, create_if_missing=False, agent_id=None):
    path = _openclaw_auth_profiles_path(agent_id)
    if not os.path.exists(path) and not create_if_missing:
        return False, None
    try:
        os.makedirs(os.path.dirname(path), exist_ok=True)
        try:
            with open(path, "r") as f:
                data = json.load(f)
        except (FileNotFoundError, json.JSONDecodeError):
            data = {"version": 1, "profiles": {}, "lastGood": {}}
        data.setdefault("version", 1)
        data.setdefault("profiles", {})
        data.setdefault("lastGood", {})
        changed = updater(data)
        if not changed:
            return False, None
        _atomic_write_text(path, json.dumps(data, indent=2) + "\n")
        return True, None
    except Exception as exc:
        return False, str(exc)


def _cleanup_openclaw_sqlite_auth_state(agent_id, provider, profile_ids):
    profile_ids = {str(pid) for pid in (profile_ids or []) if pid}
    if not profile_ids:
        return 0, None
    db_path = os.path.join(_openclaw_agent_dir(agent_id), "openclaw-agent.sqlite")
    if not os.path.exists(db_path):
        return 0, None
    updated = 0
    con = None
    try:
        con = sqlite3.connect(db_path)
        con.row_factory = sqlite3.Row
        tables = [r[0] for r in con.execute("select name from sqlite_master where type='table'")]
        now_ms = int(time.time() * 1000)
        for table in tables:
            qtable = _quote_sqlite_identifier(table)
            cols = [r[1] for r in con.execute(f"pragma table_info({qtable})")]
            if not {"state_key", "state_json", "updated_at"}.issubset(set(cols)):
                continue
            rows = con.execute(f"select state_key, state_json from {qtable}").fetchall()
            for row in rows:
                try:
                    data = json.loads(row["state_json"] or "{}")
                except Exception:
                    continue
                changed = False
                last_good = data.get("lastGood")
                if isinstance(last_good, dict):
                    for key, value in list(last_good.items()):
                        if value in profile_ids:
                            last_good.pop(key, None)
                            changed = True
                order = data.get("order")
                if isinstance(order, dict):
                    for key, values in list(order.items()):
                        if isinstance(values, list):
                            kept = [value for value in values if value not in profile_ids]
                            if kept != values:
                                order[key] = kept
                                changed = True
                usage_stats = data.get("usageStats")
                if isinstance(usage_stats, dict):
                    for profile_id in profile_ids:
                        if profile_id in usage_stats:
                            usage_stats.pop(profile_id, None)
                            changed = True
                if not changed:
                    continue
                con.execute(
                    f"update {qtable} set state_json = ?, updated_at = ? where state_key = ?",
                    (json.dumps(data, separators=(",", ":")), now_ms, row["state_key"]),
                )
                updated += 1
        con.commit()
        return updated, None
    except Exception as exc:
        return updated, str(exc)
    finally:
        try:
            if con:
                con.close()
        except Exception:
            pass


def _sync_openclaw_static_auth_from_main(provider=None, profile_id=None, target_agent=None, prune=False):
    provider = _safe_provider_id(provider) if provider else ""
    profile_id = str(profile_id or "").strip()
    target_agent = _safe_openclaw_agent_id(target_agent) if target_agent else ""
    main_profiles = _read_openclaw_auth_profile_map("main")
    managed_profiles = {
        pid: dict(profile)
        for pid, profile in main_profiles.items()
        if _is_openclaw_portable_static_profile(profile)
        and (not provider or _openclaw_profile_provider(pid, profile) == provider)
        and (not profile_id or pid == profile_id)
    }
    if profile_id and not managed_profiles:
        return {"ok": False, "error": f"Portable static profile not found in main: {profile_id}"}

    agent_ids = [target_agent] if target_agent else _openclaw_agent_ids()
    summary = []
    touched = 0
    removed_by_agent = {}
    for agent_id in agent_ids:
        if agent_id == "main":
            continue
        removed = []

        def updater(data):
            profiles = data.setdefault("profiles", {})
            changed = False
            for pid, profile in managed_profiles.items():
                if profiles.get(pid) != profile:
                    profiles[pid] = dict(profile)
                    changed = True
            if prune:
                remove = [
                    pid for pid, profile in list(profiles.items())
                    if isinstance(profile, dict)
                    and _is_openclaw_portable_static_profile(profile)
                    and (not provider or _openclaw_profile_provider(pid, profile) == provider)
                    and (not profile_id or pid == profile_id or pid not in managed_profiles)
                    and (pid not in managed_profiles or profiles.get(pid) != managed_profiles.get(pid))
                ]
                for pid in remove:
                    profiles.pop(pid, None)
                    removed.append(pid)
                    changed = True
                last_good = data.get("lastGood")
                if isinstance(last_good, dict):
                    for key, value in list(last_good.items()):
                        if value in remove:
                            last_good.pop(key, None)
            return changed

        sqlite_updates, sqlite_err = _update_openclaw_sqlite_auth_stores(updater, agent_id=agent_id)
        json_updated, json_err = _update_openclaw_auth_profiles_json(updater, create_if_missing=(sqlite_updates == 0 and not sqlite_err), agent_id=agent_id)
        if removed:
            removed_by_agent[agent_id] = removed
            _cleanup_openclaw_sqlite_auth_state(agent_id, provider, removed)
        ok = not ((sqlite_err and not json_updated) or (json_err and sqlite_updates == 0))
        if ok and (sqlite_updates or json_updated or removed):
            touched += 1
        summary.append({
            "agent": agent_id,
            "ok": ok,
            "sqliteUpdates": sqlite_updates,
            "jsonUpdated": bool(json_updated),
            "removedProfiles": removed,
            "error": sqlite_err or json_err or "",
        })
    _signal_openclaw_gateway(restart=False)
    return {
        "ok": all(item["ok"] for item in summary),
        "sourceAgent": "main",
        "provider": provider,
        "profileId": profile_id,
        "syncedProfiles": sorted(managed_profiles.keys()),
        "touchedAgents": touched,
        "agents": summary,
        "removedProfilesByAgent": removed_by_agent,
    }


def _reset_openclaw_static_auth_overrides(agent_id=None, provider=None):
    agent_id = _safe_openclaw_agent_id(agent_id) if agent_id else ""
    if agent_id == "main":
        return {"ok": False, "error": "main is the MVW global auth source and cannot be reset to itself"}
    return _sync_openclaw_static_auth_from_main(provider=provider, target_agent=agent_id or None, prune=True)


def _mirror_openclaw_config_auth_profile(provider, profile_id):
    cfg_path = _openclaw_config_path()
    cfg = _load_openclaw_model_config()
    cfg.setdefault("auth", {}).setdefault("profiles", {})[profile_id] = {
        "provider": provider,
        "mode": "api_key",
    }
    try:
        _atomic_write_text(cfg_path, json.dumps(cfg, indent=2) + "\n")
        return True, None
    except OSError as exc:
        return False, str(exc)


def _remove_openclaw_config_auth_profiles(profile_ids):
    if not profile_ids:
        return True, None
    cfg_path = _openclaw_config_path()
    cfg = _load_openclaw_model_config()
    profiles = cfg.setdefault("auth", {}).setdefault("profiles", {})
    changed = False
    for profile_id in profile_ids:
        if profile_id in profiles:
            profiles.pop(profile_id, None)
            changed = True
    if not changed:
        return True, None
    try:
        _atomic_write_text(cfg_path, json.dumps(cfg, indent=2) + "\n")
        return True, None
    except OSError as exc:
        return False, str(exc)


def _save_openclaw_api_key_direct(provider, profile_id, api_key, agent_id=None):
    profile = {"type": "api_key", "provider": provider, "key": api_key}
    agent_id = _safe_openclaw_agent_id(agent_id)

    def updater(data):
        profiles = data.setdefault("profiles", {})
        if profiles.get(profile_id) == profile:
            return False
        profiles[profile_id] = dict(profile)
        last_good = data.get("lastGood")
        if isinstance(last_good, dict):
            last_good[provider] = profile_id
        return True

    sqlite_updates, sqlite_err = _update_openclaw_sqlite_auth_stores(updater, agent_id=agent_id)
    json_updated, json_err = _update_openclaw_auth_profiles_json(updater, create_if_missing=(sqlite_updates == 0 and not sqlite_err), agent_id=agent_id)
    if sqlite_err and not json_updated:
        return {"ok": False, "error": f"Cannot write OpenClaw auth store: {sqlite_err}"}
    if json_err and sqlite_updates == 0:
        return {"ok": False, "error": f"Cannot write auth-profiles.json: {json_err}"}
    _mirror_openclaw_config_auth_profile(provider, profile_id)
    _signal_openclaw_gateway(restart=False)
    return {"ok": True, "provider": provider, "profileId": profile_id, "agent": agent_id, "maskedKey": _mask_secret(api_key), "source": "direct-auth-store"}


def _delete_openclaw_auth_direct(provider, profile_id="", agent_id=None):
    deleted = set()
    agent_id = _safe_openclaw_agent_id(agent_id)

    def should_delete(pid, profile):
        if profile_id:
            return pid == profile_id
        if (profile.get("provider") or pid.split(":", 1)[0]) != provider:
            return False
        ptype = str(profile.get("type") or profile.get("mode") or "").lower()
        return ptype in {"api_key", "key"} or "key" in profile

    def updater(data):
        profiles = data.setdefault("profiles", {})
        remove = [pid for pid, profile in profiles.items() if isinstance(profile, dict) and should_delete(pid, profile)]
        for pid in remove:
            profiles.pop(pid, None)
            deleted.add(pid)
        last_good = data.get("lastGood")
        if isinstance(last_good, dict):
            for key, value in list(last_good.items()):
                if value in remove:
                    last_good.pop(key, None)
        return bool(remove)

    sqlite_updates, sqlite_err = _update_openclaw_sqlite_auth_stores(updater, agent_id=agent_id)
    json_updated, json_err = _update_openclaw_auth_profiles_json(updater, create_if_missing=False, agent_id=agent_id)
    if sqlite_err and not json_updated:
        return {"ok": False, "error": f"Cannot write OpenClaw auth store: {sqlite_err}"}
    if json_err and sqlite_updates == 0:
        return {"ok": False, "error": f"Cannot write auth-profiles.json: {json_err}"}
    state_updates, state_err = _cleanup_openclaw_sqlite_auth_state(agent_id, provider, deleted)
    if state_err and not deleted:
        return {"ok": False, "error": f"Cannot update OpenClaw auth state: {state_err}"}
    _remove_openclaw_config_auth_profiles(deleted)
    _signal_openclaw_gateway(restart=False)
    return {"ok": True, "provider": provider, "agent": agent_id, "deletedProfiles": sorted(deleted), "stateUpdates": state_updates, "source": "direct-auth-store"}


_OPENCLAW_CLOUD_PROVIDER_IDS = {
    "anthropic",
    "openai",
    "openai-codex",
    "google",
    "gemini",
    "groq",
    "openrouter",
    "mistral",
    "cohere",
    "xai",
    "github-copilot",
    "copilot",
}


def _openclaw_provider_kind(provider, pdata):
    provider = _safe_provider_id(provider)
    pdata = pdata if isinstance(pdata, dict) else {}
    api = str(pdata.get("api") or "").lower()
    base_url = str(pdata.get("baseUrl") or "").strip()
    if provider in {"ollama", "lmstudio"} or api == "ollama":
        return "local"
    if base_url:
        return "local" if provider not in _OPENCLAW_CLOUD_PROVIDER_IDS else "cloud"
    if provider in _OPENCLAW_CLOUD_PROVIDER_IDS:
        return "cloud"
    return "local"


def _openclaw_local_providers_from_config(cfg):
    providers = []
    for provider, pdata in (cfg.get("models", {}).get("providers", {}) or {}).items():
        if not isinstance(pdata, dict) or _openclaw_provider_kind(provider, pdata) != "local":
            continue
        model_rows = []
        for model in pdata.get("models", []) or []:
            if isinstance(model, dict):
                model_id = str(model.get("id") or model.get("model") or model.get("name") or "").strip()
                name = model.get("name") or model_id
                context_window = model.get("contextWindow", 0)
                max_tokens = model.get("maxTokens", 0)
            else:
                model_id = str(model or "").strip()
                name = model_id
                context_window = 0
                max_tokens = 0
            if not model_id:
                continue
            model_rows.append({"id": model_id, "name": name, "contextWindow": context_window, "maxTokens": max_tokens})
        providers.append({
            "id": provider,
            "provider": provider,
            "baseUrl": pdata.get("baseUrl", ""),
            "api": pdata.get("api", ""),
            "apiKeyConfigured": bool(pdata.get("apiKey")),
            "timeoutSeconds": pdata.get("timeoutSeconds"),
            "models": model_rows,
            "modelCount": len(model_rows),
            "source": "openclaw-config",
        })
    return sorted(providers, key=lambda item: item.get("provider", ""))


def _openclaw_cloud_providers_from_config(cfg, auth_profiles=None):
    auth_profiles = auth_profiles or []
    configured = {}
    for model_id, data in (cfg.get("agents", {}).get("defaults", {}).get("models", {}) or {}).items():
        provider = _provider_from_model_id(model_id)
        if provider in _OPENCLAW_CLOUD_PROVIDER_IDS:
            params = data.get("params") if isinstance(data, dict) and isinstance(data.get("params"), dict) else {}
            configured.setdefault(provider, []).append({
                "id": model_id,
                "name": model_id.split("/", 1)[-1],
                "contextWindow": params.get("contextWindow") or (data.get("contextWindow") if isinstance(data, dict) else 0) or 0,
                "source": "agents.defaults.models",
            })
    for provider, pdata in (cfg.get("models", {}).get("providers", {}) or {}).items():
        if not isinstance(pdata, dict) or _openclaw_provider_kind(provider, pdata) != "cloud":
            continue
        for model in pdata.get("models", []) or []:
            raw_id = str((model.get("id") if isinstance(model, dict) else model) or "").strip()
            if not raw_id:
                continue
            configured.setdefault(provider, []).append({
                "id": raw_id if "/" in raw_id else f"{provider}/{raw_id}",
                "name": (model.get("name") if isinstance(model, dict) else raw_id) or raw_id,
                "contextWindow": model.get("contextWindow", 0) if isinstance(model, dict) else 0,
                "source": "models.providers",
            })
    for profile in auth_profiles:
        provider = profile.get("provider") or _provider_from_model_id(profile.get("id", ""))
        if provider in _OPENCLAW_CLOUD_PROVIDER_IDS:
            configured.setdefault(provider, [])
    cloud_providers = []
    for provider, models in configured.items():
        seen = set()
        model_rows = []
        for model in models:
            mid = model.get("id")
            if not mid or mid in seen:
                continue
            seen.add(mid)
            model_rows.append(model)
        profiles = [p for p in auth_profiles if (p.get("provider") or _provider_from_model_id(p.get("id", ""))) == provider]
        cloud_providers.append({
            "id": provider,
            "provider": provider,
            "authProfiles": profiles,
            "authTypes": sorted({str(p.get("type") or p.get("mode") or "profile") for p in profiles if p}),
            "models": sorted(model_rows, key=lambda item: item.get("id", "")),
            "modelCount": len(model_rows),
            "source": "openclaw-cloud",
        })
    return sorted(cloud_providers, key=lambda item: item.get("provider", ""))


def _get_openclaw_native_models(agent_id=None):
    auth_agent_id = _safe_openclaw_agent_id(agent_id)
    cfg = _load_openclaw_model_config()
    auth_profiles = _read_openclaw_auth_profiles(auth_agent_id)
    models = _openclaw_model_entries(cfg)
    agents = {}
    for item in cfg.get("agents", {}).get("list", []) or []:
        if not isinstance(item, dict) or not item.get("id"):
            continue
        agents[str(item.get("id"))] = {
            "id": item.get("id"),
            "workspace": item.get("workspace"),
            "model": item.get("model", ""),
        }
    cli = _openclaw_binary()
    if cli:
        listed = _run_json_command([cli, "models", "list", "--all", "--json"], timeout=45)
        if listed.get("ok") and isinstance(listed.get("data"), dict):
            cli_models = []
            for m in (listed.get("data") or {}).get("models", []) or []:
                key = m.get("key") or m.get("id") or ""
                if not key:
                    continue
                cli_models.append({
                    "id": key,
                    "key": key,
                    "name": m.get("name") or key.split("/", 1)[-1],
                    "label": key,
                    "provider": m.get("provider") or _provider_from_model_id(key),
                    "input": m.get("input"),
                    "contextWindow": m.get("contextWindow") or _context_window_for_model(key, m.get("provider") or "", cfg) or 0,
                    "available": bool(m.get("available", not m.get("missing", False))),
                    "missing": bool(m.get("missing", False)),
                    "local": bool(m.get("local", False)),
                    "tags": m.get("tags") or [],
                    "source": "openclaw",
                })
            if cli_models:
                by_id = {m["id"]: m for m in models}
                for model in cli_models:
                    by_id[model["id"]] = {**by_id.get(model["id"], {}), **model}
                models = sorted(by_id.values(), key=lambda item: (item.get("provider") or "", item.get("id") or ""))
        auth_listed = _run_json_command([cli, "models", "auth", "list", "--agent", auth_agent_id, "--json"], timeout=30)
        if auth_listed.get("ok") and isinstance(auth_listed.get("data"), dict) and auth_listed["data"].get("profiles"):
            auth_profiles = auth_listed["data"]["profiles"]
    return {
        "ok": True,
        "models": models,
        "authProfiles": auth_profiles,
        "authAgent": auth_agent_id,
        "authStatus": {"agent": auth_agent_id, "storePath": os.path.join(_openclaw_agent_dir(auth_agent_id), "openclaw-agent.sqlite"), "source": "native-store"},
        "managedAuth": _openclaw_managed_auth_report(),
        "agents": agents,
        "defaultModel": _primary_openclaw_model(cfg),
        "runtimeDefaultModel": _default_openclaw_model(cfg),
        "providers": sorted({m["provider"] for m in models if m.get("provider")}),
        "localProviders": _openclaw_local_providers_from_config(cfg),
        "cloudProviders": _openclaw_cloud_providers_from_config(cfg, auth_profiles),
        "nativeCommands": {
            "list": "openclaw models list --all --json",
            "auth": "openclaw models auth list --json",
            "status": "openclaw models status --json",
            "assign": "openclaw config patch / agents.list[].model",
        },
    }


def _save_openclaw_api_key(provider, api_key, profile_id="", agent_id=None, sync_all=False):
    provider = _safe_provider_id(provider)
    agent_id = _safe_openclaw_agent_id(agent_id)
    api_key = str(api_key or "").strip()
    profile_id = str(profile_id or f"{provider}:manual").strip()
    if not provider or not api_key:
        return {"ok": False, "error": "provider and API key are required"}
    if sync_all:
        saved = _save_openclaw_api_key(provider, api_key, profile_id, agent_id="main", sync_all=False)
        if not saved.get("ok"):
            return saved
        sync_result = _sync_openclaw_static_auth_from_main(provider=provider, profile_id=profile_id)
        return {
            **saved,
            "agent": "main",
            "scope": "global",
            "sync": sync_result,
            "ok": bool(saved.get("ok") and sync_result.get("ok")),
        }
    cli = _openclaw_binary()
    if cli:
        result = _run_json_command(
            [cli, "models", "auth", "paste-api-key", "--agent", agent_id, "--provider", provider, "--profile-id", profile_id],
            input_text=api_key + "\n",
            timeout=30,
        )
        if result.get("ok"):
            return {"ok": True, "provider": provider, "profileId": profile_id, "agent": agent_id, "maskedKey": _mask_secret(api_key)}
    return _save_openclaw_api_key_direct(provider, profile_id, api_key, agent_id=agent_id)


def _delete_openclaw_auth(provider, profile_id="", agent_id=None, sync_all=False):
    provider = _safe_provider_id(provider)
    agent_id = _safe_openclaw_agent_id(agent_id)
    profile_id = str(profile_id or "").strip()
    if not provider and not profile_id:
        return {"ok": False, "error": "provider or profileId is required"}
    if sync_all:
        results = []
        deleted = set()
        for target in _openclaw_agent_ids():
            result = _delete_openclaw_auth_direct(provider, profile_id, agent_id=target)
            results.append(result)
            deleted.update(result.get("deletedProfiles") or [])
        return {
            "ok": all(item.get("ok") for item in results),
            "provider": provider,
            "profileId": profile_id,
            "scope": "global",
            "deletedProfiles": sorted(deleted),
            "agents": results,
            "source": "global-auth-store",
        }
    return _delete_openclaw_auth_direct(provider, profile_id, agent_id=agent_id)


def _save_openclaw_provider(provider, base_url, models, api="", api_key="", timeout_seconds=None):
    provider = _safe_provider_id(provider)
    base_url = str(base_url or "").strip()
    entries = _parse_model_entries(models)
    if not provider:
        return {"ok": False, "error": "provider is required"}
    if not base_url:
        return {"ok": False, "error": "base URL is required"}
    if not entries:
        return {"ok": False, "error": "at least one model is required"}
    cfg_path = _openclaw_config_path()
    cfg = _load_openclaw_model_config()
    providers = cfg.setdefault("models", {}).setdefault("providers", {})
    existing = providers.get(provider, {}) if isinstance(providers.get(provider), dict) else {}
    if provider == "ollama":
        base_url = re.sub(r"/v1/?$", "", base_url)
        api = api or "ollama"
        timeout_seconds = timeout_seconds or existing.get("timeoutSeconds") or 300
    existing["baseUrl"] = base_url
    existing["api"] = api or existing.get("api") or "openai-completions"
    if api_key:
        existing["apiKey"] = str(api_key)
    if timeout_seconds:
        try:
            existing["timeoutSeconds"] = int(timeout_seconds)
        except (TypeError, ValueError):
            pass
    old_models = {str(m.get("id") or ""): m for m in existing.get("models", []) if isinstance(m, dict)}
    new_models = []
    for entry in entries:
        model_id = entry["id"]
        updated = dict(old_models.get(model_id, {}))
        updated.update({
            "id": model_id,
            "name": entry.get("name") or model_id,
            "reasoning": updated.get("reasoning", False),
            "input": updated.get("input", ["text"]),
            "cost": updated.get("cost", {"input": 0, "output": 0, "cacheRead": 0, "cacheWrite": 0}),
            "contextWindow": entry.get("contextWindow") or updated.get("contextWindow") or 100000,
            "maxTokens": entry.get("maxTokens") or updated.get("maxTokens") or 8192,
        })
        new_models.append(updated)
    existing["models"] = new_models
    providers[provider] = existing
    try:
        _atomic_write_text(cfg_path, json.dumps(cfg, indent=2) + "\n")
    except OSError as exc:
        return {"ok": False, "error": f"Could not save OpenClaw provider: {exc}"}
    gateway_signal = _signal_openclaw_gateway(restart=False)
    return {"ok": True, "provider": provider, "modelCount": len(new_models), "gatewaySignal": gateway_signal}


def _delete_openclaw_provider(provider):
    provider = _safe_provider_id(provider)
    if not provider:
        return {"ok": False, "error": "provider is required"}
    cfg_path = _openclaw_config_path()
    cfg = _load_openclaw_model_config()
    providers = cfg.setdefault("models", {}).setdefault("providers", {})
    if provider not in providers:
        return {"ok": False, "error": f"Provider {provider} is not configured"}
    providers.pop(provider, None)
    defaults_models = cfg.setdefault("agents", {}).setdefault("defaults", {}).setdefault("models", {})
    for model_id in list(defaults_models.keys()):
        if str(model_id).startswith(provider + "/"):
            defaults_models.pop(model_id, None)
    for agent in cfg.get("agents", {}).get("list", []) or []:
        if isinstance(agent, dict) and str(agent.get("model") or "").startswith(provider + "/"):
            agent.pop("model", None)
    try:
        _atomic_write_text(cfg_path, json.dumps(cfg, indent=2) + "\n")
    except OSError as exc:
        return {"ok": False, "error": f"Could not delete OpenClaw provider: {exc}"}
    gateway_signal = _signal_openclaw_gateway(restart=False)
    return {"ok": True, "provider": provider, "gatewaySignal": gateway_signal}


def _load_yaml_file(path):
    if not os.path.exists(path):
        return {}
    if yaml:
        try:
            with open(path, "r") as f:
                return yaml.safe_load(f) or {}
        except Exception:
            return {}
    data = {}
    current = None
    current_alias = None
    try:
        with open(path, "r") as f:
            for raw in f:
                line = raw.rstrip("\n")
                if not line.strip() or line.lstrip().startswith("#"):
                    continue
                if not line.startswith(" ") and line.endswith(":"):
                    current = line[:-1].strip()
                    current_alias = None
                    data.setdefault(current, {})
                    continue
                if current and line.startswith("  ") and ":" in line:
                    key, value = line.strip().split(":", 1)
                    value = value.strip().strip("\"'")
                    if current == "model_aliases" and not raw.startswith("    ") and not value:
                        current_alias = key.strip()
                        data.setdefault(current, {}).setdefault(current_alias, {})
                    elif current == "model_aliases" and current_alias and raw.startswith("    "):
                        data.setdefault(current, {}).setdefault(current_alias, {})[key.strip()] = value
                    else:
                        data.setdefault(current, {})[key.strip()] = value
    except Exception:
        return {}
    return data


def _write_yaml_file(path, data):
    if not yaml:
        return False, "PyYAML is not available"
    try:
        with open(path, "w") as f:
            yaml.safe_dump(data, f, sort_keys=False)
        return True, None
    except Exception as exc:
        return False, str(exc)


def _yaml_scalar(value):
    return json.dumps(str(value or ""))


def _hermes_profile_config_path(profile_id):
    profile_id = str(profile_id or "default")
    if profile_id in ("", "default"):
        return os.path.join(HERMES_HOME, "config.yaml")
    return os.path.join(HERMES_HOME, "profiles", profile_id, "config.yaml")


def _hermes_env():
    provider = _hermes_provider()
    if provider and hasattr(provider, "_subprocess_env"):
        return provider._subprocess_env()
    env = dict(os.environ)
    env["VW_HERMES_HOME"] = HERMES_HOME
    if os.path.basename(HERMES_HOME.rstrip(os.sep)) == ".hermes":
        env["HOME"] = os.path.dirname(HERMES_HOME.rstrip(os.sep)) or env.get("HOME", "")
    return env


def _get_hermes_profile_auth(profile_id):
    paths = []
    if profile_id and profile_id != "default":
        paths.append(os.path.join(HERMES_HOME, "profiles", profile_id, "auth.json"))
    paths.append(os.path.join(HERMES_HOME, "auth.json"))
    merged = {}
    for path in paths:
        try:
            with open(path, "r") as f:
                data = json.load(f)
        except Exception:
            continue
        for provider, state in (data.get("providers") or {}).items():
            merged.setdefault(provider, {"provider": provider, "credentials": []})
            if state:
                mode = state.get("auth_mode") or state.get("type") or "oauth"
                merged[provider]["credentials"].append({"label": provider, "type": mode, "source": "auth.json"})
        for provider, entries in (data.get("credential_pool") or {}).items():
            if not entries:
                continue
            merged.setdefault(provider, {"provider": provider, "credentials": []})
            for entry in entries:
                merged[provider]["credentials"].append({
                    "label": entry.get("label") or entry.get("id") or provider,
                    "type": entry.get("auth_type") or "",
                    "source": entry.get("source") or "credential_pool",
                })
    return list(merged.values())


def _get_hermes_native_models():
    profiles = []
    default_cfg_path = os.path.join(HERMES_HOME, "config.yaml")
    if os.path.exists(default_cfg_path):
        profiles.append(("default", default_cfg_path))
    profiles_dir = os.path.join(HERMES_HOME, "profiles")
    if os.path.isdir(profiles_dir):
        for name in sorted(os.listdir(profiles_dir)):
            cfg_path = os.path.join(profiles_dir, name, "config.yaml")
            if os.path.exists(cfg_path):
                profiles.append((name, cfg_path))
    if not profiles and os.path.isdir(HERMES_HOME):
        profiles.append(("default", default_cfg_path))

    provider_cache = {}
    try:
        with open(os.path.join(HERMES_HOME, "provider_models_cache.json"), "r") as f:
            cache_data = json.load(f)
        for provider, entry in cache_data.items():
            provider_cache[provider] = entry.get("models", []) if isinstance(entry, dict) else []
    except Exception:
        pass

    result_profiles = []
    models = []
    model_aliases = {}
    local_provider_map = {}
    for profile_id, cfg_path in profiles:
        cfg = _load_yaml_file(cfg_path)
        model_cfg = cfg.get("model", {}) if isinstance(cfg, dict) else {}
        result_profiles.append({
            "id": profile_id,
            "configPath": cfg_path,
            "provider": model_cfg.get("provider") or "",
            "model": model_cfg.get("default") or model_cfg.get("model") or "",
            "baseUrl": model_cfg.get("base_url") or "",
            "auth": _get_hermes_profile_auth(profile_id),
            "authOk": True,
        })
        aliases = cfg.get("model_aliases", {}) if isinstance(cfg, dict) else {}
        if not isinstance(aliases, dict):
            continue
        for alias, entry in aliases.items():
            if not isinstance(entry, dict):
                continue
            provider = entry.get("provider") or "custom"
            model = entry.get("model") or alias
            base_url = entry.get("base_url") or ""
            model_aliases[alias] = {"alias": alias, "profile": profile_id, "provider": provider, "model": model, "baseUrl": base_url}
            local_key = (profile_id, provider, base_url)
            local_provider_map.setdefault(local_key, {
                "id": f"{profile_id}:{provider}:{base_url}",
                "profile": profile_id,
                "provider": provider,
                "baseUrl": base_url,
                "models": [],
                "source": "hermes-model-aliases",
            })
            local_provider_map[local_key]["models"].append({"id": model, "name": model, "alias": alias})
            mid = f"{provider}/{model}"
            if not any(m.get("id") == mid for m in models):
                models.append({"id": mid, "provider": provider, "name": model, "source": "hermes-alias", "available": True, "baseUrl": base_url})
    for provider, names in provider_cache.items():
        for name in names:
            mid = f"{provider}/{name}"
            if not any(m.get("id") == mid for m in models):
                models.append({"id": mid, "provider": provider, "name": name, "source": "hermes", "available": True})
    return {
        "ok": bool(profiles),
        "profiles": result_profiles,
        "models": models,
        "providers": sorted(set(provider_cache.keys()) | {m.get("provider") for m in models if m.get("provider")}),
        "modelAliases": list(model_aliases.values()),
        "localProviders": [
            {**provider, "modelCount": len(provider.get("models", []))}
            for provider in sorted(local_provider_map.values(), key=lambda item: (item.get("profile", ""), item.get("provider", ""), item.get("baseUrl", "")))
        ],
        "nativeCommands": {
            "setup": "hermes model",
            "auth": "hermes auth list",
            "assign": "hermes config set model.provider <provider>; hermes config set model.default <model>",
        },
    }


def _set_hermes_profile_model(profile_id, provider, model, base_url=""):
    profile_id = str(profile_id or "default").strip() or "default"
    provider = _safe_provider_id(provider)
    model = str(model or "").strip()
    if not provider or not model:
        return {"ok": False, "error": "provider and model are required"}
    cfg_path = _hermes_profile_config_path(profile_id)
    if not os.path.exists(cfg_path):
        return {"ok": False, "error": f"Hermes profile config not found: {cfg_path}"}
    if yaml:
        cfg = _load_yaml_file(cfg_path)
        if not isinstance(cfg, dict):
            cfg = {}
        model_cfg = cfg.setdefault("model", {})
        model_cfg["default"] = model
        model_cfg["provider"] = provider
        if base_url:
            model_cfg["base_url"] = str(base_url).strip()
        ok, err = _write_yaml_file(cfg_path, cfg)
        if not ok:
            return {"ok": False, "error": err}
        return {"ok": True, "profile": profile_id, "provider": provider, "model": model}
    try:
        with open(cfg_path, "r") as f:
            lines = f.read().splitlines()
        output = []
        in_model = False
        seen_model = False
        wrote = {"provider": False, "default": False, "base_url": False}
        for line in lines:
            stripped = line.strip()
            if not line.startswith(" ") and stripped.endswith(":"):
                if in_model:
                    if not wrote["default"]:
                        output.append(f"  default: {model}")
                    if not wrote["provider"]:
                        output.append(f"  provider: {provider}")
                    if base_url and not wrote["base_url"]:
                        output.append(f"  base_url: {str(base_url).strip()}")
                in_model = stripped == "model:"
                seen_model = seen_model or in_model
                output.append(line)
                continue
            if in_model and line.startswith("  ") and ":" in line:
                key = stripped.split(":", 1)[0]
                if key == "default":
                    output.append(f"  default: {model}")
                    wrote["default"] = True
                    continue
                if key == "provider":
                    output.append(f"  provider: {provider}")
                    wrote["provider"] = True
                    continue
                if key == "base_url" and base_url:
                    output.append(f"  base_url: {str(base_url).strip()}")
                    wrote["base_url"] = True
                    continue
            output.append(line)
        if in_model:
            if not wrote["default"]:
                output.append(f"  default: {model}")
            if not wrote["provider"]:
                output.append(f"  provider: {provider}")
            if base_url and not wrote["base_url"]:
                output.append(f"  base_url: {str(base_url).strip()}")
        if not seen_model:
            output.extend(["model:", f"  default: {model}", f"  provider: {provider}"])
            if base_url:
                output.append(f"  base_url: {str(base_url).strip()}")
        _atomic_write_text(cfg_path, "\n".join(output) + "\n")
        return {"ok": True, "profile": profile_id, "provider": provider, "model": model}
    except Exception as exc:
        return {"ok": False, "error": str(exc)}


def _read_hermes_aliases_text(lines):
    aliases = {}
    start = None
    end = None
    for i, line in enumerate(lines):
        if line.strip() == "model_aliases:" and not line.startswith(" "):
            start = i
            end = len(lines)
            for j in range(i + 1, len(lines)):
                nxt = lines[j]
                if nxt.strip() and not nxt.startswith(" ") and not nxt.lstrip().startswith("#"):
                    end = j
                    break
            break
    if start is None:
        return aliases, None, None
    current = None
    for line in lines[start + 1:end]:
        if line.startswith("  ") and not line.startswith("    ") and line.strip().endswith(":"):
            current = line.strip()[:-1]
            aliases.setdefault(current, {})
            continue
        if current and line.startswith("    ") and ":" in line:
            key, value = line.strip().split(":", 1)
            aliases[current][key.strip()] = value.strip().strip("\"'")
    return aliases, start, end


def _write_hermes_aliases_text(path, aliases):
    try:
        with open(path, "r") as f:
            lines = f.read().splitlines()
    except Exception as exc:
        return False, str(exc)
    _, start, end = _read_hermes_aliases_text(lines)
    block = []
    if aliases:
        block.append("model_aliases:")
        for alias in sorted(aliases):
            entry = aliases[alias] or {}
            block.append(f"  {alias}:")
            block.append(f"    model: {_yaml_scalar(entry.get('model') or alias)}")
            block.append(f"    provider: {_yaml_scalar(entry.get('provider') or 'custom')}")
            if entry.get("base_url"):
                block.append(f"    base_url: {_yaml_scalar(entry.get('base_url'))}")
    if start is None:
        new_lines = lines + ([""] if lines and lines[-1].strip() else []) + block
    else:
        new_lines = lines[:start] + block + lines[end:]
    try:
        _atomic_write_text(path, "\n".join(new_lines).rstrip() + "\n")
        return True, None
    except Exception as exc:
        return False, str(exc)


def _save_hermes_api_key(provider, api_key, label=""):
    provider = _safe_provider_id(provider)
    api_key = str(api_key or "").strip()
    label = str(label or "Virtual World").strip()[:80]
    if not provider or not api_key:
        return {"ok": False, "error": "provider and API key are required"}
    if not HERMES_BIN:
        return {"ok": False, "error": "Hermes CLI is not configured"}
    result = _run_text_command([HERMES_BIN, "auth", "add", provider, "--type", "api-key", "--label", label, "--api-key", api_key], timeout=30, env=_hermes_env())
    if not result.get("ok"):
        return {"ok": False, "error": result.get("text") or "Hermes auth add failed"}
    return {"ok": True, "provider": provider, "label": label, "maskedKey": _mask_secret(api_key)}


def _delete_hermes_auth(provider, target):
    provider = _safe_provider_id(provider)
    target = str(target or "").strip()
    if not provider or not target:
        return {"ok": False, "error": "provider and credential label/id/index are required"}
    if not HERMES_BIN:
        return {"ok": False, "error": "Hermes CLI is not configured"}
    result = _run_text_command([HERMES_BIN, "auth", "remove", provider, target], timeout=30, env=_hermes_env())
    if not result.get("ok"):
        return {"ok": False, "error": result.get("text") or "Hermes auth remove failed"}
    return {"ok": True, "provider": provider, "target": target}


def _save_hermes_custom_provider(profile_id, provider, base_url, models):
    profile_id = str(profile_id or "default").strip() or "default"
    provider = _safe_provider_id(provider) or "custom"
    base_url = str(base_url or "").strip()
    entries = _parse_model_entries(models)
    if not base_url:
        return {"ok": False, "error": "base URL is required"}
    if not entries:
        return {"ok": False, "error": "at least one model is required"}
    cfg_path = _hermes_profile_config_path(profile_id)
    if not os.path.exists(cfg_path):
        return {"ok": False, "error": f"Hermes profile config not found: {cfg_path}"}

    def update_aliases(aliases):
        for alias, entry in list(aliases.items()):
            if isinstance(entry, dict) and _safe_provider_id(entry.get("provider")) == provider:
                aliases.pop(alias, None)
        for entry in entries:
            alias = re.sub(r"[^A-Za-z0-9_.:-]+", "-", entry["id"]).strip("-")[:100]
            aliases[alias] = {"model": entry["id"], "provider": provider, "base_url": base_url}
        return aliases

    if yaml:
        cfg = _load_yaml_file(cfg_path)
        if not isinstance(cfg, dict):
            cfg = {}
        aliases = cfg.setdefault("model_aliases", {})
        if not isinstance(aliases, dict):
            aliases = {}
            cfg["model_aliases"] = aliases
        update_aliases(aliases)
        ok, err = _write_yaml_file(cfg_path, cfg)
        if not ok:
            return {"ok": False, "error": err}
    else:
        try:
            with open(cfg_path, "r") as f:
                lines = f.read().splitlines()
            aliases, _, _ = _read_hermes_aliases_text(lines)
            update_aliases(aliases)
            ok, err = _write_hermes_aliases_text(cfg_path, aliases)
            if not ok:
                return {"ok": False, "error": err}
        except Exception as exc:
            return {"ok": False, "error": str(exc)}
    cache_path = os.path.join(HERMES_HOME, "provider_models_cache.json")
    try:
        cache_data = {}
        if os.path.exists(cache_path):
            with open(cache_path, "r") as f:
                cache_data = json.load(f)
        cache_data[provider] = {"models": [e["id"] for e in entries], "ts": int(time.time())}
        _atomic_write_text(cache_path, json.dumps(cache_data, indent=2) + "\n")
    except Exception:
        pass
    return {"ok": True, "profile": profile_id, "provider": provider, "modelCount": len(entries)}


def _delete_hermes_custom_provider(profile_id, provider):
    profile_id = str(profile_id or "default").strip() or "default"
    provider = _safe_provider_id(provider)
    if not provider:
        return {"ok": False, "error": "provider is required"}
    cfg_path = _hermes_profile_config_path(profile_id)
    if not os.path.exists(cfg_path):
        return {"ok": False, "error": f"Hermes profile config not found: {cfg_path}"}
    removed = []

    def remove_aliases(aliases):
        for alias, entry in list(aliases.items()):
            if isinstance(entry, dict) and _safe_provider_id(entry.get("provider")) == provider:
                removed.append(alias)
                aliases.pop(alias, None)
        return aliases

    if yaml:
        cfg = _load_yaml_file(cfg_path)
        aliases = cfg.get("model_aliases", {}) if isinstance(cfg, dict) else {}
        if isinstance(aliases, dict):
            remove_aliases(aliases)
        ok, err = _write_yaml_file(cfg_path, cfg if isinstance(cfg, dict) else {})
        if not ok:
            return {"ok": False, "error": err}
    else:
        try:
            with open(cfg_path, "r") as f:
                lines = f.read().splitlines()
            aliases, _, _ = _read_hermes_aliases_text(lines)
            remove_aliases(aliases)
            ok, err = _write_hermes_aliases_text(cfg_path, aliases)
            if not ok:
                return {"ok": False, "error": err}
        except Exception as exc:
            return {"ok": False, "error": str(exc)}
    try:
        cache_path = os.path.join(HERMES_HOME, "provider_models_cache.json")
        if os.path.exists(cache_path):
            with open(cache_path, "r") as f:
                cache_data = json.load(f)
            cache_data.pop(provider, None)
            _atomic_write_text(cache_path, json.dumps(cache_data, indent=2) + "\n")
    except Exception:
        pass
    return {"ok": True, "profile": profile_id, "provider": provider, "removedAliases": removed}


def _get_codex_native_setup_state():
    cfg = VW_CONFIG.get("codex", {}) or {}
    home_path = cfg.get("homePath") or os.path.expanduser("~/.codex")
    return {
        "ok": True,
        "enabled": bool(cfg.get("enabled", True)),
        "binary": cfg.get("binary") or "",
        "homePath": home_path,
        "workspaceRoot": cfg.get("workspaceRoot") or "",
        "mainWorkspace": cfg.get("mainWorkspace") or "",
        "model": cfg.get("model") or "",
        "sandbox": cfg.get("sandbox") or "workspace-write",
        "approvalPolicy": cfg.get("approvalPolicy") or "never",
        "preferAppServer": bool(cfg.get("preferAppServer", True)),
        "includeMain": bool(cfg.get("includeMain", True)),
        "includeNativeAgents": bool(cfg.get("includeNativeAgents", True)),
        "registerNativeAgents": bool(cfg.get("registerNativeAgents", True)),
        "nativeAgentsDir": os.path.join(home_path, "agents") if home_path else "",
        "nativeCommands": {
            "login": "codex login",
            "appServer": "codex app-server --stdio",
            "exec": "codex exec",
            "agents": "$CODEX_HOME/agents/*.toml",
        },
    }


def _get_claude_code_native_setup_state():
    cfg = VW_CONFIG.get("claudeCode", {}) or {}
    home_path = cfg.get("homePath") or os.path.expanduser("~/.claude")
    return {
        "ok": False,
        "enabled": bool(cfg.get("enabled", False)),
        "binary": cfg.get("binary") or "",
        "homePath": home_path,
        "workspaceRoot": cfg.get("workspaceRoot") or "",
        "mainWorkspace": cfg.get("mainWorkspace") or "",
        "model": cfg.get("model") or "",
        "permissionMode": cfg.get("permissionMode") or "acceptEdits",
        "includeMain": bool(cfg.get("includeMain", True)),
        "includeNativeAgents": bool(cfg.get("includeNativeAgents", True)),
        "registerNativeAgents": bool(cfg.get("registerNativeAgents", True)),
        "nativeAgentsDir": os.path.join(home_path, "agents") if home_path else "",
        "unsupportedReason": "Claude Code provider support is not implemented in My Virtual World yet.",
        "nativeCommands": {
            "login": "claude auth login",
            "status": "claude auth status --json",
            "stream": "claude -p --output-format stream-json --include-partial-messages",
            "agents": "$CLAUDE_CONFIG_DIR/agents/*.md",
        },
    }


def _handle_claude_code_test(body=None):
    cfg = dict(VW_CONFIG.get("claudeCode", {}) or {})
    if isinstance(body, dict):
        cfg.update({k: v for k, v in body.items() if v is not None})
    binary = os.path.expanduser(str(cfg.get("binary") or "claude"))
    resolved_binary = binary if os.path.isabs(binary) and os.path.isfile(binary) else (shutil.which(binary) or "")
    home_path = os.path.expanduser(str(cfg.get("homePath") or "~/.claude"))
    workspace_root = os.path.expanduser(str(cfg.get("workspaceRoot") or os.path.join(DATA_DIR, "claude-code-agents")))
    return {
        "ok": False,
        "error": "Claude Code provider support is not implemented in My Virtual World yet.",
        "enabled": bool(cfg.get("enabled", False)),
        "binary": binary,
        "binaryDetected": bool(resolved_binary),
        "resolvedBinary": resolved_binary,
        "homePath": home_path,
        "homeDetected": os.path.isdir(home_path),
        "workspaceRoot": workspace_root,
        "workspaceDetected": os.path.isdir(workspace_root),
        "agents": [],
        "unsupportedReason": "Settings can be saved now; live Claude Code agents still need the provider runtime ported from My Virtual Office.",
    }


# ─── UNIFIED CHAT SESSIONS (per-framework session management) ───────────────
# Each agent framework has its own native session architecture:
#   OpenClaw   -> gateway RPC sessions.list / chat.history / sessions.delete
#                 (session keys like agent:<id>:main, agent:<id>:vw-live-mode-planner)
#   Hermes     -> `hermes sessions list/export/delete` CLI (SQLite store) with
#                 the active chat session id tracked in hermes-chat-<profile>.json
#   Codex CLI  -> app-server `thread/list`, `thread/read`, `thread/delete` with the
#                 active thread id tracked in codex-chat-<profile>.json
#   ClaudeCode -> not yet a live provider in VW (listed as unsupported)
# This layer normalizes them into one sessions surface for the chat window.

CHAT_SESSION_SCHEMA_VERSION = "vw-chat-sessions/v1"


def _chat_sessions_agent(agent_id):
    agent = _agent_record_for(agent_id)
    if not agent:
        return None
    return {
        "agentId": agent.get("statusKey") or agent.get("id"),
        "providerKind": str(agent.get("providerKind") or "openclaw").lower(),
        "profile": agent.get("profile") or agent.get("providerAgentId") or agent.get("id"),
        "name": agent.get("name") or agent.get("id"),
    }


def _openclaw_live_mode_session_key(agent_id):
    return f"agent:{agent_id}:vw-live-mode-planner"


def _is_openclaw_live_mode_session_key(agent_id, session_id):
    session_key = str(session_id or "").strip()
    return session_key == _openclaw_live_mode_session_key(agent_id) or session_key.endswith(":vw-live-mode-planner")


def _agent_live_mode_session_active(agent_id, *, loop_state=None, meta=None):
    """True only when the agent is actually opted into Live Mode and its loop is
    not explicitly disabled. Loop-state rows alone are not enough: stale/default
    rows can exist for normal chat agents like Coder/Main."""
    agent = _agent_record_for(agent_id) or {}
    keys = []
    for value in (agent.get("statusKey"), agent.get("id"), agent_id):
        text = str(value or "").strip()
        if text and text not in keys:
            keys.append(text)
    if not keys:
        return False

    meta = meta if isinstance(meta, dict) else load_world_meta_fast()
    profiles = meta.get("agentProfiles", {}) if isinstance(meta.get("agentProfiles"), dict) else {}
    profile = {}
    for key in keys:
        if isinstance(profiles.get(key), dict):
            profile = profiles.get(key)
            break
    if not _agent_live_mode_enabled_from_profile(profile):
        return False

    loop_state = loop_state if isinstance(loop_state, dict) else get_live_agent_loop_state(persist_migration=False, meta=meta)
    loop_agents = loop_state.get("agents") if isinstance(loop_state.get("agents"), dict) else {}
    loop_agent = {}
    for key in keys:
        if isinstance(loop_agents.get(key), dict):
            loop_agent = loop_agents.get(key)
            break
    if isinstance(loop_agent.get("enabled"), bool):
        return loop_agent.get("enabled")
    return True


def _chat_sessions_list_openclaw(agent_ref, limit=40):
    agent_id = agent_ref["agentId"]
    res = _gateway_rpc_call("sessions.list", {"limit": max(1, int(limit)) * 3}, timeout=15)
    if not res.get("ok"):
        return {"ok": False, "error": str(res.get("error") or "sessions.list failed"), "sessions": []}
    rows = res.get("sessions")
    if not isinstance(rows, list):
        payload = res.get("payload") if isinstance(res.get("payload"), dict) else {}
        rows = payload.get("sessions") if isinstance(payload.get("sessions"), list) else []
    prefix = f"agent:{agent_id}:"
    sessions = []
    live_action_running = False
    try:
        loop_state = get_live_agent_loop_state(persist_migration=False)
        live_action_running = _agent_live_mode_session_active(agent_id, loop_state=loop_state)
    except Exception:
        live_action_running = False
    for row in rows:
        if not isinstance(row, dict):
            continue
        key = str(row.get("key") or row.get("sessionKey") or "")
        if not key.startswith(prefix):
            continue
        kind = key[len(prefix):]
        is_live_planner = kind == "vw-live-mode-planner"
        title = str(row.get("label") or row.get("title") or "").strip()
        if not title:
            title = "Live Agent Mode" if is_live_planner else ("Main chat" if kind == "main" else kind)
        sessions.append({
            "id": key,
            "sessionKey": key,
            "title": title[:200],
            "preview": str(row.get("preview") or row.get("lastMessage") or "")[:300],
            "updatedAt": row.get("updatedAt") or row.get("lastActiveAt"),
            "kind": "live-mode" if is_live_planner else ("main" if kind == "main" else "other"),
            "liveMode": is_live_planner,
            "active": bool(is_live_planner and live_action_running),
            "deletable": kind != "main",
        })
    sessions.sort(key=lambda s: str(s.get("updatedAt") or ""), reverse=True)
    if live_action_running and not any(s.get("liveMode") for s in sessions):
        # The planner session is ephemeral (deleted after each decision); still
        # surface Live Agent Mode as a virtual active session so the user can
        # see and open it from the sessions panel.
        sessions.insert(0, {
            "id": _openclaw_live_mode_session_key(agent_id),
            "sessionKey": _openclaw_live_mode_session_key(agent_id),
            "title": "Live Agent Mode",
            "preview": "Autonomous world-life loop (planner decisions are ephemeral)",
            "updatedAt": None,
            "kind": "live-mode",
            "liveMode": True,
            "active": True,
            "deletable": False,
            "virtual": True,
        })
    return {"ok": True, "sessions": sessions[: max(1, int(limit))]}


def _chat_sessions_list_hermes(agent_ref, limit=40):
    provider = _hermes_provider()
    if not provider:
        return {"ok": False, "error": "Hermes provider unavailable", "sessions": []}
    profile = agent_ref["profile"] or "default"
    outcome = provider.list_sessions(profile, limit=limit)
    if not outcome.get("ok"):
        return {"ok": False, "error": outcome.get("error"), "sessions": []}
    active_id = _get_hermes_session_id(profile)
    sessions = []
    for row in outcome.get("sessions") or []:
        sessions.append({
            "id": row.get("id"),
            "sessionKey": f"hermes:{profile}:{row.get('id')}",
            "title": row.get("title") or row.get("id"),
            "preview": row.get("preview") or "",
            "updatedAt": row.get("lastActive") or None,
            "kind": "chat",
            "liveMode": False,
            "active": bool(active_id and row.get("id") == active_id),
            "deletable": True,
        })
    return {"ok": True, "sessions": sessions}


def _chat_sessions_list_codex(agent_ref, limit=40):
    provider = _codex_provider()
    if not provider:
        return {"ok": False, "error": "Codex provider unavailable", "sessions": []}
    profile = agent_ref["profile"] or "main"
    outcome = provider.list_threads(profile, limit=limit)
    if not outcome.get("ok"):
        return {"ok": False, "error": outcome.get("error"), "sessions": []}
    active_id = _get_codex_session_id(profile)
    sessions = []
    for row in outcome.get("sessions") or []:
        if row.get("archived"):
            continue
        sessions.append({
            "id": row.get("id"),
            "sessionKey": f"codex:{profile}:{row.get('id')}",
            "title": row.get("title") or row.get("id"),
            "preview": row.get("preview") or "",
            "updatedAt": row.get("updatedAt"),
            "kind": "chat",
            "liveMode": False,
            "active": bool(active_id and row.get("id") == active_id),
            "deletable": True,
        })
    return {"ok": True, "sessions": sessions}


def _claude_code_home_path():
    cfg = VW_CONFIG.get("claudeCode", {}) or {}
    return os.path.expanduser(str(cfg.get("homePath") or os.environ.get("CLAUDE_CONFIG_DIR") or "~/.claude"))


def _claude_code_projects_dir():
    return os.path.join(_claude_code_home_path(), "projects")


def _claude_code_valid_session_id(session_id):
    text = str(session_id or "").strip()
    return text if re.fullmatch(r"[A-Za-z0-9_.:-]{8,128}", text) else ""


def _claude_code_text_from_content(content):
    if isinstance(content, str):
        return content
    if isinstance(content, list):
        parts = []
        for item in content:
            if not isinstance(item, dict):
                continue
            if item.get("type") == "text" and item.get("text"):
                parts.append(str(item.get("text") or ""))
        return "\n".join(parts)
    if isinstance(content, dict):
        return str(content.get("text") or "")
    return ""


def _claude_code_session_records(limit=80):
    projects_dir = _claude_code_projects_dir()
    if not os.path.isdir(projects_dir):
        return []
    records = []
    for path in glob.glob(os.path.join(projects_dir, "*", "*.jsonl")):
        if ".deleted." in os.path.basename(path):
            continue
        session_id = _claude_code_valid_session_id(os.path.splitext(os.path.basename(path))[0])
        if not session_id:
            continue
        title = ""
        preview = ""
        cwd = ""
        updated_at = None
        try:
            stat = os.stat(path)
            updated_at = _epoch_to_utc_iso(stat.st_mtime)
            with open(path, "r", encoding="utf-8", errors="replace") as f:
                for line in f:
                    try:
                        row = json.loads(line)
                    except json.JSONDecodeError:
                        continue
                    if not isinstance(row, dict):
                        continue
                    if row.get("sessionId"):
                        session_id = str(row.get("sessionId") or session_id)
                    if row.get("cwd") and not cwd:
                        cwd = str(row.get("cwd") or "")
                    if row.get("timestamp"):
                        updated_at = row.get("timestamp")
                    if row.get("type") == "last-prompt" and row.get("lastPrompt"):
                        title = str(row.get("lastPrompt") or "").replace("\n", " ").strip()[:120]
                    message = row.get("message") if isinstance(row.get("message"), dict) else {}
                    role = message.get("role") or row.get("type")
                    text = _claude_code_text_from_content(message.get("content") if message else row.get("content")).strip()
                    if text and role in ("user", "assistant"):
                        if not title and role == "user":
                            title = text.replace("\n", " ").strip()[:120]
                        preview = text.replace("\n", " ").strip()[:300]
        except OSError:
            continue
        records.append({
            "id": session_id,
            "path": path,
            "title": title or session_id,
            "preview": preview,
            "updatedAt": updated_at,
            "cwd": cwd,
        })
    records.sort(key=lambda row: str(row.get("updatedAt") or ""), reverse=True)
    return records[: max(1, int(limit))]


def _claude_code_find_session_file(session_id):
    wanted = _claude_code_valid_session_id(session_id)
    if not wanted:
        return ""
    for row in _claude_code_session_records(limit=500):
        if str(row.get("id") or "") == wanted:
            return str(row.get("path") or "")
    return ""


def _chat_sessions_list_claude_code(agent_ref, limit=40):
    cfg = VW_CONFIG.get("claudeCode", {}) or {}
    home_path = _claude_code_home_path()
    if not os.path.isdir(home_path):
        return {"ok": False, "error": f"Claude Code home not found at {home_path}", "sessions": []}
    active_id = _get_claude_code_session_id(agent_ref["profile"] or "main")
    sessions = []
    for row in _claude_code_session_records(limit=limit):
        session_id = row.get("id")
        sessions.append({
            "id": session_id,
            "sessionKey": f"claude-code:{agent_ref['profile']}:{session_id}",
            "title": row.get("title") or session_id,
            "preview": row.get("preview") or "",
            "updatedAt": row.get("updatedAt"),
            "kind": "chat",
            "liveMode": False,
            "active": bool(active_id and session_id == active_id),
            "deletable": True,
            "cwd": row.get("cwd") or "",
        })
    return {
        "ok": True,
        "sessions": sessions,
        "binary": str(cfg.get("binary") or "claude"),
        "homePath": home_path,
        "resumeCommand": "claude --resume <session-id>",
    }


def handle_chat_sessions_list(agent_id, limit=40):
    agent_ref = _chat_sessions_agent(agent_id)
    if not agent_ref:
        return {"ok": False, "error": f"Unknown agent: {agent_id}", "sessions": []}, 404
    kind = agent_ref["providerKind"]
    if kind == "hermes":
        outcome = _chat_sessions_list_hermes(agent_ref)
    elif kind == "codex":
        outcome = _chat_sessions_list_codex(agent_ref)
    elif kind == "openclaw":
        outcome = _chat_sessions_list_openclaw(agent_ref)
    elif kind in ("claude-code", "claudecode", "claude"):
        outcome = _chat_sessions_list_claude_code(agent_ref, limit=limit)
    else:
        outcome = {"ok": False, "error": f"{kind} session management is not supported yet", "sessions": []}
    status = 200 if outcome.get("ok") else 502
    return {
        "schemaVersion": CHAT_SESSION_SCHEMA_VERSION,
        "agentId": agent_ref["agentId"],
        "providerKind": kind,
        "profile": agent_ref["profile"],
        **outcome,
    }, status


def handle_chat_session_create(agent_id, body=None):
    """Start a fresh session/thread for the agent using its native surface."""
    agent_ref = _chat_sessions_agent(agent_id)
    if not agent_ref:
        return {"ok": False, "error": f"Unknown agent: {agent_id}"}, 404
    kind = agent_ref["providerKind"]
    profile = agent_ref["profile"]
    if kind == "hermes":
        # Hermes creates the new session lazily on the next message; clearing
        # the tracked session id + local mirror is the official reset path.
        _save_hermes_state(profile, {"messages": [], "sessionId": ""})
        return {"ok": True, "providerKind": kind, "profile": profile, "sessionId": "", "note": "New Hermes session starts with the next message."}, 200
    if kind == "codex":
        _save_codex_state(profile, {"messages": [], "sessionId": ""})
        return {"ok": True, "providerKind": kind, "profile": profile, "sessionId": "", "note": "New Codex thread starts with the next message."}, 200
    if kind in ("claude-code", "claudecode", "claude"):
        _save_claude_code_state(profile, {"messages": [], "sessionId": ""})
        return {"ok": True, "providerKind": kind, "profile": profile, "sessionId": "", "note": "New Claude Code session starts with the next message. Native resume uses `claude --resume <session-id>`; forking uses `--fork-session`."}, 200
    if kind == "openclaw":
        session_key = str((body or {}).get("sessionKey") or f"agent:{agent_ref['agentId']}:main")
        res = _gateway_rpc_call("sessions.reset", {"key": session_key}, timeout=15)
        if not res.get("ok"):
            return {"ok": False, "error": str(res.get("error") or "sessions.reset failed")}, 502
        return {"ok": True, "providerKind": kind, "sessionKey": session_key}, 200
    return {"ok": False, "error": f"{kind} session management is not supported yet"}, 400


def handle_chat_session_delete(agent_id, session_id, body=None):
    agent_ref = _chat_sessions_agent(agent_id)
    if not agent_ref:
        return {"ok": False, "error": f"Unknown agent: {agent_id}"}, 404
    if not session_id:
        return {"ok": False, "error": "sessionId is required"}, 400
    kind = agent_ref["providerKind"]
    profile = agent_ref["profile"]
    if kind == "hermes":
        provider = _hermes_provider()
        if not provider:
            return {"ok": False, "error": "Hermes provider unavailable"}, 502
        outcome = provider.delete_session(profile, session_id)
        if outcome.get("ok") and _get_hermes_session_id(profile) == session_id:
            _save_hermes_state(profile, {"messages": [], "sessionId": ""})
        return outcome, 200 if outcome.get("ok") else 502
    if kind == "codex":
        provider = _codex_provider()
        if not provider:
            return {"ok": False, "error": "Codex provider unavailable"}, 502
        outcome = provider.delete_thread(profile, session_id)
        if outcome.get("ok") and _get_codex_session_id(profile) == session_id:
            _save_codex_state(profile, {"messages": [], "sessionId": ""})
        return outcome, 200 if outcome.get("ok") else 502
    if kind in ("claude-code", "claudecode", "claude"):
        path = _claude_code_find_session_file(session_id)
        if not path:
            return {"ok": False, "error": "Claude Code session not found"}, 404
        deleted_path = f"{path}.deleted.{_utc_now_iso().replace(':', '-')}"
        try:
            os.replace(path, deleted_path)
        except OSError as exc:
            return {"ok": False, "error": str(exc)}, 500
        if _get_claude_code_session_id(profile) == session_id:
            _save_claude_code_state(profile, {"messages": [], "sessionId": ""})
        return {"ok": True, "deleted": True, "sessionId": session_id, "deletedPath": deleted_path}, 200
    if kind == "openclaw":
        session_key = str(session_id)
        if session_key.endswith(":main"):
            return {"ok": False, "error": "The main session cannot be deleted; use new session to reset it."}, 400
        res = _gateway_rpc_call("sessions.delete", {"key": session_key, "deleteTranscript": True}, timeout=15)
        if not res.get("ok"):
            return {"ok": False, "error": str(res.get("error") or "sessions.delete failed")}, 502
        return {"ok": True, "deleted": True, "sessionKey": session_key}, 200
    return {"ok": False, "error": f"{kind} session management is not supported yet"}, 400


def _live_agent_session_meta(agent_id):
    session_key = _openclaw_live_mode_session_key(agent_id)
    return {
        "sessionId": session_key,
        "sessionKey": session_key,
        "sessionTitle": "Live Agent Mode",
        "sessionKind": "live-mode",
        "liveMode": True,
        "activeSession": True,
    }


def _live_agent_session_detail_line(label, value, *, limit=220):
    text = _live_agent_loop_clean_plan_text(value, limit=limit)
    return f"{label}: {text}" if text else ""


def _live_agent_session_entry_text(entry):
    if not isinstance(entry, dict):
        return ""
    details = entry.get("details") if isinstance(entry.get("details"), dict) else {}
    entry_type = str(entry.get("type") or "event")
    lines = []
    title = _live_agent_loop_clean_plan_text(entry.get("title"), limit=220)
    summary = _live_agent_loop_clean_plan_text(entry.get("summary"), limit=500)
    if title:
        lines.append(title)
    if summary and summary != title:
        lines.append(summary)

    if entry_type == "decision":
        lines.extend(filter(None, [
            _live_agent_session_detail_line("Selected", details.get("selectedActionLabel") or details.get("selectedActionId")),
            _live_agent_session_detail_line("Reason", details.get("reason"), limit=420),
            _live_agent_session_detail_line("Mode", details.get("mode"), limit=80),
        ]))
    elif entry_type == "plan":
        step = details.get("currentStep") if isinstance(details.get("currentStep"), dict) else {}
        lines.extend(filter(None, [
            _live_agent_session_detail_line("Status", details.get("status"), limit=80),
            _live_agent_session_detail_line("Action", details.get("actionType") or details.get("loopActionId")),
            _live_agent_session_detail_line("Current step", step.get("label") or step.get("id")),
        ]))
    elif entry_type == "world-action":
        lines.extend(filter(None, [
            _live_agent_session_detail_line("Action", details.get("actionType")),
            _live_agent_session_detail_line("Action id", details.get("actionId"), limit=120),
            _live_agent_session_detail_line("Bucket", details.get("bucket"), limit=80),
        ]))
    elif entry_type == "proposal":
        lines.extend(filter(None, [
            _live_agent_session_detail_line("Status", details.get("status"), limit=80),
            _live_agent_session_detail_line("Action", details.get("actionType")),
            _live_agent_session_detail_line("Required executor", details.get("requiredExecutor")),
        ]))
    elif entry_type == "feedback":
        lines.append(_live_agent_session_detail_line("Level", entry.get("severity"), limit=80))
    else:
        decision = details.get("decision") if isinstance(details.get("decision"), dict) else {}
        lines.extend(filter(None, [
            _live_agent_session_detail_line("Action", details.get("loopActionId") or details.get("actionType") or decision.get("selectedActionLabel")),
            _live_agent_session_detail_line("Action id", details.get("actionId"), limit=120),
            _live_agent_session_detail_line("Reason", details.get("reason") or decision.get("reason"), limit=420),
        ]))

    deduped = []
    seen = set()
    for line in lines:
        clean = str(line or "").strip()
        if not clean or clean in seen:
            continue
        seen.add(clean)
        deduped.append(clean)
    return "\n".join(deduped).strip()[:4000]


def _openclaw_session_message_text(message):
    if not isinstance(message, dict):
        return ""
    content = message.get("content")
    if isinstance(content, str):
        return content
    if isinstance(content, list):
        parts = []
        for item in content:
            if not isinstance(item, dict):
                continue
            if item.get("type") == "text" and item.get("text"):
                parts.append(str(item.get("text") or ""))
            elif isinstance(item.get("content"), str):
                parts.append(str(item.get("content") or ""))
        return "".join(parts)
    return ""


def _is_live_agent_planner_prompt(text):
    value = str(text or "")
    if "LIVE MODE PLANNER FRAME" in value:
        return True
    return (
        "You are living as your Virtual World resident body" in value
        and "Available interactions right now" in value
        and ("ACTION:" in value or "INTENTION:" in value)
    )


def _live_agent_planner_deleted_session_files(agent_id):
    sessions_dir = os.path.join(WORKSPACE_BASE, "agents", str(agent_id or ""), "sessions")
    if not os.path.isdir(sessions_dir):
        return []
    paths = []
    for pattern in ("*.jsonl.deleted.*", "*.jsonl"):
        for path in glob.glob(os.path.join(sessions_dir, pattern)):
            name = os.path.basename(path)
            if "trajectory" in name or name.endswith(".codex-app-server.json"):
                continue
            paths.append(path)
    unique = sorted(set(paths), key=lambda path: os.path.getmtime(path) if os.path.exists(path) else 0)
    return unique[-LIVE_AGENT_PLANNER_TRANSCRIPT_RETENTION:]


def _live_agent_planner_deleted_file_turns(agent_id):
    turns = []
    for path in _live_agent_planner_deleted_session_files(agent_id):
        pending = None
        try:
            with open(path, "r", encoding="utf-8", errors="replace") as f:
                for raw in f:
                    raw = raw.strip()
                    if not raw:
                        continue
                    try:
                        row = json.loads(raw)
                    except json.JSONDecodeError:
                        continue
                    if row.get("type") != "message":
                        continue
                    message = row.get("message") if isinstance(row.get("message"), dict) else {}
                    role = str(message.get("role") or row.get("role") or "").strip()
                    text = _openclaw_session_message_text(message)
                    if role == "user" and _is_live_agent_planner_prompt(text):
                        pending = {
                            "id": f"planner-file-{hashlib.sha256((path + raw).encode('utf-8', errors='ignore')).hexdigest()[:12]}",
                            "agentId": str(agent_id or ""),
                            "sessionKey": _live_agent_model_planner_session_key(agent_id),
                            "sourceFile": path,
                            "startedAt": row.get("timestamp") or _utc_now_iso(),
                            "completedAt": None,
                            "status": "captured-from-deleted-session",
                            "mode": LIVE_AGENT_LOOP_MODEL_DECISION_MODE,
                            "prompt": _live_agent_planner_trim_text(text),
                            "reply": "",
                        }
                        continue
                    if role == "assistant" and pending:
                        pending["completedAt"] = row.get("timestamp") or pending.get("startedAt")
                        pending["reply"] = _live_agent_planner_trim_text(text, limit=8000)
                        turns.append(pending)
                        pending = None
            if pending:
                pending["completedAt"] = pending.get("startedAt")
                pending["status"] = "prompt-captured-without-reply"
                turns.append(pending)
        except OSError:
            continue
    return turns


def _live_agent_planner_stored_turns(agent_id):
    with _live_agent_planner_transcript_lock:
        data = _load_live_agent_planner_transcripts()
    agents = data.get("agents") if isinstance(data.get("agents"), dict) else {}
    row = agents.get(str(agent_id or "")) if isinstance(agents.get(str(agent_id or "")), dict) else {}
    return [item for item in (row.get("turns") or []) if isinstance(item, dict)]


def _live_agent_planner_transcript_turns(agent_id, limit_turns):
    turns = []
    seen = set()
    for item in [*_live_agent_planner_deleted_file_turns(agent_id), *_live_agent_planner_stored_turns(agent_id)]:
        prompt = str(item.get("prompt") or "")
        reply = str(item.get("reply") or "")
        if not prompt and not reply:
            continue
        started = item.get("startedAt") or item.get("completedAt") or ""
        key = hashlib.sha256(f"{prompt}|{reply}".encode("utf-8", errors="ignore")).hexdigest()
        if key in seen:
            continue
        seen.add(key)
        turns.append(item)
    turns.sort(key=lambda item: _parse_isoish_epoch(item.get("startedAt") or item.get("completedAt")) or 0)
    return turns[-max(1, int(limit_turns)):]


def _live_agent_planner_transcript_messages(agent_id, session_meta, limit=80):
    limit_value = _normalize_int(limit, 80, minimum=1, maximum=400)
    turn_limit = max(1, min(LIVE_AGENT_PLANNER_TRANSCRIPT_RETENTION, (limit_value + 1) // 2))
    agent_record = _agent_record_for(agent_id) or {}
    agent_label = str(agent_record.get("name") or agent_record.get("statusKey") or agent_record.get("id") or "Live Agent").strip() or "Live Agent"
    messages = []
    for turn in _live_agent_planner_transcript_turns(agent_id, turn_limit):
        started = turn.get("startedAt") or turn.get("completedAt") or _utc_now_iso()
        started_epoch = _parse_isoish_epoch(started)
        prompt = str(turn.get("prompt") or "").strip()
        if prompt:
            messages.append({
                "role": "user",
                "text": prompt,
                "ts": started,
                "time": _format_time_et(started),
                "epochMs": int(started_epoch * 1000) if started_epoch else 0,
                "from": "Live Mode Planner",
                "fromType": "system",
                "source": "live-agent-mode-planner-transcript",
                "eventType": "planner-prompt",
                **session_meta,
            })
        reply = str(turn.get("reply") or "").strip()
        if reply:
            completed = turn.get("completedAt") or started
            completed_epoch = _parse_isoish_epoch(completed)
            messages.append({
                "role": "assistant",
                "text": reply,
                "ts": completed,
                "time": _format_time_et(completed),
                "epochMs": int(completed_epoch * 1000) if completed_epoch else 0,
                "from": agent_label,
                "fromType": "agent",
                "source": "live-agent-mode-planner-transcript",
                "eventType": "planner-reply",
                "modelDecision": {
                    "status": turn.get("status"),
                    "mode": turn.get("mode"),
                    "chosen": turn.get("chosen"),
                    "intention": turn.get("intention") if isinstance(turn.get("intention"), dict) else None,
                },
                **session_meta,
            })
    messages.sort(key=lambda item: int(item.get("epochMs") or 0))
    return messages[-limit_value:]


def _live_agent_session_messages(agent_ref, limit=80):
    agent_id = agent_ref["agentId"]
    session_meta = _live_agent_session_meta(agent_id)
    limit_value = _normalize_int(limit, 80, minimum=1, maximum=200)
    transcript_messages = _live_agent_planner_transcript_messages(agent_id, session_meta, limit=limit_value)
    if transcript_messages:
        return transcript_messages

    messages = []
    ok, payload, _status = get_live_agent_loop_operator_timeline(agent_id=agent_id, limit=limit_value, include_resolved=True)
    entries = payload.get("entries") if ok and isinstance(payload, dict) and isinstance(payload.get("entries"), list) else []
    for entry in reversed(entries):
        text = _live_agent_session_entry_text(entry)
        if not text:
            continue
        at = entry.get("at")
        epoch = _parse_isoish_epoch(at)
        messages.append({
            "role": "assistant",
            "text": text,
            "ts": at,
            "epochMs": int(epoch * 1000) if epoch else 0,
            "from": "Live Agent Mode",
            "fromType": "agent",
            "source": "live-agent-mode-session",
            "eventType": entry.get("type"),
            **session_meta,
        })

    if messages:
        return messages[-limit_value:]

    loop_state = get_live_agent_loop_state(persist_migration=False)
    loop_agents = loop_state.get("agents") if isinstance(loop_state.get("agents"), dict) else {}
    loop_agent = loop_agents.get(agent_id) if isinstance(loop_agents.get(agent_id), dict) else {}
    status = load_agent_status()
    snapshot = status.get(agent_id, {}) if isinstance(status.get(agent_id), dict) else {}
    task = _live_agent_loop_clean_plan_text(snapshot.get("task"), limit=300)
    enabled = bool(loop_agent.get("enabled"))
    text = task or ("Live Agent Mode is active. No visible timeline events have been recorded yet." if enabled else "Live Agent Mode has no visible timeline events yet.")
    now_iso = _utc_now_iso()
    return [{
        "role": "assistant",
        "text": text,
        "ts": now_iso,
        "epochMs": int(time.time() * 1000),
        "from": "Live Agent Mode",
        "fromType": "agent",
        "source": "live-agent-mode-session",
        "eventType": "status",
        **session_meta,
    }]


def handle_chat_session_switch(agent_id, session_id, body=None):
    """Make a stored session the agent's active chat session and return its
    history so the chat window can render it immediately."""
    agent_ref = _chat_sessions_agent(agent_id)
    if not agent_ref:
        return {"ok": False, "error": f"Unknown agent: {agent_id}"}, 404
    if not session_id:
        return {"ok": False, "error": "sessionId is required"}, 400
    kind = agent_ref["providerKind"]
    profile = agent_ref["profile"]
    if kind == "hermes":
        provider = _hermes_provider()
        if not provider:
            return {"ok": False, "error": "Hermes provider unavailable"}, 502
        exported = provider.export_session(profile, session_id)
        if not exported.get("ok"):
            return {"ok": False, "error": exported.get("error") or "Hermes session export failed"}, 502
        session = exported.get("session") or {}
        messages = _hermes_session_to_chat_messages(session, agent_ref)
        _save_hermes_state(profile, {"messages": messages, "sessionId": session_id})
        return {"ok": True, "providerKind": kind, "sessionId": session_id, "messages": messages}, 200
    if kind == "codex":
        provider = _codex_provider()
        if not provider:
            return {"ok": False, "error": "Codex provider unavailable"}, 502
        outcome = provider.read_thread(profile, session_id)
        if not outcome.get("ok"):
            return {"ok": False, "error": outcome.get("error") or "Codex thread read failed"}, 502
        messages = _codex_thread_to_chat_messages(outcome.get("thread") or {}, agent_ref)
        state = _load_codex_state(profile)
        state["messages"] = messages[-500:]
        state["sessionId"] = session_id
        _save_codex_state(profile, state)
        return {"ok": True, "providerKind": kind, "sessionId": session_id, "messages": messages}, 200
    if kind in ("claude-code", "claudecode", "claude"):
        path = _claude_code_find_session_file(session_id)
        if not path:
            return {"ok": False, "error": "Claude Code session not found"}, 404
        messages = _claude_code_jsonl_to_chat_messages(path, agent_ref)
        _save_claude_code_state(profile, {"messages": messages[-500:], "sessionId": session_id})
        return {"ok": True, "providerKind": kind, "sessionId": session_id, "messages": messages, "resumeCommand": f"claude --resume {session_id}"}, 200
    if kind == "openclaw":
        session_key = str(session_id)
        if _is_openclaw_live_mode_session_key(agent_ref["agentId"], session_key):
            messages = _live_agent_session_messages(agent_ref, limit=(body or {}).get("limit") or 80)
            session_key = _openclaw_live_mode_session_key(agent_ref["agentId"])
            return {
                "ok": True,
                "providerKind": kind,
                "sessionKey": session_key,
                "sessionId": session_key,
                "messages": messages,
                "liveMode": True,
                "virtual": True,
            }, 200
        # OpenClaw sessions are addressed directly by key; the client simply
        # switches its sessionKey and reloads history over the gateway.
        return {"ok": True, "providerKind": kind, "sessionKey": session_key}, 200
    return {"ok": False, "error": f"{kind} session management is not supported yet"}, 400


def _hermes_session_to_chat_messages(session, agent_ref):
    """Convert a `hermes sessions export` record into VW chat-history messages."""
    messages = []
    for msg in session.get("messages") or []:
        if not isinstance(msg, dict):
            continue
        role = str(msg.get("role") or "")
        content = msg.get("content")
        text = content if isinstance(content, str) else json.dumps(content)[:2000] if content else ""
        if role == "tool":
            continue
        tools = []
        for call in msg.get("tool_calls") or []:
            if isinstance(call, dict):
                fn = call.get("function") if isinstance(call.get("function"), dict) else {}
                tools.append({"name": str(fn.get("name") or call.get("name") or "tool"), "status": "completed", "args": str(fn.get("arguments") or "")[:400]})
        if role not in ("user", "assistant"):
            continue
        if not text and not tools:
            continue
        entry = {"role": role, "text": text or "", "ts": None, "from": agent_ref["name"] if role == "assistant" else "You", "fromType": "agent" if role == "assistant" else "human"}
        if tools:
            entry["tools"] = tools
        messages.append(entry)
    return messages[-500:]


def _codex_thread_to_chat_messages(thread, agent_ref):
    """Convert a `thread/read` result into VW chat-history messages."""
    messages = []
    for turn in thread.get("turns") or []:
        if not isinstance(turn, dict):
            continue
        for item in turn.get("items") or []:
            if not isinstance(item, dict):
                continue
            item_type = str(item.get("type") or "")
            if item_type in ("userMessage", "user_message"):
                content = item.get("content")
                if isinstance(content, list):
                    text = " ".join(str(part.get("text") or "") for part in content if isinstance(part, dict))
                else:
                    text = str(item.get("text") or content or "")
                if text.strip():
                    messages.append({"role": "user", "text": text.strip()[:4000], "ts": None, "from": "You", "fromType": "human"})
            elif item_type in ("agentMessage", "agent_message", "assistantMessage"):
                text = str(item.get("text") or "")
                if text.strip():
                    messages.append({"role": "assistant", "text": text.strip()[:8000], "ts": None, "from": agent_ref["name"], "fromType": "agent"})
    return messages[-500:]


def _claude_code_jsonl_to_chat_messages(path, agent_ref):
    """Convert a Claude Code native JSONL session into VW chat-history messages."""
    messages = []
    try:
        with open(path, "r", encoding="utf-8", errors="replace") as f:
            for line in f:
                try:
                    row = json.loads(line)
                except json.JSONDecodeError:
                    continue
                if not isinstance(row, dict):
                    continue
                msg = row.get("message") if isinstance(row.get("message"), dict) else {}
                role = str(msg.get("role") or row.get("type") or "")
                if role not in ("user", "assistant"):
                    continue
                text = _claude_code_text_from_content(msg.get("content")).strip()
                if not text:
                    continue
                ts = row.get("timestamp")
                messages.append({
                    "role": role,
                    "text": text[:8000 if role == "assistant" else 4000],
                    "ts": ts,
                    "from": agent_ref["name"] if role == "assistant" else "You",
                    "fromType": "agent" if role == "assistant" else "human",
                    "sessionId": row.get("sessionId") or os.path.splitext(os.path.basename(path))[0],
                    "source": "claude-code",
                })
    except OSError:
        pass
    return messages[-500:]


def get_native_model_state(openclaw_agent_id=None):
    return {
        "openclaw": _get_openclaw_native_models(openclaw_agent_id),
        "hermes": _get_hermes_native_models(),
        "codex": _get_codex_native_setup_state(),
        "claudeCode": _get_claude_code_native_setup_state(),
    }


def get_agent_model_settings(agent_id):
    agent = _agent_record_for(agent_id)
    resolved_agent_id = (agent or {}).get("statusKey") or (agent or {}).get("id") or _resolve_agent_id(agent_id)
    if not resolved_agent_id:
        return False, _api_error("agent_not_found", "Unknown agent id for model settings.", details={"agentId": agent_id}), 404
    provider_kind = str((agent or {}).get("providerKind") or "openclaw").lower()
    cfg = _load_openclaw_model_config()
    default_model = _default_openclaw_model(cfg)
    agent_model = str((agent or {}).get("model") or "")
    if provider_kind == "openclaw":
        cfg_agent = _openclaw_config_agent_for(resolved_agent_id, agent, cfg)
        if isinstance(cfg_agent, dict):
            agent_model = str(cfg_agent.get("model") or agent_model or "")
    return True, {
        "ok": True,
        "schemaVersion": "agent-model-settings/v1",
        "agentId": resolved_agent_id,
        "providerKind": provider_kind,
        "providerAgentId": (agent or {}).get("providerAgentId") or resolved_agent_id,
        "editable": provider_kind == "openclaw",
        "unsupportedReason": "" if provider_kind == "openclaw" else f"{provider_kind} model switching is read-only in this first Virtual World pass.",
        "agentModel": agent_model,
        "defaultModel": default_model,
        "primaryDefaultModel": _primary_openclaw_model(cfg),
        "models": _openclaw_model_entries(cfg),
    }, 200


def save_agent_model_settings(agent_id, payload):
    if not isinstance(payload, dict):
        return False, _api_error("invalid_payload", "model settings payload must be an object."), 400
    agent = _agent_record_for(agent_id)
    resolved_agent_id = (agent or {}).get("statusKey") or (agent or {}).get("id") or _resolve_agent_id(agent_id)
    if not resolved_agent_id:
        return False, _api_error("agent_not_found", "Unknown agent id for model settings.", details={"agentId": agent_id}), 404
    provider_kind = str((agent or {}).get("providerKind") or "openclaw").lower()
    if provider_kind != "openclaw":
        return False, _api_error("unsupported_provider", f"{provider_kind} model switching is not implemented yet.", details={"providerKind": provider_kind}), 400
    model = str(payload.get("model") or "").strip()
    if model and "/" not in model:
        return False, _api_error("invalid_model", f"Invalid model format: {model}. Expected provider/model.", details={"model": model}), 400
    cfg_path = os.path.join(WORKSPACE_BASE, "openclaw.json")
    cfg = _load_openclaw_model_config()
    agents_cfg = cfg.setdefault("agents", {}).setdefault("list", [])
    if not isinstance(agents_cfg, list):
        agents_cfg = []
        cfg["agents"]["list"] = agents_cfg
    matched = _openclaw_config_agent_for(resolved_agent_id, agent, cfg)
    if matched is None:
        matched = {"id": resolved_agent_id}
        agents_cfg.append(matched)
    if model:
        matched["model"] = model
    else:
        matched.pop("model", None)
    try:
        _atomic_write_text(cfg_path, json.dumps(cfg, indent=2) + "\n")
    except OSError as exc:
        return False, _api_error("write_failed", "Could not save OpenClaw model setting.", details={"error": str(exc), "path": cfg_path}), 500
    gateway_signal = _signal_openclaw_gateway(restart=False)
    global _agent_roster, _roster_time
    _agent_roster = discover_agents()
    _roster_time = time.time()
    return True, {
        "ok": True,
        "agentId": resolved_agent_id,
        "providerKind": provider_kind,
        "model": model,
        "defaulted": not bool(model),
        "configPath": cfg_path,
        "gatewaySignal": gateway_signal,
    }, 200


def _parse_skill_frontmatter(content):
    name = ""
    description = ""
    text = str(content or "")
    if text.startswith("---"):
        parts = text.split("---", 2)
        if len(parts) >= 3:
            for line in parts[1].strip().splitlines():
                key, sep, value = line.partition(":")
                if not sep:
                    continue
                key = key.strip().lower()
                value = value.strip().strip("'\"")
                if key == "name":
                    name = value
                elif key == "description":
                    description = value
    if not description:
        for line in text.splitlines():
            clean = line.strip().lstrip("#").strip()
            if clean and not clean.startswith("---") and not clean.startswith("name:"):
                description = clean[:180]
                break
    return name, description


def _skill_slug(name):
    return re.sub(r"[^A-Za-z0-9_-]+", "-", str(name or "").strip()).strip("-").lower()


def _skills_library_dir():
    root = os.path.join(WORKSPACE_BASE, "skills-library")
    os.makedirs(root, exist_ok=True)
    return root


def _agent_skills_root_for_agent(agent_id):
    agent = _agent_record_for(agent_id)
    resolved_agent_id = (agent or {}).get("statusKey") or (agent or {}).get("id") or _resolve_agent_id(agent_id)
    if not resolved_agent_id:
        return None, "", _api_error("agent_not_found", "Unknown agent id for skills.", details={"agentId": agent_id}), 404
    provider_kind = str((agent or {}).get("providerKind") or "openclaw").lower()
    if provider_kind != "openclaw":
        return None, resolved_agent_id, {
            "ok": True,
            "schemaVersion": AGENT_SKILL_SCHEMA_VERSION,
            "agentId": resolved_agent_id,
            "providerKind": provider_kind,
            "skillsAvailable": False,
            "editable": False,
            "skills": [],
            "unsupportedReason": f"{provider_kind} skills are not implemented in My Virtual World yet.",
        }, 200
    workspace_root = _openclaw_workspace_root_for_agent(resolved_agent_id, agent)
    if not workspace_root:
        return None, resolved_agent_id, _api_error("workspace_not_found", "OpenClaw workspace root was not found for this agent.", details={"agentId": resolved_agent_id}), 404
    return os.path.join(workspace_root, "skills"), resolved_agent_id, None, 200


def _skill_file_for(root, skill_name):
    raw_name = str(skill_name or "").strip().strip("/\\")
    slug = _skill_slug(skill_name)
    if not root or not slug:
        return None, ""
    root_real = os.path.realpath(root)
    dirname = slug
    if os.path.isdir(root_real):
        try:
            for entry in os.listdir(root_real):
                skill_file = os.path.join(root_real, entry, "SKILL.md")
                if os.path.isfile(skill_file) and (entry == raw_name or _skill_slug(entry) == slug):
                    dirname = entry
                    break
        except OSError:
            pass
    skill_dir = os.path.realpath(os.path.join(root_real, dirname))
    try:
        if os.path.commonpath([root_real, skill_dir]) != root_real:
            return None, ""
    except ValueError:
        return None, ""
    return os.path.join(skill_dir, "SKILL.md"), dirname


def _read_skill_file(skill_file, fallback_name):
    try:
        size = os.path.getsize(skill_file)
        if size > AGENT_SKILL_FILE_MAX_BYTES:
            return {"name": fallback_name, "description": "Skill file is too large to preview.", "content": "", "path": skill_file, "editable": False, "size": size}
        with open(skill_file, "r", encoding="utf-8") as f:
            content = f.read()
    except (OSError, UnicodeDecodeError):
        content = ""
        size = 0
    parsed_name, description = _parse_skill_frontmatter(content)
    return {"name": fallback_name, "title": parsed_name or fallback_name, "description": description, "content": content, "path": skill_file, "editable": True, "size": size}


def handle_agent_skills_list(agent_id):
    root, resolved_agent_id, error, status = _agent_skills_root_for_agent(agent_id)
    if error:
        return True, error, status
    skills = []
    if os.path.isdir(root):
        for entry in sorted(os.listdir(root)):
            skill_file = os.path.join(root, entry, "SKILL.md")
            if os.path.isfile(skill_file):
                skills.append(_read_skill_file(skill_file, entry))
    return True, {
        "ok": True,
        "schemaVersion": AGENT_SKILL_SCHEMA_VERSION,
        "agentId": resolved_agent_id,
        "providerKind": "openclaw",
        "skillsAvailable": True,
        "editable": True,
        "skillsRoot": root,
        "skills": skills,
    }, 200


def handle_agent_skill_save(agent_id, payload):
    if not isinstance(payload, dict):
        return False, _api_error("invalid_payload", "skill payload must be an object."), 400
    root, resolved_agent_id, error, status = _agent_skills_root_for_agent(agent_id)
    if error and not error.get("ok"):
        return False, error, status
    if error:
        return False, _api_error("unsupported_provider", error.get("unsupportedReason") or "Skills are unavailable for this provider."), 400
    skill_file, slug = _skill_file_for(root, payload.get("name") or payload.get("skill"))
    if not skill_file or not slug:
        return False, _api_error("invalid_skill", "Skill name is required and may only contain letters, numbers, dashes, and underscores."), 400
    content = str(payload.get("content") or "")
    if not content.strip():
        content = f"---\nname: {slug}\ndescription: \n---\n\n# {slug}\n\nInstructions here.\n"
    if len(content.encode("utf-8")) > AGENT_SKILL_FILE_MAX_BYTES:
        return False, _api_error("file_too_large", "Skill file is larger than the editor limit.", details={"maxBytes": AGENT_SKILL_FILE_MAX_BYTES}), 413
    try:
        _atomic_write_text(skill_file, content)
    except OSError as exc:
        return False, _api_error("write_failed", "Could not save skill.", details={"error": str(exc)}), 500
    return True, {"ok": True, "agentId": resolved_agent_id, "skill": slug, "path": skill_file}, 200


def handle_agent_skill_delete(agent_id, skill_name):
    root, resolved_agent_id, error, status = _agent_skills_root_for_agent(agent_id)
    if error and not error.get("ok"):
        return False, error, status
    if error:
        return False, _api_error("unsupported_provider", error.get("unsupportedReason") or "Skills are unavailable for this provider."), 400
    skill_file, slug = _skill_file_for(root, skill_name)
    if not skill_file or not os.path.isfile(skill_file):
        return False, _api_error("not_found", "Skill not found.", details={"skill": skill_name}), 404
    try:
        shutil.rmtree(os.path.dirname(skill_file))
    except OSError as exc:
        return False, _api_error("delete_failed", "Could not delete skill.", details={"error": str(exc)}), 500
    return True, {"ok": True, "agentId": resolved_agent_id, "deleted": slug}, 200


def handle_skills_library_list():
    skills = []
    root = _skills_library_dir()
    for entry in sorted(os.listdir(root)):
        skill_file = os.path.join(root, entry, "SKILL.md")
        if os.path.isfile(skill_file):
            item = _read_skill_file(skill_file, entry)
            item.pop("content", None)
            skills.append(item)
    return True, {"ok": True, "schemaVersion": SKILLS_LIBRARY_SCHEMA_VERSION, "skillsRoot": root, "skills": skills}, 200


def handle_skills_library_get(skill_name):
    skill_file, slug = _skill_file_for(_skills_library_dir(), skill_name)
    if not skill_file or not os.path.isfile(skill_file):
        return False, _api_error("not_found", "Skill not found in library.", details={"skill": skill_name}), 404
    return True, {"ok": True, **_read_skill_file(skill_file, slug)}, 200


def handle_skills_library_save(payload):
    if not isinstance(payload, dict):
        return False, _api_error("invalid_payload", "skill payload must be an object."), 400
    skill_file, slug = _skill_file_for(_skills_library_dir(), payload.get("name") or payload.get("skill"))
    if not skill_file or not slug:
        return False, _api_error("invalid_skill", "Skill name is required."), 400
    content = str(payload.get("content") or "")
    if not content.strip():
        content = f"---\nname: {slug}\ndescription: \n---\n\n# {slug}\n\nInstructions here.\n"
    if len(content.encode("utf-8")) > AGENT_SKILL_FILE_MAX_BYTES:
        return False, _api_error("file_too_large", "Skill file is larger than the editor limit.", details={"maxBytes": AGENT_SKILL_FILE_MAX_BYTES}), 413
    try:
        _atomic_write_text(skill_file, content)
    except OSError as exc:
        return False, _api_error("write_failed", "Could not save library skill.", details={"error": str(exc)}), 500
    parsed_name, description = _parse_skill_frontmatter(content)
    return True, {"ok": True, "skill": slug, "name": parsed_name or slug, "description": description, "path": skill_file}, 200


def handle_skills_library_delete(skill_name):
    skill_file, slug = _skill_file_for(_skills_library_dir(), skill_name)
    if not skill_file or not os.path.isdir(os.path.dirname(skill_file)):
        return False, _api_error("not_found", "Skill not found in library.", details={"skill": skill_name}), 404
    try:
        shutil.rmtree(os.path.dirname(skill_file))
    except OSError as exc:
        return False, _api_error("delete_failed", "Could not delete library skill.", details={"error": str(exc)}), 500
    return True, {"ok": True, "deleted": slug}, 200


def handle_skills_library_apply(payload):
    if not isinstance(payload, dict):
        return False, _api_error("invalid_payload", "apply payload must be an object."), 400
    skill_name = str(payload.get("skill") or "").strip()
    agent_id = str(payload.get("agentId") or "").strip()
    overwrite = bool(payload.get("overwrite"))
    lib_file, slug = _skill_file_for(_skills_library_dir(), skill_name)
    if not lib_file or not os.path.isfile(lib_file):
        return False, _api_error("not_found", "Skill not found in library.", details={"skill": skill_name}), 404
    root, resolved_agent_id, error, status = _agent_skills_root_for_agent(agent_id)
    if error and not error.get("ok"):
        return False, error, status
    if error:
        return False, _api_error("unsupported_provider", error.get("unsupportedReason") or "Skills are unavailable for this provider."), 400
    dest_file, _ = _skill_file_for(root, slug)
    if os.path.isfile(dest_file) and not overwrite:
        return True, {"ok": False, "exists": True, "warning": f"Agent already has skill '{slug}'.", "skill": slug, "agentId": resolved_agent_id}, 200
    try:
        os.makedirs(os.path.dirname(dest_file), exist_ok=True)
        shutil.copy2(lib_file, dest_file)
    except OSError as exc:
        return False, _api_error("write_failed", "Could not apply skill.", details={"error": str(exc)}), 500
    return True, {"ok": True, "skill": slug, "agentId": resolved_agent_id, "path": dest_file, "overwritten": overwrite}, 200


def handle_skills_library_save_from_agent(payload):
    if not isinstance(payload, dict):
        return False, _api_error("invalid_payload", "save-from-agent payload must be an object."), 400
    agent_id = str(payload.get("agentId") or "").strip()
    skill_name = str(payload.get("skill") or payload.get("name") or "").strip()
    overwrite = bool(payload.get("overwrite"))
    ok, data, status = handle_agent_skills_list(agent_id)
    if not ok or status >= 400:
        return ok, data, status
    source = None
    for skill in data.get("skills", []):
        if skill.get("name") == skill_name:
            source = skill
            break
    if not source:
        return False, _api_error("not_found", "Skill not found on agent.", details={"skill": skill_name, "agentId": agent_id}), 404
    skill_file, slug = _skill_file_for(_skills_library_dir(), skill_name)
    content = source.get("content") or ""
    if os.path.isfile(skill_file):
        try:
            with open(skill_file, "r", encoding="utf-8") as f:
                existing = f.read()
        except OSError:
            existing = ""
        if existing == content:
            return True, {"ok": True, "status": "identical", "exists": True, "different": False, "skill": slug}, 200
        if not overwrite:
            return True, {"ok": False, "status": "exists_different", "exists": True, "different": True, "skill": slug}, 200
    try:
        _atomic_write_text(skill_file, content)
    except OSError as exc:
        return False, _api_error("write_failed", "Could not save skill to library.", details={"error": str(exc)}), 500
    return True, {"ok": True, "status": "updated" if overwrite else "created", "skill": slug, "path": skill_file}, 200


def _agent_profile_for(meta, agent_id):
    profiles = meta.get("agentProfiles", {}) if isinstance(meta.get("agentProfiles"), dict) else {}
    resolved_id = _resolve_agent_id(agent_id)
    if not resolved_id:
        return None, None, None
    profile = profiles.get(resolved_id, {}) if isinstance(profiles.get(resolved_id), dict) else {}
    return profiles, resolved_id, profile


def _limit_profile_text(value, limit=RESIDENT_PROFILE_TEXT_LIMIT):
    return str(value or "").strip()[:limit]


def _limit_profile_list(values, *, limit=RESIDENT_PROFILE_LIST_LIMIT, item_limit=1200):
    if not isinstance(values, list):
        return []
    items = []
    for item in values:
        if isinstance(item, dict):
            clean = {}
            for key, value in list(item.items())[:12]:
                if isinstance(value, (str, int, float, bool)) or value is None:
                    clean[str(key)[:60]] = _limit_profile_text(value, item_limit) if isinstance(value, str) else value
            if clean:
                items.append(clean)
        else:
            text = _limit_profile_text(item, item_limit)
            if text:
                items.append(text)
        if len(items) >= limit:
            break
    return items


def _clamp_float(value, fallback, minimum=0.0, maximum=1.0):
    try:
        number = float(value)
    except (TypeError, ValueError):
        number = fallback
    return round(min(maximum, max(minimum, number)), 3)


def _assignment_for_agent(meta, agent):
    assignments = meta.get("agentAssignments", {}) if isinstance(meta.get("agentAssignments"), dict) else {}
    for key in (agent.get("statusKey"), agent.get("id"), agent.get("providerAgentId")):
        if key and isinstance(assignments.get(key), dict):
            return dict(assignments.get(key))
    return {}


def _desk_assignment_for_agent(agent):
    aliases = {
        str(agent.get("id") or ""),
        str(agent.get("statusKey") or ""),
        str(agent.get("providerAgentId") or ""),
        str(agent.get("name") or ""),
    }
    aliases.discard("")
    try:
        buildings = list_buildings()
    except Exception:
        buildings = []
    for building in buildings:
        furniture = ((building.get("interior") or {}).get("furniture") or []) if isinstance(building, dict) else []
        for index, item in enumerate(furniture):
            if not isinstance(item, dict):
                continue
            assigned_to = str(item.get("assignedTo") or item.get("assignedAgentId") or "").strip()
            if assigned_to and assigned_to in aliases:
                return {
                    "buildingId": building.get("id") or "",
                    "buildingName": building.get("name") or "",
                    "furnitureIndex": index,
                    "objectInstanceId": item.get("id") or item.get("objectInstanceId") or "",
                    "label": item.get("name") or item.get("label") or item.get("type") or "desk",
                }
    return None


def _default_resident_profile(agent_id, meta, profile=None):
    agent = _agent_record_for(agent_id) or {"id": agent_id, "statusKey": agent_id, "providerKind": "openclaw", "providerAgentId": agent_id}
    assignment = _assignment_for_agent(meta, agent)
    desk = _desk_assignment_for_agent(agent)
    now = _utc_now_iso()
    display_name = (profile or {}).get("name") or agent.get("name") or agent.get("id") or agent_id
    role = agent.get("role") or agent.get("providerKind") or "resident"
    personality = (profile or {}).get("personality") if isinstance((profile or {}).get("personality"), dict) else {}
    return {
        "schemaVersion": RESIDENT_PROFILE_SCHEMA_VERSION,
        "templateId": "resident-default/v1",
        "agentId": str(agent.get("statusKey") or agent.get("id") or agent_id),
        "providerKind": str(agent.get("providerKind") or "openclaw"),
        "providerAgentId": str(agent.get("providerAgentId") or agent.get("id") or agent_id),
        "createdAt": now,
        "updatedAt": now,
        "identity": {
            "displayName": str(display_name),
            "role": str(role),
            "archetype": "Virtual World resident",
            "lifePurpose": "Live as a believable autonomous resident, help when directly addressed, and keep world actions aligned with the agent's framework instructions.",
            "backstory": "",
        },
        "world": {
            "homeBuildingId": assignment.get("home") or "",
            "workBuildingId": assignment.get("work") or "",
            "desk": desk,
        },
        "goals": {
            "current": [],
            "daily": [],
            "longTerm": [],
        },
        "needs": dict(LIVE_AGENT_LOOP_NEED_DEFAULTS),
        "personality": {
            "outgoing": _clamp_float(personality.get("outgoing"), 1.0, 0.5, 2.0),
            "curious": _clamp_float(personality.get("curious"), 1.0, 0.5, 2.0),
            "easygoing": _clamp_float(personality.get("easygoing"), 1.0, 0.5, 2.0),
        },
        "memory": {
            "summary": "",
            "shortTerm": [],
            "longTerm": [],
            "relationships": {},
            "reflections": [],
            "compaction": {
                "shortTermLimit": RESIDENT_PROFILE_LIST_LIMIT,
                "longTermLimit": RESIDENT_PROFILE_MEMORY_LIMIT,
                "strategy": "summarize older short-term entries into memory.summary before promoting durable facts to longTerm",
            },
        },
        "liveMode": {
            "autonomyWhenIdle": True,
            "pauseForDirectChat": True,
            "fallbackBehavior": "scripted-idle",
        },
    }


def _sanitize_resident_profile(raw, template, *, touch=False):
    data = raw if isinstance(raw, dict) else {}
    base = template if isinstance(template, dict) else {}
    now = _utc_now_iso()
    out = {
        "schemaVersion": RESIDENT_PROFILE_SCHEMA_VERSION,
        "templateId": _limit_profile_text(data.get("templateId") or base.get("templateId") or "resident-default/v1", 80),
        "agentId": str(base.get("agentId") or data.get("agentId") or ""),
        "providerKind": str(base.get("providerKind") or data.get("providerKind") or "openclaw"),
        "providerAgentId": str(base.get("providerAgentId") or data.get("providerAgentId") or ""),
        "createdAt": _limit_profile_text(data.get("createdAt") or base.get("createdAt") or now, 80),
        "updatedAt": now if touch else _limit_profile_text(data.get("updatedAt") or base.get("updatedAt") or now, 80),
    }

    data_identity = data.get("identity") if isinstance(data.get("identity"), dict) else {}
    base_identity = base.get("identity") if isinstance(base.get("identity"), dict) else {}
    out["identity"] = {
        "displayName": _limit_profile_text(data_identity.get("displayName") or base_identity.get("displayName"), 120),
        "role": _limit_profile_text(data_identity.get("role") or base_identity.get("role"), 160),
        "archetype": _limit_profile_text(data_identity.get("archetype") or base_identity.get("archetype") or "Virtual World resident", 160),
        "lifePurpose": _limit_profile_text(data_identity.get("lifePurpose") or base_identity.get("lifePurpose"), RESIDENT_PROFILE_TEXT_LIMIT),
        "backstory": _limit_profile_text(data_identity.get("backstory") or base_identity.get("backstory"), RESIDENT_PROFILE_TEXT_LIMIT),
    }

    data_world = data.get("world") if isinstance(data.get("world"), dict) else {}
    base_world = base.get("world") if isinstance(base.get("world"), dict) else {}
    out["world"] = {
        "homeBuildingId": _limit_profile_text(data_world.get("homeBuildingId") or base_world.get("homeBuildingId"), 120),
        "workBuildingId": _limit_profile_text(data_world.get("workBuildingId") or base_world.get("workBuildingId"), 120),
        "desk": data_world.get("desk") if isinstance(data_world.get("desk"), dict) else base_world.get("desk"),
    }

    data_goals = data.get("goals") if isinstance(data.get("goals"), dict) else {}
    base_goals = base.get("goals") if isinstance(base.get("goals"), dict) else {}
    out["goals"] = {
        "current": _limit_profile_list(data_goals.get("current", base_goals.get("current", [])), limit=20, item_limit=800),
        "daily": _limit_profile_list(data_goals.get("daily", base_goals.get("daily", [])), limit=20, item_limit=800),
        "longTerm": _limit_profile_list(data_goals.get("longTerm", base_goals.get("longTerm", [])), limit=20, item_limit=800),
    }

    data_needs = data.get("needs") if isinstance(data.get("needs"), dict) else {}
    base_needs = base.get("needs") if isinstance(base.get("needs"), dict) else LIVE_AGENT_LOOP_NEED_DEFAULTS
    out["needs"] = {
        key: _clamp_float(data_needs.get(key, base_needs.get(key, default)), default, 0.0, 1.0)
        for key, default in LIVE_AGENT_LOOP_NEED_DEFAULTS.items()
    }

    data_personality = data.get("personality") if isinstance(data.get("personality"), dict) else {}
    base_personality = base.get("personality") if isinstance(base.get("personality"), dict) else {}
    out["personality"] = {
        trait: _clamp_float(data_personality.get(trait, base_personality.get(trait, 1.0)), 1.0, 0.5, 2.0)
        for trait in LIVE_AGENT_LOOP_PERSONALITY_TRAITS
    }

    data_memory = data.get("memory") if isinstance(data.get("memory"), dict) else {}
    base_memory = base.get("memory") if isinstance(base.get("memory"), dict) else {}
    relationships = data_memory.get("relationships", base_memory.get("relationships", {}))
    clean_relationships = {}
    if isinstance(relationships, dict):
        for key, value in list(relationships.items())[:RESIDENT_PROFILE_MEMORY_LIMIT]:
            clean_relationships[_limit_profile_text(key, 120)] = _limit_profile_text(value, 1200) if not isinstance(value, dict) else {
                _limit_profile_text(k, 60): _limit_profile_text(v, 800) for k, v in list(value.items())[:8]
            }
    out["memory"] = {
        "summary": _limit_profile_text(data_memory.get("summary", base_memory.get("summary", "")), RESIDENT_PROFILE_TEXT_LIMIT),
        "shortTerm": _limit_profile_list(data_memory.get("shortTerm", base_memory.get("shortTerm", [])), limit=RESIDENT_PROFILE_LIST_LIMIT, item_limit=1200),
        "longTerm": _limit_profile_list(data_memory.get("longTerm", base_memory.get("longTerm", [])), limit=RESIDENT_PROFILE_MEMORY_LIMIT, item_limit=1400),
        "relationships": clean_relationships,
        "reflections": _limit_profile_list(data_memory.get("reflections", base_memory.get("reflections", [])), limit=RESIDENT_PROFILE_MEMORY_LIMIT, item_limit=1200),
        "compaction": {
            "shortTermLimit": RESIDENT_PROFILE_LIST_LIMIT,
            "longTermLimit": RESIDENT_PROFILE_MEMORY_LIMIT,
            "strategy": _limit_profile_text(((data_memory.get("compaction") if isinstance(data_memory.get("compaction"), dict) else {}) or {}).get("strategy") or ((base_memory.get("compaction") if isinstance(base_memory.get("compaction"), dict) else {}) or {}).get("strategy") or "summarize older short-term entries into memory.summary before promoting durable facts to longTerm", 300),
        },
    }

    data_live = data.get("liveMode") if isinstance(data.get("liveMode"), dict) else {}
    base_live = base.get("liveMode") if isinstance(base.get("liveMode"), dict) else {}
    out["liveMode"] = {
        "autonomyWhenIdle": bool(data_live.get("autonomyWhenIdle", base_live.get("autonomyWhenIdle", True))),
        "pauseForDirectChat": bool(data_live.get("pauseForDirectChat", base_live.get("pauseForDirectChat", True))),
        "fallbackBehavior": _limit_profile_text(data_live.get("fallbackBehavior") or base_live.get("fallbackBehavior") or "scripted-idle", 120),
    }
    if isinstance(data.get("custom"), dict):
        custom = {}
        for key, value in list(data["custom"].items())[:30]:
            clean_key = _limit_profile_text(key, 80)
            if isinstance(value, list):
                custom[clean_key] = _limit_profile_list(value, limit=20, item_limit=800)
            elif isinstance(value, dict):
                custom[clean_key] = {
                    _limit_profile_text(k, 60): _limit_profile_text(v, 800)
                    for k, v in list(value.items())[:20]
                }
            else:
                custom[clean_key] = _limit_profile_text(value, 1200)
        out["custom"] = custom
    elif isinstance(base.get("custom"), dict):
        out["custom"] = base["custom"]
    return out


def get_agent_resident_profile(agent_id, *, persist=True):
    meta = load_world_meta()
    profiles, resolved_agent_id, profile = _agent_profile_for(meta, agent_id)
    if not resolved_agent_id:
        return False, _api_error("agent_not_found", "Unknown agent id for resident profile.", details={"agentId": agent_id}), 404
    profile = dict(profile or {})
    template = _default_resident_profile(resolved_agent_id, meta, profile)
    current = profile.get("residentProfile") if isinstance(profile.get("residentProfile"), dict) else None
    resident_profile = _sanitize_resident_profile(current or template, template, touch=False)
    defaulted = current is None
    if persist and (defaulted or resident_profile != current):
        profile["residentProfile"] = resident_profile
        profiles[resolved_agent_id] = profile
        meta["agentProfiles"] = profiles
        save_world_meta(meta)
    return True, {
        "ok": True,
        "schemaVersion": RESIDENT_PROFILE_SCHEMA_VERSION,
        "agentId": resolved_agent_id,
        "defaulted": defaulted,
        "residentProfile": resident_profile,
        "storage": "world-meta.json agentProfiles[agentId].residentProfile",
    }, 200


def save_agent_resident_profile(agent_id, payload):
    if not isinstance(payload, dict):
        return False, _api_error("invalid_payload", "resident profile payload must be an object."), 400
    meta = load_world_meta()
    profiles, resolved_agent_id, profile = _agent_profile_for(meta, agent_id)
    if not resolved_agent_id:
        return False, _api_error("agent_not_found", "Unknown agent id for resident profile.", details={"agentId": agent_id}), 404
    profile = dict(profile or {})
    template = _default_resident_profile(resolved_agent_id, meta, profile)
    existing = profile.get("residentProfile") if isinstance(profile.get("residentProfile"), dict) else template
    raw_profile = payload.get("residentProfile") if isinstance(payload.get("residentProfile"), dict) else payload
    base = _sanitize_resident_profile(existing, template, touch=False)
    merged = dict(base)
    for key, value in raw_profile.items():
        if key in {"schemaVersion", "templateId", "agentId", "providerKind", "providerAgentId", "createdAt", "updatedAt"}:
            continue
        merged[key] = value
    resident_profile = _sanitize_resident_profile(merged, template, touch=True)
    profile["residentProfile"] = resident_profile
    profiles[resolved_agent_id] = profile
    meta["agentProfiles"] = profiles
    save_world_meta(meta)
    return True, {
        "ok": True,
        "schemaVersion": RESIDENT_PROFILE_SCHEMA_VERSION,
        "agentId": resolved_agent_id,
        "residentProfile": resident_profile,
        "storage": "world-meta.json agentProfiles[agentId].residentProfile",
    }, 200


def _ensure_resident_profile_for_agent(agent_id):
    try:
        get_agent_resident_profile(agent_id, persist=True)
    except Exception as exc:
        print(f"⚠️  Virtual World resident profile seed failed for {agent_id}: {exc}")


def _agent_live_mode_enabled_from_profile(profile):
    if isinstance(profile, dict) and isinstance(profile.get("agentLiveModeEnabled"), bool):
        return profile.get("agentLiveModeEnabled")
    return AGENT_LIVE_MODE_DEFAULT_ENABLED


LIVE_AGENT_WORLD_REGISTRY_SCHEMA_VERSION = "agent-live-world-registry/v1"
LIVE_AGENT_WORLD_REGISTRY_DEFAULT_TTL_SEC = 1800
_LIVE_AGENT_WORLD_REGISTRY_LOCK = threading.RLock()


def _live_agent_world_registry_ttl_sec():
    try:
        return max(60, min(86400, int(_env_or("VW_LIVE_AGENT_WORLD_REGISTRY_TTL_SEC", str(LIVE_AGENT_WORLD_REGISTRY_DEFAULT_TTL_SEC)))))
    except (TypeError, ValueError):
        return LIVE_AGENT_WORLD_REGISTRY_DEFAULT_TTL_SEC


def _live_agent_world_registry_path():
    override = os.environ.get("VW_LIVE_AGENT_WORLD_REGISTRY_FILE", "").strip()
    if override:
        return os.path.expanduser(override)
    # All packaged installs mount uploads read-write for agent/file exchange.
    # Some test/secondary worlds mount the wider OpenClaw tree read-only, so the
    # default registry must live under this shared writable mount.
    root = os.path.expanduser(UPLOADS_DIR or os.path.join(WORKSPACE_BASE or DATA_DIR, "workspace", "uploads"))
    return os.path.join(root, ".runtime", "live-agent-worlds.json")


def _live_agent_world_now_epoch():
    return time.time()


def _live_agent_world_iso(epoch=None):
    return time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime(float(epoch or _live_agent_world_now_epoch())))


def _live_agent_world_id():
    basis = f"{PUBLIC_ORIGIN}|{PUBLIC_HOST_PORT}|{DATA_DIR}"
    return "vw-" + hashlib.sha1(basis.encode("utf-8")).hexdigest()[:12]


def _live_agent_world_name(meta=None):
    if isinstance(meta, dict) and meta.get("name"):
        return str(meta.get("name"))[:120]
    world = VW_CONFIG.get("world") if isinstance(VW_CONFIG.get("world"), dict) else {}
    return str(world.get("name") or "My Virtual World")[:120]


def _current_live_agent_world(meta=None):
    return {
        "worldId": _live_agent_world_id(),
        "worldName": _live_agent_world_name(meta),
        "port": str(PUBLIC_HOST_PORT or PORT),
        "publicOrigin": PUBLIC_ORIGIN,
        "dataDir": DATA_DIR,
    }


def _read_live_agent_world_registry_unlocked(path):
    try:
        with open(path, "r") as f:
            doc = json.load(f)
    except (FileNotFoundError, json.JSONDecodeError, OSError):
        doc = {}
    if not isinstance(doc, dict):
        doc = {}
    agents = doc.get("agents") if isinstance(doc.get("agents"), dict) else {}
    worlds = doc.get("worlds") if isinstance(doc.get("worlds"), dict) else {}
    return {
        "schemaVersion": LIVE_AGENT_WORLD_REGISTRY_SCHEMA_VERSION,
        "updatedAt": doc.get("updatedAt") or _live_agent_world_iso(),
        "worlds": worlds,
        "agents": agents,
    }


def _write_live_agent_world_registry_unlocked(path, doc):
    os.makedirs(os.path.dirname(path), exist_ok=True)
    tmp_path = f"{path}.tmp-{os.getpid()}-{threading.get_ident()}"
    with open(tmp_path, "w") as f:
        json.dump(doc, f, indent=2, sort_keys=True)
        f.write("\n")
        f.flush()
        os.fsync(f.fileno())
    os.replace(tmp_path, path)


@contextlib.contextmanager
def _live_agent_world_registry_file_lock(path):
    lock_path = f"{path}.lock"
    os.makedirs(os.path.dirname(path), exist_ok=True)
    with open(lock_path, "a+") as lock_file:
        if fcntl:
            fcntl.flock(lock_file.fileno(), fcntl.LOCK_EX)
        try:
            yield
        finally:
            if fcntl:
                fcntl.flock(lock_file.fileno(), fcntl.LOCK_UN)


def _live_agent_world_claim_stale(claim, now_epoch=None):
    if not isinstance(claim, dict):
        return True
    now_epoch = float(now_epoch or _live_agent_world_now_epoch())
    last_seen = claim.get("lastSeenEpoch")
    try:
        last_seen = float(last_seen)
    except (TypeError, ValueError):
        return True
    return now_epoch - last_seen > _live_agent_world_registry_ttl_sec()


def _prune_live_agent_world_registry(doc, now_epoch=None):
    now_epoch = float(now_epoch or _live_agent_world_now_epoch())
    agents = doc.get("agents") if isinstance(doc.get("agents"), dict) else {}
    doc["agents"] = {
        str(agent_id): claim
        for agent_id, claim in agents.items()
        if isinstance(claim, dict) and not _live_agent_world_claim_stale(claim, now_epoch)
    }
    active_world_ids = {claim.get("worldId") for claim in doc["agents"].values() if isinstance(claim, dict)}
    worlds = doc.get("worlds") if isinstance(doc.get("worlds"), dict) else {}
    doc["worlds"] = {
        str(world_id): world
        for world_id, world in worlds.items()
        if world_id in active_world_ids or (isinstance(world, dict) and not _live_agent_world_claim_stale(world, now_epoch))
    }
    return doc


def _with_live_agent_world_registry(mutator, *, write=True):
    path = _live_agent_world_registry_path()
    with _LIVE_AGENT_WORLD_REGISTRY_LOCK:
        with _live_agent_world_registry_file_lock(path):
            doc = _read_live_agent_world_registry_unlocked(path)
            doc = _prune_live_agent_world_registry(doc)
            result = mutator(doc)
            doc["schemaVersion"] = LIVE_AGENT_WORLD_REGISTRY_SCHEMA_VERSION
            doc["updatedAt"] = _live_agent_world_iso()
            if write:
                _write_live_agent_world_registry_unlocked(path, doc)
            return result


def _read_live_agent_world_registry():
    return _with_live_agent_world_registry(lambda doc: copy.deepcopy(doc), write=False)


def _public_live_agent_world_claim(claim, current_world=None):
    if not isinstance(claim, dict):
        return None
    current_world = current_world or _current_live_agent_world()
    return {
        "agentId": claim.get("agentId"),
        "agentName": claim.get("agentName") or "",
        "worldId": claim.get("worldId"),
        "worldName": claim.get("worldName") or "My Virtual World",
        "port": str(claim.get("port") or ""),
        "publicOrigin": claim.get("publicOrigin") or "",
        "claimedAt": claim.get("claimedAt"),
        "lastSeenAt": claim.get("lastSeenAt"),
        "currentWorld": claim.get("worldId") == current_world.get("worldId"),
    }


def _live_agent_world_claim_message(claim):
    if not isinstance(claim, dict):
        return ""
    world_label = claim.get("worldName") or claim.get("publicOrigin") or "another Virtual World"
    port = str(claim.get("port") or "").strip()
    if port:
        return f"This agent is currently live in {world_label} on port {port}."
    return f"This agent is currently live in {world_label}."


def _agent_live_world_claim_payload(agent_id, *, meta=None, registry=None, refresh_current=True):
    resolved = _resolve_agent_id(agent_id) or str(agent_id or "")
    if refresh_current:
        _refresh_local_live_agent_world_claims(meta=meta)
    doc = registry if isinstance(registry, dict) else _read_live_agent_world_registry()
    current_world = _current_live_agent_world(meta)
    claim = (doc.get("agents") or {}).get(resolved)
    public_claim = _public_live_agent_world_claim(claim, current_world)
    conflict = bool(public_claim and not public_claim.get("currentWorld"))
    notice = _live_agent_world_claim_message(public_claim) if conflict else ""
    return {
        "schemaVersion": "agent-live-world-awareness/v1",
        "agentId": resolved,
        "currentWorld": current_world,
        "claim": public_claim,
        "conflict": conflict,
        "notice": notice,
        "registryPath": _live_agent_world_registry_path(),
        "ttlSec": _live_agent_world_registry_ttl_sec(),
    }


def _agent_live_world_claim(agent_id, agent_name="", *, meta=None):
    resolved = str(agent_id or "")
    if not resolved:
        return None
    now_epoch = _live_agent_world_now_epoch()
    now_iso = _live_agent_world_iso(now_epoch)
    world = _current_live_agent_world(meta)
    return {
        "agentId": resolved,
        "agentName": str(agent_name or resolved)[:120],
        **world,
        "claimedAt": now_iso,
        "lastSeenAt": now_iso,
        "lastSeenEpoch": round(now_epoch, 3),
        "status": "live",
    }


def _enabled_live_agent_rows(meta=None, roster=None):
    meta = meta if isinstance(meta, dict) else load_world_meta_fast()
    profiles = meta.get("agentProfiles", {}) if isinstance(meta.get("agentProfiles"), dict) else {}
    rows = []
    source_roster = roster if isinstance(roster, list) else get_roster(meta=meta)
    for agent in source_roster:
        if not isinstance(agent, dict):
            continue
        status_key = str(agent.get("statusKey") or agent.get("id") or "")
        if not status_key:
            continue
        profile = profiles.get(status_key) or profiles.get(str(agent.get("id") or "")) or {}
        if _agent_live_mode_enabled_from_profile(profile):
            rows.append({"agentId": status_key, "agentName": agent.get("name") or agent.get("id") or status_key})
    return rows


def _refresh_local_live_agent_world_claims(meta=None, roster=None):
    meta = meta if isinstance(meta, dict) else load_world_meta_fast()
    rows = _enabled_live_agent_rows(meta, roster=roster)
    current_world = _current_live_agent_world(meta)
    current_world_id = current_world.get("worldId")

    def mutate(doc):
        agents = doc.setdefault("agents", {})
        worlds = doc.setdefault("worlds", {})
        active_ids = {row["agentId"] for row in rows}
        for agent_id, claim in list(agents.items()):
            if isinstance(claim, dict) and claim.get("worldId") == current_world_id and agent_id not in active_ids:
                agents.pop(agent_id, None)
        for row in rows:
            existing = agents.get(row["agentId"])
            if isinstance(existing, dict) and existing.get("worldId") != current_world_id and not _live_agent_world_claim_stale(existing):
                continue
            agents[row["agentId"]] = _agent_live_world_claim(row["agentId"], row.get("agentName"), meta=meta)
        world_claim = dict(current_world)
        world_claim.update({
            "lastSeenAt": _live_agent_world_iso(),
            "lastSeenEpoch": round(_live_agent_world_now_epoch(), 3),
            "enabledAgentCount": len(rows),
        })
        worlds[current_world_id] = world_claim
        return True

    try:
        return _with_live_agent_world_registry(mutate, write=True)
    except Exception as exc:
        print(f"⚠️  Live Agent world registry refresh failed: {exc}")
        return False


def _claim_live_agent_world_or_conflict(agent_id, agent_name="", *, meta=None):
    resolved = str(agent_id or "")
    current_world = _current_live_agent_world(meta)
    current_world_id = current_world.get("worldId")

    def mutate(doc):
        agents = doc.setdefault("agents", {})
        worlds = doc.setdefault("worlds", {})
        existing = agents.get(resolved)
        if isinstance(existing, dict) and existing.get("worldId") != current_world_id and not _live_agent_world_claim_stale(existing):
            public_claim = _public_live_agent_world_claim(existing, current_world)
            return False, public_claim
        agents[resolved] = _agent_live_world_claim(resolved, agent_name, meta=meta)
        world_claim = dict(current_world)
        world_claim.update({
            "lastSeenAt": _live_agent_world_iso(),
            "lastSeenEpoch": round(_live_agent_world_now_epoch(), 3),
        })
        worlds[current_world_id] = world_claim
        return True, _public_live_agent_world_claim(agents[resolved], current_world)

    return _with_live_agent_world_registry(mutate, write=True)


def _release_live_agent_world_claim(agent_id, *, meta=None):
    resolved = str(agent_id or "")
    current_world_id = _current_live_agent_world(meta).get("worldId")

    def mutate(doc):
        agents = doc.setdefault("agents", {})
        existing = agents.get(resolved)
        if isinstance(existing, dict) and existing.get("worldId") == current_world_id:
            agents.pop(resolved, None)
            return True
        return False

    try:
        return _with_live_agent_world_registry(mutate, write=True)
    except Exception as exc:
        print(f"⚠️  Live Agent world registry release failed for {resolved}: {exc}")
        return False


def get_live_agent_world_status(agent_id=None):
    meta = load_world_meta()
    _refresh_local_live_agent_world_claims(meta=meta)
    registry = _read_live_agent_world_registry()
    current_world = _current_live_agent_world(meta)
    if agent_id:
        return _agent_live_world_claim_payload(agent_id, meta=meta, registry=registry, refresh_current=False)
    return {
        "schemaVersion": "agent-live-world-awareness/v1",
        "currentWorld": current_world,
        "claims": [_public_live_agent_world_claim(claim, current_world) for claim in (registry.get("agents") or {}).values() if isinstance(claim, dict)],
        "registryPath": _live_agent_world_registry_path(),
        "ttlSec": _live_agent_world_registry_ttl_sec(),
    }


def get_agent_live_mode_setting(agent_id):
    meta = load_world_meta()
    _, resolved_id, profile = _agent_profile_for(meta, agent_id)
    if not resolved_id:
        return None
    loop_state = get_live_agent_loop_state()
    loop_agent = loop_state.get("agents", {}).get(resolved_id)
    loop_enabled = True
    if isinstance(loop_agent, dict) and isinstance(loop_agent.get("enabled"), bool):
        loop_enabled = loop_agent.get("enabled")
    scripted_ambient_enabled = not (
        isinstance(profile, dict) and (
            profile.get("scriptedAmbientEnabled") is False or
            profile.get("ambientEnabled") is False
        )
    )
    enabled = _agent_live_mode_enabled_from_profile(profile)
    return {
        "agentId": resolved_id,
        "agentLiveModeEnabled": enabled,
        "agentLiveModeLoopEnabled": loop_enabled,
        "scriptedAmbientEnabled": scripted_ambient_enabled,
        "ambientEnabled": scripted_ambient_enabled,
        "loop": {
            "enabled": loop_enabled,
            "lastHeartbeatAt": loop_agent.get("lastHeartbeatAt") if isinstance(loop_agent, dict) else None,
            "lastOutcome": loop_agent.get("lastOutcome") if isinstance(loop_agent, dict) else None,
            "stats": loop_agent.get("stats", {}) if isinstance(loop_agent, dict) else {},
        },
        "storage": "world-meta.json agentProfiles[agentId].agentLiveModeEnabled",
        "defaulted": not (isinstance(profile, dict) and isinstance(profile.get("agentLiveModeEnabled"), bool)),
        "liveWorld": _agent_live_world_claim_payload(resolved_id, meta=meta),
    }


def set_agent_live_mode_setting(agent_id, enabled=None, *, agent_loop_enabled=None, scripted_ambient_enabled=None, ambient_enabled=None):
    if enabled is not None and not isinstance(enabled, bool):
        return False, _api_error("invalid_payload", "agentLiveModeEnabled must be a boolean"), 400
    if agent_loop_enabled is not None and not isinstance(agent_loop_enabled, bool):
        return False, _api_error("invalid_payload", "agentLoopEnabled must be a boolean"), 400
    if scripted_ambient_enabled is not None and not isinstance(scripted_ambient_enabled, bool):
        return False, _api_error("invalid_payload", "scriptedAmbientEnabled must be a boolean"), 400
    if ambient_enabled is not None and not isinstance(ambient_enabled, bool):
        return False, _api_error("invalid_payload", "ambientEnabled must be a boolean"), 400
    meta = load_world_meta()
    profiles, resolved_id, profile = _agent_profile_for(meta, agent_id)
    if not resolved_id:
        return False, _api_error("agent_not_found", "Unknown agent id for Agent Live Mode setting.", details={"agentId": agent_id}), 404
    enabled_provided = enabled is not None
    if enabled is None:
        enabled = _agent_live_mode_enabled_from_profile(profile)
    agent_name = resolved_id
    for agent in get_roster():
        if agent.get("statusKey") == resolved_id or agent.get("id") == resolved_id:
            agent_name = agent.get("name") or agent.get("id") or resolved_id
            break
    live_world_claim = None
    if enabled:
        try:
            claimed, live_world_claim = _claim_live_agent_world_or_conflict(resolved_id, agent_name, meta=meta)
        except Exception as exc:
            return False, _api_error(
                "agent_live_world_registry_unavailable",
                "Agent Live Mode could not verify the active world registry; activation was not changed.",
                details={"agentId": resolved_id, "error": str(exc)},
            ), 503
        if not claimed:
            message = _live_agent_world_claim_message(live_world_claim)
            return False, _api_error(
                "agent_live_mode_world_conflict",
                message,
                details={
                    "agentId": resolved_id,
                    "agentLiveModeEnabled": False,
                    "currentWorld": _current_live_agent_world(meta),
                    "activeWorld": live_world_claim,
                    "notice": message,
                },
            ), 409
    next_profile = dict(profile or {})
    next_profile["agentLiveModeEnabled"] = enabled
    if scripted_ambient_enabled is not None:
        next_profile["scriptedAmbientEnabled"] = scripted_ambient_enabled
        next_profile["ambientEnabled"] = scripted_ambient_enabled
    if ambient_enabled is not None:
        next_profile["ambientEnabled"] = ambient_enabled
        next_profile["scriptedAmbientEnabled"] = ambient_enabled
    profiles[resolved_id] = next_profile
    meta["agentProfiles"] = profiles
    save_world_meta(meta)
    if not enabled:
        _release_live_agent_world_claim(resolved_id, meta=meta)
    next_loop_enabled = agent_loop_enabled
    if next_loop_enabled is None and enabled_provided:
        next_loop_enabled = enabled
    if next_loop_enabled is not None:
        with _live_agent_loop_lock:
            loop_state = get_live_agent_loop_state(persist_migration=True)
            agent_state = _live_agent_loop_agent_state(loop_state, resolved_id)
            agent_state["enabled"] = bool(next_loop_enabled)
            _live_agent_loop_add_event(loop_state, "settings-updated", agent_id=resolved_id, details={"agentEnabled": {"agentId": resolved_id, "enabled": bool(next_loop_enabled), "source": "agent-live-mode-setting"}})
            save_live_agent_loop_state(loop_state)
    live_world = _agent_live_world_claim_payload(resolved_id, meta=meta)
    if live_world_claim and isinstance(live_world.get("claim"), dict):
        live_world["claim"] = live_world.get("claim") or live_world_claim
    scripted_ambient_public = not (
        next_profile.get("scriptedAmbientEnabled") is False or
        next_profile.get("ambientEnabled") is False
    )
    return True, {
        "ok": True,
        "agentId": resolved_id,
        "agentLiveModeEnabled": enabled,
        "agentLiveModeLoopEnabled": bool(next_loop_enabled) if next_loop_enabled is not None else get_agent_live_mode_setting(resolved_id).get("agentLiveModeLoopEnabled"),
        "scriptedAmbientEnabled": scripted_ambient_public,
        "ambientEnabled": scripted_ambient_public,
        "storage": "world-meta.json agentProfiles[agentId].agentLiveModeEnabled",
        "liveWorld": live_world,
    }, 200


def _agent_live_mode_disabled_error(agent_id):
    return _api_error(
        "agent_live_mode_disabled",
        "Agent Live Mode is disabled for this agent; agent-model action requests are rejected until agentLiveModeEnabled is true.",
        details={"agentId": agent_id, "agentLiveModeEnabled": False},
    )


def _merge_agent_profiles(roster, meta=None):
    meta = meta if isinstance(meta, dict) else load_world_meta_fast()
    profiles = meta.get("agentProfiles", {}) if isinstance(meta.get("agentProfiles"), dict) else {}
    loop_state = get_live_agent_loop_state(meta=meta)
    loop_agents = loop_state.get("agents", {}) if isinstance(loop_state.get("agents"), dict) else {}
    merged = []
    for agent in roster:
        a = dict(agent)
        profile_key = _agent_profile_key(a)
        profile = profiles.get(profile_key) or profiles.get(str(a.get("id"))) or {}
        status_key = str(a.get("statusKey") or a.get("id") or profile_key or "")
        loop_agent = loop_agents.get(status_key) or loop_agents.get(str(a.get("id") or "")) or {}
        loop_enabled = True
        if isinstance(loop_agent, dict) and isinstance(loop_agent.get("enabled"), bool):
            loop_enabled = loop_agent.get("enabled")
        scripted_ambient_enabled = not (
            isinstance(profile, dict) and (
                profile.get("scriptedAmbientEnabled") is False or
                profile.get("ambientEnabled") is False
            )
        )
        a["agentLiveModeEnabled"] = _agent_live_mode_enabled_from_profile(profile)
        a["agentLiveModeLoopEnabled"] = loop_enabled
        a["scriptedAmbientEnabled"] = scripted_ambient_enabled
        a["ambientEnabled"] = scripted_ambient_enabled
        a["agentLiveModeLoop"] = {
            "enabled": loop_enabled,
            "lastHeartbeatAt": loop_agent.get("lastHeartbeatAt") if isinstance(loop_agent, dict) else None,
            "lastOutcome": loop_agent.get("lastOutcome") if isinstance(loop_agent, dict) else None,
            "stats": loop_agent.get("stats", {}) if isinstance(loop_agent, dict) else {},
        }
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


def _agent_chat_apply_session_meta(messages, session_meta):
    if not isinstance(messages, list) or not isinstance(session_meta, dict):
        return messages
    for msg in messages:
        if not isinstance(msg, dict):
            continue
        for key, value in session_meta.items():
            if value not in (None, ""):
                msg[key] = value
    return messages

def get_agent_chat():
    """Read recent chat messages from agent session JSONL files."""
    global _chat_cache, _chat_cache_time
    gateway_connected = _gateway_presence_connected()
    now = time.time()
    if gateway_connected and now - _chat_cache_time < 2:  # cache for 2 seconds
        return _chat_cache

    result = {}
    roster = get_roster()
    live_loop_agents = {}
    try:
        live_state = get_live_agent_loop_state(persist_migration=False)
        live_loop_agents = live_state.get("agents") if isinstance(live_state.get("agents"), dict) else {}
    except Exception:
        live_loop_agents = {}

    for agent in roster:
        if not gateway_connected:
            continue
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
            best_key = None
            best_meta = {}
            if isinstance(sessions, dict):
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
                best_meta = sessions.get(best_key, {}) or {}
                sess_id = best_meta.get("sessionId", "")
            elif isinstance(sessions, list):
                sessions.sort(key=lambda s: s.get("updatedAt", 0), reverse=True)
                best_meta = sessions[0] if sessions and isinstance(sessions[0], dict) else {}
                best_key = best_meta.get("key") or best_meta.get("sessionKey") or best_meta.get("label") or ""
                sess_id = best_meta.get("sessionId", "")
            else:
                continue

            if not sess_id:
                continue

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
                    session_title = "Live Agent Mode" if str(best_key).endswith(":vw-live-mode-planner") else ("Main chat" if str(best_key).endswith(":main") or not best_key else str(best_key).split(":")[-1])
                    session_meta = {
                        "sessionId": sess_id,
                        "sessionKey": best_key,
                        "sessionTitle": session_title,
                        "sessionKind": "live-mode" if str(best_key).endswith(":vw-live-mode-planner") else ("main" if str(best_key).endswith(":main") else "other"),
                        "liveMode": str(best_key).endswith(":vw-live-mode-planner"),
                    }

                    if isinstance(content, str):
                        if content.strip():
                            messages.append({
                                "role": role,
                                "text": content[:500],
                                "time": time_str,
                                "from": from_name,
                                **session_meta,
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
                                        "from": from_name,
                                        **session_meta,
                                    })
                            elif item_type == "tool_use":
                                activity = _format_tool_activity(item)
                                messages.append({
                                    "role": role,
                                    "text": activity,
                                    "time": time_str,
                                    "from": from_name,
                                    **session_meta,
                                })

            # Keep last 500 messages
            result[agent_id] = messages[-500:]

        except Exception as e:
            pass  # skip agents with read errors

    for agent in roster:
        if agent.get("providerKind") == "hermes":
            profile = agent.get("profile") or agent.get("providerAgentId") or "default"
            active_session_id = _get_hermes_session_id(profile) or ""
            hermes_messages = []
            for msg in _hermes_history_with_pending_approval(profile, agent.get("id") or agent.get("statusKey") or "hermes-default"):
                if not isinstance(msg, dict):
                    continue
                msg_session_id = msg.get("sessionId") or active_session_id
                hermes_messages.append({
                    "role": msg.get("role") or "assistant",
                    "text": str(msg.get("text") or msg.get("content") or ""),
                    "time": msg.get("time") or "",
                    "ts": msg.get("ts") or msg.get("epochMs") or msg.get("timestamp") or 0,
                    "epochMs": msg.get("epochMs") or msg.get("ts") or 0,
                    "from": msg.get("from") or agent.get("name") or "Hermes",
                    "source": "hermes",
                    "sessionId": msg_session_id,
                    "sessionTitle": f"Hermes session {str(msg_session_id)[-8:]}" if msg_session_id else "Hermes session",
                    "sessionKind": "chat",
                    "activeSession": bool(active_session_id and msg_session_id == active_session_id),
                    "exitCode": msg.get("exitCode"),
                    "tools": msg.get("tools") if isinstance(msg.get("tools"), list) else [],
                    "thinking": msg.get("thinking") or "",
                    "reasoningTokens": msg.get("reasoningTokens") or 0,
                    "approval": msg.get("approval") if isinstance(msg.get("approval"), dict) else None,
                })
            if hermes_messages:
                result.setdefault(agent.get("id"), []).extend(hermes_messages[-500:])
        elif agent.get("providerKind") == "codex":
            profile = agent.get("profile") or agent.get("providerAgentId") or "main"
            active_session_id = _get_codex_session_id(profile) or ""
            codex_messages = []
            for msg in _load_codex_history(profile):
                if not isinstance(msg, dict):
                    continue
                msg_session_id = msg.get("sessionId") or active_session_id
                codex_messages.append({
                    "role": msg.get("role") or "assistant",
                    "text": str(msg.get("text") or msg.get("content") or ""),
                    "time": msg.get("time") or "",
                    "ts": msg.get("ts") or msg.get("epochMs") or msg.get("timestamp") or 0,
                    "epochMs": msg.get("epochMs") or msg.get("ts") or 0,
                    "from": msg.get("from") or agent.get("name") or "Codex",
                    "source": "codex",
                    "sessionId": msg_session_id,
                    "sessionTitle": f"Codex thread {str(msg_session_id)[-8:]}" if msg_session_id else "Codex thread",
                    "sessionKind": "chat",
                    "activeSession": bool(active_session_id and msg_session_id == active_session_id),
                    "exitCode": msg.get("exitCode"),
                    "tools": msg.get("tools") if isinstance(msg.get("tools"), list) else [],
                    "thinking": msg.get("thinking") or "",
                    "reasoningTokens": msg.get("reasoningTokens") or 0,
                })
            if codex_messages:
                result.setdefault(agent.get("id"), []).extend(codex_messages[-500:])
        elif agent.get("providerKind") in ("claude-code", "claudecode", "claude"):
            profile = agent.get("profile") or agent.get("providerAgentId") or "main"
            active_session_id = _get_claude_code_session_id(profile) or ""
            claude_messages = []
            for msg in _load_claude_code_history(profile):
                if not isinstance(msg, dict):
                    continue
                msg_session_id = msg.get("sessionId") or active_session_id
                claude_messages.append({
                    "role": msg.get("role") or "assistant",
                    "text": str(msg.get("text") or msg.get("content") or ""),
                    "time": msg.get("time") or "",
                    "ts": msg.get("ts") or msg.get("epochMs") or msg.get("timestamp") or 0,
                    "epochMs": msg.get("epochMs") or msg.get("ts") or 0,
                    "from": msg.get("from") or agent.get("name") or "Claude Code",
                    "source": "claude-code",
                    "sessionId": msg_session_id,
                    "sessionTitle": f"Claude Code {str(msg_session_id)[-8:]}" if msg_session_id else "Claude Code session",
                    "sessionKind": "chat",
                    "activeSession": bool(active_session_id and msg_session_id == active_session_id),
                })
            if claude_messages:
                result.setdefault(agent.get("id"), []).extend(claude_messages[-500:])

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
            or from_ref.get("providerKind") == "codex"
            or to_ref.get("providerKind") == "codex"
            or _is_hermes_agent(from_ref.get("id"))
            or _is_hermes_agent(to_ref.get("id"))
            or _is_codex_agent(from_ref.get("id"))
            or _is_codex_agent(to_ref.get("id"))
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

    status = load_agent_status()
    now_iso = datetime.now(timezone.utc).isoformat()

    # Live Agent Mode is its own active session in the world UI. Even when the
    # ephemeral planner transcript is deleted, synthesize a minimal row if no
    # chat history exists. Do not overwrite real main-chat/session metadata:
    # bubbles should display the actual session that produced each message.
    for agent in roster:
        agent_id = agent.get("id", "")
        if not agent_id:
            continue
        status_key = agent.get("statusKey") or agent_id
        try:
            live_session_active = _agent_live_mode_session_active(status_key, loop_state={"agents": live_loop_agents})
        except Exception:
            live_session_active = False
        if not live_session_active:
            continue
        session_meta = {
            "sessionId": _live_agent_model_planner_session_key(agent_id),
            "sessionKey": _live_agent_model_planner_session_key(agent_id),
            "sessionTitle": "Live Agent Mode",
            "sessionKind": "live-mode",
            "liveMode": True,
            "activeSession": True,
        }
        if result.get(agent_id):
            continue
        snapshot = status.get(status_key, {}) or status.get(agent_id, {}) or {}
        task = (snapshot.get("task") or "").strip()
        text = task or "Live Agent Mode is active"
        result[agent_id] = [{
            "role": "assistant",
            "text": text,
            "time": _format_time_et(now_iso),
            "epochMs": int(time.time() * 1000),
            "from": "Live Agent Mode",
            "source": "live-agent-mode-session",
            **session_meta,
        }]

    # Fallback: if an actively working non-live agent has no parsed session chat
    # yet, synthesize a bubble from the task so the world mirrors VO behavior.
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

def get_roster(meta=None):
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
    return _merge_agent_profiles(_agent_roster, meta=meta)

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
GZIP_STATIC_EXTENSIONS = (".css", ".html", ".js", ".json", ".mjs", ".svg", ".wasm")
GZIP_STATIC_MIN_BYTES = 1024

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
        elif getattr(self, "_vw_cache_control_sent", False):
            pass
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

    def _client_accepts_gzip(self):
        accepted = self.headers.get("Accept-Encoding", "")
        return any(token.strip().split(";", 1)[0].lower() == "gzip" for token in accepted.split(","))

    def _static_cache_control(self, request_path):
        if request_path in {"/", "/index.html"}:
            return "no-cache, must-revalidate"
        if request_path.endswith((".css", ".js", ".mjs", ".png", ".jpg", ".jpeg", ".webp", ".svg", ".wasm")):
            return "public, max-age=31536000, immutable"
        return None

    def _send_static_file_response(self, real_path, request_path=None, cache_control=None):
        if not os.path.isfile(real_path):
            self.send_error(404)
            return True
        ctype = mimetypes.guess_type(real_path)[0] or "application/octet-stream"
        with open(real_path, "rb") as f:
            data = f.read()
        should_gzip = (
            self._client_accepts_gzip()
            and len(data) >= GZIP_STATIC_MIN_BYTES
            and real_path.endswith(GZIP_STATIC_EXTENSIONS)
        )
        if should_gzip:
            data = gzip.compress(data, compresslevel=6)
        self.send_response(200)
        self.send_header("Content-Type", ctype)
        self.send_header("Content-Length", str(len(data)))
        self.send_header("Vary", "Accept-Encoding")
        if should_gzip:
            self.send_header("Content-Encoding", "gzip")
        if cache_control is None and request_path:
            cache_control = self._static_cache_control(request_path)
        if cache_control:
            self.send_header("Cache-Control", cache_control)
            self._vw_cache_control_sent = True
        self.end_headers()
        self.wfile.write(data)
        return True

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
            qs = urllib.parse.parse_qs(parsed.query)
            if str((qs.get("boot") or qs.get("summary") or [""])[0]).lower() in {"1", "true", "yes"}:
                return self._send_json(world_meta_boot_payload())
            return self._send_json(load_world_meta_fast())

        if path == "/api/building-placement-rules":
            return self._send_json(get_building_placement_rules())

        if path in {"/api/world-action-events", "/api/world-actions/events"}:
            return self._send_json(list_world_action_events(urllib.parse.parse_qs(parsed.query)))

        if path == "/api/world-actions":
            return self._send_json(reconcile_world_action_reservations())

        if path == "/api/world-actions/active":
            query = urllib.parse.parse_qs(parsed.query)
            client_markers = {str(value).strip() for value in query.get("client", [])}
            client_versions = {str(value).strip() for value in query.get("version", [])}
            client_visibility = str((query.get("visibility") or [""])[0] or "").strip().lower()
            if client_visibility == "hidden":
                return self._send_json([])
            if "main3d-live-sync" in client_markers:
                world_client_claimed = note_live_agent_loop_world_client_activity(
                    client_version=next(iter(client_versions), None),
                    client_info={
                        "client": "main3d-live-sync",
                        "sessionId": (query.get("sessionId") or query.get("session") or [None])[0],
                        "page": (query.get("page") or [None])[0],
                        "visibility": client_visibility or None,
                        "userAgent": self.headers.get("User-Agent"),
                    },
                )
                if not world_client_claimed:
                    return self._send_json([])
            with _live_agent_action_handoff_lock:
                active_actions = reconcile_world_action_reservations().get("active", [])
            return self._send_json(active_actions)

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
            meta = load_world_meta_fast()
            roster = get_roster(meta=meta)
            total_agents = len(roster)
            roster = _limited(roster, get_agent_limit())
            status = load_agent_status()
            # Load agent assignments from world meta
            _refresh_local_live_agent_world_claims(meta=meta, roster=roster)
            live_world_registry = _read_live_agent_world_registry()
            loop_state = get_live_agent_loop_state(meta=meta)
            loop_agents = loop_state.get("agents", {}) if isinstance(loop_state.get("agents"), dict) else {}
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
                loop_agent = loop_agents.get(status_key) or loop_agents.get(str(agent.get("id") or "")) or {}
                loop_enabled = True
                if isinstance(loop_agent, dict) and isinstance(loop_agent.get("enabled"), bool):
                    loop_enabled = loop_agent.get("enabled")
                scripted_ambient_enabled = not (
                    isinstance(profile, dict) and (
                        profile.get("scriptedAmbientEnabled") is False or
                        profile.get("ambientEnabled") is False
                    )
                )
                a["agentLiveModeEnabled"] = _agent_live_mode_enabled_from_profile(profile)
                a["agentLiveModeLoopEnabled"] = loop_enabled
                a["scriptedAmbientEnabled"] = scripted_ambient_enabled
                a["ambientEnabled"] = scripted_ambient_enabled
                a["agentLiveModeLoop"] = {
                    "enabled": loop_enabled,
                    "lastHeartbeatAt": loop_agent.get("lastHeartbeatAt") if isinstance(loop_agent, dict) else None,
                    "lastOutcome": loop_agent.get("lastOutcome") if isinstance(loop_agent, dict) else None,
                    "stats": loop_agent.get("stats", {}) if isinstance(loop_agent, dict) else {},
                }
                a["liveWorld"] = _agent_live_world_claim_payload(status_key, meta=meta, registry=live_world_registry, refresh_current=False)
                if isinstance(profile.get("appearance"), dict):
                    a["appearance"] = profile["appearance"]
                if isinstance(profile.get("personality"), dict):
                    a["personality"] = profile["personality"]
                result.append(a)
            return self._send_json(result)

        if path == "/api/agent-platforms":
            return self._send_json(_handle_agent_platforms())

        if path == "/api/agent-models":
            qs = urllib.parse.parse_qs(parsed.query)
            agent_id = (qs.get("agent") or qs.get("agentId") or [""])[0]
            ok, result, status = get_agent_model_settings(agent_id)
            return self._send_json(result, status)

        if path == "/api/native-models":
            qs = urllib.parse.parse_qs(parsed.query)
            openclaw_agent_id = (qs.get("agent") or qs.get("agentId") or ["main"])[0]
            return self._send_json(get_native_model_state(openclaw_agent_id))

        if path == "/api/skills-library":
            ok, result, status = handle_skills_library_list()
            return self._send_json(result, status)

        if path.startswith("/api/skills-library/"):
            skill_name = urllib.parse.unquote(path[len("/api/skills-library/"):].strip("/"))
            ok, result, status = handle_skills_library_get(skill_name)
            return self._send_json(result, status)

        if path.startswith("/api/agent/") and path.endswith("/live-mode"):
            parts = path.strip("/").split("/")
            agent_id = urllib.parse.unquote(parts[2]) if len(parts) >= 3 else ""
            setting = get_agent_live_mode_setting(agent_id)
            if not setting:
                return self._send_json(_api_error("agent_not_found", "Unknown agent id for Agent Live Mode setting.", details={"agentId": agent_id}), 404)
            return self._send_json(setting)

        if path == "/api/agent-live-world":
            qs = urllib.parse.parse_qs(parsed.query)
            agent_id = (qs.get("agentId") or qs.get("agent") or [""])[0]
            return self._send_json(get_live_agent_world_status(agent_id or None))

        if path.startswith("/api/agent/") and path.endswith("/workspace"):
            parts = path.strip("/").split("/")
            agent_id = urllib.parse.unquote(parts[2]) if len(parts) >= 3 else ""
            ok, result, status = get_agent_framework_workspace(agent_id)
            return self._send_json(result, status)

        if path.startswith("/api/agent/") and path.endswith("/skills"):
            parts = path.strip("/").split("/")
            agent_id = urllib.parse.unquote(parts[2]) if len(parts) >= 3 else ""
            ok, result, status = handle_agent_skills_list(agent_id)
            return self._send_json(result, status)

        if path.startswith("/api/agent/") and path.endswith("/resident-profile"):
            parts = path.strip("/").split("/")
            agent_id = urllib.parse.unquote(parts[2]) if len(parts) >= 3 else ""
            ok, result, status = get_agent_resident_profile(agent_id, persist=True)
            return self._send_json(result, status)

        if path == "/api/assignments":
            meta = load_world_meta_fast()
            return self._send_json(meta.get("agentAssignments", {}))

        if path == "/api/decorations":
            meta = load_world_meta_fast()
            return self._send_json(meta.get("decorations", []))

        if path == "/api/streets":
            meta = load_world_meta_fast()
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

        if path == "/api/agent-live-loop/perception":
            qs = urllib.parse.parse_qs(parsed.query)
            agent_id = (qs.get("agentId") or qs.get("agent") or ["adam"])[0]
            ok, result, status = get_live_agent_loop_perception(agent_id)
            return self._send_json(result, status)

        if path == "/api/agent-live-loop/feedback":
            qs = urllib.parse.parse_qs(parsed.query)
            agent_id = (qs.get("agentId") or qs.get("agent") or [None])[0]
            limit = (qs.get("limit") or [None])[0]
            ok, result, status = get_live_agent_loop_feedback(agent_id, limit=limit)
            return self._send_json(result, status)

        if path == "/api/agent-live-loop/proposals":
            qs = urllib.parse.parse_qs(parsed.query)
            agent_id = (qs.get("agentId") or qs.get("agent") or [None])[0]
            include_resolved = str((qs.get("includeResolved") or qs.get("include_resolved") or [""])[0]).lower() in {"1", "true", "yes"}
            limit = (qs.get("limit") or [None])[0]
            ok, result, status = get_live_agent_loop_operator_proposals(agent_id, include_resolved=include_resolved, limit=limit)
            return self._send_json(result, status)

        if path == "/api/agent-live-loop/timeline":
            qs = urllib.parse.parse_qs(parsed.query)
            agent_id = (qs.get("agentId") or qs.get("agent") or [None])[0]
            include_resolved = str((qs.get("includeResolved") or qs.get("include_resolved") or ["true"])[0]).lower() not in {"0", "false", "no"}
            limit = (qs.get("limit") or [None])[0]
            ok, result, status = get_live_agent_loop_operator_timeline(agent_id, limit=limit, include_resolved=include_resolved)
            return self._send_json(result, status)

        if path == "/api/agent-live-loop":
            return self._send_json(get_live_agent_loop_status())

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
            return self._send_json({"ok": True, "messages": _hermes_history_with_pending_approval(profile, agent.get("id") or agent_key), "profile": profile})

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

        if path.startswith("/api/hermes/runs/") and path.endswith("/events"):
            run_id = urllib.parse.unquote(path[len("/api/hermes/runs/"):-len("/events")].strip("/"))
            return _handle_hermes_run_events(self, run_id)

        if path == "/api/hermes/test":
            return self._send_json(_handle_hermes_test())

        if path == "/api/codex/history" or path.startswith("/api/codex/history?"):
            qs = urllib.parse.parse_qs(parsed.query)
            agent_key = (qs.get("agentId") or qs.get("key") or ["codex-main"])[0]
            agent = _get_codex_agent(agent_key) or {}
            profile = agent.get("profile") or agent.get("providerAgentId") or "main"
            return self._send_json({"ok": True, "messages": _load_codex_history(profile), "profile": profile})

        if path.startswith("/api/codex/runs/") and path.endswith("/events"):
            run_id = urllib.parse.unquote(path[len("/api/codex/runs/"):-len("/events")].strip("/"))
            return _handle_codex_run_events(self, run_id)

        if path == "/api/codex/test":
            provider = _codex_provider()
            return self._send_json(provider.test() if provider else {"ok": False, "error": "Codex provider module unavailable", "agents": []})

        if path == "/api/claude-code/test":
            return self._send_json(_handle_claude_code_test())

        if path == "/api/chat-sessions" or path.startswith("/api/chat-sessions?"):
            qs = urllib.parse.parse_qs(parsed.query)
            agent_id = (qs.get("agentId") or qs.get("agent") or [""])[0]
            try:
                limit = int((qs.get("limit") or ["40"])[0])
            except (TypeError, ValueError):
                limit = 40
            payload, status = handle_chat_sessions_list(agent_id, limit=limit)
            return self._send_json(payload, status)

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
            return self._send_json(_gateway_info_payload())

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
                if provider_kind == "hermes":
                    session_key = f"hermes:{a.get('profile') or a.get('providerAgentId') or a['id']}"
                elif provider_kind == "codex":
                    session_key = f"codex:{a.get('profile') or a.get('providerAgentId') or a['id']}"
                else:
                    session_key = f"agent:{a['id']}:main"
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
                    "model": a.get("model", ""),
                    "provider": a.get("provider", ""),
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
            qs = urllib.parse.parse_qs(parsed.query)
            agent_key = (qs.get("agent") or qs.get("agentId") or qs.get("key") or [""])[0]
            provider_kind = str((qs.get("providerKind") or qs.get("provider") or [""])[0] or "").strip().lower()
            model_cfg = _load_openclaw_model_config()
            provider_agent = None
            if agent_key and (provider_kind == "hermes" or agent_key.startswith(("hermes:", "hermes-"))):
                provider_agent = _get_hermes_agent(agent_key)
            elif agent_key and (provider_kind == "codex" or agent_key.startswith(("codex:", "codex-"))):
                provider_agent = _get_codex_agent(agent_key)
            if provider_agent:
                if provider_agent.get("providerKind") == "codex":
                    return self._send_json(_codex_context_payload(provider_agent, agent_key=agent_key, model_cfg=model_cfg))
                else:
                    model = provider_agent.get("model") or "unknown"
                provider = provider_agent.get("provider") or provider_agent.get("providerKind") or ""
                return self._send_json({
                    "model": model,
                    "provider": provider,
                    "providerKind": provider_agent.get("providerKind", ""),
                    "contextWindow": _context_window_for_model(model, provider, model_cfg),
                })

            requested_agent = _agent_record_for(agent_key) if agent_key else None
            cfg_agent = _openclaw_config_agent_for(agent_key, requested_agent, model_cfg) if agent_key else None
            defaults = model_cfg.get("agents", {}).get("defaults", {}).get("model", {}) if isinstance(model_cfg, dict) else {}
            provider = str(defaults.get("provider") or "")
            model = ""
            if isinstance(cfg_agent, dict):
                model = str(cfg_agent.get("model") or "")
                provider = str(cfg_agent.get("provider") or provider or "")
            if not model:
                model = _default_openclaw_model(model_cfg) or "unknown"
                try:
                    for a_cfg in model_cfg.get("agents", {}).get("list", []):
                        if isinstance(a_cfg, dict) and a_cfg.get("default") and a_cfg.get("model"):
                            provider = str(a_cfg.get("provider") or provider or "")
                            break
                except Exception:
                    pass
            context_window = _context_window_for_model(model, provider, model_cfg)
            return self._send_json({"model": model, "provider": provider, "providerKind": "openclaw", "contextWindow": context_window})

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
                self._send_static_file_response(nm_path, request_path=path, cache_control="public, max-age=31536000, immutable")
                return

        # --- Static files ---
        real_static_path = self.translate_path(path)
        if os.path.isfile(real_static_path):
            self._send_static_file_response(real_static_path, request_path=path)
            return
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

        if path == "/api/agent/create":
            result = _handle_agent_create(self._read_body() or {})
            status = int(result.pop("_status", 200) or 200) if result.get("ok") else int(result.pop("_status", 500) or 500)
            return self._send_json(result, status)

        if path == "/api/hermes/runs":
            result = _handle_hermes_run_start(self._read_body())
            status = int(result.pop("_status", 200) or 200) if result.get("ok") else int(result.pop("_status", 502) or 502)
            return self._send_json(result, status)

        if path.startswith("/api/hermes/runs/") and path.endswith("/stop"):
            run_id = urllib.parse.unquote(path[len("/api/hermes/runs/"):-len("/stop")].strip("/"))
            body = self._read_body() or {}
            body["runId"] = run_id
            result = _handle_hermes_interrupt(body)
            status = int(result.pop("_status", 200) or 200) if result.get("ok") else int(result.pop("_status", 502) or 502)
            return self._send_json(result, status)

        if path.startswith("/api/hermes/runs/") and path.endswith("/approval"):
            run_id = urllib.parse.unquote(path[len("/api/hermes/runs/"):-len("/approval")].strip("/"))
            body = self._read_body() or {}
            meta = _get_hermes_active_run(run_id) or {}
            body["agentId"] = body.get("agentId") or meta.get("agentId") or meta.get("agentKey") or "hermes-default"
            body.setdefault("approval", {})
            if isinstance(body["approval"], dict):
                body["approval"]["provider"] = body["approval"].get("provider") or "hermes-api"
                body["approval"]["runId"] = body["approval"].get("runId") or run_id
                body["approval"]["agentId"] = body["approval"].get("agentId") or body["agentId"]
                body["approval"]["profile"] = body["approval"].get("profile") or meta.get("profile") or ""
                body["approval"]["session_id"] = body["approval"].get("session_id") or meta.get("sessionId") or ""
            result = _handle_hermes_approval_respond(body)
            status = int(result.pop("_status", 200) or 200) if result.get("ok") else int(result.pop("_status", 502) or 502)
            return self._send_json(result, status)

        if path == "/api/hermes/interrupt":
            result = _handle_hermes_interrupt(self._read_body())
            status = int(result.pop("_status", 200) or 200) if result.get("ok") else int(result.pop("_status", 502) or 502)
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

        if path == "/api/codex/chat":
            result = _handle_codex_chat(self._read_body())
            status = int(result.pop("_status", 200) or 200) if result.get("ok") else int(result.pop("_status", 502) or 502)
            return self._send_json(result, status)

        if path == "/api/codex/runs":
            result = _handle_codex_run_start(self._read_body())
            status = int(result.pop("_status", 200) or 200) if result.get("ok") else int(result.pop("_status", 502) or 502)
            return self._send_json(result, status)

        if path == "/api/codex/interrupt":
            result = _handle_codex_interrupt(self._read_body())
            status = int(result.pop("_status", 200) or 200) if result.get("ok") else int(result.pop("_status", 502) or 502)
            return self._send_json(result, status)

        if path == "/api/codex/history/clear":
            body = self._read_body() or {}
            agent = _get_codex_agent(body.get("agentId") or body.get("key") or "codex-main") or {}
            profile = agent.get("profile") or agent.get("providerAgentId") or "main"
            _save_codex_state(profile, {"messages": [], "sessionId": ""})
            return self._send_json({"ok": True, "profile": profile})

        if path == "/api/codex/test":
            provider = _codex_provider()
            return self._send_json(provider.test() if provider else {"ok": False, "error": "Codex provider module unavailable", "agents": []})

        if path == "/api/claude-code/test":
            return self._send_json(_handle_claude_code_test(self._read_body() or {}))

        if path == "/api/chat-sessions/create":
            body = self._read_body() or {}
            payload, status = handle_chat_session_create(body.get("agentId") or body.get("agent"), body)
            return self._send_json(payload, status)

        if path == "/api/chat-sessions/delete":
            body = self._read_body() or {}
            payload, status = handle_chat_session_delete(body.get("agentId") or body.get("agent"), str(body.get("sessionId") or body.get("sessionKey") or ""), body)
            return self._send_json(payload, status)

        if path == "/api/chat-sessions/switch":
            body = self._read_body() or {}
            payload, status = handle_chat_session_switch(body.get("agentId") or body.get("agent"), str(body.get("sessionId") or body.get("sessionKey") or ""), body)
            return self._send_json(payload, status)

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

        if path == "/api/agent-live-loop":
            if _demo_feature_locked("agentLiveMode"):
                return self._send_json(_locked_response("agentLiveMode"), 403)
            ok, result, status = update_live_agent_loop_settings(self._read_body() or {})
            return self._send_json(result, status)

        if path == "/api/agent-live-loop/proposals":
            if _demo_feature_locked("agentLiveMode"):
                return self._send_json(_locked_response("agentLiveMode"), 403)
            ok, result, status = resolve_live_agent_loop_operator_proposal(self._read_body() or {})
            return self._send_json(result, status)

        if path == "/api/agent-live-loop/user-attention":
            if _demo_feature_locked("agentLiveMode"):
                return self._send_json(_locked_response("agentLiveMode"), 403)
            data = self._read_body() or {}
            if not isinstance(data, dict):
                return self._send_json(_api_error("invalid_payload", "user-attention payload must be an object."), 400)
            agent_id = data.get("agentId") or data.get("agent")
            if not agent_id:
                return self._send_json(_api_error("invalid_payload", "agentId is required."), 400)
            if data.get("clear") is True:
                cleared = live_agent_clear_user_attention(agent_id)
                return self._send_json({"ok": True, "cleared": cleared, "agentId": _resolve_agent_id(agent_id) or agent_id})
            record = live_agent_note_user_attention(
                agent_id,
                source=str(data.get("source") or "api"),
                message_preview=str(data.get("messagePreview") or "")[:160],
                hold_sec=data.get("holdSec"),
            )
            if not record:
                return self._send_json(_api_error("agent_not_found", "agentId must reference an existing agent."), 404)
            return self._send_json({"ok": True, "userAttention": {k: v for k, v in record.items() if k != "holdUntilEpoch"}})

        if path == "/api/agent-live-loop/tick":
            if _demo_feature_locked("agentLiveMode"):
                return self._send_json(_locked_response("agentLiveMode"), 403)
            data = self._read_body() or {}
            if not isinstance(data, dict):
                return self._send_json(_api_error("invalid_payload", "tick payload must be an object."), 400)
            result = live_agent_loop_tick(
                reason=str(data.get("reason") or "api"),
                force=bool(data.get("force")),
                dry_run=bool(data.get("dryRun")),
            )
            return self._send_json(result, 200 if result.get("ok") else 409)

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
            enabled = data.get("agentLiveModeEnabled") if isinstance(data, dict) and "agentLiveModeEnabled" in data else None
            agent_loop_enabled = None
            if isinstance(data, dict):
                if "agentLoopEnabled" in data:
                    agent_loop_enabled = data.get("agentLoopEnabled")
                elif "agentEnabled" in data:
                    agent_loop_enabled = data.get("agentEnabled")
            scripted_ambient_enabled = data.get("scriptedAmbientEnabled") if isinstance(data, dict) and "scriptedAmbientEnabled" in data else None
            ambient_enabled = data.get("ambientEnabled") if isinstance(data, dict) and "ambientEnabled" in data else None
            ok, result, status = set_agent_live_mode_setting(
                agent_id,
                enabled,
                agent_loop_enabled=agent_loop_enabled,
                scripted_ambient_enabled=scripted_ambient_enabled,
                ambient_enabled=ambient_enabled,
            )
            return self._send_json(result, status)

        if path.startswith("/api/agent/") and path.endswith("/workspace"):
            if _demo_feature_locked("advancedEditor"):
                return self._send_json(_demo_edit_locked_response(), 403)
            parts = path.strip("/").split("/")
            agent_id = urllib.parse.unquote(parts[2]) if len(parts) >= 3 else ""
            ok, result, status = save_agent_framework_workspace(agent_id, self._read_body())
            return self._send_json(result, status)

        if path.startswith("/api/agent/") and path.endswith("/model"):
            if _demo_feature_locked("advancedEditor"):
                return self._send_json(_demo_edit_locked_response(), 403)
            parts = path.strip("/").split("/")
            agent_id = urllib.parse.unquote(parts[2]) if len(parts) >= 3 else ""
            ok, result, status = save_agent_model_settings(agent_id, self._read_body())
            return self._send_json(result, status)

        if path == "/api/native-models/openclaw/agent-model":
            if _demo_feature_locked("advancedEditor"):
                return self._send_json(_demo_edit_locked_response(), 403)
            body = self._read_body() or {}
            agent_id = body.get("agent") or body.get("agentId") or body.get("id") or ""
            ok, result, status = save_agent_model_settings(agent_id, {"model": body.get("model") or ""})
            return self._send_json(result, status)

        if path == "/api/native-models/openclaw/auth/api-key":
            if _demo_feature_locked("advancedEditor"):
                return self._send_json(_demo_edit_locked_response(), 403)
            body = self._read_body() or {}
            result = _save_openclaw_api_key(
                body.get("provider"),
                body.get("apiKey"),
                body.get("profileId") or body.get("profile"),
                body.get("agent") or body.get("agentId") or "main",
                sync_all=str(body.get("scope") or "global").lower() != "agent",
            )
            return self._send_json(result, 200 if result.get("ok") else 400)

        if path == "/api/native-models/openclaw/auth/delete":
            if _demo_feature_locked("advancedEditor"):
                return self._send_json(_demo_edit_locked_response(), 403)
            body = self._read_body() or {}
            result = _delete_openclaw_auth(
                body.get("provider"),
                body.get("profileId") or body.get("profile"),
                body.get("agent") or body.get("agentId") or "main",
                sync_all=str(body.get("scope") or "global").lower() != "agent",
            )
            return self._send_json(result, 200 if result.get("ok") else 400)

        if path == "/api/native-models/openclaw/auth/sync-static":
            if _demo_feature_locked("advancedEditor"):
                return self._send_json(_demo_edit_locked_response(), 403)
            body = self._read_body() or {}
            result = _sync_openclaw_static_auth_from_main(body.get("provider"), body.get("profileId") or body.get("profile"))
            return self._send_json(result, 200 if result.get("ok") else 400)

        if path == "/api/native-models/openclaw/auth/reset-overrides":
            if _demo_feature_locked("advancedEditor"):
                return self._send_json(_demo_edit_locked_response(), 403)
            body = self._read_body() or {}
            result = _reset_openclaw_static_auth_overrides(body.get("agent") or body.get("agentId"), body.get("provider"))
            return self._send_json(result, 200 if result.get("ok") else 400)

        if path == "/api/native-models/openclaw/provider":
            if _demo_feature_locked("advancedEditor"):
                return self._send_json(_demo_edit_locked_response(), 403)
            body = self._read_body() or {}
            result = _save_openclaw_provider(
                body.get("provider"),
                body.get("baseUrl") or body.get("baseURL") or body.get("url"),
                body.get("models"),
                api=body.get("api") or "",
                api_key=body.get("apiKey") or "",
                timeout_seconds=body.get("timeoutSeconds"),
            )
            return self._send_json(result, 200 if result.get("ok") else 400)

        if path == "/api/native-models/openclaw/provider/delete":
            if _demo_feature_locked("advancedEditor"):
                return self._send_json(_demo_edit_locked_response(), 403)
            body = self._read_body() or {}
            result = _delete_openclaw_provider(body.get("provider"))
            return self._send_json(result, 200 if result.get("ok") else 400)

        if path == "/api/native-models/hermes/profile-model":
            if _demo_feature_locked("advancedEditor"):
                return self._send_json(_demo_edit_locked_response(), 403)
            body = self._read_body() or {}
            result = _set_hermes_profile_model(body.get("profile") or body.get("profileId"), body.get("provider"), body.get("model"), body.get("baseUrl") or "")
            return self._send_json(result, 200 if result.get("ok") else 400)

        if path == "/api/native-models/hermes/auth/api-key":
            if _demo_feature_locked("advancedEditor"):
                return self._send_json(_demo_edit_locked_response(), 403)
            body = self._read_body() or {}
            result = _save_hermes_api_key(body.get("provider"), body.get("apiKey"), body.get("label") or "")
            return self._send_json(result, 200 if result.get("ok") else 400)

        if path == "/api/native-models/hermes/auth/delete":
            if _demo_feature_locked("advancedEditor"):
                return self._send_json(_demo_edit_locked_response(), 403)
            body = self._read_body() or {}
            result = _delete_hermes_auth(body.get("provider"), body.get("target") or body.get("label") or body.get("id"))
            return self._send_json(result, 200 if result.get("ok") else 400)

        if path == "/api/native-models/hermes/provider":
            if _demo_feature_locked("advancedEditor"):
                return self._send_json(_demo_edit_locked_response(), 403)
            body = self._read_body() or {}
            result = _save_hermes_custom_provider(
                body.get("profile") or body.get("profileId") or "default",
                body.get("provider"),
                body.get("baseUrl") or body.get("baseURL") or body.get("url"),
                body.get("models"),
            )
            return self._send_json(result, 200 if result.get("ok") else 400)

        if path == "/api/native-models/hermes/provider/delete":
            if _demo_feature_locked("advancedEditor"):
                return self._send_json(_demo_edit_locked_response(), 403)
            body = self._read_body() or {}
            result = _delete_hermes_custom_provider(body.get("profile") or body.get("profileId") or "default", body.get("provider"))
            return self._send_json(result, 200 if result.get("ok") else 400)

        if path.startswith("/api/agent/") and path.endswith("/skills"):
            if _demo_feature_locked("advancedEditor"):
                return self._send_json(_demo_edit_locked_response(), 403)
            parts = path.strip("/").split("/")
            agent_id = urllib.parse.unquote(parts[2]) if len(parts) >= 3 else ""
            ok, result, status = handle_agent_skill_save(agent_id, self._read_body())
            return self._send_json(result, status)

        if path == "/api/skills-library":
            if _demo_feature_locked("advancedEditor"):
                return self._send_json(_demo_edit_locked_response(), 403)
            ok, result, status = handle_skills_library_save(self._read_body())
            return self._send_json(result, status)

        if path == "/api/skills-library/apply":
            if _demo_feature_locked("advancedEditor"):
                return self._send_json(_demo_edit_locked_response(), 403)
            ok, result, status = handle_skills_library_apply(self._read_body())
            return self._send_json(result, status)

        if path == "/api/skills-library/save-from-agent":
            if _demo_feature_locked("advancedEditor"):
                return self._send_json(_demo_edit_locked_response(), 403)
            ok, result, status = handle_skills_library_save_from_agent(self._read_body())
            return self._send_json(result, status)

        if path.startswith("/api/agent/") and path.endswith("/resident-profile"):
            if _demo_feature_locked("advancedEditor"):
                return self._send_json(_demo_edit_locked_response(), 403)
            parts = path.strip("/").split("/")
            agent_id = urllib.parse.unquote(parts[2]) if len(parts) >= 3 else ""
            ok, result, status = save_agent_resident_profile(agent_id, self._read_body())
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
                placement = validate_building_placement(data)
                if not placement.get("ok"):
                    return self._send_json({"ok": False, **placement}, 409)
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
                placement = validate_building_placement(data)
                if not placement.get("ok"):
                    return self._send_json({"ok": False, **placement}, 409)
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

        if path.startswith("/api/agent/") and "/skills/" in path:
            if _demo_feature_locked("advancedEditor"):
                return self._send_json(_demo_edit_locked_response(), 403)
            rest = path[len("/api/agent/"):]
            agent_part, _, skill_part = rest.partition("/skills/")
            ok, result, status = handle_agent_skill_delete(
                urllib.parse.unquote(agent_part.strip("/")),
                urllib.parse.unquote(skill_part.strip("/")),
            )
            return self._send_json(result, status)

        if path.startswith("/api/skills-library/"):
            if _demo_feature_locked("advancedEditor"):
                return self._send_json(_demo_edit_locked_response(), 403)
            skill_name = urllib.parse.unquote(path[len("/api/skills-library/"):].strip("/"))
            ok, result, status = handle_skills_library_delete(skill_name)
            return self._send_json(result, status)

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
    try:
        allowed = set(_read_gateway_allowed_origins())
        candidates = _gateway_origin_candidates()
        accepted = [origin for origin in candidates if origin in allowed]
        if accepted:
            print(f"[chat] ✅ Gateway origin {accepted[0]} found in allowedOrigins")
        else:
            expected = candidates[0] if candidates else f"http://127.0.0.1:{PORT}"
            print(f"[chat] ⚠️  Origin {expected} NOT in gateway.controlUi.allowedOrigins!")
            print(f"[chat]    Chat will get 1008 disconnects. Add this origin to openclaw.json")
            print(f"[chat]    and restart the gateway, or use the VO settings panel.")
    except Exception as e:
        print(f"[chat] Could not check gateway config: {e}")


def warm_startup_caches():
    """Move first-hit meta/roster parsing out of the browser load path."""
    try:
        started = time.perf_counter()
        meta = load_world_meta_fast()
        get_roster(meta=meta)
        _read_live_agent_world_registry()
        elapsed_ms = int((time.perf_counter() - started) * 1000)
        print(f"⚡ Startup caches warmed in {elapsed_ms}ms")
    except Exception as exc:
        print(f"⚠️  Startup cache warmup skipped: {exc}")


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

    # Keep enabled Live Mode agents present across restarts; action creation stays
    # gated by an active world client polling /api/world-actions/active.
    start_live_agent_loop()
    warm_startup_caches()

    class ReusableThreadingTCPServer(socketserver.ThreadingTCPServer):
        allow_reuse_address = True

    handler = VWHandler
    with ReusableThreadingTCPServer(("", PORT), handler) as httpd:
        print(f"🌐 Serving on http://0.0.0.0:{PORT}")
        try:
            httpd.serve_forever()
        except KeyboardInterrupt:
            print("\n🛑 Server stopped.")

if __name__ == "__main__":
    main()
