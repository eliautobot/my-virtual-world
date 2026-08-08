"""OpenCode provider for My Virtual World."""

from __future__ import annotations

import json
import os
import re
import shutil
import subprocess
import threading
import time
from dataclasses import dataclass
from pathlib import Path
from typing import Any

from .file_safety import backup_files
from .process_env import resolve_executable, sanitized_env


_ACTIVE: dict[str, subprocess.Popen[str]] = {}
_ACTIVE_LOCK = threading.Lock()


@dataclass
class OpenCodeProvider:
    home_path: str | None = None
    binary: str | None = None
    workspace_root: str | None = None
    enabled: bool = True
    timeout_sec: int = 900
    model: str = ""
    main_workspace: str | None = None
    include_main: bool = True
    include_agents: bool = True
    register_agents: bool = True

    provider_kind: str = "opencode"
    provider_type: str = "harness"

    def __post_init__(self) -> None:
        status_dir = os.environ.get("VW_STATUS_DIR", "/data")
        self.home_path = os.path.abspath(os.path.expanduser(
            self.home_path
            or os.environ.get("VW_OPENCODE_CONFIG_DIR")
            or os.environ.get("OPENCODE_CONFIG_DIR")
            or "~/.config/opencode"
        ))
        self.binary = resolve_executable(self.binary, "VW_OPENCODE_BIN", "opencode")
        self.workspace_root = os.path.abspath(os.path.expanduser(
            self.workspace_root or os.environ.get("VW_OPENCODE_WORKSPACE_ROOT") or os.path.join(status_dir, "opencode-agents")
        ))
        self.main_workspace = os.path.abspath(os.path.expanduser(
            self.main_workspace or os.environ.get("VW_OPENCODE_MAIN_WORKSPACE") or os.path.join(status_dir, "opencode-main")
        ))
        self.model = str(self.model or os.environ.get("VW_OPENCODE_MODEL") or "")

    def is_available(self) -> bool:
        return bool(self.enabled and self.binary and os.path.isfile(self.binary) and os.access(self.binary, os.X_OK))

    def test(self) -> dict[str, Any]:
        if not self.is_available():
            return {
                "ok": False,
                "enabled": self.enabled,
                "installed": bool(self.binary and os.path.isfile(self.binary)),
                "error": "OpenCode CLI is disabled or unavailable",
                "binary": self.binary,
                "homePath": self.home_path,
            }
        try:
            result = subprocess.run(
                [self.binary or "opencode", "--version"],
                capture_output=True,
                text=True,
                timeout=10,
                env=self._env(),
            )
            return {
                "ok": result.returncode == 0,
                "installed": True,
                "enabled": True,
                "version": (result.stdout or result.stderr or "").strip(),
                "binary": self.binary,
                "homePath": self.home_path,
                "workspaceRoot": self.workspace_root,
                "mainWorkspace": self.main_workspace,
                "error": "" if result.returncode == 0 else (result.stderr or result.stdout or "").strip(),
            }
        except Exception as exc:
            return {"ok": False, "installed": True, "enabled": True, "error": str(exc)}

    def discover_agents(self) -> list[dict[str, Any]]:
        if not self.is_available():
            return []
        agents: list[dict[str, Any]] = []
        seen: set[str] = set()
        if self.include_main:
            agents.append(self._entry("main", "OpenCode Main", "Default OpenCode agent", "⚡", self.main_workspace or "", "native-main"))
            seen.add("main")
        if not self.include_agents:
            return agents
        for root in self._registered_workspaces():
            meta = self._load_json(os.path.join(root, "opencode-agent.json"))
            profile = self._safe_profile(meta.get("profile") or os.path.basename(root))
            if not profile or profile in seen:
                continue
            agents.append(self._entry(
                profile,
                str(meta.get("name") or profile.replace("-", " ").title()),
                str(meta.get("role") or "OpenCode Agent"),
                str(meta.get("emoji") or "⚡"),
                root,
                "managed-workspace",
                str(meta.get("model") or self.model),
            ))
            seen.add(profile)
        native_dir = self._native_agents_dir()
        if os.path.isdir(native_dir):
            for path in sorted(Path(native_dir).glob("*.md")):
                profile = self._safe_profile(path.stem)
                if not profile or profile in seen:
                    continue
                meta = self._frontmatter(path)
                agents.append(self._entry(
                    profile,
                    str(meta.get("name") or profile.replace("-", " ").title()),
                    str(meta.get("description") or "OpenCode Agent"),
                    "⚡",
                    self._workspace_for(profile),
                    "native-agent",
                    str(meta.get("model") or self.model),
                ))
                seen.add(profile)
        return agents

    def create_agent(
        self,
        name: str,
        role: str = "OpenCode Agent",
        model: str | None = None,
        emoji: str = "⚡",
        profile: str | None = None,
        prompt: str | None = None,
        creation_mode: str = "standard",
        custom_directory: str | None = None,
    ) -> dict[str, Any]:
        if not self.is_available():
            return {"ok": False, "error": "OpenCode CLI is unavailable"}
        safe = self._safe_profile(profile or name)
        if not safe or safe == "main":
            return {"ok": False, "error": "A non-main OpenCode agent ID is required"}
        if any(item.get("providerAgentId") == safe for item in self.discover_agents()):
            return {"ok": False, "error": f"OpenCode agent '{safe}' already exists"}
        mode = creation_mode if creation_mode in {"standard", "custom"} else "standard"
        if mode == "custom":
            parent = os.path.abspath(os.path.expanduser(str(custom_directory or "")))
            if not custom_directory or parent.startswith(self._native_agents_dir() + os.sep):
                return {"ok": False, "error": "Choose a custom parent outside the OpenCode native agents directory"}
            workspace = os.path.join(parent, safe)
        else:
            workspace = os.path.join(self.workspace_root or "", safe)
        instructions = str(prompt or role or "OpenCode Agent").strip()
        model_value = str(model or self.model or "")
        native_path = os.path.join(self._native_agents_dir(), f"{safe}.md") if self.register_agents else ""
        project_path = os.path.join(workspace, ".opencode", "agents", f"{safe}.md")
        os.makedirs(os.path.join(workspace, ".opencode", "skills"), exist_ok=True)
        meta = {
            "profile": safe, "name": name, "role": role, "emoji": emoji, "model": model_value,
            "prompt": instructions, "providerKind": "opencode", "providerType": "harness",
            "creationMode": mode, "nativeAgentPath": native_path, "projectAgentPath": project_path,
            "createdAt": int(time.time()),
        }
        self._write_json(os.path.join(workspace, "opencode-agent.json"), meta)
        self._write_text(os.path.join(workspace, "IDENTITY.md"), self._identity(name, role, emoji))
        self._write_text(os.path.join(workspace, "AGENTS.md"), self._instructions(name, role, instructions))
        self._write_text(project_path, self._agent_md(safe, role, instructions, model_value))
        if native_path:
            self._write_text(native_path, self._agent_md(safe, role, instructions, model_value))
        self._save_registry(safe, workspace)
        return {
            "ok": True,
            "profile": safe,
            "agentId": f"opencode-{safe}",
            "workspace": workspace,
            "nativeAgentPath": native_path,
            "creationMode": mode,
            "message": f"OpenCode agent '{name}' created successfully",
        }

    def delete_agent(self, profile: str) -> dict[str, Any]:
        safe = self._safe_profile(profile)
        if not safe or safe == "main":
            return {"ok": False, "error": "The OpenCode main agent cannot be deleted"}
        registry = self._load_registry()
        workspace = str((registry.get("agents") or {}).get(safe) or os.path.join(self.workspace_root or "", safe))
        meta = self._load_json(os.path.join(workspace, "opencode-agent.json"))
        if meta.get("providerKind") != "opencode" or meta.get("profile") != safe:
            return {"ok": False, "error": "Refusing to delete an unowned OpenCode directory"}
        shutil.rmtree(workspace)
        native = str(meta.get("nativeAgentPath") or os.path.join(self._native_agents_dir(), f"{safe}.md"))
        if os.path.isfile(native) and os.path.abspath(native).startswith(os.path.abspath(self._native_agents_dir()) + os.sep):
            os.remove(native)
        agents = registry.get("agents") if isinstance(registry.get("agents"), dict) else {}
        agents.pop(safe, None)
        registry["agents"] = agents
        self._write_json(self._registry_path(), registry)
        return {"ok": True, "deleted": True, "profile": safe, "agentId": f"opencode-{safe}"}

    def update_profile(self, profile: str, patch: dict[str, Any]) -> dict[str, Any]:
        safe = self._safe_profile(profile)
        workspace = self._workspace_for(safe)
        meta_path = os.path.join(workspace, "opencode-agent.json")
        meta = self._load_json(meta_path)
        if not meta or meta.get("profile") != safe:
            return {"ok": False, "error": f"Managed OpenCode agent '{safe}' was not found"}
        for key in ("name", "role", "emoji", "model"):
            if key in patch:
                meta[key] = str(patch.get(key) or "")
        if "instructions" in patch:
            meta["prompt"] = str(patch.get("instructions") or "")
        name = str(meta.get("name") or safe.replace("-", " ").title())
        role = str(meta.get("role") or "OpenCode Agent")
        emoji = str(meta.get("emoji") or "⚡")
        model = str(meta.get("model") or self.model or "")
        prompt = str(meta.get("prompt") or role)
        native_path = str(meta.get("nativeAgentPath") or "")
        project_path = str(meta.get("projectAgentPath") or os.path.join(workspace, ".opencode", "agents", f"{safe}.md"))
        paths = [meta_path, os.path.join(workspace, "IDENTITY.md"), os.path.join(workspace, "AGENTS.md"), project_path, native_path]
        backup_id, backups = backup_files(workspace, paths)
        self._write_json(meta_path, meta)
        self._write_text(os.path.join(workspace, "IDENTITY.md"), self._identity(name, role, emoji))
        self._write_text(os.path.join(workspace, "AGENTS.md"), self._instructions(name, role, prompt))
        self._write_text(project_path, self._agent_md(safe, role, prompt, model))
        if native_path:
            self._write_text(native_path, self._agent_md(safe, role, prompt, model))
        return {"ok": True, "profile": safe, "backupId": backup_id, "backups": backups}

    def send_chat_message(
        self,
        profile: str,
        message: str,
        session_id: str | None = None,
        timeout_sec: int | None = None,
        on_progress: Any = None,
        files: list[str] | None = None,
        auto_approve: bool = False,
    ) -> dict[str, Any]:
        if not self.is_available():
            return {"ok": False, "error": "OpenCode CLI unavailable", "reply": "", "sessionId": session_id or ""}
        safe = self._safe_profile(profile or "main")
        cmd = [self.binary or "opencode", "run", "--format", "json"]
        if safe != "main":
            cmd.extend(["--agent", safe])
        if session_id:
            cmd.extend(["--session", session_id])
        if self.model:
            cmd.extend(["--model", self.model])
        if auto_approve:
            cmd.append("--auto")
        # The OpenCode CLI declares --file as an array option, so every
        # positional token after it is consumed as another filename. Place the
        # message first, then append file options.
        cmd.append(str(message or ""))
        for path in files or []:
            full = os.path.abspath(os.path.expanduser(str(path)))
            if os.path.isfile(full):
                cmd.extend(["--file", full])
        workspace = self._workspace_for(safe)
        os.makedirs(workspace, exist_ok=True)
        deadline = time.time() + int(timeout_sec or self.timeout_sec)
        replies: list[str] = []
        events: list[dict[str, Any]] = []
        tools: list[dict[str, Any]] = []
        proc: subprocess.Popen[str] | None = None
        try:
            proc = subprocess.Popen(
                cmd,
                cwd=workspace,
                env=self._env(),
                stdin=subprocess.DEVNULL,
                stdout=subprocess.PIPE,
                stderr=subprocess.PIPE,
                text=True,
                bufsize=1,
            )
            with _ACTIVE_LOCK:
                _ACTIVE[safe] = proc
            for raw in proc.stdout or []:
                if time.time() > deadline:
                    proc.kill()
                    return {"ok": False, "error": "OpenCode call timed out", "reply": "\n".join(replies), "sessionId": session_id or ""}
                line = raw.strip()
                if not line:
                    continue
                try:
                    event = json.loads(line)
                except json.JSONDecodeError:
                    replies.append(line)
                    continue
                if not isinstance(event, dict):
                    continue
                events.append(event)
                session_id = str(event.get("sessionID") or event.get("sessionId") or session_id or "")
                text = self._event_text(event)
                if text:
                    replies.append(text)
                tool = self._event_tool(event)
                if tool:
                    tools.append(tool)
                if callable(on_progress):
                    on_progress({"reply": "\n".join(replies), "sessionId": session_id or "", "tools": tools, "rawEvent": event})
            code = proc.wait(timeout=5)
            stderr = (proc.stderr.read() if proc.stderr else "").strip()
            return {
                "ok": code == 0,
                "reply": "\n".join(replies).strip(),
                "error": "" if code == 0 else stderr[-1200:] or f"OpenCode exited {code}",
                "stderr": stderr[-4000:],
                "exitCode": code,
                "sessionId": session_id or "",
                "tools": tools,
                "rawEvents": events[-200:],
                "providerPath": "opencode-cli",
            }
        except Exception as exc:
            return {"ok": False, "error": str(exc), "reply": "\n".join(replies), "sessionId": session_id or ""}
        finally:
            with _ACTIVE_LOCK:
                if _ACTIVE.get(safe) is proc:
                    _ACTIVE.pop(safe, None)

    def interrupt(self, profile: str) -> dict[str, Any]:
        safe = self._safe_profile(profile or "main")
        with _ACTIVE_LOCK:
            proc = _ACTIVE.get(safe)
        if proc and proc.poll() is None:
            proc.terminate()
            return {"ok": True, "interrupted": True, "profile": safe}
        return {"ok": False, "error": f"No active OpenCode run for {safe}"}

    def list_sessions(self, profile: str, limit: int = 40) -> dict[str, Any]:
        try:
            workspace = os.path.realpath(self._workspace_for(self._safe_profile(profile or "main")))
            result = subprocess.run(
                [self.binary or "opencode", "session", "list", "--format", "json", "--max-count", str(max(1, int(limit)))],
                cwd=workspace,
                capture_output=True,
                text=True,
                timeout=20,
                env=self._env(),
            )
            if result.returncode != 0:
                return {"ok": False, "error": (result.stderr or result.stdout or "").strip(), "sessions": []}
            raw = json.loads(result.stdout or "[]")
            rows = raw if isinstance(raw, list) else raw.get("sessions") or []
            # OpenCode stores sessions globally, so `session list` can include
            # conversations owned by another My Virtual World instance/project.
            # Those sessions cannot be resumed from this provider workspace.
            # Keep the SDK session catalog scoped to the configured agent.
            scoped_rows = []
            for row in rows:
                if not isinstance(row, dict):
                    continue
                directory = str(row.get("directory") or "").strip()
                if directory and os.path.realpath(directory) != workspace:
                    continue
                scoped_rows.append(row)
            return {"ok": True, "sessions": scoped_rows[:limit]}
        except Exception as exc:
            return {"ok": False, "error": str(exc), "sessions": []}

    def export_session(self, profile: str, session_id: str) -> dict[str, Any]:
        if not re.fullmatch(r"[A-Za-z0-9_.:-]{1,160}", str(session_id or "")):
            return {"ok": False, "error": "Invalid session ID", "session": {}}
        try:
            result = subprocess.run(
                [self.binary or "opencode", "export", session_id],
                cwd=self._workspace_for(self._safe_profile(profile or "main")),
                capture_output=True,
                text=True,
                timeout=30,
                env=self._env(),
            )
            return {
                "ok": result.returncode == 0,
                "session": json.loads(result.stdout or "{}") if result.returncode == 0 else {},
                "error": "" if result.returncode == 0 else (result.stderr or result.stdout or "").strip(),
            }
        except Exception as exc:
            return {"ok": False, "error": str(exc), "session": {}}

    def delete_session(self, profile: str, session_id: str) -> dict[str, Any]:
        if not re.fullmatch(r"[A-Za-z0-9_.:-]{1,160}", str(session_id or "")):
            return {"ok": False, "error": "Invalid session ID"}
        result = subprocess.run(
            [self.binary or "opencode", "session", "delete", session_id],
            cwd=self._workspace_for(self._safe_profile(profile or "main")),
            capture_output=True,
            text=True,
            timeout=20,
            env=self._env(),
        )
        return {"ok": result.returncode == 0, "deleted": result.returncode == 0, "error": "" if result.returncode == 0 else (result.stderr or result.stdout or "").strip()}

    def _env(self) -> dict[str, str]:
        env = sanitized_env("VW_OPENCODE_ENV_ALLOWLIST")
        env["OPENCODE_CONFIG_DIR"] = str(self.home_path)
        provider_home = os.environ.get("VW_PROVIDER_USER_HOME") or os.path.expanduser("~")
        if os.path.isdir(provider_home):
            env["HOME"] = provider_home
            env.setdefault("XDG_DATA_HOME", os.path.join(provider_home, ".local", "share"))
        return env

    def _entry(self, profile: str, name: str, role: str, emoji: str, workspace: str, source: str, model: str = "") -> dict[str, Any]:
        return {
            "id": f"opencode-{profile}", "statusKey": f"opencode:{profile}", "providerAgentId": profile,
            "profile": profile, "name": name, "role": role, "emoji": emoji, "model": model or self.model,
            "workspace": workspace, "source": source, "lastActiveAt": self._last_active(workspace),
        }

    def _workspace_for(self, profile: str) -> str:
        if profile == "main":
            return str(self.main_workspace)
        registry = self._load_registry()
        return str((registry.get("agents") or {}).get(profile) or os.path.join(self.workspace_root or "", profile))

    def _registered_workspaces(self) -> list[str]:
        roots = []
        if os.path.isdir(self.workspace_root or ""):
            roots.extend(str(item) for item in Path(self.workspace_root or "").iterdir() if item.is_dir())
        roots.extend(str(path) for path in (self._load_registry().get("agents") or {}).values())
        return list(dict.fromkeys(os.path.abspath(path) for path in roots if path and os.path.isdir(path)))

    def _native_agents_dir(self) -> str:
        return os.path.join(str(self.home_path), "agents")

    def _registry_path(self) -> str:
        return os.path.join(str(self.workspace_root), "world-opencode-agent-registry.json")

    def _load_registry(self) -> dict[str, Any]:
        data = self._load_json(self._registry_path())
        if not isinstance(data.get("agents"), dict):
            data["agents"] = {}
        return data

    def _save_registry(self, profile: str, workspace: str) -> None:
        data = self._load_registry()
        data["agents"][profile] = os.path.abspath(workspace)
        self._write_json(self._registry_path(), data)

    @staticmethod
    def _safe_profile(value: Any) -> str:
        return re.sub(r"[^a-z0-9_-]+", "-", str(value or "").lower()).strip("-_")[:64]

    @staticmethod
    def _load_json(path: str) -> dict[str, Any]:
        try:
            value = json.loads(Path(path).read_text(encoding="utf-8"))
            return value if isinstance(value, dict) else {}
        except Exception:
            return {}

    @staticmethod
    def _write_json(path: str, value: dict[str, Any]) -> None:
        OpenCodeProvider._write_text(path, json.dumps(value, indent=2) + "\n")

    @staticmethod
    def _write_text(path: str, content: str) -> None:
        os.makedirs(os.path.dirname(path), exist_ok=True)
        tmp = f"{path}.tmp-{os.getpid()}"
        Path(tmp).write_text(content, encoding="utf-8")
        os.replace(tmp, path)

    @staticmethod
    def _frontmatter(path: Path) -> dict[str, str]:
        try:
            text = path.read_text(encoding="utf-8", errors="replace")
        except OSError:
            return {}
        if not text.startswith("---"):
            return {}
        result: dict[str, str] = {}
        for line in text.split("---", 2)[1].splitlines():
            if ":" in line:
                key, value = line.split(":", 1)
                result[key.strip()] = value.strip().strip("\"'")
        return result

    @staticmethod
    def _last_active(path: str) -> int:
        try:
            return int(max((item.stat().st_mtime for item in Path(path).rglob("*") if item.is_file()), default=0))
        except OSError:
            return 0

    @staticmethod
    def _event_text(event: dict[str, Any]) -> str:
        for value in (
            event.get("text"),
            (event.get("part") or {}).get("text") if isinstance(event.get("part"), dict) else "",
            (event.get("message") or {}).get("content") if isinstance(event.get("message"), dict) else "",
        ):
            if isinstance(value, str) and value.strip():
                return value.strip()
        return ""

    @staticmethod
    def _event_tool(event: dict[str, Any]) -> dict[str, Any] | None:
        part = event.get("part") if isinstance(event.get("part"), dict) else event
        if str(part.get("type") or "").lower() not in {"tool", "tool_use", "tool-invocation", "tool_result"}:
            return None
        state = part.get("state") if isinstance(part.get("state"), dict) else {}
        raw_status = str(state.get("status") or part.get("status") or "completed").lower()
        status = "error" if raw_status in {"error", "failed", "failure", "cancelled", "canceled"} else (
            "done" if raw_status in {"completed", "complete", "done", "success", "succeeded"} else "running"
        )
        error = state.get("error") or part.get("error") or ""
        if error:
            status = "error"
        return {
            "id": str(part.get("id") or part.get("callID") or f"tool-{int(time.time() * 1000)}"),
            "name": str(part.get("tool") or part.get("name") or "tool"),
            "status": status,
            "arguments": state.get("input") or part.get("input") or part.get("args") or {},
            "result": state.get("output") or state.get("result") or part.get("output") or part.get("result") or "",
            "error": error,
        }

    @staticmethod
    def _identity(name: str, role: str, emoji: str) -> str:
        return f"# IDENTITY.md\n\n- **Name:** {name}\n- **Creature:** {role} — OpenCode agent\n- **Emoji:** {emoji}\n"

    @staticmethod
    def _instructions(name: str, role: str, prompt: str) -> str:
        return f"# {name}\n\n## Role\n{role}\n\n## Instructions\n{prompt}\n"

    @staticmethod
    def _agent_md(profile: str, role: str, prompt: str, model: str) -> str:
        model_line = f"model: {model}\n" if model else ""
        return f"---\ndescription: {json.dumps(role)}\nmode: primary\n{model_line}---\n\n# {profile}\n\n{prompt}\n"
