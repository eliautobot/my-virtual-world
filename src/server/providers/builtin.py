"""Built-in provider adapters for the registry.

Provider-specific construction lives here so the HTTP server and UI can remain
provider-neutral.  Third-party providers use the extension loader instead.
"""

from __future__ import annotations

import json
import inspect
import os
import re
import time
from pathlib import Path
from typing import Any

from .claude_code import ClaudeCodeProvider
from .codex import CodexProvider
from .file_safety import backup_files
from .hermes import HermesProvider
from .path_mapping import is_windows_absolute, map_host_path_to_container, normalize_host_path
from .registry import ProviderManifest, ProviderRegistry

try:
    from .opencode import OpenCodeProvider
except ImportError:
    OpenCodeProvider = None

try:
    from .antigravity import AntigravityProvider
except ImportError:
    AntigravityProvider = None


COMMON_RESOURCE_SCHEMA = [
    {
        "id": "identity", "label": "Office identity", "paths": ["IDENTITY.md"],
        "runtimeActive": False, "writable": True, "deletable": False,
        "description": "My Virtual World identity metadata; not injected by every native runtime.",
    },
    {
        "id": "instructions", "label": "Project instructions", "paths": ["AGENTS.md"],
        "runtimeActive": True, "writable": True, "deletable": False,
        "description": "Project-level instructions consumed by this runtime.",
    },
]

OFFICE_ONLY_RESOURCE_SCHEMA = [
    COMMON_RESOURCE_SCHEMA[0],
    {
        **COMMON_RESOURCE_SCHEMA[1],
        "label": "Office instructions",
        "runtimeActive": False,
        "description": "My Virtual World standing instructions; the native runtime uses its own instruction file below.",
    },
]

SAFE_DOCUMENT_RESOURCE = {
    "id": "documents",
    "label": "Workspace documents",
    "paths": [
        "README.md", "*.txt", "docs/**/*.md", "docs/**/*.txt",
        "notes/**/*.md", "notes/**/*.txt", "memory/*.md",
    ],
    "runtimeActive": False,
    "writable": True,
    "deletable": True,
    "description": "Non-secret text documents explicitly exposed by the provider contract.",
}


def _skill_root(
    path: str,
    label: str,
    *,
    shared_roots: list[str] | None = None,
    writable: bool = True,
) -> list[dict[str, Any]]:
    return [{
        "id": "agent",
        "label": label,
        "path": path,
        "scope": "agent",
        "runtimeActive": True,
        "writable": writable,
        "format": "agentskills",
        "sharedRoots": list(shared_roots or []),
    }]


def _bool(value: Any, default: bool = False) -> bool:
    if value is None:
        return default
    return str(value).lower() not in ("0", "false", "no", "off")


def _creation_schema(
    model_field: bool = True,
    directory_modes: bool = False,
    include_native_id: bool = True,
) -> dict[str, Any]:
    fields = [
        {"id": "name", "label": "Name", "type": "text", "required": True},
        {"id": "role", "label": "Role", "type": "text", "required": True},
        {"id": "emoji", "label": "Emoji", "type": "emoji", "required": False},
        {"id": "instructions", "label": "Instructions", "type": "textarea", "required": False},
    ]
    if include_native_id:
        fields.insert(1, {"id": "id", "label": "Native ID", "type": "slug", "required": False})
    if model_field:
        fields.append({"id": "model", "label": "Model", "type": "model", "required": False})
    if directory_modes:
        fields.extend([
            {
                "id": "creationMode",
                "label": "Workspace",
                "type": "select",
                "default": "standard",
                "options": [
                    {"value": "standard", "label": "Managed workspace"},
                    {"value": "custom", "label": "Custom parent directory"},
                ],
            },
            {
                "id": "customDirectory",
                "label": "Custom parent directory",
                "type": "path",
                "required": True,
                "showWhen": {"creationMode": "custom"},
            },
        ])
    return {"fields": fields}


def _field(key: str, label: str, field_type: str = "text", **extra: Any) -> dict[str, Any]:
    """Build a browser-safe provider settings field declaration."""
    return {"key": key, "label": label, "type": field_type, **extra}


def _endpoint_mode_field(key: str = "endpointMode", label: str = "Endpoint location") -> dict[str, Any]:
    return _field(
        key,
        label,
        "select",
        default="auto",
        options=[
            {"value": "auto", "label": "Auto-detect"},
            {"value": "host", "label": "Docker host"},
            {"value": "container", "label": "Container local"},
            {"value": "custom", "label": "Custom URL only"},
        ],
        help="Auto-detect probes one endpoint at a time and selects a single authenticated connection before submitting work.",
    )


def _network_transport(
    transport_id: str,
    label: str,
    *,
    mode_key: str,
    url_key: str,
    schemes: list[str],
    host_url: str,
    container_url: str,
) -> dict[str, Any]:
    return {
        "id": transport_id,
        "label": label,
        "kind": "network",
        "modeKey": mode_key,
        "urlKey": url_key,
        "schemes": schemes,
        "selection": "single-before-run",
        "defaultEndpoints": [
            {"url": host_url, "location": "host", "label": "Docker host"},
            {"url": container_url, "location": "container", "label": "Container local"},
        ],
    }


def _process_transport(label: str, *, executable_key: str = "binary", home_key: str = "homePath") -> dict[str, Any]:
    return {
        "id": "cli",
        "label": label,
        "kind": "process",
        "executionBoundary": "server-runtime",
        "executableKey": executable_key,
        "homeKey": home_key,
        "hostEndpointFallback": False,
    }


def _connection_schema(*transports: dict[str, Any]) -> dict[str, Any]:
    return {"version": 1, "transports": [dict(item) for item in transports]}


# These transport declarations are the single source of truth shared by the
# manifest/UI contract and the native server routes. Provider-specific probes
# remain in their adapters; candidate topology does not.
OPENCLAW_GATEWAY_TRANSPORT = _network_transport(
    "gateway",
    "OpenClaw Gateway",
    mode_key="endpointMode",
    url_key="gatewayUrl",
    schemes=["ws", "wss"],
    host_url="ws://host.docker.internal:18789",
    container_url="ws://127.0.0.1:18789",
)

HERMES_API_TRANSPORT = _network_transport(
    "api",
    "Hermes API",
    mode_key="apiEndpointMode",
    url_key="apiUrl",
    schemes=["http", "https"],
    host_url="http://host.docker.internal:8642",
    container_url="http://127.0.0.1:8642",
)


def _session_settings() -> dict[str, Any]:
    return {
        "id": "sessions",
        "label": "Active session",
        "description": "Keep the world bubble and chat window attached to the native session that is currently active for this agent.",
        "fields": [
            _field(
                "followActiveSession",
                "Automatically follow the newest active native session",
                "boolean",
                default=True,
                help="When another client starts or resumes a newer session, My Virtual World switches the agent bubble to it and imports its live transcript.",
            ),
            _field(
                "sessionSyncIntervalSec",
                "Session sync interval",
                "number",
                default=3,
                min=1,
                max=60,
                step=1,
                suffix="seconds",
            ),
        ],
    }


def _cli_settings_schema(
    *,
    provider_id: str,
    config_key: str | None = None,
    display_name: str | None = None,
    permission_fields: list[dict[str, Any]] | None = None,
    discovery_fields: list[dict[str, Any]] | None = None,
    include_sessions: bool = True,
    include_main_workspace: bool = True,
) -> dict[str, Any]:
    upper_name = display_name or provider_id.replace("-", " ").title()
    connection_fields = [
        _field("enabled", "Enabled", "boolean", default=True),
        _field(
            "binary",
            "Executable",
            "path",
            placeholder=provider_id,
            help="This native CLI must be executable by the Virtual World server runtime. A host URL cannot substitute for a CLI unless that framework provides a network bridge.",
        ),
        _field("homePath", f"{upper_name} home/config directory", "path"),
        _field("workspaceRoot", "Managed agent workspace root", "path"),
    ]
    if include_main_workspace:
        connection_fields.append(_field("mainWorkspace", "Main agent workspace", "path"))
    connection_fields.append(
        _field("timeoutSec", "Turn timeout", "number", default=900, min=30, max=7200, step=30, suffix="seconds")
    )
    sections = [
        {
            "id": "connection",
            "label": "Connection",
            "fields": connection_fields,
        },
        {
            "id": "models",
            "label": "Models",
            "fields": [
                _field(
                    "model",
                    "Default model",
                    "model",
                    placeholder="Use the runtime default",
                    help="Leave blank to use the model selected by the native runtime.",
                ),
            ],
        },
    ]
    if permission_fields:
        sections.append({"id": "permissions", "label": "Permissions", "fields": permission_fields})
    if discovery_fields:
        sections.append({"id": "discovery", "label": "Agent discovery", "fields": discovery_fields})
    if include_sessions:
        sections.append(_session_settings())
    return {"version": 1, "configKey": config_key or provider_id, "sections": sections}


def _atomic_text(path: str, content: str) -> None:
    os.makedirs(os.path.dirname(path), exist_ok=True)
    tmp = f"{path}.tmp-{os.getpid()}"
    Path(tmp).write_text(content, encoding="utf-8")
    os.replace(tmp, path)


def _update_identity_file(path: str, patch: dict[str, Any]) -> bool:
    if not path:
        return False
    try:
        text = Path(path).read_text(encoding="utf-8", errors="replace")
    except OSError:
        text = "# IDENTITY.md\n"
    fields = {"name": "Name", "role": "Role", "emoji": "Emoji"}
    changed = False
    for key, label in fields.items():
        if key not in patch:
            continue
        value = str(patch.get(key) or "").strip()
        pattern = re.compile(rf"(?im)^(\s*-\s*\*\*{re.escape(label)}:\*\*\s*).*$")
        replacement = rf"\g<1>{value}"
        if pattern.search(text):
            updated = pattern.sub(replacement, text, count=1)
        else:
            updated = text.rstrip() + f"\n- **{label}:** {value}\n"
        changed = changed or updated != text
        text = updated
    if changed:
        _atomic_text(path, text)
    return changed


class OpenClawOfficeProvider:
    provider_kind = "openclaw"
    provider_type = "runtime"

    def __init__(self, context: dict[str, Any]) -> None:
        self.context = context
        self.home_path = os.path.abspath(os.path.expanduser(str(context.get("workspaceBase") or "~/.openclaw")))
        gateway_home = str(context.get("gatewayWorkspaceBase") or self.home_path)
        self.gateway_home_path = normalize_host_path(gateway_home)
        self.manifest = ProviderManifest(
            id="openclaw",
            name="OpenClaw",
            description="Gateway-backed OpenClaw agents with native workspaces, sessions, tools, skills, and approvals.",
            icon="🦞",
            provider_type="runtime",
            capabilities={
                "discover": True, "health": True, "chat": True, "streaming": True,
                "sessions": True, "sessionCreate": True, "sessionDelete": True, "sessionSwitch": True,
                "interrupt": True, "approvals": True, "agentCreate": True, "agentDelete": True,
                "profileEdit": True, "resourcesRead": True, "resourcesWrite": True, "skills": True,
                "models": True, "projects": True, "meetings": True, "agentToAgent": True,
                "attachments": True, "tools": True,
            },
            connection_schema=_connection_schema(OPENCLAW_GATEWAY_TRANSPORT),
            # OpenClaw's Gateway derives the native agent id from the name.
            # Do not present an editable id that the Gateway cannot honor.
            creation_schema=_creation_schema(model_field=True, include_native_id=False),
            settings_schema={
                "version": 1,
                "configKey": "openclaw",
                "sections": [
                    {
                        "id": "connection",
                        "label": "Connection",
                        "fields": [
                            _field("homePath", "OpenClaw home", "path", required=True),
                            _endpoint_mode_field(),
                            _field("gatewayUrl", "Preferred or custom Gateway WebSocket URL", "url", required=True, placeholder="ws://host.docker.internal:18789"),
                            _field("gatewayHttp", "Gateway HTTP URL", "url", placeholder="http://127.0.0.1:18789"),
                            _field("gatewayToken", "Gateway token", "secret", secret=True, placeholder="Keep existing token"),
                        ],
                    },
                    {
                        "id": "models",
                        "label": "Models",
                        "description": "OpenClaw model providers and per-agent model choices continue to use the full native model editor.",
                        "fields": [
                            _field("nativeModelEditor", "Open native model editor", "link", href="/models.html#openclaw", actionLabel="Manage OpenClaw models"),
                        ],
                    },
                    _session_settings(),
                ],
            },
            resource_schema=[
                {"id": "instructions", "label": "Standing instructions", "paths": ["AGENTS.md"], "runtimeActive": True, "writable": True},
                {"id": "soul", "label": "Soul and personality", "paths": ["SOUL.md"], "runtimeActive": True, "writable": True},
                {"id": "identity", "label": "Identity", "paths": ["IDENTITY.md"], "runtimeActive": True, "writable": True},
                {"id": "user", "label": "User context", "paths": ["USER.md"], "runtimeActive": True, "writable": True},
                {"id": "tools", "label": "Tool notes", "paths": ["TOOLS.md"], "runtimeActive": True, "writable": True},
                {"id": "memory", "label": "Long-term memory", "paths": ["MEMORY.md", "memory/*.md"], "runtimeActive": True, "writable": True},
                {"id": "heartbeat", "label": "Heartbeat", "paths": ["HEARTBEAT.md"], "runtimeActive": True, "writable": True},
                {"id": "skills", "label": "Skills", "paths": ["skills/**/SKILL.md"], "runtimeActive": True, "writable": True},
                SAFE_DOCUMENT_RESOURCE,
            ],
            skill_schema=_skill_root("skills", "OpenClaw workspace skills", shared_roots=["$OPENCLAW_HOME/skills"]),
            metadata={"skillsPath": "skills", "configKey": "openclaw"},
        )

    def test(self) -> dict[str, Any]:
        config = os.path.join(self.home_path, "openclaw.json")
        gateway_test = self.context.get("gatewayTest")
        if callable(gateway_test):
            try:
                result = gateway_test((self.context.get("config") or {}).get("openclaw") or {})
            except TypeError:
                result = gateway_test()
        else:
            result = {"ok": os.path.isfile(config)}
        result = dict(result or {})
        result.setdefault("ok", os.path.isfile(config))
        result.update({"homePath": self.home_path, "configPath": config, "installed": os.path.isfile(config)})
        return result

    def discover_agents(self) -> list[dict[str, Any]]:
        config_path = os.path.join(self.home_path, "openclaw.json")
        agents_dir = os.path.join(self.home_path, "agents")
        rows: list[dict[str, Any]] = []
        configured: list[dict[str, Any]] = []
        try:
            with open(config_path, "r", encoding="utf-8") as handle:
                configured = (json.load(handle).get("agents") or {}).get("list") or []
        except Exception:
            configured = []
        if not configured and os.path.isdir(agents_dir):
            configured = [{"id": item} for item in sorted(os.listdir(agents_dir)) if os.path.isdir(os.path.join(agents_dir, item, "sessions"))]
        for raw in configured:
            if not isinstance(raw, dict):
                continue
            agent_id = str(raw.get("id") or "").strip()
            if not agent_id:
                continue
            workspace = self._local_workspace(str(raw.get("workspace") or (
                os.path.join(self.home_path, "workspace") if agent_id == "main"
                else os.path.join(self.home_path, f"workspace-{agent_id}")
            )))
            identity = self._identity(workspace)
            rows.append({
                "id": agent_id,
                "statusKey": agent_id,
                "providerAgentId": agent_id,
                "profile": agent_id,
                "name": identity.get("name") or ("Main Agent" if agent_id == "main" else agent_id.replace("-", " ").title()),
                "emoji": identity.get("emoji") or "🤖",
                "role": identity.get("role") or "",
                "model": raw.get("model") or "",
                "workspace": workspace,
                "lastActiveAt": self._last_active(os.path.join(agents_dir, agent_id, "sessions")),
            })
        return rows

    def _local_workspace(self, workspace: str) -> str:
        """Translate a Gateway/host workspace path into the mounted path."""
        mapped = map_host_path_to_container(
            workspace,
            host_root=self.gateway_home_path,
            container_root=self.home_path,
        )
        # Windows paths that are not under the configured/mounted OpenClaw
        # root are intentionally unavailable inside the Linux container.
        if is_windows_absolute(workspace) and not mapped:
            return ""
        return mapped

    def create_agent(self, **body: Any) -> dict[str, Any]:
        callback = self.context.get("openclawCreate")
        if not callable(callback):
            return {"ok": False, "error": "OpenClaw create service is unavailable"}
        return callback(body)

    def delete_agent(self, profile: str) -> dict[str, Any]:
        callback = self.context.get("openclawDelete")
        if not callable(callback):
            return {"ok": False, "error": "OpenClaw delete service is unavailable"}
        return callback(profile)

    def send_chat_message(self, profile: str, message: str, **kwargs: Any) -> dict[str, Any]:
        callback = self.context.get("openclawSend")
        if not callable(callback):
            return {"ok": False, "error": "OpenClaw chat service is unavailable"}
        return callback(profile, message, **kwargs)

    def list_sessions(self, profile: str, limit: int = 40) -> dict[str, Any]:
        callback = self.context.get("sessionList")
        if not callable(callback):
            return {"ok": False, "error": "OpenClaw session service is unavailable", "sessions": []}
        return callback(profile, limit=limit)

    def interrupt(self, profile: str) -> dict[str, Any]:
        callback = self.context.get("openclawInterrupt")
        if not callable(callback):
            return {"ok": False, "error": "OpenClaw interrupt service is unavailable"}
        return callback(profile)

    def pending_approval(self, profile: str) -> dict[str, Any]:
        callback = self.context.get("openclawApprovalPending")
        if callable(callback):
            return callback(profile)
        return {
            "ok": True,
            "pending": None,
            "pending_count": 0,
            "providerPath": "gateway-native",
            "message": "OpenClaw approvals are handled by the existing Gateway stream.",
        }

    def respond_approval(self, profile: str, approval_id: str, choice: str = "cancel") -> dict[str, Any]:
        callback = self.context.get("openclawApprovalRespond")
        if callable(callback):
            return callback(profile, approval_id, choice)
        return {
            "ok": False,
            "code": "native_transport_required",
            "error": "OpenClaw approval responses use the existing browser-to-Gateway stream.",
        }

    def update_profile(self, profile: str, patch: dict[str, Any]) -> dict[str, Any]:
        agent = next((row for row in self.discover_agents() if row.get("providerAgentId") == profile), None)
        if not agent:
            return {"ok": False, "error": f"OpenClaw agent '{profile}' was not found"}
        workspace = str(agent.get("workspace") or "")
        changed = []
        backup_id, backups = backup_files(workspace, [
            os.path.join(workspace, "IDENTITY.md"),
            os.path.join(workspace, "AGENTS.md"),
        ])
        if _update_identity_file(os.path.join(workspace, "IDENTITY.md"), patch):
            changed.append("IDENTITY.md")
        if "instructions" in patch:
            _atomic_text(os.path.join(workspace, "AGENTS.md"), str(patch.get("instructions") or ""))
            changed.append("AGENTS.md")
        return {"ok": True, "profile": profile, "changed": changed, "backupId": backup_id, "backups": backups}

    @staticmethod
    def _identity(workspace: str) -> dict[str, str]:
        result = {"name": "", "emoji": "", "role": ""}
        if not workspace:
            return result
        try:
            text = Path(workspace, "IDENTITY.md").read_text(encoding="utf-8", errors="replace")
        except OSError:
            return result
        for key in result:
            match = re.search(rf"\*\*{key.title()}:\*\*\s*(.+)", text, re.I)
            if match:
                result[key] = match.group(1).strip()
        return result

    @staticmethod
    def _last_active(path: str) -> int:
        newest = 0
        try:
            for item in Path(path).glob("*.jsonl"):
                newest = max(newest, int(item.stat().st_mtime))
        except OSError:
            pass
        return newest


class NativeOfficeProvider:
    """Attach a manifest to an existing native provider implementation."""

    def __init__(self, native: Any, manifest: ProviderManifest, context: dict[str, Any] | None = None) -> None:
        self.native = native
        self.manifest = manifest
        self.context = context or {}
        self.provider_kind = manifest.id
        self.provider_type = manifest.provider_type

    def __getattr__(self, name: str) -> Any:
        return getattr(self.native, name)

    def test(self) -> dict[str, Any]:
        return self.native.test()

    def discover_agents(self) -> list[dict[str, Any]]:
        return self.native.discover_agents()

    def create_agent(self, **body: Any) -> dict[str, Any]:
        name = str(body.get("name") or "").strip()
        kwargs = {
            "name": name,
            "role": body.get("role") or self.manifest.name + " Agent",
            "model": body.get("model") or "",
            "emoji": body.get("emoji") or self.manifest.icon,
            "profile": body.get("id") or body.get("profile") or name,
            "prompt": body.get("instructions") or body.get("prompt") or body.get("systemPrompt") or body.get("role") or "",
            "creation_mode": body.get("creationMode") or "standard",
            "custom_directory": body.get("customDirectory") or "",
        }
        try:
            return self.native.create_agent(**kwargs)
        except TypeError:
            kwargs.pop("creation_mode", None)
            kwargs.pop("custom_directory", None)
            try:
                return self.native.create_agent(**kwargs)
            except TypeError:
                kwargs.pop("prompt", None)
                return self.native.create_agent(**kwargs)

    def delete_agent(self, profile: str) -> dict[str, Any]:
        return self.native.delete_agent(profile)

    def send_chat_message(self, profile: str, message: str, **kwargs: Any) -> dict[str, Any]:
        kwargs.pop("agent", None)
        message, kwargs = self._prepare_native_chat(message, kwargs)
        return self.native.send_chat_message(profile, message, **kwargs)

    def _prepare_native_chat(self, message: str, kwargs: dict[str, Any]) -> tuple[str, dict[str, Any]]:
        """Adapt canonical file attachments to each native chat signature."""
        kwargs = dict(kwargs)
        files = [str(path) for path in (kwargs.get("files") or []) if str(path)]
        native_chat = getattr(self.native, "send_chat_message")
        try:
            parameters = inspect.signature(native_chat).parameters.values()
            accepts_files = any(item.name == "files" for item in parameters) or any(
                item.kind == inspect.Parameter.VAR_KEYWORD for item in parameters
            )
        except (TypeError, ValueError):
            accepts_files = False
        if files and not accepts_files:
            kwargs.pop("files", None)
            message = (
                f"{message}\n\n"
                "Files attached through My Virtual World are available at these paths:\n"
                + "\n".join(f"- {path}" for path in files)
                + "\nUse your native file tools to inspect them."
            )
        return message, kwargs

    def list_sessions(self, profile: str, limit: int = 40) -> dict[str, Any]:
        native_list = getattr(self.native, "list_sessions", None)
        if callable(native_list):
            return native_list(profile, limit=limit)
        callback = self.context.get("sessionList")
        if callable(callback):
            return callback(profile, limit=limit)
        return {"ok": False, "error": f"{self.manifest.name} session service is unavailable", "sessions": []}

    def interrupt(self, profile: str) -> dict[str, Any]:
        native_interrupt = getattr(self.native, "interrupt", None)
        if callable(native_interrupt):
            return native_interrupt(profile)
        callback = self.context.get("providerInterrupt")
        if callable(callback):
            return callback(self.manifest.id, profile)
        return {"ok": False, "error": f"{self.manifest.name} interrupt service is unavailable"}

    def update_profile(self, profile: str, patch: dict[str, Any]) -> dict[str, Any]:
        native_update = getattr(self.native, "update_profile", None)
        if callable(native_update):
            return native_update(profile, patch)
        agent = next((row for row in self.native.discover_agents() if str(row.get("providerAgentId") or row.get("profile")) == str(profile)), None)
        if not agent:
            return {"ok": False, "error": f"{self.manifest.name} agent '{profile}' was not found"}
        workspace = str(agent.get("workspace") or agent.get("home") or "")
        if not workspace:
            return {"ok": False, "error": "This provider connection does not expose editable native profile files"}
        changed = []
        backup_id, backups = backup_files(workspace, [
            os.path.join(workspace, "IDENTITY.md"),
            os.path.join(workspace, "AGENTS.md"),
            os.path.join(workspace, "world-agent.json"),
            os.path.join(workspace, "opencode-agent.json"),
            os.path.join(workspace, "antigravity-agent.json"),
        ])
        if _update_identity_file(os.path.join(workspace, "IDENTITY.md"), patch):
            changed.append("IDENTITY.md")
        for filename in ("world-agent.json", "opencode-agent.json", "antigravity-agent.json"):
            path = os.path.join(workspace, filename)
            if not os.path.isfile(path):
                continue
            try:
                data = json.loads(Path(path).read_text(encoding="utf-8"))
            except Exception:
                continue
            if not isinstance(data, dict):
                continue
            for key in ("name", "role", "emoji", "model"):
                if key in patch:
                    data[key] = patch.get(key)
            _atomic_text(path, json.dumps(data, indent=2) + "\n")
            changed.append(filename)
        if "instructions" in patch:
            _atomic_text(os.path.join(workspace, "AGENTS.md"), str(patch.get("instructions") or ""))
            changed.append("AGENTS.md")
        return {"ok": True, "profile": profile, "changed": changed, "backupId": backup_id, "backups": backups}


class HermesOfficeProvider(NativeOfficeProvider):
    def __init__(self, native: HermesProvider, context: dict[str, Any], manifest: ProviderManifest) -> None:
        super().__init__(native, manifest, context)
        self.context = context

    def discover_agents(self) -> list[dict[str, Any]]:
        callback = self.context.get("hermesDiscover")
        rows = callback() if callable(callback) else self.native.discover_agents()
        rows = rows if isinstance(rows, list) else []
        for item in rows:
            local_workspace = bool(item.get("workspace") or item.get("home"))
            overrides = dict(item.get("capabilityOverrides") or {})
            # A mounted Linux profile retains the full local resource surface.
            # API-only rows arrive with capability-negotiated remote flags and
            # must not regain CLI/filesystem writes from the global manifest.
            if local_workspace:
                overrides.update({
                    "profileEdit": True,
                    "resourcesRead": True,
                    "resourcesWrite": True,
                    "skills": True,
                    "agentDelete": True,
                })
            else:
                overrides.setdefault("profileEdit", False)
                overrides.setdefault("resourcesRead", False)
                overrides.setdefault("resourcesWrite", False)
                overrides.setdefault("skills", False)
                overrides.setdefault("agentDelete", False)
                overrides.setdefault("agentCreate", False)
            item["capabilityOverrides"] = overrides
        return rows

    def test(self) -> dict[str, Any]:
        connection_test = self.context.get("hermesConnectionTest")
        api_result = connection_test((self.context.get("config") or {}).get("hermes") or {}) if callable(connection_test) else {"ok": False}
        native_result = self.native.test()
        if native_result.get("ok"):
            native_result.setdefault("transport", "cli")
            if api_result.get("ok"):
                native_result["transport"] = "cli+api"
                native_result["message"] = api_result.get("message") or "Hermes CLI and API are connected"
                native_result["endpointMode"] = api_result.get("endpointMode") or "auto"
                native_result["endpointLocation"] = api_result.get("endpointLocation") or ""
            return native_result
        if api_result.get("ok"):
            return api_result
        # A connection test may contain unsaved endpoint/authentication values.
        # Never replace its failure with agents discovered through the global
        # saved configuration; that would report a wrong key or explicit
        # container/custom mode as healthy via a different endpoint.
        if callable(connection_test):
            return api_result
        rows = self.discover_agents()
        api_agents = [row for row in rows if row.get("apiAvailable")]
        if api_agents:
            return {
                "ok": True,
                "transport": "api",
                "agents": api_agents,
                "message": f"Connected to {len(api_agents)} Hermes API agent(s)",
            }
        if api_result.get("error"):
            return api_result
        return native_result

    def send_chat_message(self, profile: str, message: str, **kwargs: Any) -> dict[str, Any]:
        """Route API-connected Hermes agents through their native API transport.

        Local Hermes profiles continue to use the Hermes CLI provider.  This
        decision belongs here, not in the My Virtual World server.
        """
        agent = kwargs.pop("agent", None)
        message, kwargs = self._prepare_native_chat(message, kwargs)
        connection_modes = set((agent or {}).get("connectionModes") or [])
        callback = self.context.get("hermesSend")
        if callable(callback):
            return callback(agent or {"profile": profile}, message, **kwargs)
        return self.native.send_chat_message(profile, message, **kwargs)

    def interrupt(self, profile: str) -> dict[str, Any]:
        callback = self.context.get("hermesInterrupt")
        if callable(callback):
            return callback(profile)
        return super().interrupt(profile)

    def pending_approval(self, profile: str) -> dict[str, Any]:
        callback = self.context.get("hermesApprovalPending")
        if callable(callback):
            return callback(profile)
        return {"ok": True, "pending": None, "pending_count": 0}

    def respond_approval(self, profile: str, approval_id: str, choice: str = "deny", **kwargs: Any) -> dict[str, Any]:
        callback = self.context.get("hermesApprovalRespond")
        if callable(callback):
            return callback(profile, approval_id, choice, **kwargs)
        return {"ok": False, "error": "Hermes approval service is unavailable"}


def _manifest(
    provider_id: str,
    name: str,
    icon: str,
    description: str,
    capabilities: dict[str, bool],
    resource_schema: list[dict[str, Any]],
    skill_schema: list[dict[str, Any]] | None = None,
    directory_modes: bool = True,
    provider_type: str = "harness",
    metadata: dict[str, Any] | None = None,
    settings_schema: dict[str, Any] | None = None,
    connection_schema: dict[str, Any] | None = None,
) -> ProviderManifest:
    normalized_metadata = dict(metadata or {})
    normalized_metadata.setdefault("configKey", provider_id)
    return ProviderManifest(
        id=provider_id,
        name=name,
        icon=icon,
        description=description,
        provider_type=provider_type,
        capabilities=capabilities,
        connection_schema=connection_schema or _connection_schema(_process_transport(f"{name} CLI")),
        creation_schema=_creation_schema(model_field=True, directory_modes=directory_modes),
        settings_schema=settings_schema or {},
        resource_schema=resource_schema,
        skill_schema=list(skill_schema or []),
        metadata=normalized_metadata,
    )


def build_provider_registry(context: dict[str, Any]) -> ProviderRegistry:
    cfg = context.get("config") or {}
    registry = ProviderRegistry(context)
    registry.register(OpenClawOfficeProvider(context))

    hermes_cfg = cfg.get("hermes") or {}
    hermes_native = HermesProvider(
        home_path=hermes_cfg.get("homePath") or os.environ.get("VW_HERMES_HOME"),
        binary=hermes_cfg.get("binary") or os.environ.get("VW_HERMES_BIN"),
        enabled=bool(hermes_cfg.get("enabled", True) and hermes_cfg.get("localProfilesEnabled", True)),
        timeout_sec=int(hermes_cfg.get("timeoutSec") or 600),
    )
    registry.register(HermesOfficeProvider(
        hermes_native,
        context,
        _manifest(
            "hermes", "Hermes", "⚕️",
            "Hermes native profiles and authenticated API connections.",
            {
                "discover": True, "health": True, "chat": True, "streaming": True,
                "sessions": True, "sessionCreate": True, "sessionDelete": True, "sessionSwitch": True,
                "interrupt": True, "approvals": True, "agentCreate": bool(hermes_cfg.get("enabled", True) and hermes_cfg.get("localProfilesEnabled", True)),
                "agentDelete": bool(hermes_cfg.get("enabled", True) and hermes_cfg.get("localProfilesEnabled", True)), "profileEdit": bool(hermes_cfg.get("enabled", True) and hermes_cfg.get("localProfilesEnabled", True)),
                "resourcesRead": bool(hermes_cfg.get("enabled", True) and hermes_cfg.get("localProfilesEnabled", True)), "resourcesWrite": bool(hermes_cfg.get("enabled", True) and hermes_cfg.get("localProfilesEnabled", True)),
                "skills": bool(hermes_cfg.get("enabled", True) and hermes_cfg.get("localProfilesEnabled", True)), "models": True, "projects": True, "meetings": True,
                "agentToAgent": True, "attachments": True, "tools": True,
            },
            [
                {"id": "soul", "label": "Soul and personality", "paths": ["SOUL.md"], "runtimeActive": True, "writable": True},
                {"id": "identity", "label": "Identity", "paths": ["IDENTITY.md"], "runtimeActive": True, "writable": True},
                {
                    "id": "config", "label": "Hermes configuration", "paths": ["config.yaml", "auth.json", ".env"],
                    "runtimeActive": True, "readable": False, "writable": False, "sensitive": True,
                    "managedBy": "Connections", "description": "Hidden because this file can contain credentials.",
                },
                {"id": "workspace", "label": "Workspace documents", "paths": ["workspace/**/*.md", "workspace/**/*.txt"], "runtimeActive": True, "writable": True, "deletable": True},
                {"id": "skills", "label": "Hermes profile skills", "paths": ["skills/**/SKILL.md"], "runtimeActive": True, "writable": True, "deletable": False},
            ],
            skill_schema=_skill_root("skills", "Hermes profile skills"),
            directory_modes=False,
            provider_type="runtime",
            connection_schema=_connection_schema(
                HERMES_API_TRANSPORT,
                _process_transport("Hermes CLI"),
            ),
            settings_schema={
                "version": 1,
                "configKey": "hermes",
                "sections": [
                    {
                        "id": "connection",
                        "label": "Connections",
                        "fields": [
                            _field("enabled", "Enabled", "boolean", default=True),
                            _endpoint_mode_field("apiEndpointMode", "Default API endpoint location"),
                            _field("apiUrl", "Preferred or custom default API URL", "url", placeholder="http://host.docker.internal:8642"),
                            _field("apiKey", "Default API key", "secret", secret=True, placeholder="Keep existing key"),
                            _field(
                                "preferApi",
                                "Use API discovery and runtime features",
                                "boolean",
                                default=True,
                                help="Discovers profile/model identity, sessions, skills, runs, approvals, and cancellation through the authenticated Hermes API before using a local Linux CLI.",
                            ),
                            _field(
                                "connections",
                                "Native Hermes gateways",
                                "connection-list",
                                minItems=0,
                                maxItems=20,
                                itemLabel="Hermes connection",
                                itemFields=[
                                    _field("id", "Connection ID", "slug", required=True),
                                    _field("name", "Display name", "text", required=True),
                                    _endpoint_mode_field("endpointMode", "Endpoint location"),
                                    _field("apiUrl", "Preferred or custom API URL", "url", required=True, placeholder="http://host.docker.internal:8642"),
                                    _field("apiKey", "API key", "secret", secret=True, placeholder="Keep existing key"),
                                    _field("emoji", "Emoji", "text", default="⚕️"),
                                    _field("role", "Role", "text", default="Hermes Agent"),
                                    _field("enabled", "Enabled", "boolean", default=True),
                                ],
                            ),
                            _field("localProfilesEnabled", "Discover local Hermes profiles", "boolean", default=True),
                            _field("homePath", "Local Hermes home", "path"),
                            _field("binary", "Local Hermes executable", "path"),
                            _field("timeoutSec", "Turn timeout", "number", default=600, min=30, max=7200, step=30, suffix="seconds"),
                        ],
                    },
                    {
                        "id": "models",
                        "label": "Models",
                        "description": "Hermes models belong to native profiles and are edited through the native model editor.",
                        "fields": [
                            _field("nativeModelEditor", "Open native model editor", "link", href="/models.html#hermes", actionLabel="Manage Hermes profile models"),
                        ],
                    },
                    _session_settings(),
                ],
            },
        ),
    ))

    codex_cfg = cfg.get("codex") or {}
    codex = CodexProvider(
        home_path=codex_cfg.get("homePath"),
        binary=codex_cfg.get("binary"),
        workspace_root=codex_cfg.get("workspaceRoot"),
        enabled=codex_cfg.get("enabled", True),
        timeout_sec=int(codex_cfg.get("timeoutSec") or 900),
        model=codex_cfg.get("model") or "",
        sandbox=codex_cfg.get("sandbox") or "workspace-write",
        approval_policy=codex_cfg.get("approvalPolicy") or "never",
        prefer_app_server=codex_cfg.get("preferAppServer", True),
        main_workspace=codex_cfg.get("mainWorkspace"),
        include_main=codex_cfg.get("includeMain", True),
        include_native_agents=codex_cfg.get("includeNativeAgents", True),
        register_native_agents=codex_cfg.get("registerNativeAgents", True),
    )
    registry.register(NativeOfficeProvider(
        codex,
        _manifest(
            "codex", "Codex CLI", "⌨️", "Codex App Server and CLI workspaces.",
            {
                "discover": True, "health": True, "chat": True, "streaming": True, "sessions": True,
                "sessionCreate": True, "sessionDelete": True, "sessionSwitch": True, "interrupt": True,
                "approvals": True, "agentCreate": True, "agentDelete": True, "profileEdit": True,
                "resourcesRead": True, "resourcesWrite": True, "skills": True, "models": True,
                "projects": True, "meetings": True, "agentToAgent": True, "attachments": True, "tools": True,
            },
            COMMON_RESOURCE_SCHEMA + [
                {"id": "nativeAgent", "label": "Native agent definition", "paths": [".codex/agents/*.toml"], "runtimeActive": True, "writable": True},
                {"id": "config", "label": "Managed Codex configuration", "paths": [".codex/config.toml"], "runtimeActive": True, "writable": False, "generated": True, "managedBy": "Connections"},
                {"id": "skills", "label": "Codex project skills", "paths": [".agents/skills/**/SKILL.md"], "runtimeActive": True, "writable": True, "deletable": False},
                SAFE_DOCUMENT_RESOURCE,
            ],
            skill_schema=_skill_root(
                ".agents/skills", "Codex project skills",
                shared_roots=["$HOME/.agents/skills", "/etc/codex/skills"],
            ),
            settings_schema=_cli_settings_schema(
                provider_id="codex",
                permission_fields=[
                    _field("sandbox", "Sandbox", "select", default="workspace-write", options=[
                        {"value": "read-only", "label": "Read only"},
                        {"value": "workspace-write", "label": "Workspace write"},
                        {"value": "danger-full-access", "label": "Full access"},
                    ]),
                    _field("approvalPolicy", "Approval policy", "select", default="never", options=[
                        {"value": "untrusted", "label": "Untrusted"},
                        {"value": "on-request", "label": "On request"},
                        {"value": "on-failure", "label": "On failure"},
                        {"value": "never", "label": "Never"},
                    ]),
                    _field("preferAppServer", "Prefer Codex app-server", "boolean", default=True),
                ],
                discovery_fields=[
                    _field("includeMain", "Include main agent", "boolean", default=True),
                    _field("includeNativeAgents", "Discover native agents", "boolean", default=True),
                    _field("registerNativeAgents", "Register created agents natively", "boolean", default=True),
                ],
            ),
        ),
        context,
    ))

    claude_cfg = cfg.get("claudeCode") or {}
    claude = ClaudeCodeProvider(
        home_path=claude_cfg.get("homePath"),
        binary=claude_cfg.get("binary"),
        workspace_root=claude_cfg.get("workspaceRoot"),
        enabled=claude_cfg.get("enabled", True),
        timeout_sec=int(claude_cfg.get("timeoutSec") or 900),
        model=claude_cfg.get("model") or "",
        permission_mode=claude_cfg.get("permissionMode") or "acceptEdits",
        main_workspace=claude_cfg.get("mainWorkspace"),
        include_main=claude_cfg.get("includeMain", True),
        include_native_agents=claude_cfg.get("includeNativeAgents", True),
        register_native_agents=claude_cfg.get("registerNativeAgents", True),
    )
    registry.register(NativeOfficeProvider(
        claude,
        _manifest(
            "claude-code", "Claude Code", "🟣", "Claude Code CLI workspaces and native agent files.",
            {
                "discover": True, "health": True, "chat": True, "streaming": True, "sessions": True,
                "sessionCreate": True, "sessionDelete": True, "sessionSwitch": True, "interrupt": True,
                "approvals": False, "agentCreate": True, "agentDelete": True, "profileEdit": True,
                "resourcesRead": True, "resourcesWrite": True, "skills": True, "models": True,
                "projects": True, "meetings": True, "agentToAgent": True, "attachments": True, "tools": True,
            },
            OFFICE_ONLY_RESOURCE_SCHEMA + [
                {"id": "claude", "label": "Claude instructions", "paths": ["CLAUDE.md"], "runtimeActive": True, "writable": True},
                {"id": "nativeAgent", "label": "Native agent definition", "paths": [".claude/agents/*.md"], "runtimeActive": True, "writable": True},
                {"id": "skills", "label": "Claude Code project skills", "paths": [".claude/skills/**/SKILL.md"], "runtimeActive": True, "writable": True, "deletable": False},
                SAFE_DOCUMENT_RESOURCE,
            ],
            skill_schema=_skill_root(".claude/skills", "Claude Code project skills", shared_roots=["$HOME/.claude/skills"]),
            settings_schema=_cli_settings_schema(
                provider_id="claude-code",
                config_key="claudeCode",
                display_name="Claude Code",
                permission_fields=[
                    _field("permissionMode", "Permission mode", "select", default="acceptEdits", options=[
                        {"value": "default", "label": "Default"},
                        {"value": "acceptEdits", "label": "Accept edits"},
                        {"value": "plan", "label": "Plan"},
                        {"value": "bypassPermissions", "label": "Bypass permissions"},
                    ]),
                ],
                discovery_fields=[
                    _field("includeMain", "Include main agent", "boolean", default=True),
                    _field("includeNativeAgents", "Discover native agents", "boolean", default=True),
                    _field("registerNativeAgents", "Register created agents natively", "boolean", default=True),
                ],
            ),
        ),
        context,
    ))

    opencode_cfg = cfg.get("openCode") or cfg.get("opencode") or {}
    if OpenCodeProvider is not None:
        opencode = OpenCodeProvider(
            home_path=opencode_cfg.get("homePath"),
            binary=opencode_cfg.get("binary"),
            workspace_root=opencode_cfg.get("workspaceRoot"),
            enabled=opencode_cfg.get("enabled", False),
            timeout_sec=int(opencode_cfg.get("timeoutSec") or 900),
            model=opencode_cfg.get("model") or "",
            main_workspace=opencode_cfg.get("mainWorkspace"),
            include_main=opencode_cfg.get("includeMain", True),
            include_agents=opencode_cfg.get("includeAgents", True),
            register_agents=opencode_cfg.get("registerAgents", True),
        )
        registry.register(NativeOfficeProvider(
            opencode,
            _manifest(
                "opencode", "OpenCode", "⚡", "OpenCode CLI agents, workspaces, tools, and persistent sessions.",
                {
                    "discover": True, "health": True, "chat": True, "streaming": True, "sessions": True,
                    "sessionCreate": True, "sessionDelete": True, "sessionSwitch": True, "interrupt": True,
                    "approvals": False, "agentCreate": True, "agentDelete": True, "profileEdit": True,
                    "resourcesRead": True, "resourcesWrite": True, "skills": True, "models": True,
                    "projects": True, "meetings": True, "agentToAgent": True, "attachments": True, "tools": True,
                },
                COMMON_RESOURCE_SCHEMA + [
                    {"id": "nativeAgent", "label": "OpenCode agent definition", "paths": [".opencode/agents/*.md"], "runtimeActive": True, "writable": True},
                    {"id": "skills", "label": "OpenCode project skills", "paths": [".opencode/skills/**/SKILL.md"], "runtimeActive": True, "writable": True, "deletable": False},
                    SAFE_DOCUMENT_RESOURCE,
                ],
                skill_schema=_skill_root(".opencode/skills", "OpenCode project skills", shared_roots=["$HOME/.config/opencode/skills"]),
                metadata={"skillsPath": ".opencode/skills"},
                settings_schema=_cli_settings_schema(
                    provider_id="opencode",
                    config_key="openCode",
                    display_name="OpenCode",
                    discovery_fields=[
                        _field("includeMain", "Include main agent", "boolean", default=True),
                        _field("includeAgents", "Discover native and managed agents", "boolean", default=True),
                        _field("registerAgents", "Register created agents natively", "boolean", default=True),
                    ],
                ),
            ),
            context,
        ))

    antigravity_cfg = cfg.get("antigravity") or {}
    if AntigravityProvider is not None:
        antigravity = AntigravityProvider(
            home_path=antigravity_cfg.get("homePath"),
            binary=antigravity_cfg.get("binary"),
            workspace_root=antigravity_cfg.get("workspaceRoot"),
            enabled=antigravity_cfg.get("enabled", False),
            timeout_sec=int(antigravity_cfg.get("timeoutSec") or 600),
            print_timeout=antigravity_cfg.get("printTimeout") or "5m",
            model=antigravity_cfg.get("model") or "",
            sandbox=antigravity_cfg.get("sandbox") or "",
        )
        registry.register(NativeOfficeProvider(
            antigravity,
            _manifest(
                "antigravity", "Antigravity", "🌌", "Google Antigravity CLI custom agents and workspaces.",
                {
                    "discover": True, "health": True, "chat": True, "streaming": False, "sessions": False,
                    "sessionCreate": False, "sessionDelete": False, "sessionSwitch": False, "interrupt": True,
                    "approvals": False, "agentCreate": True, "agentDelete": True, "profileEdit": True,
                    "resourcesRead": True, "resourcesWrite": True, "skills": True, "models": True,
                    "projects": True, "meetings": True, "agentToAgent": True, "attachments": False, "tools": False,
                },
                OFFICE_ONLY_RESOURCE_SCHEMA + [
                    {"id": "gemini", "label": "Gemini instructions", "paths": ["GEMINI.md"], "runtimeActive": True, "writable": True},
                    {"id": "nativeAgent", "label": "Antigravity agent definition", "paths": [".agents/agents/*/agent.md"], "runtimeActive": True, "writable": True},
                    {"id": "skills", "label": "Antigravity project skills", "paths": [".agents/skills/**/SKILL.md"], "runtimeActive": True, "writable": True, "deletable": False},
                    SAFE_DOCUMENT_RESOURCE,
                ],
                skill_schema=_skill_root(".agents/skills", "Antigravity project skills"),
                metadata={"skillsPath": ".agents/skills"},
                settings_schema=_cli_settings_schema(
                    provider_id="antigravity",
                    permission_fields=[
                        _field("sandbox", "Sandbox", "text", placeholder="Use native default"),
                        _field("printTimeout", "Native print timeout", "text", default="5m"),
                    ],
                    include_sessions=False,
                    include_main_workspace=False,
                ),
            ),
            context,
        ))

    default_extension_dir = os.path.join(str(context.get("statusDir") or "/data"), "provider-extensions")
    configured = os.environ.get("VW_PROVIDER_EXTENSION_DIRS", "")
    extension_dirs = [default_extension_dir] + [item.strip() for item in configured.split(os.pathsep) if item.strip()]
    registry.load_extensions(extension_dirs)
    return registry
