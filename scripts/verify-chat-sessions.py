#!/usr/bin/env python3
"""Verify unified chat session APIs and bubble session metadata.

Runs against isolated temp data with fake provider/gateway surfaces, so it does
not touch real OpenClaw, Hermes, Codex, or Claude Code sessions.
"""

import importlib.util
import json
import os
import sys
import tempfile
import time
from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]
SERVER_PATH = ROOT / "src" / "server" / "server.py"
CHECKS = []


def check(name, condition, detail=""):
    CHECKS.append((name, bool(condition), detail))
    marker = "PASS" if condition else "FAIL"
    print(f"[{marker}] {name}" + (f" -- {detail}" if detail and not condition else ""))
    return bool(condition)


def load_server(tmpdir):
    data_dir = tmpdir / "data"
    openclaw_dir = tmpdir / "openclaw"
    claude_home = tmpdir / "claude"
    for path in (data_dir / "chunks", data_dir / "buildings", openclaw_dir, claude_home / "projects" / "test-project"):
        path.mkdir(parents=True, exist_ok=True)
    os.environ["VW_DATA_DIR"] = str(data_dir)
    os.environ["VW_STATUS_DIR"] = str(data_dir)
    os.environ["VW_STATUS_FILE"] = str(data_dir / "virtual-world-status.json")
    os.environ["VW_OPENCLAW_PATH"] = str(openclaw_dir)
    os.environ["VW_OPENCLAW_HOST_PATH"] = str(openclaw_dir)
    os.environ["VW_CLAUDE_CODE_HOME"] = str(claude_home)
    os.environ["CLAUDE_CONFIG_DIR"] = str(claude_home)
    os.environ["VW_CODEX_INCLUDE_NATIVE_AGENTS"] = "0"
    os.environ["VW_CLAUDE_CODE_INCLUDE_NATIVE_AGENTS"] = "0"
    os.environ["_VW_INT"] = "1"

    spec = importlib.util.spec_from_file_location("mvw_server_chat_sessions_test", SERVER_PATH)
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    module._agent_roster = [
        {"id": "resident-a", "statusKey": "resident-a", "name": "Resident A", "providerKind": "openclaw", "providerAgentId": "resident-a", "profile": "resident-a"},
        {"id": "coder", "statusKey": "coder", "name": "Coder", "providerKind": "openclaw", "providerAgentId": "coder", "profile": "coder"},
        {"id": "hermes-default", "statusKey": "hermes-default", "name": "Hermes", "providerKind": "hermes", "providerAgentId": "default", "profile": "default"},
        {"id": "codex-main", "statusKey": "codex-main", "name": "Codex", "providerKind": "codex", "providerAgentId": "main", "profile": "main"},
        {"id": "claude-main", "statusKey": "claude-main", "name": "Claude", "providerKind": "claude-code", "providerAgentId": "main", "profile": "main"},
    ]
    module._roster_time = time.time()
    return module, data_dir


class FakeHermesProvider:
    def __init__(self):
        self.deleted = []

    def list_sessions(self, profile, limit=40):
        return {
            "ok": True,
            "sessions": [
                {"id": "hermes-session-1", "title": "Hermes Current", "preview": "latest", "lastActive": "2026-07-07 10:30"},
                {"id": "hermes-session-0", "title": "Hermes Older", "preview": "older", "lastActive": "2026-07-06 09:00"},
            ][:limit],
            "profile": profile,
        }

    def export_session(self, profile, session_id):
        return {
            "ok": True,
            "session": {
                "id": session_id,
                "messages": [
                    {"role": "user", "content": "hello"},
                    {"role": "assistant", "content": "hi from hermes"},
                    {"role": "tool", "content": "hidden"},
                ],
            },
        }

    def delete_session(self, profile, session_id):
        self.deleted.append((profile, session_id))
        return {"ok": True, "deleted": True}


class FakeCodexProvider:
    def __init__(self):
        self.deleted = []

    def list_threads(self, profile, limit=40):
        return {
            "ok": True,
            "sessions": [
                {"id": "codex-thread-1", "title": "Codex Current", "preview": "latest", "updatedAt": "2026-07-07T14:00:00Z", "archived": False},
                {"id": "codex-thread-archived", "title": "Archived", "preview": "old", "updatedAt": "2026-07-01T14:00:00Z", "archived": True},
            ][:limit],
            "profile": profile,
        }

    def read_thread(self, profile, thread_id):
        return {
            "ok": True,
            "thread": {
                "id": thread_id,
                "turns": [
                    {"items": [
                        {"type": "userMessage", "content": [{"text": "build it"}]},
                        {"type": "agentMessage", "text": "built it"},
                    ]},
                ],
            },
        }

    def delete_thread(self, profile, thread_id):
        self.deleted.append((profile, thread_id))
        return {"ok": True, "deleted": True}


def main():
    with tempfile.TemporaryDirectory(prefix="mvw-chat-sessions-") as raw_tmp:
        server, data_dir = load_server(Path(raw_tmp))

        # Seed live mode + presence so /api/agent-chat can synthesize the live
        # session even when the ephemeral planner transcript is deleted.
        server.save_live_agent_loop_state({
            "enabled": True,
            "agents": {
                "resident-a": {
                    "enabled": True,
                    "lastDecision": {
                        "at": "2026-07-07T13:05:00Z",
                        "mode": "heuristic",
                        "selectedActionId": "life.consumeDrink",
                        "selectedActionLabel": "Get coffee",
                        "reason": "The resident's energy need is high.",
                    },
                    "activePlan": {
                        "id": "plan-resident-coffee",
                        "status": "in_progress",
                        "title": "Get coffee",
                        "operatorSummary": "The resident is walking to the coffee machine.",
                        "actionType": "interaction.consumeDrink",
                        "loopActionId": "life.consumeDrink",
                        "steps": [{"id": "step-1", "label": "Walk to the coffee machine", "status": "in_progress"}],
                        "updatedAt": "2026-07-07T13:06:00Z",
                    },
                },
                "coder": {"enabled": True},
            },
            "events": [{
                "type": "action-created",
                "agentId": "resident-a",
                "at": "2026-07-07T13:06:00Z",
                "details": {
                    "actionId": "world-action-resident-coffee",
                    "loopActionId": "life.consumeDrink",
                    "reason": "continuous-presence",
                },
            }],
        })
        meta = server.load_world_meta_fast()
        meta["agentProfiles"] = {
            "resident-a": {"agentLiveModeEnabled": True},
            "coder": {"agentLiveModeEnabled": False},
        }
        server.save_world_meta(meta)
        (data_dir / "virtual-world-status.json").write_text(json.dumps({
            "resident-a": {"state": "working", "task": "Living in My Virtual World: getting coffee", "updated": int(time.time())}
        }), encoding="utf-8")
        resident_sessions_dir = data_dir.parent / "openclaw" / "agents" / "resident-a" / "sessions"
        resident_sessions_dir.mkdir(parents=True, exist_ok=True)
        deleted_planner_file = resident_sessions_dir / "resident-live-planner.jsonl.deleted.2026-07-07T13-07-00Z"
        deleted_planner_file.write_text("\n".join([
            json.dumps({"type": "session", "id": "resident-live-planner", "timestamp": "2026-07-07T13:06:30Z"}),
            json.dumps({"type": "message", "timestamp": "2026-07-07T13:06:31Z", "message": {"role": "user", "content": "LIVE MODE PLANNER FRAME - EPHEMERAL LOOP CONTEXT\nAvailable interactions right now:\n- hydrate-coffee-machine: Get coffee\nDecide now. ACTION:"}}),
            json.dumps({"type": "message", "timestamp": "2026-07-07T13:06:34Z", "message": {"role": "assistant", "content": [{"type": "text", "text": "ACTION: hydrate-coffee-machine"}]}}),
        ]) + "\n", encoding="utf-8")

        gateway_calls = []

        def fake_gateway(method, params=None, timeout=20):
            gateway_calls.append((method, params or {}))
            if method == "sessions.list":
                return {"ok": True, "sessions": [
                    {"key": "agent:resident-a:main", "label": "Main chat", "preview": "main preview", "updatedAt": "2026-07-07T13:00:00Z"},
                    {"key": "agent:coder:main", "label": "Main chat", "preview": "coder main preview", "updatedAt": "2026-07-07T13:05:00Z"},
                ]}
            if method in {"sessions.reset", "sessions.delete"}:
                return {"ok": True, "payload": {}}
            return {"ok": False, "error": f"unexpected gateway method {method}"}

        fake_hermes = FakeHermesProvider()
        fake_codex = FakeCodexProvider()
        server._gateway_rpc_call = fake_gateway
        server._hermes_provider = lambda: fake_hermes
        server._codex_provider = lambda: fake_codex

        server._save_hermes_state("default", {"messages": [], "sessionId": "hermes-session-1"})
        server._save_codex_state("main", {"messages": [], "sessionId": "codex-thread-1"})
        claude_session_id = "11111111-2222-3333-4444-555555555555"
        claude_file = data_dir.parent / "claude" / "projects" / "test-project" / f"{claude_session_id}.jsonl"
        claude_file.write_text("\n".join([
            json.dumps({"type": "user", "sessionId": claude_session_id, "timestamp": "2026-07-07T10:00:00Z", "message": {"role": "user", "content": "hello claude"}, "cwd": "/tmp/test-project"}),
            json.dumps({"type": "assistant", "sessionId": claude_session_id, "timestamp": "2026-07-07T10:01:00Z", "message": {"role": "assistant", "content": [{"type": "text", "text": "hi from claude"}]}, "cwd": "/tmp/test-project"}),
            json.dumps({"type": "last-prompt", "sessionId": claude_session_id, "timestamp": "2026-07-07T10:02:00Z", "lastPrompt": "hello claude"}),
        ]) + "\n", encoding="utf-8")

        openclaw_payload, openclaw_status = server.handle_chat_sessions_list("resident-a")
        check("OpenClaw sessions list succeeds", openclaw_status == 200 and openclaw_payload.get("ok"))
        openclaw_sessions = openclaw_payload.get("sessions") or []
        check("OpenClaw main session is listed", any(s.get("id") == "agent:resident-a:main" for s in openclaw_sessions))
        live_session = next((s for s in openclaw_sessions if s.get("liveMode")), None)
        check("Live Mode appears as active durable session", bool(live_session and live_session.get("active") and live_session.get("durable") and not live_session.get("virtual")))
        coder_payload, coder_status = server.handle_chat_sessions_list("coder")
        check("non-live OpenClaw agent does not get virtual Live Mode session", coder_status == 200 and not any(s.get("liveMode") for s in (coder_payload.get("sessions") or [])), json.dumps(coder_payload, default=str))

        created, status = server.handle_chat_session_create("resident-a", {"sessionKey": "agent:resident-a:main"})
        check("OpenClaw create/reset uses gateway sessions.reset", status == 200 and created.get("ok") and gateway_calls[-1][0] == "sessions.reset")
        switched, status = server.handle_chat_session_switch("resident-a", live_session.get("sessionKey"))
        check("OpenClaw switch returns stable lived session key", status == 200 and switched.get("sessionKey") == "vw-live-mode:resident-a")
        check("OpenClaw live session switch returns visible structured messages", bool(switched.get("liveMode") and switched.get("messages") and any(m.get("eventType") == "activation" for m in switched.get("messages", []))))
        check("OpenClaw live session hides raw planner prompt", not any("LIVE MODE PLANNER FRAME" in (m.get("text") or "") or m.get("eventType") == "planner-prompt" for m in switched.get("messages", [])), json.dumps(switched.get("messages", [])[:2], default=str))
        check("OpenClaw live session hides raw planner reply", not any("ACTION: hydrate-coffee-machine" in (m.get("text") or "") or m.get("eventType") == "planner-reply" for m in switched.get("messages", [])), json.dumps(switched.get("messages", [])[:2], default=str))
        check("OpenClaw lived session uses agent display name", bool(any(m.get("from") == "Resident A" and m.get("eventType") == "activation" for m in switched.get("messages", []))), json.dumps(switched.get("messages", [])[:4], default=str))
        deleted, status = server.handle_chat_session_delete("resident-a", "agent:resident-a:old-session")
        check("OpenClaw delete uses gateway sessions.delete", status == 200 and deleted.get("deleted") and gateway_calls[-1][0] == "sessions.delete")

        sample_messages = [{"sessionTitle": "Main chat", "liveMode": False}]
        server._agent_chat_apply_session_meta(sample_messages, {"sessionKey": "agent:resident-a:vw-live-mode-planner", "sessionTitle": "Live Agent Mode", "liveMode": True})
        check("active session metadata overrides stale message metadata", sample_messages[0].get("sessionTitle") == "Live Agent Mode" and sample_messages[0].get("sessionKey") == "agent:resident-a:vw-live-mode-planner" and sample_messages[0].get("liveMode") is True)

        chat = server.get_agent_chat()
        resident_chat = chat.get("resident-a") or []
        check("agent chat synthesizes live-mode bubble row", bool(resident_chat and resident_chat[-1].get("sessionTitle") == "Live Agent Mode"))
        check("live-mode bubble row carries active durable session metadata", bool(resident_chat and resident_chat[-1].get("activeSession") and resident_chat[-1].get("liveMode") and resident_chat[-1].get("sessionKey") == "vw-live-mode:resident-a" and resident_chat[-1].get("activationId")))

        resident_session_file = resident_sessions_dir / "resident-main-session.jsonl"
        resident_session_file.write_text(json.dumps({
            "type": "message",
            "timestamp": "2026-07-07T13:10:00Z",
            "message": {"role": "assistant", "content": "main chat answer"},
        }) + "\n", encoding="utf-8")
        (resident_sessions_dir / "sessions.json").write_text(json.dumps({
            "agent:resident-a:main": {
                "updatedAt": 1783429800000,
                "sessionId": "resident-main-session",
                "sessionFile": str(resident_session_file),
            }
        }), encoding="utf-8")
        server._gateway_presence_connected = lambda: True
        server._chat_cache = {}
        server._chat_cache_time = 0
        chat_with_main = server.get_agent_chat()
        resident_main_chat = chat_with_main.get("resident-a") or []
        check("agent chat keeps actual main session metadata when Live Mode is also active", bool(resident_main_chat and resident_main_chat[-1].get("sessionTitle") == "Main chat" and resident_main_chat[-1].get("sessionKey") == "agent:resident-a:main" and not resident_main_chat[-1].get("liveMode")), json.dumps(resident_main_chat[-2:], default=str))

        hermes_payload, hermes_status = server.handle_chat_sessions_list("hermes-default")
        check("Hermes sessions list uses provider", hermes_status == 200 and hermes_payload.get("sessions", [{}])[0].get("active") is True)
        switched, status = server.handle_chat_session_switch("hermes-default", "hermes-session-1")
        check("Hermes switch exports messages", status == 200 and len(switched.get("messages") or []) == 2 and server._get_hermes_session_id("default") == "hermes-session-1")
        deleted, status = server.handle_chat_session_delete("hermes-default", "hermes-session-1")
        check("Hermes delete clears active session", status == 200 and deleted.get("deleted") and server._get_hermes_session_id("default") == "")

        codex_payload, codex_status = server.handle_chat_sessions_list("codex-main")
        codex_sessions = codex_payload.get("sessions") or []
        check("Codex list filters archived threads", codex_status == 200 and len(codex_sessions) == 1 and codex_sessions[0].get("id") == "codex-thread-1")
        switched, status = server.handle_chat_session_switch("codex-main", "codex-thread-1")
        check("Codex switch reads thread messages", status == 200 and len(switched.get("messages") or []) == 2 and server._get_codex_session_id("main") == "codex-thread-1")
        deleted, status = server.handle_chat_session_delete("codex-main", "codex-thread-1")
        check("Codex delete clears active thread", status == 200 and deleted.get("deleted") and server._get_codex_session_id("main") == "")

        claude_payload, claude_status = server.handle_chat_sessions_list("claude-main")
        claude_sessions = claude_payload.get("sessions") or []
        check("Claude Code lists native JSONL sessions", claude_status == 200 and claude_sessions and claude_sessions[0].get("id") == claude_session_id)
        switched, status = server.handle_chat_session_switch("claude-main", claude_session_id)
        check("Claude Code switch reads JSONL messages", status == 200 and len(switched.get("messages") or []) == 2 and server._get_claude_code_session_id("main") == claude_session_id)
        deleted, status = server.handle_chat_session_delete("claude-main", claude_session_id)
        check("Claude Code delete renames native session file and clears active id", status == 200 and deleted.get("deleted") and server._get_claude_code_session_id("main") == "" and not claude_file.exists())

    failures = [name for name, ok, _detail in CHECKS if not ok]
    if failures:
        print(f"FAILED: {len(failures)} chat session checks failed: {', '.join(failures)}", file=sys.stderr)
        sys.exit(1)
    print(f"verify-chat-sessions: OK ({len(CHECKS)} checks)")


if __name__ == "__main__":
    main()
