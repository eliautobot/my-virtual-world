"""Hermes provider adapter for My Virtual World.

This module is intentionally isolated from the OpenClaw discovery/runtime paths.
It talks to Hermes through public CLI surfaces only, so the product can add
Hermes support without hardcoding one user's setup or reading private Hermes
internals such as .env, auth.json, memories, raw logs, or state.db contents.
"""

from __future__ import annotations

import os
import re
import shutil
import subprocess
import json
import time
import glob
from dataclasses import dataclass
from typing import Any


@dataclass
class HermesProvider:
    """Provider adapter for local Hermes Agent profiles."""

    home_path: str | None = None
    binary: str | None = None
    enabled: bool = True
    timeout_sec: int = 600

    provider_kind: str = "hermes"
    provider_type: str = "runtime"

    def __post_init__(self) -> None:
        self.home_path = os.path.expanduser(
            self.home_path
            or os.environ.get("VW_HERMES_HOME")
            or "~/.hermes"
        )
        self.binary = self._resolve_binary(self.binary)

    def is_available(self) -> bool:
        return bool(self.enabled and self.binary and os.path.exists(self.binary) and self.home_path and os.path.isdir(self.home_path))

    def _subprocess_env(self) -> dict[str, str]:
        """Environment for Hermes CLI calls.

        Containers commonly run as root, where `~` would resolve to /root and
        Hermes would accidentally inspect/create /root/.hermes. When the user
        configured a Hermes home path, derive HOME from it so Hermes resolves
        its own profile paths consistently with the configured installation.
        """
        env = os.environ.copy()
        if self.home_path:
            env["VW_HERMES_HOME"] = self.home_path
            if os.path.basename(self.home_path.rstrip(os.sep)) == ".hermes":
                env["HOME"] = os.path.dirname(self.home_path.rstrip(os.sep)) or env.get("HOME", "")
            agent_root = os.path.join(self.home_path, "hermes-agent")
            site_packages = sorted(glob.glob(os.path.join(agent_root, "venv", "lib", "python*", "site-packages")))
            pythonpath_parts = [p for p in [agent_root, *site_packages, env.get("PYTHONPATH", "")] if p]
            if os.path.isdir(agent_root):
                env["PYTHONPATH"] = os.pathsep.join(pythonpath_parts)
        return env

    def discover_agents(self) -> list[dict[str, Any]]:
        """Return Hermes profiles as normalized Virtual World agent-like dictionaries."""
        if not self.is_available():
            return []

        profiles = self._list_profiles() or [{"profile": "default", "model": "", "gateway": ""}]
        agents: list[dict[str, Any]] = []
        for item in profiles:
            profile = item.get("profile") or "default"
            details = self._show_profile(profile)
            model = details.get("model") or item.get("model") or ""
            provider = details.get("provider") or ""
            gateway = details.get("gateway") or item.get("gateway") or ""
            profile_home = details.get("path") or (
                self.home_path if profile == "default" else os.path.join(self.home_path or "", "profiles", profile)
            )
            scan_home = profile_home if os.path.isdir(profile_home) else (self.home_path or "")
            identity = self._read_identity(profile_home)
            suffix = self._safe_suffix(profile)
            agents.append({
                "id": f"hermes-{suffix}",
                "statusKey": f"hermes-{suffix}",
                "providerKind": self.provider_kind,
                "providerType": self.provider_type,
                "providerAgentId": profile,
                "profile": profile,
                "name": identity.get("name") or self._display_name(profile),
                "emoji": identity.get("emoji") or os.environ.get("VW_HERMES_AGENT_EMOJI", "⚕️"),
                "role": identity.get("role") or "Hermes Agent",
                "model": model,
                "provider": provider,
                "gateway": gateway,
                "workspace": profile_home,
                "home": profile_home,
                "binary": self.binary,
                "lastActiveAt": self._last_active(scan_home),
                "capabilities": ["chat", "status", "sessions"],
            })
        return agents

    def test(self) -> dict[str, Any]:
        """Check whether Hermes is reachable and return discovered profiles."""
        if not self.binary or not os.path.exists(self.binary):
            return {"ok": False, "error": f"Hermes CLI not found at {self.binary}", "agents": []}
        if not self.home_path or not os.path.isdir(self.home_path):
            return {"ok": False, "error": f"Hermes home not found at {self.home_path}", "agents": []}
        try:
            probe = subprocess.run([self.binary, "profile", "list"], capture_output=True, text=True, timeout=15, env=self._subprocess_env())
            if probe.returncode != 0:
                return {"ok": False, "error": (probe.stderr or probe.stdout or "Hermes CLI probe failed").strip()[:1000], "agents": []}
            return {"ok": True, "binary": self.binary, "homePath": self.home_path, "agents": self.discover_agents()}
        except Exception as exc:  # defensive: test endpoint should not crash server
            return {"ok": False, "error": str(exc), "agents": []}

    def send_message(self, profile: str, message: str, timeout_sec: int | None = None) -> dict[str, Any]:
        """Send a one-shot message to Hermes and return stdout as the reply."""
        if not self.binary or not os.path.exists(self.binary):
            return {"ok": False, "error": f"Hermes CLI not found at {self.binary}", "exitCode": None, "reply": ""}
        if not message.strip():
            return {"ok": False, "error": "message is required", "exitCode": None, "reply": ""}

        cmd = [self.binary]
        if profile and profile != "default":
            cmd.extend(["--profile", profile])
        cmd.extend(["-z", message])

        try:
            result = subprocess.run(
                cmd,
                capture_output=True,
                text=True,
                timeout=int(timeout_sec or self.timeout_sec) + 30,
                env=self._subprocess_env(),
            )
            reply = (result.stdout or "").strip()
            stderr = (result.stderr or "").strip()
            if result.returncode != 0 and not reply:
                reply = f"[Hermes error] {stderr[:1000]}"
            return {
                "ok": result.returncode == 0,
                "reply": reply,
                "stderr": stderr[:2000],
                "exitCode": result.returncode,
                "profile": profile or "default",
            }
        except subprocess.TimeoutExpired:
            return {"ok": False, "error": "Hermes call timed out", "exitCode": None, "reply": ""}
        except Exception as exc:
            return {"ok": False, "error": str(exc), "exitCode": None, "reply": ""}

    def send_chat_message(self, profile: str, message: str, session_id: str | None = None, timeout_sec: int | None = None, yolo_once: bool = False, approval_bridge_dir: str | None = None) -> dict[str, Any]:
        """Send a message through Hermes chat, optionally resuming a session.

        Unlike ``send_message``/``hermes -z``, this uses the public
        ``hermes chat -Q -q`` surface so Virtual World can keep real Hermes
        session continuity by storing the returned ``session_id`` and passing it
        back with ``--resume`` on later turns.
        """
        if not self.binary or not os.path.exists(self.binary):
            return {"ok": False, "error": f"Hermes CLI not found at {self.binary}", "exitCode": None, "reply": "", "sessionId": session_id or ""}
        if not message.strip():
            return {"ok": False, "error": "message is required", "exitCode": None, "reply": "", "sessionId": session_id or ""}

        cmd = [self.binary]
        if profile and profile != "default":
            cmd.extend(["--profile", profile])
        cmd.extend(["chat", "-Q"])
        if session_id:
            cmd.extend(["--resume", session_id])
        if yolo_once:
            cmd.append("--yolo")
        cmd.extend(["-q", message])

        try:
            env = self._subprocess_env()
            if approval_bridge_dir:
                env["HERMES_APPROVAL_BRIDGE_DIR"] = approval_bridge_dir
            result = subprocess.run(
                cmd,
                capture_output=True,
                text=True,
                timeout=int(timeout_sec or self.timeout_sec) + 30,
                env=env,
            )
            stdout = (result.stdout or "").strip()
            stderr = (result.stderr or "").strip()
            found_session_id = session_id or ""
            reply_lines: list[str] = []
            for line in stdout.splitlines():
                m = re.match(r"^\s*session_id:\s*(\S+)\s*$", line)
                if m:
                    found_session_id = m.group(1).strip()
                else:
                    reply_lines.append(line)
            for line in stderr.splitlines():
                m = re.match(r"^\s*session_id:\s*(\S+)\s*$", line)
                if m:
                    found_session_id = m.group(1).strip()
            reply = "\n".join(reply_lines).strip()
            if result.returncode != 0 and not reply:
                reply = f"[Hermes error] {stderr[:1000]}"
            return {
                "ok": result.returncode == 0,
                "reply": reply,
                "stderr": stderr[:2000],
                "exitCode": result.returncode,
                "profile": profile or "default",
                "sessionId": found_session_id,
            }
        except subprocess.TimeoutExpired:
            return {"ok": False, "error": "Hermes call timed out", "exitCode": None, "reply": "", "sessionId": session_id or ""}
        except Exception as exc:
            return {"ok": False, "error": str(exc), "exitCode": None, "reply": "", "sessionId": session_id or ""}

    def export_session(self, profile: str, session_id: str, timeout_sec: int = 30) -> dict[str, Any]:
        """Export one Hermes session through the public CLI JSONL surface."""
        if not self.binary or not os.path.exists(self.binary):
            return {"ok": False, "error": f"Hermes CLI not found at {self.binary}", "session": None}
        if not session_id:
            return {"ok": False, "error": "session_id is required", "session": None}

        cmd = [self.binary]
        if profile and profile != "default":
            cmd.extend(["--profile", profile])
        cmd.extend(["sessions", "export", "--session-id", session_id, "-"])

        try:
            result = subprocess.run(
                cmd,
                capture_output=True,
                text=True,
                timeout=int(timeout_sec),
                env=self._subprocess_env(),
            )
            if result.returncode != 0:
                return {"ok": False, "error": (result.stderr or result.stdout or "Hermes session export failed").strip()[:2000], "session": None}
            sessions: list[dict[str, Any]] = []
            for raw in (result.stdout or "").splitlines():
                raw = raw.strip()
                if not raw:
                    continue
                try:
                    item = json.loads(raw)
                except json.JSONDecodeError:
                    continue
                if isinstance(item, dict):
                    sessions.append(item)
            session = next((s for s in sessions if str(s.get("id") or "") == str(session_id)), sessions[0] if sessions else None)
            return {"ok": bool(session), "session": session, "error": "" if session else "session not found in export"}
        except subprocess.TimeoutExpired:
            return {"ok": False, "error": "Hermes session export timed out", "session": None}
        except Exception as exc:
            return {"ok": False, "error": str(exc), "session": None}

    def create_agent(self, name: str, role: str = "Hermes Agent", model: str | None = None, emoji: str = "⚕️", profile: str | None = None, prompt: str | None = None) -> dict[str, Any]:
        """Create a Hermes profile that Virtual World treats as an agent."""
        if not self.binary or not os.path.exists(self.binary):
            return {"ok": False, "error": f"Hermes CLI not found at {self.binary}"}
        if not self.home_path or not os.path.isdir(self.home_path):
            return {"ok": False, "error": f"Hermes home not found at {self.home_path}"}

        safe_profile = self._safe_profile_name(profile or name)
        if safe_profile == "default":
            return {"ok": False, "error": "Cannot create or overwrite the default Hermes profile"}
        if any(a.get("profile") == safe_profile for a in self.discover_agents()):
            return {"ok": False, "error": f"Hermes profile '{safe_profile}' already exists"}

        description = (role or "Hermes Agent").strip()[:500]
        cmd = [
            self.binary,
            "profile",
            "create",
            safe_profile,
            "--clone",
            "--clone-from",
            "default",
            "--no-alias",
            "--description",
            description,
        ]
        result = subprocess.run(cmd, capture_output=True, text=True, timeout=60, env=self._subprocess_env())
        if result.returncode != 0:
            fallback = subprocess.run(
                [self.binary, "profile", "create", safe_profile, "--no-alias", "--description", description],
                capture_output=True,
                text=True,
                timeout=60,
                env=self._subprocess_env(),
            )
            if fallback.returncode != 0:
                return {
                    "ok": False,
                    "error": (fallback.stderr or fallback.stdout or result.stderr or result.stdout or "Hermes profile create failed").strip()[:2000],
                    "exitCode": fallback.returncode,
                }

        if model and str(model).strip():
            subprocess.run(
                [self.binary, "--profile", safe_profile, "config", "set", "model.default", str(model).strip()],
                capture_output=True,
                text=True,
                timeout=30,
                env=self._subprocess_env(),
            )

        profile_home = os.path.join(self.home_path, "profiles", safe_profile)
        os.makedirs(profile_home, exist_ok=True)
        self._write_profile_bootstrap(profile_home, name=name, role=role, emoji=emoji, profile=safe_profile, prompt=prompt or "")
        self._chown_like_home(profile_home)

        return {
            "ok": True,
            "profile": safe_profile,
            "agentId": f"hermes-{safe_profile}",
            "name": name,
            "workspace": profile_home,
            "message": f"Hermes profile '{safe_profile}' created successfully",
        }

    def delete_agent(self, profile: str) -> dict[str, Any]:
        """Delete a Hermes profile through the public CLI."""
        safe_profile = self._safe_profile_name(profile)
        if safe_profile == "default":
            return {"ok": False, "error": "Cannot delete the default Hermes profile"}
        if not self.binary or not os.path.exists(self.binary):
            return {"ok": False, "error": f"Hermes CLI not found at {self.binary}"}

        result = subprocess.run(
            [self.binary, "profile", "delete", safe_profile, "--yes"],
            capture_output=True,
            text=True,
            timeout=60,
            env=self._subprocess_env(),
        )
        return {
            "ok": result.returncode == 0,
            "deleted": result.returncode == 0,
            "profile": safe_profile,
            "agentId": f"hermes-{safe_profile}",
            "stdout": (result.stdout or "").strip()[:1000],
            "stderr": (result.stderr or "").strip()[:1000],
            "error": "" if result.returncode == 0 else ((result.stderr or result.stdout or "Hermes profile delete failed").strip()[:1000]),
            "exitCode": result.returncode,
        }

    def delete_session(self, profile: str, session_id: str) -> dict[str, Any]:
        """Delete a Hermes session through the public sessions CLI."""
        if not session_id:
            return {"ok": True, "deleted": False}
        if not self.binary or not os.path.exists(self.binary):
            return {"ok": False, "error": f"Hermes CLI not found at {self.binary}"}
        cmd = [self.binary]
        if profile and profile != "default":
            cmd.extend(["--profile", profile])
        cmd.extend(["sessions", "delete", session_id, "--yes"])
        try:
            result = subprocess.run(cmd, capture_output=True, text=True, timeout=30, env=self._subprocess_env())
            return {
                "ok": result.returncode == 0,
                "deleted": result.returncode == 0,
                "stdout": (result.stdout or "").strip()[:1000],
                "stderr": (result.stderr or "").strip()[:1000],
                "exitCode": result.returncode,
            }
        except Exception as exc:
            return {"ok": False, "error": str(exc)}

    def _list_profiles(self) -> list[dict[str, str]]:
        profiles: list[dict[str, str]] = []
        try:
            result = subprocess.run([self.binary or "hermes", "profile", "list"], capture_output=True, text=True, timeout=15, env=self._subprocess_env())
            if result.returncode != 0:
                return profiles
            for line in (result.stdout or "").splitlines():
                clean = line.strip()
                if not clean or clean.startswith("Profile") or clean.startswith("─"):
                    continue
                clean = clean.replace("◆", " ").strip()
                parts = re.split(r"\s{2,}", clean)
                if not parts:
                    continue
                profile = parts[0].strip()
                if not profile or profile in {"—", "-"}:
                    continue
                profiles.append({
                    "profile": profile,
                    "model": parts[1].strip() if len(parts) > 1 else "",
                    "gateway": parts[2].strip() if len(parts) > 2 else "",
                })
        except Exception:
            pass
        return profiles

    def _show_profile(self, profile: str) -> dict[str, str]:
        details: dict[str, str] = {}
        try:
            cmd = [self.binary or "hermes"]
            if profile != "default":
                cmd.extend(["--profile", profile])
            cmd.extend(["profile", "show", profile])
            result = subprocess.run(cmd, capture_output=True, text=True, timeout=15, env=self._subprocess_env())
            text = (result.stdout or "") + "\n" + (result.stderr or "")
            for line in text.splitlines():
                clean = line.strip(" │\t")
                if clean.startswith("Path:"):
                    details["path"] = clean.split(":", 1)[1].strip()
                elif clean.startswith("Model:"):
                    value = clean.split(":", 1)[1].strip()
                    m = re.match(r"(.+?)\s*\((.+?)\)\s*$", value)
                    if m:
                        details["model"] = m.group(1).strip()
                        details["provider"] = m.group(2).strip()
                    else:
                        details["model"] = value
                elif clean.startswith("Gateway:"):
                    details["gateway"] = clean.split(":", 1)[1].strip()
        except Exception:
            pass
        return details

    @staticmethod
    def _safe_suffix(profile: str) -> str:
        safe = re.sub(r"[^a-zA-Z0-9_.-]+", "-", profile or "default").strip("-.")
        return safe or "default"

    def _resolve_binary(self, value: str | None) -> str:
        home = os.path.expanduser(self.home_path or os.environ.get("VW_HERMES_HOME") or "~/.hermes")
        candidates = [
            value,
            os.environ.get("VW_HERMES_BIN"),
            shutil.which("hermes"),
            os.path.expanduser("~/.local/bin/hermes"),
            os.path.join(home, "hermes-agent", "hermes"),
            os.path.join(home, "hermes-agent", "venv", "bin", "hermes"),
        ]
        candidates.extend(sorted(glob.glob(os.path.join(home, "**", "bin", "hermes"), recursive=True), reverse=True))
        candidates.extend(sorted(glob.glob(os.path.join(home, "**", "hermes"), recursive=True), reverse=True))
        for candidate in candidates:
            if not candidate:
                continue
            expanded = os.path.expanduser(str(candidate))
            resolved = shutil.which(expanded) if os.path.basename(expanded) == expanded else expanded
            if resolved and os.path.isfile(resolved) and os.access(resolved, os.X_OK):
                return resolved
        return os.path.expanduser(str(value or os.environ.get("VW_HERMES_BIN") or "hermes"))

    @staticmethod
    def _safe_profile_name(value: str) -> str:
        safe = re.sub(r"[^a-z0-9_-]+", "-", (value or "").lower().strip()).strip("-_")
        safe = re.sub(r"[-_]{2,}", "-", safe)
        return (safe or f"agent-{int(time.time())}")[:63]

    def _write_profile_bootstrap(self, profile_home: str, *, name: str, role: str, emoji: str, profile: str, prompt: str = "") -> None:
        instructions = (prompt or role or "Be helpful and direct.").strip()
        files = {
            "IDENTITY.md": f"""# IDENTITY.md

- **Name:** {name}
- **Creature:** {role} - Hermes profile
- **Vibe:** Helpful, direct, ready to work
- **Emoji:** {emoji}
""",
            "SOUL.md": f"""# SOUL.md - {name}

You are **{name}** {emoji} - {role}.

## Style
- Be helpful and direct
- Keep work visible through Virtual World when possible
- Use your Hermes profile `{profile}` for isolated context

## Standing Instructions
{instructions}
""",
            "AGENTS.md": f"""# {name} {emoji} - {role}

## Role
{role}

## Standing Instructions
{instructions}

## Core Rules
- Follow instructions carefully
- Keep replies concise and useful
- Do not expose secrets from your Hermes profile

## Memory
- Use Hermes profile memory and sessions normally.
""",
            "MEMORY.md": f"# MEMORY.md - {name}\n\n_No memories yet._\n",
            "TOOLS.md": f"# TOOLS.md - {name}\n\n_Add tool-specific notes here._\n",
        }
        for filename, content in files.items():
            with open(os.path.join(profile_home, filename), "w", encoding="utf-8") as f:
                f.write(content)

    def _chown_like_home(self, path: str) -> None:
        try:
            st = os.stat(self.home_path or path)
            for root, dirs, files in os.walk(path):
                os.chown(root, st.st_uid, st.st_gid)
                for name in dirs + files:
                    try:
                        os.chown(os.path.join(root, name), st.st_uid, st.st_gid)
                    except OSError:
                        pass
        except OSError:
            pass

    def _display_name(self, profile: str) -> str:
        env_key = f"VW_HERMES_PROFILE_NAME_{self._safe_suffix(profile).upper().replace('-', '_')}"
        override = os.environ.get(env_key)
        if override:
            return override
        if profile == "default":
            return "Hermes"
        return profile.replace("-", " ").replace("_", " ").title()

    @staticmethod
    def _read_identity(profile_home: str) -> dict[str, str]:
        identity: dict[str, str] = {}
        try:
            with open(os.path.join(profile_home, "IDENTITY.md"), "r", encoding="utf-8") as f:
                for line in f:
                    line = line.strip()
                    m = re.match(r'-\s*\*\*Name:\*\*\s*(.+)', line)
                    if m:
                        identity["name"] = m.group(1).strip()
                    m = re.match(r'-\s*\*\*Emoji:\*\*\s*(.+)', line)
                    if m:
                        identity["emoji"] = m.group(1).strip()
                    m = re.match(r'-\s*\*\*Creature:\*\*\s*(.+)', line)
                    if m:
                        identity["role"] = m.group(1).split(" - Hermes profile")[0].strip().rstrip(" -")
        except (OSError, UnicodeError):
            pass
        return identity

    @staticmethod
    def _last_active(home_path: str) -> int:
        latest = 0
        for rel in ("state.db", os.path.join("logs", "agent.log"), os.path.join("logs", "errors.log")):
            path = os.path.join(home_path, rel)
            try:
                if os.path.exists(path):
                    latest = max(latest, int(os.path.getmtime(path)))
            except OSError:
                pass
        return latest
