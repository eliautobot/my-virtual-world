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
import threading
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
        {"id": "opencode-main", "statusKey": "opencode-main", "name": "OpenCode", "providerKind": "opencode", "providerAgentId": "main", "profile": "main", "capabilities": {"chat": True, "sessions": True, "sessionCreate": True, "sessionDelete": True, "sessionSwitch": True}},
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


class FakeOpenCodeProvider:
    def __init__(self):
        self.deleted = []
        self.block_chat = False
        self.chat_started = threading.Event()
        self.chat_release = threading.Event()

    def list_sessions(self, profile, limit=40):
        return {"ok": True, "sessions": [
            {"id": "opencode-session-1", "title": "OpenCode Current", "updatedAt": "2026-07-07T15:00:00Z"},
            {"id": "opencode-session-0", "title": "OpenCode Older", "updatedAt": "2026-07-06T15:00:00Z"},
        ][:limit]}

    def export_session(self, profile, session_id):
        return {"ok": True, "session": {"info": {"id": session_id}, "messages": [
            {"info": {"role": "user", "time": {"created": 1}}, "parts": [{"type": "text", "text": "hello opencode"}]},
            {"info": {"role": "assistant", "time": {"created": 2}}, "parts": [
                {"type": "text", "text": "hi from opencode"},
                {"type": "tool", "id": "tool-1", "tool": "read", "state": {"status": "completed", "output": "ok"}},
            ]},
        ]}}

    def delete_session(self, profile, session_id):
        self.deleted.append((profile, session_id))
        return {"ok": True, "deleted": True, "sessionId": session_id}

    def send_chat_message(self, profile, message, **kwargs):
        self.chat_started.set()
        if self.block_chat:
            self.chat_release.wait(timeout=5)
        return {"ok": True, "reply": "opencode run finished", "sessionId": kwargs.get("session_id") or "opencode-session-1"}


class FakeProviderRegistry:
    def __init__(self, provider):
        self.provider = provider

    def get(self, provider_kind):
        return self.provider if provider_kind == "opencode" else None

    def invoke(self, provider_kind, operation, *args, **kwargs):
        provider = self.get(provider_kind)
        method = getattr(provider, operation, None) if provider else None
        if not callable(method):
            return {"ok": False, "error": f"unsupported fake operation: {provider_kind}.{operation}"}
        return method(*args, **kwargs)


def main():
    with tempfile.TemporaryDirectory(prefix="mvw-chat-sessions-") as raw_tmp:
        server, data_dir = load_server(Path(raw_tmp))

        original_merge_profiles = server._merge_agent_profiles
        merge_calls = []
        server._merge_agent_profiles = lambda roster, meta=None: merge_calls.append(True) or original_merge_profiles(roster, meta=meta)
        server._merged_roster_cache_key = None
        server._merged_roster_cache = []
        server.get_roster()
        merge_calls.clear()
        server.get_roster()
        server.get_roster()
        check("hot roster lookups normalize Live state only once per world revision", len(merge_calls) <= 1, str(len(merge_calls)))
        server._merge_agent_profiles = original_merge_profiles

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
        server._gateway_presence_connected = lambda: True
        server._hermes_provider = lambda: fake_hermes
        server._codex_provider = lambda: fake_codex

        coder_sessions_dir = data_dir.parent / "openclaw" / "agents" / "coder" / "sessions"
        coder_sessions_dir.mkdir(parents=True, exist_ok=True)
        coder_session_file = coder_sessions_dir / "coder-main-session.jsonl"
        coder_session_file.write_text("\n".join([
            json.dumps({"type": "message", "timestamp": "2026-07-07T13:09:00Z", "message": {"role": "user", "content": "fix the active bubble"}}),
            json.dumps({"type": "message", "timestamp": "2026-07-07T13:10:00Z", "message": {"role": "assistant", "content": [{"type": "text", "text": "working on the active bubble"}]}}),
            json.dumps({"type": "message", "timestamp": "2026-07-07T13:10:01Z", "message": {"role": "assistant", "content": [{"type": "toolCall", "name": "read", "arguments": {"path": "/tmp/chat.js"}}]}}),
            json.dumps({"type": "message", "timestamp": "2026-08-08T15:54:19.660Z", "message": {"role": "assistant", "content": [{"type": "toolCall", "id": "tool-1", "name": "read", "arguments": {"path": "/tmp/example"}}]}}),
            json.dumps({"type": "message", "timestamp": "2026-08-08T15:55:01.433Z", "message": {"role": "assistant", "content": [{"type": "text", "text": "Final answer"}]}}),
        ]) + "\n", encoding="utf-8")
        (coder_sessions_dir / "sessions.json").write_text(json.dumps({
            "agent:coder:main": {
                "updatedAt": 1783429801000,
                "sessionId": "coder-main-session",
                "sessionFile": str(coder_session_file),
            }
        }), encoding="utf-8")

        # OpenClaw's gateway transcript can omit safe public Codex commentary.
        # Seed a long trajectory/rollout pair to verify run->thread recovery,
        # while ensuring private reasoning and final_answer records stay out.
        commentary_run_id = "world-commentary-run"
        commentary_run_id_2 = "world-commentary-run-2"
        commentary_thread_id = "019fd7c8-15ec-7852-a0a4-a0188edb277d"
        commentary_trajectory = [
            json.dumps({"type": "session.started", "ts": "2026-08-08T15:54:02.000Z", "runId": commentary_run_id, "data": {"threadId": commentary_thread_id}}),
            json.dumps({"type": "context.compiled", "ts": "2026-08-08T15:54:02.149Z", "runId": commentary_run_id, "data": {"threadId": commentary_thread_id}}),
        ]
        commentary_trajectory.extend(
            json.dumps({"type": "diagnostic", "ts": f"2026-08-08T{15 + (54 + index) // 60:02d}:{(54 + index) % 60:02d}:00.000Z", "runId": commentary_run_id, "data": {"sequence": index}})
            for index in range(100)
        )
        commentary_trajectory.extend([
            json.dumps({"type": "tool.call", "ts": "2026-08-08T15:54:19.660Z", "runId": commentary_run_id, "data": {"toolCallId": "tool-1", "name": "read", "arguments": {"path": "/tmp/example"}}}),
            json.dumps({"type": "tool.result", "ts": "2026-08-08T15:54:20.699Z", "runId": commentary_run_id, "data": {"toolCallId": "tool-1", "name": "read", "result": "ok"}}),
            json.dumps({"type": "session.ended", "ts": "2026-08-08T17:40:00.000Z", "runId": commentary_run_id, "data": {"threadId": commentary_thread_id, "status": "success"}}),
            json.dumps({"type": "session.started", "ts": "2026-08-08T18:00:00.000Z", "runId": commentary_run_id_2, "data": {"threadId": commentary_thread_id}}),
            json.dumps({"type": "context.compiled", "ts": "2026-08-08T18:00:00.100Z", "runId": commentary_run_id_2, "data": {"threadId": commentary_thread_id}}),
            json.dumps({"type": "session.ended", "ts": "2026-08-08T18:01:00.000Z", "runId": commentary_run_id_2, "data": {"threadId": commentary_thread_id, "status": "success"}}),
        ])
        (coder_sessions_dir / "coder-main-session.trajectory.jsonl").write_text("\n".join(commentary_trajectory) + "\n", encoding="utf-8")
        rollout_dir = data_dir.parent / "openclaw" / "agents" / "coder" / "agent" / "codex-home" / "sessions" / "2026" / "08" / "08"
        rollout_dir.mkdir(parents=True, exist_ok=True)
        commentary_rollout = [
            json.dumps({"timestamp": "2026-08-08T15:54:10.855Z", "type": "response_item", "payload": {"type": "reasoning", "summary": [], "encrypted_content": "private"}}),
            json.dumps({"timestamp": "2026-08-08T15:54:11.863Z", "type": "response_item", "payload": {"id": "commentary-1", "type": "message", "role": "assistant", "phase": "commentary", "content": [{"type": "output_text", "text": "I will inspect the exact change set."}]}}),
        ]
        commentary_rollout.extend(
            json.dumps({"timestamp": f"2026-08-08T{15 + (54 + index) // 60:02d}:{(54 + index) % 60:02d}:00.500Z", "type": "response_item", "payload": {"type": "reasoning", "summary": [], "encrypted_content": f"private-{index}"}})
            for index in range(100)
        )
        commentary_rollout.append(
            json.dumps({"timestamp": "2026-08-08T15:55:01.433Z", "type": "response_item", "payload": {"id": "final-1", "type": "message", "role": "assistant", "phase": "final_answer", "content": [{"type": "output_text", "text": "Final answer"}]}}),
        )
        commentary_rollout.extend([
            json.dumps({"timestamp": "2026-08-08T17:50:00.000Z", "type": "response_item", "payload": {"id": "commentary-orphan", "type": "message", "role": "assistant", "phase": "commentary", "content": [{"type": "output_text", "text": "This gap message belongs to no run."}]}}),
            json.dumps({"timestamp": "2026-08-08T18:00:10.000Z", "type": "response_item", "payload": {"id": "commentary-2", "type": "message", "role": "assistant", "phase": "commentary", "content": [{"type": "output_text", "text": "I will verify the second request."}]}}),
        ])
        (rollout_dir / f"rollout-2026-08-08T11-54-02-{commentary_thread_id}.jsonl").write_text("\n".join(commentary_rollout) + "\n", encoding="utf-8")

        recovered = server._session_trajectory_messages("agent:coder:main", max_tools=80)
        recovered_commentary = [msg for msg in recovered if msg.get("source") == "codex-commentary"]
        recovered_by_text = {msg.get("text"): msg for msg in recovered_commentary}
        check("OpenClaw activity recovers public Codex commentary", len(recovered_commentary) == 2 and "I will inspect the exact change set." in recovered_by_text)
        check("Long trajectories retain Codex thread mapping", len(recovered_commentary) == 2)
        check("Long Codex rollouts retain early commentary", "I will inspect the exact change set." in recovered_by_text)
        check("Codex commentary keeps its OpenClaw run id", recovered_by_text.get("I will inspect the exact change set.", {}).get("runId") == commentary_run_id)
        check("One Codex thread is separated across OpenClaw runs", recovered_by_text.get("I will verify the second request.", {}).get("runId") == commentary_run_id_2)
        check("Commentary outside every run window is rejected", "This gap message belongs to no run." not in recovered_by_text)
        check("Codex recovery excludes reasoning and final-answer records", all("private" not in str(msg) and msg.get("text") != "Final answer" for msg in recovered))
        commentary_only = server._session_trajectory_messages("agent:coder:main", run_id=commentary_run_id_2, commentary_only=True)
        check("Commentary-only recovery excludes tools", len(commentary_only) == 1 and all(not msg.get("tools") for msg in commentary_only))
        check("Run-scoped recovery never replays older commentary", commentary_only[0].get("text") == "I will verify the second request." if commentary_only else False)
        check("Recovered commentary exposes its verified run boundary", commentary_only[0].get("runStartedAt") == server._timestamp_epoch_ms("2026-08-08T18:00:00.000Z") if commentary_only else False)
        check("Session activity enforces one overall limit", len(server._session_trajectory_messages("agent:coder:main", max_tools=1)) == 1)
        unknown_transcript, unknown_trajectory, unknown_info = server._openclaw_session_paths(
            "coder", "agent:coder:vw-chat-new-session"
        )
        check(
            "fresh OpenClaw session does not inherit the newest old trajectory",
            unknown_transcript is None and unknown_trajectory is None and not unknown_info,
            json.dumps(unknown_info, default=str),
        )
        check(
            "fresh OpenClaw session activity starts empty",
            server._session_trajectory_messages("agent:coder:vw-chat-new-session", max_tools=80) == [],
        )
        server._append_comm_event({
            "ts": 1783430400000,
            "from": {"id": "coder", "name": "Coder"},
            "to": {"id": "resident-a", "name": "Resident A"},
            "text": "newer field report that must not hide the active main session",
        })

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

        gateway_call_count = len(gateway_calls)
        created, status = server.handle_chat_session_create("resident-a", {"sessionKey": "agent:resident-a:main"})
        check(
            "OpenClaw new session preserves the current gateway session",
            status == 200
            and created.get("ok")
            and str(created.get("sessionKey") or "").startswith("agent:resident-a:vw-chat-")
            and created.get("sessionKey") != "agent:resident-a:main"
            and len(gateway_calls) == gateway_call_count,
            json.dumps(created, default=str),
        )
        server._live_agent_session_append(
            "resident-a",
            kind="observation",
            phase="observe",
            role="system",
            text="The nearby chair is currently in use.",
            source="world-resource-telemetry",
        )
        switched, status = server.handle_chat_session_switch("resident-a", live_session.get("sessionKey"))
        check("OpenClaw switch returns stable lived session key", status == 200 and switched.get("sessionKey") == "vw-live-mode:resident-a")
        check("OpenClaw live session switch returns visible structured messages", bool(switched.get("liveMode") and switched.get("messages") and any(m.get("eventType") == "activation" for m in switched.get("messages", []))))
        check("OpenClaw live session hides raw planner prompt", not any("LIVE MODE PLANNER FRAME" in (m.get("text") or "") or m.get("eventType") == "planner-prompt" for m in switched.get("messages", [])), json.dumps(switched.get("messages", [])[:2], default=str))
        check("OpenClaw live session hides raw planner reply", not any("ACTION: hydrate-coffee-machine" in (m.get("text") or "") or m.get("eventType") == "planner-reply" for m in switched.get("messages", [])), json.dumps(switched.get("messages", [])[:2], default=str))
        check("Live lifecycle telemetry uses the World sender", bool(any(m.get("from") == "World" and m.get("fromType") == "system" and m.get("eventType") == "activation" for m in switched.get("messages", []))), json.dumps(switched.get("messages", [])[:4], default=str))
        world_observation = next((m for m in switched.get("messages", []) if m.get("eventSource") == "world-resource-telemetry"), {})
        check(
            "world resource telemetry stays visibly separate from Resident speech",
            world_observation.get("role") == "system" and world_observation.get("from") == "World" and world_observation.get("fromType") == "system",
            json.dumps(world_observation, default=str),
        )
        deleted, status = server.handle_chat_session_delete("resident-a", "agent:resident-a:old-session")
        check("OpenClaw delete uses gateway sessions.delete", status == 200 and deleted.get("deleted") and gateway_calls[-1][0] == "sessions.delete")

        sample_messages = [{"sessionTitle": "Main chat", "liveMode": False}]
        server._agent_chat_apply_session_meta(sample_messages, {"sessionKey": "agent:resident-a:vw-live-mode-planner", "sessionTitle": "Live Agent Mode", "liveMode": True})
        check("active session metadata overrides stale message metadata", sample_messages[0].get("sessionTitle") == "Live Agent Mode" and sample_messages[0].get("sessionKey") == "agent:resident-a:vw-live-mode-planner" and sample_messages[0].get("liveMode") is True)

        chat = server.get_agent_chat()
        resident_chat = chat.get("resident-a") or []
        check("agent chat synthesizes live-mode bubble row", bool(resident_chat and resident_chat[-1].get("sessionTitle") == "Live Agent Mode"))
        check("live-mode bubble row carries active durable session metadata", bool(resident_chat and resident_chat[-1].get("activeSession") and resident_chat[-1].get("liveMode") and resident_chat[-1].get("sessionKey") == "vw-live-mode:resident-a" and resident_chat[-1].get("activationId")))
        coder_chat = chat.get("coder") or []
        coder_active_chat = [row for row in coder_chat if row.get("activeSession") is True]
        check(
            "OpenClaw active-session messages retain sortable epoch timestamps",
            bool(coder_active_chat and all(int(row.get("epochMs") or 0) > 0 for row in coder_active_chat)),
            json.dumps(coder_chat[-6:], default=str),
        )
        check(
            "OpenClaw active session survives newer local field-report history",
            bool(any(row.get("text") == "working on the active bubble" for row in coder_active_chat)),
            json.dumps(coder_chat[-6:], default=str),
        )
        check(
            "current OpenClaw toolCall activity is parsed into the active stream",
            bool(any(row.get("text") == "📄 chat.js" for row in coder_active_chat)),
            json.dumps(coder_active_chat[-4:], default=str),
        )
        yellow_order = [
            row.get("text")
            for row in coder_active_chat
            if row.get("text") in {"I will inspect the exact change set.", "📄 example", "Final answer"}
        ]
        check(
            "yellow bubble recovers public commentary before tool and final",
            yellow_order == ["I will inspect the exact change set.", "📄 example", "Final answer"],
            json.dumps(coder_active_chat[-8:], default=str),
        )

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
        check(
            "active Live Mode bubble overrides stale main-session content",
            bool(
                resident_main_chat
                and resident_main_chat[-1].get("sessionTitle") == "Live Agent Mode"
                and resident_main_chat[-1].get("sessionKey") == "vw-live-mode:resident-a"
                and resident_main_chat[-1].get("liveMode") is True
                and not any(row.get("text") == "main chat answer" for row in resident_main_chat)
            ),
            json.dumps(resident_main_chat[-4:], default=str),
        )

        hermes_rich = [
            {"role": "user", "text": "hello", "sessionId": "hermes-session-1", "source": "virtual-world"},
            {"role": "assistant", "text": "hi from hermes", "sessionId": "hermes-session-1", "source": "virtual-world"},
            {"role": "assistant", "text": "local progress survives native export", "sessionId": "hermes-session-1", "source": "hermes-progress"},
        ]
        server._save_hermes_state("default", {"messages": hermes_rich, "sessionId": "hermes-session-1"})
        hermes_payload, hermes_status = server.handle_chat_sessions_list("hermes-default")
        check("Hermes sessions list uses provider", hermes_status == 200 and hermes_payload.get("sessions", [{}])[0].get("active") is True)
        switched, status = server.handle_chat_session_switch("hermes-default", "hermes-session-1")
        check("Hermes switch merges native history without truncating the rich transcript", status == 200 and len(switched.get("messages") or []) == 3 and any(row.get("text") == "local progress survives native export" for row in switched.get("messages") or []) and server._get_hermes_session_id("default") == "hermes-session-1")
        created, status = server.handle_chat_session_create("hermes-default")
        check("Hermes new session archives rather than clears the prior transcript", status == 200 and "@new:" in str(created.get("sessionKey") or "") and len(server._load_chat_session_mirror("hermes", "default", "hermes-session-1")) == 3 and not server._load_hermes_history("default"))
        switched, status = server.handle_chat_session_switch("hermes-default", "hermes-session-1")
        check("Hermes archived session reopens with its complete transcript", status == 200 and len(switched.get("messages") or []) == 3)
        deleted, status = server.handle_chat_session_delete("hermes-default", "hermes-session-1")
        check("Hermes delete clears active session", status == 200 and deleted.get("deleted") and server._get_hermes_session_id("default") == "")

        codex_rich = [
            {"role": "user", "text": "build it", "sessionId": "codex-thread-1"},
            {"role": "assistant", "text": "built it", "sessionId": "codex-thread-1"},
            {"role": "assistant", "text": "codex commentary survives", "sessionId": "codex-thread-1", "source": "codex-progress"},
        ]
        server._save_codex_state("main", {"messages": codex_rich, "sessionId": "codex-thread-1"})
        codex_payload, codex_status = server.handle_chat_sessions_list("codex-main")
        codex_sessions = codex_payload.get("sessions") or []
        check("Codex list filters archived threads", codex_status == 200 and len(codex_sessions) == 1 and codex_sessions[0].get("id") == "codex-thread-1")
        switched, status = server.handle_chat_session_switch("codex-main", "codex-thread-1")
        check("Codex switch merges thread history without truncating commentary", status == 200 and len(switched.get("messages") or []) == 3 and server._get_codex_session_id("main") == "codex-thread-1")
        created, status = server.handle_chat_session_create("codex-main")
        check("Codex new thread preserves the prior transcript", status == 200 and "@new:" in str(created.get("sessionKey") or "") and len(server._load_chat_session_mirror("codex", "main", "codex-thread-1")) == 3)
        switched, status = server.handle_chat_session_switch("codex-main", "codex-thread-1")
        check("Codex archived thread reopens with its complete transcript", status == 200 and len(switched.get("messages") or []) == 3)
        deleted, status = server.handle_chat_session_delete("codex-main", "codex-thread-1")
        check("Codex delete clears active thread", status == 200 and deleted.get("deleted") and server._get_codex_session_id("main") == "")

        claude_rich = [
            {"role": "user", "text": "hello claude", "sessionId": claude_session_id},
            {"role": "assistant", "text": "hi from claude", "sessionId": claude_session_id},
            {"role": "assistant", "text": "claude local activity survives", "sessionId": claude_session_id, "source": "provider-progress"},
        ]
        server._save_claude_code_state("main", {"messages": claude_rich, "sessionId": claude_session_id})
        claude_payload, claude_status = server.handle_chat_sessions_list("claude-main")
        claude_sessions = claude_payload.get("sessions") or []
        check("Claude Code lists native JSONL sessions", claude_status == 200 and claude_sessions and claude_sessions[0].get("id") == claude_session_id)
        switched, status = server.handle_chat_session_switch("claude-main", claude_session_id)
        check("Claude Code switch synchronizes native and generic session state", status == 200 and len(switched.get("messages") or []) == 3 and server._get_claude_code_session_id("main") == claude_session_id and server._load_generic_provider_session("claude-code", "main").get("sessionId") == claude_session_id and len(server._load_provider_history("claude-code", "main")) == 3)
        created, status = server.handle_chat_session_create("claude-main")
        check("Claude Code new session preserves the prior transcript", status == 200 and "@new:" in str(created.get("sessionKey") or "") and len(server._load_chat_session_mirror("claude-code", "main", claude_session_id)) == 3 and not server._load_provider_history("claude-code", "main"))
        switched, status = server.handle_chat_session_switch("claude-main", claude_session_id)
        check("Claude Code archived session reopens with its complete transcript", status == 200 and len(switched.get("messages") or []) == 3)
        deleted, status = server.handle_chat_session_delete("claude-main", claude_session_id)
        check("Claude Code delete renames native session file and clears active id", status == 200 and deleted.get("deleted") and server._get_claude_code_session_id("main") == "" and not claude_file.exists())

        fake_opencode = FakeOpenCodeProvider()
        server._PROVIDER_REGISTRY = FakeProviderRegistry(fake_opencode)
        opencode_rich = [
            {"role": "user", "text": "hello opencode", "sessionId": "opencode-session-1"},
            {"role": "assistant", "text": "hi from opencode", "sessionId": "opencode-session-1", "tools": [{"id": "tool-1", "name": "read", "status": "completed", "result": "ok"}]},
            {"role": "assistant", "text": "opencode local activity survives", "sessionId": "opencode-session-1", "source": "provider-progress"},
        ]
        server._save_generic_provider_session("opencode", "main", "opencode-session-1", source="test")
        server._save_provider_history("opencode", "main", opencode_rich)
        opencode_payload, opencode_status = server.handle_chat_sessions_list("opencode-main")
        check("registered provider sessions list uses its native contract", opencode_status == 200 and len(opencode_payload.get("sessions") or []) == 2)
        switched, status = server.handle_chat_session_switch("opencode-main", "opencode-session-1")
        check("OpenCode switch normalizes export and preserves rich local activity", status == 200 and len(switched.get("messages") or []) == 3 and any(row.get("text") == "opencode local activity survives" for row in switched.get("messages") or []))
        created, status = server.handle_chat_session_create("opencode-main")
        check("registered provider new session preserves prior history", status == 200 and "@new:" in str(created.get("sessionKey") or "") and len(server._load_chat_session_mirror("opencode", "main", "opencode-session-1")) == 3 and not server._load_provider_history("opencode", "main"))
        switched, status = server.handle_chat_session_switch("opencode-main", "opencode-session-1")
        check("registered provider archived session reopens completely", status == 200 and len(switched.get("messages") or []) == 3 and server._load_generic_provider_session("opencode", "main").get("sessionId") == "opencode-session-1")

        fake_opencode.block_chat = True
        started = server._handle_provider_run_start({
            "agentId": "opencode-main",
            "sessionId": "opencode-session-1",
            "message": "finish in the original session",
            "timeoutSec": 5,
        })
        check("registered provider run starts in the explicitly selected session", started.get("ok") and fake_opencode.chat_started.wait(timeout=2))
        switched_other, status = server.handle_chat_session_switch("opencode-main", "opencode-session-0")
        fake_opencode.chat_release.set()
        run_meta = server._PROVIDER_RUNS.get(started.get("runId")) or {}
        deadline = time.time() + 5
        while not run_meta.get("done") and time.time() < deadline:
            time.sleep(0.02)
        active_after_run = server._load_generic_provider_session("opencode", "main")
        current_after_run = server._load_provider_history("opencode", "main")
        original_after_run = server._load_chat_session_mirror("opencode", "main", "opencode-session-1")
        check(
            "a finishing provider run cannot steal focus from a newer session switch",
            status == 200
            and run_meta.get("done")
            and active_after_run.get("sessionId") == "opencode-session-0"
            and all(row.get("sessionId") == "opencode-session-0" for row in current_after_run)
            and any(row.get("text") == "opencode run finished" for row in original_after_run),
            json.dumps({"active": active_after_run, "current": current_after_run, "original": original_after_run}, default=str),
        )
        deleted, status = server.handle_chat_session_delete("opencode-main", "opencode-session-1")
        check("registered provider explicit delete removes only the selected session", status == 200 and deleted.get("deleted") and fake_opencode.deleted == [("main", "opencode-session-1")])

    failures = [name for name, ok, _detail in CHECKS if not ok]
    if failures:
        print(f"FAILED: {len(failures)} chat session checks failed: {', '.join(failures)}", file=sys.stderr)
        sys.exit(1)
    print(f"verify-chat-sessions: OK ({len(CHECKS)} checks)")


if __name__ == "__main__":
    main()
