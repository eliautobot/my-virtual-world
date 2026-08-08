"""Claude Code provider adapter for My Virtual World.

The integration uses Claude Code's native terminal CLI in non-interactive
stream-json mode. Agent discovery and creation use Claude Code's native
subagent files under ``~/.claude/agents`` and project ``.claude/agents``.
"""

from __future__ import annotations

import json
import os
import queue
import re
import shutil
import subprocess
import threading
import time
from dataclasses import dataclass
from typing import Any, Callable

from .file_safety import backup_files


ProgressCallback = Callable[[dict[str, Any]], None]

_ACTIVE_RUNS: dict[str, subprocess.Popen] = {}
_ACTIVE_RUNS_LOCK = threading.Lock()


@dataclass
class ClaudeCodeProvider:
    """Provider adapter for local Claude Code-backed Virtual World agents."""

    home_path: str | None = None
    binary: str | None = None
    workspace_root: str | None = None
    enabled: bool = True
    timeout_sec: int = 900
    model: str = ""
    permission_mode: str = "acceptEdits"
    main_workspace: str | None = None
    include_main: bool = True
    include_native_agents: bool = True
    register_native_agents: bool = True

    provider_kind: str = "claude-code"
    provider_type: str = "harness"

    def __post_init__(self) -> None:
        status_dir = os.environ.get("VW_STATUS_DIR", "/data")
        self.home_path = os.path.expanduser(
            self.home_path
            or os.environ.get("VW_CLAUDE_CODE_HOME")
            or os.environ.get("VW_CLAUDE_HOME")
            or "~/.claude"
        )
        self.binary = self._resolve_binary(self.binary)
        self.workspace_root = os.path.expanduser(
            self.workspace_root
            or os.environ.get("VW_CLAUDE_CODE_WORKSPACE_ROOT")
            or os.path.join(status_dir, "claude-code-agents")
        )
        self.main_workspace = os.path.expanduser(
            self.main_workspace
            or os.environ.get("VW_CLAUDE_CODE_MAIN_WORKSPACE")
            or os.path.join(status_dir, "claude-code-main")
        )
        self.model = str(self.model or os.environ.get("VW_CLAUDE_CODE_MODEL") or "")
        self.permission_mode = str(
            self.permission_mode
            or os.environ.get("VW_CLAUDE_CODE_PERMISSION_MODE")
            or "acceptEdits"
        )
        self.include_main = str(os.environ.get("VW_CLAUDE_CODE_INCLUDE_MAIN", str(self.include_main))).lower() not in ("0", "false", "no", "off")
        self.include_native_agents = str(os.environ.get("VW_CLAUDE_CODE_INCLUDE_NATIVE_AGENTS", str(self.include_native_agents))).lower() not in ("0", "false", "no", "off")
        self.register_native_agents = str(os.environ.get("VW_CLAUDE_CODE_REGISTER_NATIVE_AGENTS", str(self.register_native_agents))).lower() not in ("0", "false", "no", "off")

    def is_available(self) -> bool:
        return bool(
            self.enabled
            and self.binary
            and os.path.isfile(self.binary)
            and os.access(self.binary, os.X_OK)
        )

    def test(self) -> dict[str, Any]:
        if not self.binary or not os.path.isfile(self.binary):
            return {"ok": False, "installed": False, "error": "Claude Code CLI not found. Set VW_CLAUDE_CODE_BIN or install claude on PATH.", "agents": []}
        if not os.access(self.binary, os.X_OK):
            return {"ok": False, "installed": True, "error": f"Claude Code CLI is not executable at {self.binary}", "agents": []}
        try:
            status = subprocess.run(
                [self.binary, "auth", "status", "--json"],
                capture_output=True,
                text=True,
                timeout=20,
                env=self._subprocess_env(),
            )
            raw = (status.stdout or status.stderr or "").strip()
            parsed: dict[str, Any] = {}
            try:
                parsed = json.loads(raw) if raw else {}
            except json.JSONDecodeError:
                parsed = {}
            auth_ok = status.returncode == 0 and bool(parsed.get("loggedIn"))
            return {
                "ok": auth_ok,
                "installed": True,
                "authOk": auth_ok,
                "authStatus": parsed or raw[:500],
                "binary": self.binary,
                "homePath": self.home_path,
                "workspaceRoot": self.workspace_root,
                "mainWorkspace": self._main_workspace(),
                "error": "" if auth_ok else "Claude Code is installed but not authenticated. Run claude auth login for this environment.",
                "agents": self.discover_agents() if auth_ok else [],
            }
        except Exception as exc:
            return {"ok": False, "installed": True, "error": str(exc), "agents": []}

    def discover_agents(self) -> list[dict[str, Any]]:
        if not self.is_available():
            return []
        agents: list[dict[str, Any]] = []
        seen_profiles: set[str] = set()
        if self.include_main:
            agents.append(self._agent_entry(
                profile="main",
                name="Main",
                emoji="🤖",
                role="Default Claude Code agent",
                model=self.model or "",
                workspace=self._main_workspace(),
                source="native-main",
                last_active=self._last_active(self._main_workspace()),
            ))
            seen_profiles.add("main")

        if self.workspace_root and os.path.isdir(self.workspace_root):
            for agent_dir in self._office_agent_dirs():
                meta = self._load_meta(agent_dir)
                profile = self._safe_profile_name(meta.get("profile") or os.path.basename(agent_dir))
                if not profile or profile in seen_profiles:
                    continue
                seen_profiles.add(profile)
                agents.append(self._agent_entry(
                    profile=profile,
                    name=meta.get("name") or self._display_name(profile),
                    emoji=meta.get("emoji") or "🤖",
                    role=meta.get("role") or "Claude Code Agent",
                    model=meta.get("model") or self.model or "",
                    workspace=agent_dir,
                    source=meta.get("creationMode") or "virtual-world",
                    last_active=self._last_active(agent_dir),
                    native_agent_path=meta.get("nativeAgentPath") or "",
                ))

        agents.extend(self._discover_native_agents(seen_profiles))
        return agents

    def create_agent(
        self,
        name: str,
        role: str = "Claude Code Agent",
        model: str | None = None,
        emoji: str = "🤖",
        profile: str | None = None,
        prompt: str | None = None,
        creation_mode: str = "standard",
        custom_directory: str | None = None,
    ) -> dict[str, Any]:
        if not self.is_available():
            return {"ok": False, "error": "Claude Code CLI is not available. Set VW_CLAUDE_CODE_BIN or install claude on PATH."}

        safe_profile = self._safe_profile_name(profile or name)
        if safe_profile == "main":
            return {"ok": False, "error": "Claude Code Main already exists"}
        if self._profile_exists(safe_profile):
            return {"ok": False, "error": f"Claude Code agent '{safe_profile}' already exists"}

        mode = str(creation_mode or "standard").strip().lower()
        if mode not in {"standard", "custom"}:
            mode = "standard"
        if mode == "custom":
            parent_dir = self._resolve_custom_parent(custom_directory)
            if not parent_dir:
                return {"ok": False, "error": "A custom parent directory is required for custom Claude Code agent creation"}
            native_agents_dir = self._native_agents_dir()
            if native_agents_dir and self._path_is_inside(parent_dir, native_agents_dir):
                return {"ok": False, "error": "Custom workspace directory cannot be inside the Claude Code user agents directory. Use the standard option instead."}
            agent_dir = os.path.join(parent_dir, safe_profile)
        else:
            agent_dir = os.path.join(self.workspace_root or "", safe_profile)

        meta_path = os.path.join(agent_dir, "world-agent.json")
        if os.path.exists(meta_path):
            return {"ok": False, "error": f"Claude Code agent '{safe_profile}' already exists"}

        native_agent_path = self._native_agent_file_path(safe_profile) if mode == "standard" else ""
        should_register_native = mode == "standard" and self.register_native_agents and native_agent_path
        if should_register_native and os.path.exists(native_agent_path):
            return {"ok": False, "error": f"Native Claude Code agent '{safe_profile}' already exists in {native_agent_path}"}

        os.makedirs(os.path.join(agent_dir, ".claude", "agents"), exist_ok=True)
        os.makedirs(os.path.join(agent_dir, ".claude", "skills"), exist_ok=True)
        model_value = (model or self.model or "").strip()
        instructions = (prompt or role or "Claude Code Agent").strip()
        project_agent_path = os.path.join(agent_dir, ".claude", "agents", f"{safe_profile}.md")
        meta = {
            "profile": safe_profile,
            "name": name,
            "emoji": emoji or "🤖",
            "role": role or "Claude Code Agent",
            "prompt": instructions,
            "model": model_value,
            "providerKind": self.provider_kind,
            "providerType": self.provider_type,
            "creationMode": mode,
            "customParentDirectory": os.path.dirname(agent_dir) if mode == "custom" else "",
            "nativeAgentPath": native_agent_path if should_register_native else "",
            "projectAgentPath": project_agent_path,
            "createdAt": int(time.time()),
        }
        self._write_json(meta_path, meta)
        self._write_text(os.path.join(agent_dir, "IDENTITY.md"), self._identity_md(name, role, emoji))
        self._write_text(os.path.join(agent_dir, "AGENTS.md"), self._agents_md(name, role, instructions))
        self._write_text(os.path.join(agent_dir, "CLAUDE.md"), self._claude_md(name, role, instructions))
        self._write_text(project_agent_path, self._agent_md(safe_profile, role, instructions, model_value))
        if should_register_native:
            self._write_text(native_agent_path, self._agent_md(safe_profile, role, instructions, model_value))
        if mode == "custom":
            self._save_external_agent(safe_profile, agent_dir)

        return {
            "ok": True,
            "profile": safe_profile,
            "agentId": f"claude-code-{safe_profile}",
            "name": name,
            "workspace": agent_dir,
            "creationMode": mode,
            "nativeAgentPath": native_agent_path if should_register_native else "",
            "message": f"Claude Code agent '{name}' created successfully",
        }

    def delete_agent(self, profile: str) -> dict[str, Any]:
        safe_profile = self._safe_profile_name(profile)
        if not safe_profile:
            return {"ok": False, "error": "profile is required"}
        if safe_profile == "main":
            return {"ok": False, "error": "The built-in Claude Code Main agent cannot be deleted"}

        agent_dir = os.path.join(self.workspace_root or "", safe_profile)
        meta = self._load_meta(agent_dir)
        if os.path.isdir(agent_dir):
            if meta.get("providerKind") != self.provider_kind or self._safe_profile_name(meta.get("profile")) != safe_profile:
                return {"ok": False, "error": "Refusing to delete an unowned Claude Code workspace"}
            shutil.rmtree(agent_dir)
            self._remove_external_agent(safe_profile)
        else:
            external_dir = self._external_agent_dir(safe_profile)
            if external_dir and os.path.isdir(external_dir):
                external_meta = self._load_meta(external_dir)
                if external_meta.get("providerKind") != self.provider_kind or self._safe_profile_name(external_meta.get("profile")) != safe_profile:
                    return {"ok": False, "error": "Refusing to delete an unowned Claude Code workspace"}
                meta = external_meta
                shutil.rmtree(external_dir)
                self._remove_external_agent(safe_profile)

        native_path = str(meta.get("nativeAgentPath") or self._native_agent_file_path(safe_profile) or "")
        if native_path and os.path.isfile(native_path) and self._is_native_agent_path(native_path):
            try:
                os.remove(native_path)
            except OSError:
                pass
        return {"ok": True, "deleted": True, "profile": safe_profile, "agentId": f"claude-code-{safe_profile}"}

    def update_profile(self, profile: str, patch: dict[str, Any]) -> dict[str, Any]:
        safe_profile = self._safe_profile_name(profile)
        agent_dir = self._workspace_for_profile(safe_profile)
        meta_path = os.path.join(agent_dir, "world-agent.json")
        meta = self._load_meta(agent_dir)
        if not meta or meta.get("profile") != safe_profile:
            return {"ok": False, "error": f"Managed Claude Code agent '{safe_profile}' was not found"}
        for key in ("name", "role", "emoji", "model"):
            if key in patch:
                meta[key] = str(patch.get(key) or "")
        if "instructions" in patch:
            meta["prompt"] = str(patch.get("instructions") or "")
        name = str(meta.get("name") or self._display_name(safe_profile))
        role = str(meta.get("role") or "Claude Code Agent")
        emoji = str(meta.get("emoji") or "🤖")
        model = str(meta.get("model") or self.model or "")
        instructions = str(meta.get("prompt") or role)
        native_path = str(meta.get("nativeAgentPath") or "")
        project_path = str(meta.get("projectAgentPath") or os.path.join(agent_dir, ".claude", "agents", f"{safe_profile}.md"))
        paths = [meta_path, os.path.join(agent_dir, "IDENTITY.md"), os.path.join(agent_dir, "AGENTS.md"), os.path.join(agent_dir, "CLAUDE.md"), project_path, native_path]
        backup_id, backups = backup_files(agent_dir, paths)
        self._write_json(meta_path, meta)
        self._write_text(os.path.join(agent_dir, "IDENTITY.md"), self._identity_md(name, role, emoji))
        self._write_text(os.path.join(agent_dir, "AGENTS.md"), self._agents_md(name, role, instructions))
        self._write_text(os.path.join(agent_dir, "CLAUDE.md"), self._claude_md(name, role, instructions))
        self._write_text(project_path, self._agent_md(safe_profile, role, instructions, model))
        if native_path:
            self._write_text(native_path, self._agent_md(safe_profile, role, instructions, model))
        return {"ok": True, "profile": safe_profile, "backupId": backup_id, "backups": backups}

    def send_chat_message(
        self,
        profile: str,
        message: str,
        session_id: str | None = None,
        timeout_sec: int | None = None,
        on_progress: ProgressCallback | None = None,
    ) -> dict[str, Any]:
        if not self.is_available():
            return {"ok": False, "error": f"Claude Code CLI is not available at {self.binary}", "reply": "", "sessionId": session_id or ""}
        if not message.strip():
            return {"ok": False, "error": "message is required", "reply": "", "sessionId": session_id or ""}

        safe_profile = self._safe_profile_name(profile or "main")
        workspace = self._workspace_for_profile(safe_profile)
        os.makedirs(workspace, exist_ok=True)

        cmd = [
            self.binary or "claude",
            "-p",
            "--output-format",
            "stream-json",
            "--verbose",
            "--include-partial-messages",
        ]
        if session_id:
            cmd.extend(["--resume", session_id])
        if safe_profile and safe_profile != "main":
            cmd.extend(["--agent", safe_profile])
        if self.model:
            cmd.extend(["--model", self.model])
        permission_mode = str(self.permission_mode or "").strip()
        if permission_mode == "bypassPermissions":
            cmd.append("--dangerously-skip-permissions")
        elif permission_mode:
            cmd.extend(["--permission-mode", permission_mode])
        cmd.append(message)

        deadline = time.time() + int(timeout_sec or self.timeout_sec or 900)
        state = _ClaudeStreamState(profile=safe_profile, session_id=session_id or "")
        stderr_lines: list[str] = []
        proc: subprocess.Popen | None = None
        try:
            proc = subprocess.Popen(
                cmd,
                cwd=workspace,
                env=self._subprocess_env(),
                stdin=subprocess.DEVNULL,
                stdout=subprocess.PIPE,
                stderr=subprocess.PIPE,
                text=True,
                bufsize=1,
            )
            with _ACTIVE_RUNS_LOCK:
                _ACTIVE_RUNS[safe_profile] = proc

            def read_stderr() -> None:
                if not proc or not proc.stderr:
                    return
                try:
                    for raw in proc.stderr:
                        if raw:
                            stderr_lines.append(raw.rstrip("\n"))
                except Exception:
                    pass

            threading.Thread(target=read_stderr, daemon=True).start()

            if not proc.stdout:
                return {"ok": False, "error": "Claude Code stdout pipe was not available", "reply": "", "sessionId": session_id or ""}
            for raw in proc.stdout:
                if time.time() > deadline:
                    proc.kill()
                    return {"ok": False, "error": "Claude Code call timed out", "reply": state.reply, "sessionId": state.session_id or session_id or ""}
                line = raw.strip()
                if not line:
                    continue
                try:
                    item = json.loads(line)
                except json.JSONDecodeError:
                    state.add_text(line)
                    if on_progress:
                        on_progress(state.as_progress())
                    continue
                state.ingest(item)
                if on_progress:
                    on_progress(state.as_progress())

            exit_code = proc.wait(timeout=5)
            reply = state.final_result or state.reply
            token_usage = self._usage_to_token_usage(state.usage)
            error = state.error
            if exit_code != 0 and not error:
                error = reply or "\n".join(stderr_lines)[-1000:] or "Claude Code command failed"
            return {
                "ok": exit_code == 0 and not state.is_error,
                "reply": reply,
                "stderr": "\n".join(stderr_lines)[-4000:],
                "exitCode": exit_code,
                "sessionId": state.session_id or session_id or "",
                "runId": state.session_id or "",
                "providerPath": "claude-code-cli",
                "tools": state.tools,
                "thinking": state.status,
                "tokenUsage": token_usage,
                "usage": state.usage,
                "model": state.model,
                "error": error,
            }
        except subprocess.TimeoutExpired:
            if proc:
                proc.kill()
            return {"ok": False, "error": "Claude Code call timed out", "reply": state.reply, "sessionId": state.session_id or session_id or ""}
        except Exception as exc:
            return {"ok": False, "error": str(exc), "reply": state.reply, "sessionId": state.session_id or session_id or ""}
        finally:
            with _ACTIVE_RUNS_LOCK:
                if _ACTIVE_RUNS.get(safe_profile) is proc:
                    _ACTIVE_RUNS.pop(safe_profile, None)

    def interrupt(self, profile: str) -> dict[str, Any]:
        safe_profile = self._safe_profile_name(profile or "main")
        with _ACTIVE_RUNS_LOCK:
            proc = _ACTIVE_RUNS.get(safe_profile)
        if not proc:
            return {"ok": False, "error": "No active Claude Code turn is running for this agent."}
        try:
            proc.terminate()
            return {"ok": True, "interrupted": True, "profile": safe_profile}
        except Exception as exc:
            return {"ok": False, "error": str(exc)}

    def _subprocess_env(self) -> dict[str, str]:
        env = os.environ.copy()
        if self.home_path:
            env["VW_CLAUDE_CODE_HOME"] = self.home_path
            env.setdefault("CLAUDE_CONFIG_DIR", self.home_path)
            if os.path.basename(self.home_path.rstrip(os.sep)) == ".claude":
                env["HOME"] = os.path.dirname(self.home_path.rstrip(os.sep)) or env.get("HOME", "")
        return env

    def _agent_entry(
        self,
        *,
        profile: str,
        name: str,
        emoji: str,
        role: str,
        model: str,
        workspace: str,
        source: str,
        last_active: int = 0,
        native_agent_path: str = "",
    ) -> dict[str, Any]:
        suffix = self._safe_suffix(profile)
        return {
            "id": f"claude-code-{suffix}",
            "statusKey": f"claude-code-{suffix}",
            "providerKind": self.provider_kind,
            "providerType": self.provider_type,
            "providerAgentId": profile,
            "profile": profile,
            "name": name or self._display_name(profile),
            "emoji": emoji or "🤖",
            "role": role or "Claude Code Agent",
            "model": model or self.model or "inherit",
            "provider": "Claude Code",
            "workspace": workspace,
            "home": workspace,
            "binary": self.binary,
            "lastActiveAt": last_active,
            "claudeCodeSource": source,
            "nativeAgentPath": native_agent_path,
            "capabilities": ["chat", "status", "sessions", "files", "streaming", "interrupt"],
        }

    def _office_agent_dirs(self) -> list[str]:
        dirs: list[str] = []
        seen: set[str] = set()
        if self.workspace_root and os.path.isdir(self.workspace_root):
            for name in sorted(os.listdir(self.workspace_root)):
                agent_dir = os.path.join(self.workspace_root, name)
                if os.path.isdir(agent_dir):
                    dirs.append(agent_dir)
                    seen.add(os.path.abspath(agent_dir))
        for _profile, agent_dir in sorted(self._load_external_agents().items()):
            if not agent_dir or not os.path.isdir(agent_dir):
                continue
            real = os.path.abspath(agent_dir)
            if real in seen:
                continue
            dirs.append(agent_dir)
            seen.add(real)
        return dirs

    def _discover_native_agents(self, seen_profiles: set[str]) -> list[dict[str, Any]]:
        if not self.include_native_agents:
            return []
        agents_dir = self._native_agents_dir()
        if not agents_dir or not os.path.isdir(agents_dir):
            return []
        agents: list[dict[str, Any]] = []
        for root, dirs, files in os.walk(agents_dir):
            dirs[:] = [d for d in dirs if d not in {"node_modules", ".git"}]
            for filename in sorted(files):
                if not filename.endswith(".md"):
                    continue
                path = os.path.join(root, filename)
                meta = self._load_agent_md(path)
                if not meta:
                    continue
                profile = self._safe_profile_name(meta.get("name") or os.path.splitext(filename)[0])
                if not profile or profile in seen_profiles:
                    continue
                seen_profiles.add(profile)
                agents.append(self._agent_entry(
                    profile=profile,
                    name=self._display_name(profile),
                    emoji="🤖",
                    role=meta.get("description") or "Claude Code Agent",
                    model=meta.get("model") or self.model or "inherit",
                    workspace=self._workspace_for_profile(profile),
                    source="native-user-agent",
                    last_active=self._last_active(path),
                    native_agent_path=path,
                ))
        return agents

    def _workspace_for_profile(self, profile: str) -> str:
        if profile == "main":
            return self._main_workspace()
        agent_dir = os.path.join(self.workspace_root or "", profile)
        if os.path.isdir(agent_dir):
            return agent_dir
        external = self._external_agent_dir(profile)
        if external and os.path.isdir(external):
            return external
        return self._main_workspace()

    def _main_workspace(self) -> str:
        return os.path.expanduser(self.main_workspace or self.workspace_root or os.getcwd())

    def _native_agents_dir(self) -> str:
        return os.path.join(os.path.expanduser(self.home_path or "~/.claude"), "agents")

    def _native_agent_file_path(self, profile: str) -> str:
        return os.path.join(self._native_agents_dir(), f"{self._safe_profile_name(profile)}.md")

    def _profile_exists(self, profile: str) -> bool:
        if profile == "main":
            return True
        if os.path.exists(os.path.join(self.workspace_root or "", profile, "world-agent.json")):
            return True
        if self._external_agent_dir(profile):
            return True
        native = self._native_agent_file_path(profile)
        return bool(native and os.path.exists(native))

    def _registry_path(self) -> str:
        root = self.workspace_root or os.environ.get("VW_STATUS_DIR", "/data")
        return os.path.join(os.path.expanduser(root), "world-claude-code-agent-registry.json")

    def _load_external_agents(self) -> dict[str, str]:
        try:
            with open(self._registry_path(), "r", encoding="utf-8") as f:
                data = json.load(f)
            agents = data.get("agents", {}) if isinstance(data, dict) else {}
            return {self._safe_profile_name(k): str(v) for k, v in agents.items() if k and v}
        except Exception:
            return {}

    def _save_external_agent(self, profile: str, agent_dir: str) -> None:
        data = {"schema": "my-virtual-world.claude-code-agent-registry.v1", "agents": self._load_external_agents()}
        data["agents"][self._safe_profile_name(profile)] = os.path.abspath(agent_dir)
        self._write_json(self._registry_path(), data)

    def _remove_external_agent(self, profile: str) -> None:
        path = self._registry_path()
        data = {"schema": "my-virtual-world.claude-code-agent-registry.v1", "agents": self._load_external_agents()}
        data["agents"].pop(self._safe_profile_name(profile), None)
        self._write_json(path, data)

    def _external_agent_dir(self, profile: str) -> str:
        return self._load_external_agents().get(self._safe_profile_name(profile), "")

    def _resolve_custom_parent(self, value: str | None) -> str:
        path = os.path.expanduser(str(value or "").strip())
        if not path:
            return ""
        os.makedirs(path, exist_ok=True)
        return os.path.abspath(path)

    def _is_native_agent_path(self, path: str) -> bool:
        agents_dir = self._native_agents_dir()
        return bool(path and agents_dir and self._path_is_inside(path, agents_dir))

    @staticmethod
    def _path_is_inside(path: str, parent: str) -> bool:
        try:
            return os.path.commonpath([os.path.abspath(path), os.path.abspath(parent)]) == os.path.abspath(parent)
        except (ValueError, OSError):
            return False

    @staticmethod
    def _resolve_binary(value: str | None) -> str:
        candidates = [
            value,
            os.environ.get("VW_CLAUDE_CODE_BIN"),
            os.environ.get("VW_CLAUDE_BIN"),
            shutil.which("claude"),
            os.path.expanduser("~/.npm-global/bin/claude"),
            os.path.expanduser("~/.local/bin/claude"),
            "/usr/local/bin/claude",
        ]
        for candidate in candidates:
            if not candidate:
                continue
            expanded = os.path.expanduser(str(candidate))
            resolved = shutil.which(expanded) if os.path.basename(expanded) == expanded else expanded
            if resolved and os.path.isfile(resolved):
                return resolved
        return os.path.expanduser(str(value or os.environ.get("VW_CLAUDE_CODE_BIN") or "claude"))

    @staticmethod
    def _safe_profile_name(value: str | None) -> str:
        raw = str(value or "").strip().lower()
        raw = re.sub(r"[^a-z0-9-]+", "-", raw).strip("-")
        raw = re.sub(r"-{2,}", "-", raw)
        return raw[:64] or "claude-agent"

    @staticmethod
    def _safe_suffix(value: str | None) -> str:
        return re.sub(r"[^a-zA-Z0-9_.-]+", "-", str(value or "claude-agent")).strip("-")[:80] or "claude-agent"

    @staticmethod
    def _display_name(profile: str) -> str:
        if profile == "main":
            return "Main"
        return str(profile or "claude").replace("-", " ").replace("_", " ").title()

    @staticmethod
    def _last_active(path: str) -> int:
        latest = 0
        try:
            if os.path.isfile(path):
                return int(os.path.getmtime(path))
            for root, dirs, files in os.walk(path):
                dirs[:] = [d for d in dirs if d not in {"node_modules", ".git"}]
                for fname in files:
                    latest = max(latest, int(os.path.getmtime(os.path.join(root, fname))))
        except OSError:
            pass
        return latest

    def _load_meta(self, agent_dir: str) -> dict[str, Any]:
        try:
            with open(os.path.join(agent_dir, "world-agent.json"), "r", encoding="utf-8") as f:
                data = json.load(f)
            return data if isinstance(data, dict) else {}
        except Exception:
            return {}

    def _load_agent_md(self, path: str) -> dict[str, str]:
        try:
            with open(path, "r", encoding="utf-8") as f:
                content = f.read(20000)
        except (OSError, UnicodeError):
            return {}
        if not content.startswith("---"):
            return {}
        parts = content.split("---", 2)
        if len(parts) < 3:
            return {}
        meta: dict[str, str] = {}
        for raw in parts[1].splitlines():
            line = raw.strip()
            if not line or line.startswith("#") or ":" not in line:
                continue
            key, value = line.split(":", 1)
            key = key.strip()
            value = value.strip().strip("'\"")
            if key:
                meta[key] = value
        if not meta.get("name") or not meta.get("description"):
            return {}
        return meta

    @staticmethod
    def _write_text(path: str, content: str) -> None:
        os.makedirs(os.path.dirname(path), exist_ok=True)
        with open(path, "w", encoding="utf-8") as f:
            f.write(content)

    @staticmethod
    def _write_json(path: str, data: dict[str, Any]) -> None:
        os.makedirs(os.path.dirname(path), exist_ok=True)
        with open(path, "w", encoding="utf-8") as f:
            json.dump(data, f, indent=2, ensure_ascii=False)

    @staticmethod
    def _yaml_string(value: str) -> str:
        text = str(value or "").replace("\\", "\\\\").replace('"', '\\"')
        return f'"{text}"'

    def _identity_md(self, name: str, role: str, emoji: str) -> str:
        return (
            "# IDENTITY.md\n\n"
            f"- **Name:** {name}\n"
            f"- **Creature:** {role or 'Claude Code Agent'}\n"
            f"- **Emoji:** {emoji or '🤖'}\n"
        )

    def _agents_md(self, name: str, role: str, instructions: str) -> str:
        return (
            f"# {name}\n\n"
            f"Role: {role or 'Claude Code Agent'}\n\n"
            "## Standing Instructions\n\n"
            f"{instructions.strip()}\n"
        )

    def _claude_md(self, name: str, role: str, instructions: str) -> str:
        return (
            f"# {name}\n\n"
            f"You are {name}, a Claude Code-backed My Virtual World agent.\n\n"
            f"Role: {role or 'Claude Code Agent'}\n\n"
            "Follow these standing instructions:\n\n"
            f"{instructions.strip()}\n"
        )

    def _agent_md(self, profile: str, role: str, instructions: str, model: str) -> str:
        lines = [
            "---",
            f"name: {self._yaml_string(profile)}",
            f"description: {self._yaml_string(role or 'My Virtual World Claude Code agent')}",
        ]
        if model and model != "inherit":
            lines.append(f"model: {self._yaml_string(model)}")
        lines.append("---")
        lines.append(instructions.strip())
        lines.append("")
        return "\n".join(lines)

    def _usage_to_token_usage(self, usage: dict[str, Any]) -> dict[str, Any]:
        usage = usage if isinstance(usage, dict) else {}
        input_tokens = self._int(usage.get("input_tokens") or usage.get("inputTokens"), 0)
        output_tokens = self._int(usage.get("output_tokens") or usage.get("outputTokens"), 0)
        cache_create = self._int(usage.get("cache_creation_input_tokens") or usage.get("cacheCreationInputTokens"), 0)
        cache_read = self._int(usage.get("cache_read_input_tokens") or usage.get("cacheReadInputTokens"), 0)
        total = input_tokens + output_tokens + cache_create + cache_read
        if not total:
            return {}
        return {
            "last": {
                "inputTokens": input_tokens + cache_create + cache_read,
                "outputTokens": output_tokens,
                "totalTokens": total,
            },
            "total": {
                "inputTokens": input_tokens + cache_create + cache_read,
                "outputTokens": output_tokens,
                "totalTokens": total,
            },
        }

    @staticmethod
    def _int(value: Any, default: int = 0) -> int:
        try:
            return int(value)
        except (TypeError, ValueError):
            return default


class _ClaudeStreamState:
    def __init__(self, profile: str, session_id: str = "") -> None:
        self.profile = profile
        self.session_id = session_id
        self.reply = ""
        self.final_result = ""
        self.status = "Starting Claude Code."
        self.model = ""
        self.usage: dict[str, Any] = {}
        self.tools: list[dict[str, Any]] = []
        self._tool_by_index: dict[int, dict[str, Any]] = {}
        self._tool_json_parts: dict[int, str] = {}
        self.is_error = False
        self.error = ""

    def add_text(self, text: str) -> None:
        if text:
            self.reply += text

    def ingest(self, item: dict[str, Any]) -> None:
        item_type = item.get("type")
        if item.get("session_id"):
            self.session_id = str(item.get("session_id") or self.session_id)
        if item_type == "system":
            self._ingest_system(item)
        elif item_type == "stream_event":
            event = item.get("event") if isinstance(item.get("event"), dict) else {}
            self._ingest_stream_event(event)
        elif item_type == "assistant":
            self._ingest_message(item.get("message"))
        elif item_type == "user":
            self._ingest_message(item.get("message"), from_user=True)
        elif item_type == "result":
            self.final_result = str(item.get("result") or self.final_result or self.reply)
            self.is_error = bool(item.get("is_error") or item.get("subtype") == "error")
            self.error = str(item.get("error") or item.get("message") or "") or self.error
            if isinstance(item.get("usage"), dict):
                self.usage = item["usage"]
            for tool in self.tools:
                if tool.get("status") == "running":
                    tool["status"] = "error" if self.is_error else "done"
            self.status = "Claude Code completed."
        elif item_type == "error":
            self.is_error = True
            self.error = str(item.get("error") or item.get("message") or "Claude Code error")

    def _ingest_system(self, item: dict[str, Any]) -> None:
        subtype = str(item.get("subtype") or "")
        if subtype == "init":
            self.model = str(item.get("model") or self.model)
            self.status = "Claude Code initialized."
        elif subtype == "api_retry":
            attempt = item.get("attempt")
            max_retries = item.get("max_retries")
            self.status = f"Claude API retry {attempt}/{max_retries}".strip()
        elif subtype:
            self.status = subtype.replace("_", " ").title()

    def _ingest_message(self, message: Any, from_user: bool = False) -> None:
        if not isinstance(message, dict):
            return
        if isinstance(message.get("usage"), dict):
            self.usage = message["usage"]
        content = message.get("content")
        if not isinstance(content, list):
            return
        text_parts = []
        for block in content:
            if not isinstance(block, dict):
                continue
            btype = block.get("type")
            if btype == "text" and block.get("text") and not from_user:
                text_parts.append(str(block.get("text") or ""))
            elif btype == "tool_use":
                self._upsert_tool(block)
            elif btype == "tool_result":
                self._ingest_tool_result(block)
        if text_parts and not self.reply:
            self.reply = "\n".join(text_parts).strip()

    def _ingest_stream_event(self, event: dict[str, Any]) -> None:
        etype = str(event.get("type") or "")
        if etype == "content_block_delta":
            delta = event.get("delta") if isinstance(event.get("delta"), dict) else {}
            if delta.get("type") == "text_delta":
                self.reply += str(delta.get("text") or "")
            elif delta.get("type") == "input_json_delta":
                idx = self._event_index(event)
                self._tool_json_parts[idx] = self._tool_json_parts.get(idx, "") + str(delta.get("partial_json") or "")
                tool = self._tool_by_index.get(idx)
                if tool:
                    tool["arguments"] = self._parse_json_fragment(self._tool_json_parts[idx])
        elif etype == "content_block_start":
            block = event.get("content_block") if isinstance(event.get("content_block"), dict) else {}
            if block.get("type") == "tool_use":
                idx = self._event_index(event)
                tool = self._upsert_tool(block)
                self._tool_by_index[idx] = tool
                self.status = f"Running {tool.get('name') or 'tool'}."
        elif etype == "content_block_stop":
            idx = self._event_index(event)
            tool = self._tool_by_index.get(idx)
            if tool:
                tool["status"] = tool.get("status") or "running"
        elif etype == "message_delta":
            usage = event.get("usage") if isinstance(event.get("usage"), dict) else {}
            if usage:
                self.usage = usage
        elif etype:
            self.status = etype.replace("_", " ")

    def _upsert_tool(self, block: dict[str, Any]) -> dict[str, Any]:
        tool_id = str(block.get("id") or f"claude-tool-{len(self.tools) + 1}")
        found = next((tool for tool in self.tools if tool.get("id") == tool_id), None)
        if not found:
            found = {
                "id": tool_id,
                "name": block.get("name") or "Claude tool",
                "status": "running",
                "arguments": block.get("input") if isinstance(block.get("input"), dict) else {},
                "result": "",
                "source": "claude-code",
            }
            self.tools.append(found)
        else:
            found["name"] = block.get("name") or found.get("name")
            if isinstance(block.get("input"), dict):
                found["arguments"] = block.get("input")
        return found

    def _ingest_tool_result(self, block: dict[str, Any]) -> dict[str, Any]:
        tool_id = str(block.get("tool_use_id") or block.get("id") or f"claude-tool-result-{len(self.tools) + 1}")
        found = next((tool for tool in self.tools if tool.get("id") == tool_id), None)
        if not found:
            found = {
                "id": tool_id,
                "name": block.get("name") or "Claude tool",
                "status": "running",
                "arguments": {},
                "result": "",
                "source": "claude-code",
            }
            self.tools.append(found)
        is_error = bool(block.get("is_error") or block.get("error"))
        found["status"] = "error" if is_error else "done"
        result = block.get("content")
        if isinstance(result, list):
            result = "\n".join(
                str(item.get("text") or item.get("content") or item)
                for item in result
                if item
            )
        if result is None:
            result = block.get("result") or block.get("error") or ""
        if is_error:
            found["error"] = str(result or block.get("error") or "Claude tool failed")
        else:
            found["result"] = str(result or "")
        return found

    def as_progress(self) -> dict[str, Any]:
        return {
            "profile": self.profile,
            "sessionId": self.session_id,
            "threadId": self.session_id,
            "runId": self.session_id,
            "status": self.status,
            "reply": self.reply,
            "tools": self.tools,
            "model": self.model,
            "usage": self.usage,
            "error": self.error,
        }

    @staticmethod
    def _event_index(event: dict[str, Any]) -> int:
        try:
            return int(event.get("index") or event.get("content_block_index") or 0)
        except (TypeError, ValueError):
            return 0

    @staticmethod
    def _parse_json_fragment(value: str) -> dict[str, Any]:
        if not value:
            return {}
        try:
            parsed = json.loads(value)
            return parsed if isinstance(parsed, dict) else {"value": parsed}
        except json.JSONDecodeError:
            return {"partial": value[-1000:]}
