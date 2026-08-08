"""Google Antigravity CLI provider for My Virtual World."""

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
_LOCK = threading.Lock()


@dataclass
class AntigravityProvider:
    home_path: str | None = None
    binary: str | None = None
    workspace_root: str | None = None
    enabled: bool = True
    timeout_sec: int = 600
    print_timeout: str = "5m"
    model: str = ""
    sandbox: str = ""

    provider_kind: str = "antigravity"
    provider_type: str = "harness"

    def __post_init__(self) -> None:
        self._auth_ok: bool | None = None
        self._last_auth_error = ""
        status_dir = os.environ.get("VW_STATUS_DIR", "/data")
        self.home_path = os.path.abspath(os.path.expanduser(
            self.home_path or os.environ.get("VW_ANTIGRAVITY_HOME") or "~/.gemini/config"
        ))
        self.binary = resolve_executable(self.binary, "VW_ANTIGRAVITY_BIN", "agy")
        self.workspace_root = os.path.abspath(os.path.expanduser(
            self.workspace_root or os.environ.get("VW_ANTIGRAVITY_WORKSPACE_ROOT") or os.path.join(status_dir, "antigravity-agents")
        ))

    def is_available(self) -> bool:
        return bool(self.enabled and self.binary and os.path.isfile(self.binary) and os.access(self.binary, os.X_OK))

    def test(self) -> dict[str, Any]:
        if not self.is_available():
            return {"ok": False, "enabled": self.enabled, "installed": bool(self.binary and os.path.isfile(self.binary)), "error": "Antigravity CLI is disabled or unavailable"}
        result = subprocess.run([self.binary or "agy", "--version"], capture_output=True, text=True, timeout=10, env=self._env())
        if result.returncode == 0:
            self._probe_auth()
        return {
            "ok": result.returncode == 0 and self._auth_ok is True,
            "installed": True,
            "enabled": True,
            "authOk": self._auth_ok,
            "ready": self._auth_ok is True,
            "version": (result.stdout or result.stderr or "").strip(),
            "binary": self.binary,
            "homePath": self.home_path,
            "workspaceRoot": self.workspace_root,
            "error": self._last_auth_error if self._auth_ok is False else ("" if result.returncode == 0 else (result.stderr or result.stdout or "").strip()),
        }

    def discover_agents(self) -> list[dict[str, Any]]:
        if not self.is_available():
            return []
        agents: list[dict[str, Any]] = []
        seen: set[str] = set()
        if os.path.isdir(self.workspace_root or ""):
            for workspace in sorted(Path(self.workspace_root or "").iterdir()):
                meta = self._load_json(workspace / "antigravity-agent.json")
                profile = self._safe(meta.get("profile") or workspace.name)
                if not workspace.is_dir() or not profile or meta.get("providerKind") != "antigravity":
                    continue
                agents.append(self._entry(
                    profile,
                    str(meta.get("name") or profile.replace("-", " ").title()),
                    str(meta.get("role") or "Antigravity Agent"),
                    str(meta.get("emoji") or "🌌"),
                    str(workspace),
                    str(meta.get("model") or self.model),
                    "managed-agent",
                ))
                seen.add(profile)
        native_root = Path(str(self.home_path)) / "agents"
        if native_root.is_dir():
            for agent_file in sorted(native_root.glob("*/agent.md")):
                profile = self._safe(agent_file.parent.name)
                if not profile or profile in seen:
                    continue
                meta = self._agent_file_meta(agent_file)
                agents.append(self._entry(
                    profile,
                    str(meta.get("name") or profile.replace("-", " ").title()),
                    str(meta.get("description") or "Antigravity custom agent"),
                    "🌌",
                    self._workspace(profile),
                    str(meta.get("model") or self.model),
                    "native-agent",
                ))
                seen.add(profile)
        try:
            result = subprocess.run([self.binary or "agy", "agent"], capture_output=True, text=True, timeout=20, env=self._env())
            for match in re.finditer(r"(?m)^([A-Za-z0-9_.-]+)\s+\((primary|subagent)\)\s*$", result.stdout or ""):
                profile = self._safe(match.group(1))
                if not profile or profile in seen or profile in {"build", "compaction", "explore", "general", "plan"}:
                    continue
                agents.append(self._entry(profile, profile.replace("-", " ").title(), "Antigravity custom agent", "🌌", self._workspace(profile), self.model, "native-agent"))
                seen.add(profile)
        except Exception:
            pass
        return agents

    def create_agent(
        self,
        name: str,
        role: str = "Antigravity Agent",
        model: str | None = None,
        emoji: str = "🌌",
        profile: str | None = None,
        prompt: str | None = None,
        creation_mode: str = "standard",
        custom_directory: str | None = None,
    ) -> dict[str, Any]:
        if not self.is_available():
            return {"ok": False, "error": "Antigravity CLI is unavailable"}
        safe = self._safe(profile or name)
        if not safe:
            return {"ok": False, "error": "Antigravity agent ID is required"}
        if any(item.get("providerAgentId") == safe for item in self.discover_agents()):
            return {"ok": False, "error": f"Antigravity agent '{safe}' already exists"}
        parent = os.path.abspath(os.path.expanduser(str(custom_directory or self.workspace_root)))
        workspace = os.path.join(parent, safe)
        instructions = str(prompt or role or "Antigravity Agent").strip()
        model_value = str(model or self.model or "inherit")
        native_path = os.path.join(str(self.home_path), "agents", safe, "agent.md")
        project_path = os.path.join(workspace, ".agents", "agents", safe, "agent.md")
        os.makedirs(os.path.join(workspace, ".agents", "skills"), exist_ok=True)
        meta = {
            "profile": safe, "name": name, "role": role, "emoji": emoji, "model": model_value,
            "prompt": instructions, "providerKind": "antigravity", "providerType": "harness",
            "nativeAgentPath": native_path, "projectAgentPath": project_path, "createdAt": int(time.time()),
        }
        self._write_json(os.path.join(workspace, "antigravity-agent.json"), meta)
        self._write_text(os.path.join(workspace, "IDENTITY.md"), f"# IDENTITY.md\n\n- **Name:** {name}\n- **Creature:** {role} — Antigravity agent\n- **Emoji:** {emoji}\n")
        self._write_text(os.path.join(workspace, "AGENTS.md"), f"# {name}\n\n## Role\n{role}\n\n## Instructions\n{instructions}\n")
        self._write_text(os.path.join(workspace, "GEMINI.md"), f"# {name}\n\n{instructions}\n")
        self._write_text(native_path, self._agent_md(name, role, instructions, model_value))
        self._write_text(project_path, self._agent_md(name, role, instructions, model_value))
        return {
            "ok": True,
            "profile": safe,
            "agentId": f"antigravity-{safe}",
            "workspace": workspace,
            "nativeAgentPath": native_path,
            "creationMode": "standard",
            "message": f"Antigravity agent '{name}' created successfully",
        }

    def delete_agent(self, profile: str) -> dict[str, Any]:
        safe = self._safe(profile)
        workspace = self._workspace(safe)
        meta = self._load_json(Path(workspace) / "antigravity-agent.json")
        if not safe or meta.get("providerKind") != "antigravity" or meta.get("profile") != safe:
            return {"ok": False, "error": "Refusing to delete an unowned Antigravity agent"}
        shutil.rmtree(workspace)
        native = os.path.abspath(str(meta.get("nativeAgentPath") or ""))
        native_root = os.path.abspath(os.path.join(str(self.home_path), "agents"))
        if os.path.isfile(native) and native.startswith(native_root + os.sep):
            parent = os.path.dirname(native)
            os.remove(native)
            if os.path.isdir(parent) and not os.listdir(parent):
                os.rmdir(parent)
        return {"ok": True, "deleted": True, "profile": safe, "agentId": f"antigravity-{safe}"}

    def update_profile(self, profile: str, patch: dict[str, Any]) -> dict[str, Any]:
        safe = self._safe(profile)
        workspace = self._workspace(safe)
        meta_path = os.path.join(workspace, "antigravity-agent.json")
        meta = self._load_json(Path(meta_path))
        if not meta or meta.get("profile") != safe:
            return {"ok": False, "error": f"Managed Antigravity agent '{safe}' was not found"}
        for key in ("name", "role", "emoji", "model"):
            if key in patch:
                meta[key] = str(patch.get(key) or "")
        if "instructions" in patch:
            meta["prompt"] = str(patch.get("instructions") or "")
        name = str(meta.get("name") or safe.replace("-", " ").title())
        role = str(meta.get("role") or "Antigravity Agent")
        emoji = str(meta.get("emoji") or "🌌")
        model = str(meta.get("model") or self.model or "inherit")
        prompt = str(meta.get("prompt") or role)
        native_path = str(meta.get("nativeAgentPath") or os.path.join(str(self.home_path), "agents", safe, "agent.md"))
        project_path = str(meta.get("projectAgentPath") or os.path.join(workspace, ".agents", "agents", safe, "agent.md"))
        paths = [meta_path, os.path.join(workspace, "IDENTITY.md"), os.path.join(workspace, "AGENTS.md"), os.path.join(workspace, "GEMINI.md"), native_path, project_path]
        backup_id, backups = backup_files(workspace, paths)
        self._write_json(meta_path, meta)
        self._write_text(os.path.join(workspace, "IDENTITY.md"), f"# IDENTITY.md\n\n- **Name:** {name}\n- **Creature:** {role} — Antigravity agent\n- **Emoji:** {emoji}\n")
        self._write_text(os.path.join(workspace, "AGENTS.md"), f"# {name}\n\n## Role\n{role}\n\n## Instructions\n{prompt}\n")
        self._write_text(os.path.join(workspace, "GEMINI.md"), f"# {name}\n\n{prompt}\n")
        self._write_text(native_path, self._agent_md(name, role, prompt, model))
        self._write_text(project_path, self._agent_md(name, role, prompt, model))
        return {"ok": True, "profile": safe, "backupId": backup_id, "backups": backups}

    def send_chat_message(
        self,
        profile: str,
        message: str,
        session_id: str | None = None,
        timeout_sec: int | None = None,
        on_progress: Any = None,
        **_: Any,
    ) -> dict[str, Any]:
        safe = self._safe(profile or "main")
        if not self._probe_auth():
            return {
                "ok": False,
                "error": self._last_auth_error or "Antigravity is not authenticated.",
                "reply": "",
                "sessionId": session_id or "",
                "providerPath": "antigravity-cli",
                "tools": [],
            }
        cmd = [self.binary or "agy", "--print", str(message or "")]
        if safe and safe != "main":
            cmd.extend(["--agent", safe])
        if session_id:
            cmd.extend(["--conversation", session_id])
        if self.model:
            cmd.extend(["--model", self.model])
        if self.sandbox:
            cmd.extend(["--sandbox", self.sandbox])
        if self.print_timeout:
            cmd.extend(["--print-timeout", self.print_timeout])
        workspace = self._workspace(safe)
        os.makedirs(workspace, exist_ok=True)
        proc: subprocess.Popen[str] | None = None
        try:
            proc = subprocess.Popen(cmd, cwd=workspace, env=self._env(), stdout=subprocess.PIPE, stderr=subprocess.PIPE, text=True)
            with _LOCK:
                _ACTIVE[safe] = proc
            stdout, stderr = proc.communicate(timeout=int(timeout_sec or self.timeout_sec))
            conversation = session_id or self._conversation_id(stderr)
            raw_error = (stderr or stdout).strip()
            if "authentication required" in raw_error.lower() or "authentication failed or timed out" in raw_error.lower():
                self._auth_ok = False
                self._last_auth_error = "Antigravity is installed but not authenticated. Sign in with the Antigravity CLI before running agents."
            elif proc.returncode == 0:
                self._auth_ok = True
                self._last_auth_error = ""
            return {
                "ok": proc.returncode == 0,
                "reply": stdout.strip(),
                "error": "" if proc.returncode == 0 else (self._last_auth_error or raw_error[-1200:]),
                "stderr": stderr.strip()[-4000:],
                "exitCode": proc.returncode,
                "sessionId": conversation or "",
                "providerPath": "antigravity-cli",
                "tools": [],
            }
        except subprocess.TimeoutExpired:
            if proc:
                proc.kill()
            return {"ok": False, "error": "Antigravity call timed out", "reply": "", "sessionId": session_id or ""}
        except Exception as exc:
            return {"ok": False, "error": str(exc), "reply": "", "sessionId": session_id or ""}
        finally:
            with _LOCK:
                if _ACTIVE.get(safe) is proc:
                    _ACTIVE.pop(safe, None)

    def interrupt(self, profile: str) -> dict[str, Any]:
        safe = self._safe(profile or "main")
        with _LOCK:
            proc = _ACTIVE.get(safe)
        if proc and proc.poll() is None:
            proc.terminate()
            return {"ok": True, "interrupted": True, "profile": safe}
        return {"ok": False, "error": f"No active Antigravity run for {safe}"}

    def _env(self) -> dict[str, str]:
        env = sanitized_env("VW_ANTIGRAVITY_ENV_ALLOWLIST")
        provider_home = os.environ.get("VW_PROVIDER_USER_HOME") or os.path.expanduser("~")
        if os.path.isdir(provider_home):
            env["HOME"] = provider_home
        return env

    def _probe_auth(self) -> bool:
        """Use the non-interactive model catalog as a fast authentication check."""
        try:
            result = subprocess.run(
                [self.binary or "agy", "models"],
                capture_output=True,
                text=True,
                timeout=15,
                env=self._env(),
            )
        except Exception as exc:
            self._auth_ok = False
            self._last_auth_error = f"Antigravity authentication check failed: {exc}"
            return False
        output = (result.stderr or result.stdout or "").strip()
        if result.returncode == 0:
            self._auth_ok = True
            self._last_auth_error = ""
            return True
        self._auth_ok = False
        if "sign in" in output.lower() or "auth" in output.lower():
            self._last_auth_error = "Antigravity is installed but not authenticated. Sign in with the Antigravity CLI before running agents."
        else:
            self._last_auth_error = output[-1200:] or "Antigravity authentication check failed."
        return False

    def _entry(self, profile: str, name: str, role: str, emoji: str, workspace: str, model: str, source: str) -> dict[str, Any]:
        return {
            "id": f"antigravity-{profile}", "statusKey": f"antigravity:{profile}",
            "providerAgentId": profile, "profile": profile, "name": name, "role": role, "emoji": emoji,
            "model": model, "workspace": workspace, "source": source,
            "lastActiveAt": self._last_active(workspace),
        }

    def _workspace(self, profile: str) -> str:
        return os.path.join(str(self.workspace_root), profile or "main")

    @staticmethod
    def _safe(value: Any) -> str:
        return re.sub(r"[^a-z0-9_-]+", "-", str(value or "").lower()).strip("-_")[:64]

    @staticmethod
    def _conversation_id(text: str) -> str:
        match = re.search(r"(?:--conversation|conversation(?:\s+id)?[:=])\s*([A-Za-z0-9_.:-]+)", text or "", re.I)
        return match.group(1) if match else ""

    @staticmethod
    def _load_json(path: Path) -> dict[str, Any]:
        try:
            value = json.loads(path.read_text(encoding="utf-8"))
            return value if isinstance(value, dict) else {}
        except Exception:
            return {}

    @staticmethod
    def _write_json(path: str, value: dict[str, Any]) -> None:
        AntigravityProvider._write_text(path, json.dumps(value, indent=2) + "\n")

    @staticmethod
    def _write_text(path: str, content: str) -> None:
        os.makedirs(os.path.dirname(path), exist_ok=True)
        tmp = f"{path}.tmp-{os.getpid()}"
        Path(tmp).write_text(content, encoding="utf-8")
        os.replace(tmp, path)

    @staticmethod
    def _agent_file_meta(path: Path) -> dict[str, str]:
        try:
            text = path.read_text(encoding="utf-8", errors="replace")
        except OSError:
            return {}
        if not text.startswith("---"):
            return {}
        end = text.find("\n---", 3)
        if end < 0:
            return {}
        result: dict[str, str] = {}
        for raw in text[3:end].splitlines():
            if ":" not in raw:
                continue
            key, value = raw.split(":", 1)
            result[key.strip()] = value.strip().strip("'\"")
        return result

    @staticmethod
    def _last_active(path: str) -> int:
        try:
            return int(max((item.stat().st_mtime for item in Path(path).rglob("*") if item.is_file()), default=0))
        except OSError:
            return 0

    @staticmethod
    def _agent_md(name: str, role: str, prompt: str, model: str) -> str:
        return (
            "---\n"
            f"name: {json.dumps(name)}\n"
            f"description: {json.dumps(role)}\n"
            "mainAgent: true\n"
            "subagent: false\n"
            "inheritMcp: true\n"
            f"model: {json.dumps(model or 'inherit')}\n"
            "---\n\n"
            f"# {name}\n\n{prompt}\n"
        )
