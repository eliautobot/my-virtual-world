#!/usr/bin/env python3
"""Verify recurrent, durable, interruptible Live Agent Mode sessions.

The verifier runs in an isolated world and stubs provider/network surfaces. It
does not touch production world state or provider conversations.
"""

import importlib.util
import json
import os
import tempfile
import time
from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]
SERVER_PATH = ROOT / "src" / "server" / "server.py"
CHECKS = []


def check(name, condition, detail=""):
    ok = bool(condition)
    CHECKS.append((name, ok, detail))
    print(f"[{'PASS' if ok else 'FAIL'}] {name}" + (f" -- {detail}" if detail and not ok else ""))
    return ok


def load_server(tmp):
    data = tmp / "data"
    openclaw = tmp / "openclaw"
    for path in (data / "chunks", data / "buildings", openclaw):
        path.mkdir(parents=True, exist_ok=True)
    os.environ["VW_DATA_DIR"] = str(data)
    os.environ["VW_STATUS_DIR"] = str(data)
    os.environ["VW_STATUS_FILE"] = str(data / "virtual-world-status.json")
    os.environ["VW_OPENCLAW_PATH"] = str(openclaw)
    os.environ["VW_OPENCLAW_HOST_PATH"] = str(openclaw)
    os.environ["VW_CODEX_INCLUDE_NATIVE_AGENTS"] = "0"
    os.environ["VW_CLAUDE_CODE_INCLUDE_NATIVE_AGENTS"] = "0"
    os.environ["_VW_INT"] = "1"
    spec = importlib.util.spec_from_file_location("mvw_live_lived_session_test", SERVER_PATH)
    server = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(server)
    server.VW_CONFIG.setdefault("features", {})["agentLiveMode"] = True
    server._agent_roster = [
        {"id": "resident-a", "statusKey": "resident-a", "name": "Resident A", "providerKind": "openclaw", "providerAgentId": "resident-a", "profile": "resident-a"},
        {"id": "resident-b", "statusKey": "resident-b", "name": "Resident B", "providerKind": "openclaw", "providerAgentId": "resident-b", "profile": "resident-b"},
    ]
    server._roster_time = time.time()
    meta = server.load_world_meta_fast()
    meta["agentProfiles"] = {
        "resident-a": {"agentLiveModeEnabled": True},
        "resident-b": {"agentLiveModeEnabled": False},
    }
    server.save_world_meta(meta)
    server.save_live_agent_loop_state({"enabled": True, "agents": {"resident-a": {"enabled": True}, "resident-b": {"enabled": False}}})
    return server


def main():
    with tempfile.TemporaryDirectory(prefix="mvw-lived-session-") as raw:
        server = load_server(Path(raw))

        first = server._live_agent_session_open("resident-a", reason="verification")
        same = server._live_agent_session_open("resident-a", reason="verification-heartbeat")
        check("activation opens one durable Live session", first.get("id") == same.get("id") and first.get("status") == "active")
        check("Live activation persists without retaining a provider transcript", first.get("activationId") and not first.get("providerSessionKey") and not first.get("providerSessionId"), json.dumps(first, default=str)[:600])
        replaced = server._live_agent_session_open("resident-a", force_new=True, reason="verification-reactivate")
        sessions_doc = server._load_live_agent_sessions()
        history = sessions_doc["agents"]["resident-a"]["history"]
        check("new activation archives the prior session", replaced.get("id") != first.get("id") and history and history[-1].get("id") == first.get("id"))

        gateway_calls = []
        server._gateway_rpc_call = lambda method, params=None, timeout=20: gateway_calls.append((method, params or {})) or {"ok": True}
        server._live_agent_model_decision_recover_reply = lambda *_args, **_kwargs: '{"reply":"I am still walking there."}'
        original_sleep = server.time.sleep
        server.time.sleep = lambda _seconds: None
        try:
            exchange_one = server._live_agent_model_provider_request("resident-a", "first", {"timeoutSec": 10}, 1)
            exchange_two = server._live_agent_model_provider_request("resident-a", "second", {"timeoutSec": 10}, 2)
        finally:
            server.time.sleep = original_sleep
        provider_keys = [params.get("sessionKey") for method, params in gateway_calls if method == "agent"]
        check(
            "provider cognition uses disposable event-turn sessions",
            exchange_one.get("ok")
            and exchange_two.get("ok")
            and len(provider_keys) == 2
            and len(set(provider_keys)) == 2
            and all(key.startswith("agent:resident-a:vw-live-turn-") and ":vw-live-world-" in key for key in provider_keys),
            json.dumps(gateway_calls, default=str),
        )
        agent_payloads = [params for method, params in gateway_calls if method == "agent"]
        check("OpenClaw turns retain full framework bootstrap", agent_payloads and all("promptMode" not in params and "modelRun" not in params for params in agent_payloads), json.dumps(agent_payloads, default=str))
        check(
            "disposable turns use public Gateway-compatible session effects and clean transport sessions",
            all("suppressPromptPersistence" not in params and "sessionEffects" not in params for params in agent_payloads)
            and all(any(method == "sessions.delete" and call.get("key") == key for method, call in gateway_calls) for key in provider_keys),
            json.dumps(gateway_calls, default=str),
        )
        server._live_agent_model_decision_recover_reply = lambda *_args, **_kwargs: "Context overflow: prompt too large for the model."
        server.time.sleep = lambda _seconds: None
        try:
            overflow_exchange = server._live_agent_model_provider_request("resident-a", "bounded", {"timeoutSec": 10}, 3)
        finally:
            server.time.sleep = original_sleep
        check(
            "context overflow transcript text is a provider failure, not a completed agent turn",
            overflow_exchange.get("ok") is False
            and overflow_exchange.get("failureStatus") == "provider-context-overflow"
            and overflow_exchange.get("failureKind") == "context-overflow",
            json.dumps(overflow_exchange, default=str),
        )
        turn_key = provider_keys[-1]
        server._live_agent_session_update("resident-a", provider_session_id=turn_key, provider_session_key=turn_key)

        # The Gateway runs on the host while the Virtual World API runs in a
        # container, so a genuine local bridge request arrives from the Docker
        # gateway address rather than 127.0.0.1. The shared world registry
        # provides a stable secret for signed, restart-safe bridge calls.
        bridge_auth = server._live_agent_world_bridge_auth({})
        bridge_body = json.dumps({
            "agentId": "resident-a",
            "sessionKey": turn_key,
            "tool": "observe",
            "params": {},
        }, separators=(",", ":")).encode("utf-8")
        bridge_timestamp = str(int(time.time()))
        bridge_nonce = "a1" * 18
        bridge_digest = server.hashlib.sha256(bridge_body).hexdigest()
        bridge_signature = server.hmac.new(
            bridge_auth["secret"].encode("utf-8"),
            f"{bridge_timestamp}\n{bridge_nonce}\n{bridge_digest}".encode("utf-8"),
            server.hashlib.sha256,
        ).hexdigest()
        bridge_headers = {
            "X-VW-Bridge-Timestamp": bridge_timestamp,
            "X-VW-Bridge-Nonce": bridge_nonce,
            "X-VW-Bridge-Signature": bridge_signature,
        }
        original_registry_reader = server._read_live_agent_world_registry
        original_world_id = server._live_agent_world_id
        server._read_live_agent_world_registry = lambda: {
            "worlds": {"vw-test": {"bridgeAuth": bridge_auth}},
            "agents": {},
        }
        server._live_agent_world_id = lambda: "vw-test"
        server._LIVE_AGENT_WORLD_BRIDGE_NONCES.clear()
        try:
            signed_ok, signed_reason = server._live_agent_native_bridge_signature_valid(bridge_body, bridge_headers)
            replay_ok, replay_reason = server._live_agent_native_bridge_signature_valid(bridge_body, bridge_headers)
            tampered_headers = dict(bridge_headers)
            tampered_headers["X-VW-Bridge-Nonce"] = "b2" * 18
            tampered_ok, tampered_reason = server._live_agent_native_bridge_signature_valid(bridge_body + b" ", tampered_headers)
        finally:
            server._read_live_agent_world_registry = original_registry_reader
            server._live_agent_world_id = original_world_id
            server._LIVE_AGENT_WORLD_BRIDGE_NONCES.clear()
        check(
            "signed Docker/Gateway bridge request validates across process restarts",
            signed_ok is True and signed_reason is None,
            json.dumps({"ok": signed_ok, "reason": signed_reason}),
        )
        check(
            "native bridge rejects replayed and tampered requests",
            replay_ok is False
            and replay_reason == "replayed_bridge_signature"
            and tampered_ok is False
            and tampered_reason == "invalid_bridge_signature",
            json.dumps({"replay": [replay_ok, replay_reason], "tampered": [tampered_ok, tampered_reason]}),
        )

        # Native world tools are bound to the exact full-agent world session.
        # They fail closed for another session and delegate physical execution
        # to the existing validated world-action path.
        wrong_ok, wrong_result, wrong_status = server.handle_live_agent_native_tool({
            "agentId": "resident-a",
            "sessionKey": "agent:resident-a:not-the-live-world-session",
            "tool": "observe",
            "params": {},
        })
        check(
            "native world tools reject an unbound OpenClaw session",
            wrong_ok is False
            and wrong_status == 403
            and (wrong_result.get("error") or {}).get("code") == "invalid_live_tool_lease",
            json.dumps(wrong_result, default=str),
        )

        native_action_def = {
            "id": "hydrate-water-cooler",
            "label": "get water",
            "actionType": "life.getWater",
            "capabilityTag": "life.hydration",
            "need": "hydration",
            "category": "hydration",
            "timeoutSec": 180,
        }
        native_target = {
            "kind": "object-instance",
            "buildingId": "office",
            "catalogId": "waterCooler",
            "objectInstanceId": "water-1",
            "interactionSpotId": "use-front",
            "floor": 1,
            "point": {"x": 120.0, "y": 240.0, "floor": 1},
        }
        native_affordance = {
            "id": "hydrate-water-cooler",
            "label": "get water",
            "actionType": "life.getWater",
            "capabilityTag": "life.hydration",
            "need": "hydration",
            "category": "hydration",
            "available": True,
            "target": native_target,
            "availability": {"state": "available"},
            "selected": {
                "action": native_action_def,
                "target": native_target,
                "availability": {"state": "available"},
            },
        }
        original_build_perception = server._live_agent_loop_build_perception
        original_active_behavior = server._active_behavior_records_for_agent
        original_visible_contract = server._live_agent_visible_action_contract
        original_bind_goal = server._live_agent_loop_bind_durable_goal_action
        original_prepare_plan = server._live_agent_loop_prepare_plan
        original_mark_plan_created = server._live_agent_loop_mark_plan_action_created
        original_create_live_action = server.create_agent_live_mode_action_request
        native_action_payloads = []
        native_active_records = []
        server._live_agent_loop_build_perception = lambda *_args, **_kwargs: {
            "at": server._utc_now_iso(),
            "needs": {"hydration": 0.9},
            "active": [],
            "spatial": {"self": {"x": 0.0, "y": 0.0, "floor": 1, "buildingId": "office"}},
            "affordances": [native_affordance],
        }
        server._active_behavior_records_for_agent = lambda _agent_id: list(native_active_records)
        server._live_agent_visible_action_contract = lambda _action_type: {"clientExecutor": "standing-object-interaction"}
        server._live_agent_loop_bind_durable_goal_action = lambda *_args, **_kwargs: None
        server._live_agent_loop_prepare_plan = lambda *_args, **_kwargs: {
            "id": "plan-native-tool",
            "status": "active",
            "currentStepIndex": 0,
            "steps": [{"id": "execute-visible-action", "status": "pending"}],
        }
        server._live_agent_loop_mark_plan_action_created = lambda _state, _agent_id, _agent_state, plan, *_args, **_kwargs: plan

        def create_native_action(payload):
            native_action_payloads.append(payload)
            action_row = {
                "id": "wa-native-world-tool",
                "agentId": "resident-a",
                "actionType": payload.get("actionType"),
                "status": "created",
                "source": payload.get("source"),
                "target": payload.get("target"),
                "params": payload.get("params"),
                "timing": {"createdAt": server._utc_now_iso()},
            }
            return True, {"ok": True, "action": action_row}, 202

        server.create_agent_live_mode_action_request = create_native_action
        try:
            observe_ok, observed, observe_status = server.handle_live_agent_native_tool({
                "agentId": "resident-a",
                "sessionKey": turn_key,
                "tool": "observe",
                "params": {"detail": True},
            })
            act_ok, acted, act_status = server.handle_live_agent_native_tool({
                "agentId": "resident-a",
                "sessionKey": turn_key,
                "tool": "act",
                "params": {
                    "actionId": "hydrate-water-cooler",
                    "reason": "I want a drink of water.",
                    "successCriteria": "The world verifies water acquisition.",
                },
            })
            native_active_records.append({
                "id": "wa-native-world-tool",
                "type": "world-action",
                "behaviorSourceKind": "agent-live-mode",
            })
            overlap_ok, overlap, overlap_status = server.handle_live_agent_native_tool({
                "agentId": "resident-a",
                "sessionKey": turn_key,
                "tool": "act",
                "params": {"actionId": "hydrate-water-cooler", "reason": "duplicate"},
            })
        finally:
            server._live_agent_loop_build_perception = original_build_perception
            server._active_behavior_records_for_agent = original_active_behavior
            server._live_agent_visible_action_contract = original_visible_contract
            server._live_agent_loop_bind_durable_goal_action = original_bind_goal
            server._live_agent_loop_prepare_plan = original_prepare_plan
            server._live_agent_loop_mark_plan_action_created = original_mark_plan_created
            server.create_agent_live_mode_action_request = original_create_live_action
        check(
            "bound native observe injects Resident Profile, world memory, and body context",
            observe_ok
            and observe_status == 200
            and (observed.get("context") or {}).get("authority", {}).get("frameworkPersonaRequired") is True
            and (observed.get("context") or {}).get("body", {}).get("position", {}).get("buildingId") == "office"
            and isinstance((observed.get("context") or {}).get("memories"), list),
            json.dumps(observed, default=str)[:1800],
        )
        check(
            "native act delegates to the existing validated world-action executor",
            act_ok
            and act_status == 202
            and acted.get("status") == "accepted"
            and acted.get("actionId") == "wa-native-world-tool"
            and native_action_payloads
            and native_action_payloads[0].get("source", {}).get("surface") == "openclaw-native-tool"
            and native_action_payloads[0].get("params", {}).get("serverRuntimeAuthority") is True,
            json.dumps({"acted": acted, "payload": native_action_payloads[:1]}, default=str)[:2200],
        )
        check(
            "native act preserves one physical action per resident",
            overlap_ok is False
            and overlap_status == 409
            and (overlap.get("error") or {}).get("code") == "agent_unavailable",
            json.dumps(overlap, default=str),
        )

        action = {
            "id": "wa-lived-1",
            "agentId": "resident-a",
            "actionType": "life.getCoffee",
            "status": "completed",
            "source": {"kind": "agent-live-mode", "requestId": "live-loop-resident-a-test"},
            "params": {"loopActionId": "hydrate-coffee-machine"},
            "target": {"kind": "object-instance", "buildingId": "office", "catalogId": "countertopCoffeeMachine", "objectInstanceId": "coffee-1", "interactionSpotId": "use-front", "point": {"x": 968.0, "y": -460.0, "floor": 1}},
            "reservation": {"state": "released", "queueIndex": 2},
            "timing": {"createdAt": "2099-07-17T15:00:00Z", "updatedAt": "2099-07-17T15:01:00Z"},
            "events": [
                {"id": "e1", "name": "created", "toStatus": "created", "at": "2099-07-17T15:00:00Z"},
                {"id": "e2", "name": "service-queue-joined", "toStatus": "reserved", "at": "2099-07-17T15:00:01Z"},
                {"id": "e3", "name": "routing", "toStatus": "routing", "at": "2099-07-17T15:00:02Z"},
                {"id": "e4", "name": "arrived", "toStatus": "arrived", "at": "2099-07-17T15:00:03Z"},
                {"id": "e5", "name": "in-progress", "toStatus": "in_progress", "at": "2099-07-17T15:00:08Z"},
                {"id": "e6", "name": "completed", "toStatus": "completed", "at": "2099-07-17T15:00:28Z"},
                {"id": "e7", "name": "reservation-released", "toStatus": "completed", "at": "2099-07-17T15:00:28Z"},
            ],
            "effects": [{"type": "route-intent-cleared", "at": "2099-07-17T15:00:28Z"}, {"type": "reservation-released", "at": "2099-07-17T15:00:28Z"}],
        }
        legacy_action = {
            **action,
            "id": "wa-before-activation",
            "timing": {"createdAt": "2020-01-01T00:00:00Z", "updatedAt": "2020-01-01T00:00:01Z"},
            "events": [{"id": "legacy-event", "name": "completed", "toStatus": "completed", "at": "2020-01-01T00:00:01Z"}],
            "effects": [],
        }
        server.get_world_actions_store = lambda *args, **kwargs: {"active": [], "history": [legacy_action, action]}
        server._live_agent_session_sync_world_actions("resident-a")
        lived = server._live_agent_session_current("resident-a")
        phases = [row.get("phase") for row in lived.get("messages", [])]
        text_blob = "\n".join(row.get("text", "") for row in lived.get("messages", []))
        check("meaningful world lifecycle is visible without reservation chatter", all(value in phases for value in ("select-target", "reserve-or-queue", "route", "revalidate-target", "begin-use", "verify")) and "continue" not in phases, json.dumps(phases))
        check("queue position and target are visible in the lived journal", "position 3" in text_blob and "coffee" in text_blob.lower(), text_blob)
        check("lived target narration includes authoritative coordinates", "(968.0, -460.0)" in text_blob, text_blob)
        check("operational effects stay diagnostic and do not duplicate terminal journal lines", sum(1 for row in lived.get("messages", []) if row.get("actionId") == "wa-lived-1" and row.get("phase") == "verify") == 1 and "released my reservation" not in text_blob, text_blob)
        action_times = [server._parse_isoish_epoch(row.get("at")) for row in lived.get("messages", []) if row.get("actionId") == "wa-lived-1"]
        check("journal retains original event time in chronological order", action_times == sorted(action_times) and action_times[0] == server._parse_isoish_epoch("2099-07-17T15:00:00Z"), json.dumps(action_times))
        check("new activation excludes historical world actions", not any(row.get("actionId") == "wa-before-activation" for row in lived.get("messages", [])) and "legacy-event" not in lived.get("checkpoint", {}).get("actionEventKeys", []), json.dumps(lived, default=str)[:1500])

        original_active_records = server._active_behavior_records_for_agent
        original_cancel_world_action = server.cancel_world_action
        cancel_payloads = []
        server._active_behavior_records_for_agent = lambda _agent_id: [{"type": "world-action", "id": "wa-cancel-contract", "behaviorSourceKind": "agent-live-mode"}]
        server.cancel_world_action = lambda action_id, payload: cancel_payloads.append((action_id, payload)) or (True, {"ok": True}, 200)
        try:
            cancelled = server._live_agent_cancel_live_actions("resident-a", actor="live-session-user-redirect", failure_reason="cancelled_by_user_redirect")
        finally:
            server._active_behavior_records_for_agent = original_active_records
            server.cancel_world_action = original_cancel_world_action
        check(
            "user redirect maps to the valid cancellation lifecycle contract",
            cancelled[0].get("cancelled") is True
            and cancel_payloads[0][1].get("failureReason") == "cancelled_by_user"
            and (cancel_payloads[0][1].get("result") or {}).get("reason") == "cancelled_by_user_redirect",
            json.dumps({"cancelled": cancelled, "payloads": cancel_payloads}, default=str),
        )
        redirect_action = {
            "id": "wa-live-session-redirect",
            "status": "cancelled",
            "actionType": "life.useObject",
            "failureReason": "cancelled_by_user",
            "result": {"status": "cancelled", "reason": "cancelled_by_user_redirect"},
            "target": {"kind": "object-instance", "buildingId": "office", "catalogId": "whiteboard", "x": 900.0, "y": -400.0},
        }
        redirect_message = server._live_agent_session_action_event_message(
            redirect_action,
            {"name": "cancelled", "toStatus": "cancelled", "at": "2099-07-17T15:00:29Z"},
        )
        check(
            "redirect journal explains a user priority change instead of inventing a target failure",
            redirect_message[0] == "event"
            and redirect_message[1] == "replan"
            and "user changed" in redirect_message[2].lower()
            and "priority" in redirect_message[2].lower()
            and "could not finish" not in redirect_message[2].lower(),
            json.dumps(redirect_message),
        )

        original_provider = server._live_agent_model_provider_request
        original_perception = server._live_agent_loop_build_perception
        original_loop_lock = server._live_agent_loop_lock
        original_halt = server._live_agent_halt_live_actions_for_user
        original_cancel = server._live_agent_cancel_live_actions
        halt_calls = []
        cancel_calls = []
        provider_calls = []
        server._live_agent_model_provider_request = lambda *_args, **_kwargs: provider_calls.append(True) or {"ok": True, "providerKind": "openclaw", "sessionId": turn_key, "reply": "I’m walking to the coffee machine and I’ll keep going after answering you."}
        server._live_agent_loop_build_perception = lambda *_args, **_kwargs: {"location": {"buildingId": "office"}, "active": [{"id": "wa-lived-1", "status": "routing"}], "spatial": {"nearbyObjects": []}}
        server._live_agent_halt_live_actions_for_user = lambda agent_id: halt_calls.append(agent_id) or [{"id": "wa-lived-1", "cancelled": True}]
        server._live_agent_cancel_live_actions = lambda agent_id, **kwargs: cancel_calls.append((agent_id, kwargs)) or [{"id": "wa-lived-1", "cancelled": True}]
        try:
            class ConversationMustNotTakeLoopLock:
                def __enter__(self):
                    raise AssertionError("Live conversation attempted to take the autonomy loop lock")

                def __exit__(self, *_args):
                    return False

            server._live_agent_loop_lock = ConversationMustNotTakeLoopLock()
            ok, question, status = server.handle_live_agent_session_message({"agentId": "resident-a", "sessionId": f"vw-live-mode:resident-a", "message": "Where are you going?"})
            for _ in range(100):
                status_messages = (server._live_agent_session_current("resident-a") or {}).get("messages") or []
                if any(item.get("kind") == "reply" and "keep going" in str(item.get("text") or "") for item in status_messages):
                    break
                time.sleep(0.01)
            check(
                "status question answers through the same full-agent Live session",
                ok and status == 202 and question.get("sessionId") == replaced.get("id") and question.get("pending") is True
                and any(item.get("kind") == "reply" and "keep going" in str(item.get("text") or "") for item in status_messages),
                json.dumps({"ok": ok, "status": status, "result": question}, default=str)[:1500],
            )
            check(
                "user conversation aborts the older autonomous OpenClaw lane before replying",
                any(method == "chat.abort" and params.get("sessionKey") == turn_key for method, params in gateway_calls),
                json.dumps(gateway_calls[-8:], default=str),
            )
            greeting_ok, greeting_result, greeting_status = server.handle_live_agent_session_message({"agentId": "resident-a", "sessionId": f"vw-live-mode:resident-a", "message": "hi"})
            for _ in range(100):
                greeting_messages = (server._live_agent_session_current("resident-a") or {}).get("messages") or []
                if sum(1 for item in greeting_messages if item.get("kind") == "reply") >= 2:
                    break
                time.sleep(0.01)
            check(
                "greetings are generated by the full agent without canned speech",
                greeting_ok and greeting_status == 202 and greeting_result.get("pending") is True and len(provider_calls) >= 2
                and not any(str(item.get("text") or "") == "Hi — I’m here, and this Live Mode session is active." for item in greeting_messages),
                json.dumps({"status": greeting_status, "calls": len(provider_calls), "messages": greeting_messages[-6:]}, default=str)[:1800],
            )
            conversation_started = time.time()
            ok_async, async_result, async_status = server.handle_live_agent_session_message({"agentId": "resident-a", "sessionId": f"vw-live-mode:resident-a", "message": "Tell me something about the walk."})
            async_returned_in = time.time() - conversation_started
            for _ in range(100):
                current_messages = (server._live_agent_session_current("resident-a") or {}).get("messages") or []
                if any(item.get("kind") == "reply" and "keep going" in str(item.get("text") or "") for item in current_messages):
                    break
                time.sleep(0.01)
            check(
                "normal provider conversation returns immediately and publishes asynchronously",
                ok_async and async_status == 202 and async_result.get("pending") is True and async_returned_in < 0.5
                and any(item.get("kind") == "reply" and "keep going" in str(item.get("text") or "") for item in current_messages),
                json.dumps({"status": async_status, "result": async_result, "elapsed": async_returned_in, "calls": len(provider_calls)}, default=str)[:1500],
            )
            check("Live conversation never waits on the autonomy loop lock", ok_async and async_status == 202)
            check("status question does not cancel the physical action", not halt_calls and not cancel_calls)
            server._live_agent_loop_lock = original_loop_lock
            ok, stopped, status = server.handle_live_agent_session_message({"agentId": "resident-a", "message": "Stop and wait."})
            check("explicit stop interrupts and pauses at a checkpoint", ok and halt_calls == ["resident-a"] and server._live_agent_session_current("resident-a")["checkpoint"].get("pausedByUser") is True, json.dumps({"ok": ok, "status": status, "result": stopped, "halts": halt_calls, "session": server._live_agent_session_current("resident-a")}, default=str)[:1500])
            server.live_agent_clear_user_attention("resident-a")
            loop_state = server.get_live_agent_loop_state(persist_migration=True)
            loop_agent = server._live_agent_loop_agent_state(loop_state, "resident-a")
            loop_agent["autonomyPlan"] = server._live_agent_loop_normalize_autonomy_plan({"currentGoal": "Finish the carried item first.", "nextStep": {"intent": "Use another seat."}})
            loop_agent["nextAllowedAt"] = "2099-07-17T16:00:00Z"
            server.save_live_agent_loop_state(loop_state)
            server._live_agent_loop_wake.clear()
            ok, redirected, status = server.handle_live_agent_session_message({"agentId": "resident-a", "message": "Go to the water cooler instead."})
            current = server._live_agent_session_current("resident-a")
            redirected_agent = (server.get_live_agent_loop_state(persist_migration=False).get("agents") or {}).get("resident-a") or {}
            check("redirect cancels current work, records the directive, and supersedes stale planning", ok and cancel_calls and current["checkpoint"].get("userDirective") == "Go to the water cooler instead." and current["workingMemory"]["userDirectives"][-1]["status"] == "pending" and (redirected_agent.get("autonomyPlan") or {}).get("currentGoal") == "Go to the water cooler instead.", json.dumps({"ok": ok, "status": status, "result": redirected, "cancels": cancel_calls, "session": current, "agent": redirected_agent}, default=str)[:2000])
            check("direct user priority clears action cooldown and wakes scheduler", redirected_agent.get("nextAllowedAt") is None and server._live_agent_loop_wake.is_set(), json.dumps(redirected_agent, default=str)[:1200])

            server._live_agent_loop_wake.clear()
            generation = server._live_agent_model_decision_start("resident-a")
            published = server._live_agent_model_decision_publish("resident-a", generation, {"chosen": "skip", "detail": {"status": "model-skip"}})
            check("completed cognition wakes scheduler immediately", published and server._live_agent_loop_wake.is_set())
        finally:
            server._live_agent_model_provider_request = original_provider
            server._live_agent_loop_build_perception = original_perception
            server._live_agent_loop_lock = original_loop_lock
            server._live_agent_halt_live_actions_for_user = original_halt
            server._live_agent_cancel_live_actions = original_cancel
            server.live_agent_clear_user_attention("resident-a")

        state = {}
        coffee_summary = {"id": "coffee-action", "actionType": "life.getCoffee"}
        acquired = server._live_agent_loop_update_inventory_after_action("resident-a", state, {"target": {"catalogId": "countertopCoffeeMachine"}}, coffee_summary, True, "2026-07-17T15:10:00Z")
        dynamic = server._live_agent_loop_dynamic_action_defs("resident-a", state)
        check("coffee completion creates visible carried-item working memory", acquired.get("event") == "acquired" and state["inventory"]["held"]["kind"] == "coffee" and server._live_agent_session_current("resident-a")["workingMemory"]["inventory"][0]["kind"] == "coffee")
        check("carried consumable activates a generic seating follow-up", any(row.get("id") == "use-seating-object" for row in dynamic))
        original_target_resolver = server._live_agent_loop_find_action_target
        server._live_agent_loop_find_action_target = lambda action_def, **_kwargs: {"action": action_def, "target": {"kind": "object-instance", "buildingId": "office", "objectInstanceId": f"target-{action_def.get('id')}", "catalogId": "armchair" if action_def.get("id") == "use-seating-object" else "countertopCoffeeMachine", "interactionSpotId": "seat-1" if action_def.get("id") == "use-seating-object" else "use-front", "floor": 1}, "availability": {"state": "available"}}
        try:
            carried_affordances = server._live_agent_loop_action_affordances("resident-a", state, spatial={"nearbyObjects": []})
        finally:
            server._live_agent_loop_find_action_target = original_target_resolver
        coffee_affordance = next(row for row in carried_affordances if row.get("id") == "hydrate-coffee-machine")
        seating_affordance = next(row for row in carried_affordances if row.get("id") == "use-seating-object")
        check("carrying a consumable blocks acquiring another and keeps seating available", coffee_affordance.get("available") is False and coffee_affordance.get("reason") == "carrying_item_requires_seating_follow_up" and seating_affordance.get("available") is True, json.dumps({"coffee": coffee_affordance, "seating": seating_affordance}, default=str)[:1800])
        consumed = server._live_agent_loop_update_inventory_after_action("resident-a", state, {"target": {"catalogId": "armchair", "objectInstanceId": "chair-1"}}, {"id": "seat-action", "actionType": "life.restAtArmchair"}, True, "2026-07-17T15:11:00Z")
        check("verified seating consumes the carried item", consumed.get("event") == "consumed" and state["inventory"].get("held") is None and state["inventory"]["history"][-1]["kind"] == "coffee")

        original_buildings = server.list_buildings
        original_find = server._find_world_action_target
        original_availability = server.get_object_availability
        server.list_buildings = lambda: [{
            "id": "office",
            "name": "Office",
            "interior": {"furniture": [
                {"objectInstanceId": "seat-overused", "catalogId": "armchair", "floor": 1},
                {"objectInstanceId": "seat-fresh", "catalogId": "armchair", "floor": 1},
            ]},
        }]
        server._find_world_action_target = lambda target: {"object": {"catalogId": "armchair"}, "candidateIds": [target.get("objectInstanceId")]}
        server.get_object_availability = lambda *args, **kwargs: {"state": "available"}
        overused_key = "object:office:seat-overused"
        fresh_key = "object:office:seat-fresh"
        seating_selection_state = {
            "inventory": {
                "held": {"id": "held-water", "kind": "water", "label": "water"},
                "history": [
                    {"state": "consumed", "consumedAt": f"2026-07-17T15:0{index}:00Z", "target": {"kind": "object-instance", "buildingId": "office", "objectInstanceId": "seat-overused"}}
                    for index in range(5)
                ],
            },
            "memory": {"recentActions": []},
            "goalProgress": {"category:seating": {"completedTargets": [overused_key], "failedTargets": []}},
        }
        try:
            novel_pick = server._live_agent_loop_find_seating_target(
                server.LIVE_AGENT_DYNAMIC_OBJECT_AFFORDANCES["seating"],
                agent_id="resident-a",
                agent_state=seating_selection_state,
            )
            seating_selection_state["goalProgress"]["category:seating"]["completedTargets"].append(fresh_key)
            seating_selection_state["inventory"]["history"].append({
                "state": "consumed",
                "consumedAt": "2026-07-17T15:10:00Z",
                "target": {"kind": "object-instance", "buildingId": "office", "objectInstanceId": "seat-fresh"},
            })
            least_used_pick = server._live_agent_loop_find_seating_target(
                server.LIVE_AGENT_DYNAMIC_OBJECT_AFFORDANCES["seating"],
                agent_id="resident-a",
                agent_state=seating_selection_state,
            )
        finally:
            server.list_buildings = original_buildings
            server._find_world_action_target = original_find
            server.get_object_availability = original_availability
        check(
            "carried-item dwell prefers an unverified seat over the first armchair",
            (novel_pick.get("target") or {}).get("objectInstanceId") == "seat-fresh"
            and (novel_pick.get("selectionEvidence") or {}).get("verifiedTarget") is False,
            json.dumps(novel_pick, default=str)[:1000],
        )
        check(
            "carried-item dwell chooses the least-used seat when every seat is verified",
            (least_used_pick.get("target") or {}).get("objectInstanceId") == "seat-fresh"
            and (least_used_pick.get("selectionEvidence") or {}).get("recentUseCount") < 5,
            json.dumps(least_used_pick, default=str)[:1000],
        )

        original_buildings = server.list_buildings
        original_find = server._find_world_action_target
        original_availability = server.get_object_availability
        server.list_buildings = lambda: [{"id": "office", "name": "Office", "interior": {"furniture": [{"objectInstanceId": "coffee-1", "catalogId": "countertopCoffeeMachine", "floor": 1}]}}]
        server._find_world_action_target = lambda target: {"object": {"catalogId": "countertopCoffeeMachine"}, "candidateIds": ["coffee-1"]}
        server.get_object_availability = lambda *args, **kwargs: {"state": "in_use", "reason": "object_reserved", "queueAvailability": {"state": "available", "queue": {"spotId": "queue", "index": 2, "capacity": 4}}}
        try:
            selected = server._live_agent_loop_find_action_target(server.LIVE_AGENT_LOOP_ACTIONS[1], agent_id="resident-a", agent_state={})
        finally:
            server.list_buildings = original_buildings
            server._find_world_action_target = original_find
            server.get_object_availability = original_availability
        check("occupied queueable machine remains an executable choice", selected and selected["availability"]["state"] == "in_use" and selected["availability"]["queueAvailability"]["state"] == "available")

        resource_state = {}
        occupied_spatial = {"nearbyObjects": [{
            "objectInstanceId": "armchair-1", "catalogId": "armchair", "objectType": "armchair", "perceived": True,
            "runtimeOccupied": True, "runtimeOccupiedByAgentIds": ["resident-b"], "occupiedByAgentIds": ["resident-b"],
            "interactions": [{"actionId": "life.restAtArmchair", "availability": {"state": "in_use", "conflicts": [{"agentId": "resident-b"}]}}],
        }]}
        server._live_agent_loop_record_resource_signals("resident-a", resource_state, occupied_spatial, now_epoch=1000)
        server._live_agent_loop_record_resource_signals("resident-a", resource_state, occupied_spatial, now_epoch=1301)
        signal = resource_state["resourceSignals"]["seating:armchair-1"]
        resident_memory = server._live_agent_loop_resident_profile_context(server._live_agent_loop_resident_profile("resident-a", persist=False))["memory"]
        memory_blob = json.dumps(resident_memory, default=str)
        check("repeated shortage becomes bounded working memory", signal.get("observationCount") == 2 and signal.get("memoryRecordedAt") and "available alternative" in signal.get("text", ""))
        check("important repeated shortage reaches durable Resident memory", "seating resource has been unavailable" in memory_blob, memory_blob[:1000])
        resource_messages = [
            item for item in (server._live_agent_session_current("resident-a") or {}).get("messages", [])
            if item.get("source") == "world-resource-telemetry"
        ]
        check(
            "resource telemetry stays out of the Resident conversation journal",
            resource_messages == [],
            json.dumps(resource_messages, default=str)[:1200],
        )

        planner_state = {}
        server._live_agent_loop_apply_planner_turn(planner_state, {
            "agentId": "resident-a",
            "status": "applied",
            "chosen": "use-seating-object",
            "plannerTurn": {
                "observation": "The only armchair has been occupied again.",
                "reflection": "This is a recurring office comfort problem.",
                "currentGoal": "Find a practical place to sit",
                "nextStep": {"intent": "Use another available seat", "action": "use-seating-object"},
                "memoryUpdate": {"lesson": "The office often needs another shared armchair.", "importance": 0.9, "durable": True},
            },
        }, agent_id="resident-a")
        chosen_memory = server._live_agent_loop_resident_profile_context(server._live_agent_loop_resident_profile("resident-a", persist=False))["memory"]
        check("Resident-selected important lesson is consolidated into long-term memory", any("office often needs another shared armchair" in str(item.get("text") or "").lower() for item in chosen_memory.get("longTerm") or []), json.dumps(chosen_memory, default=str)[:1200])

        directive_state = {"inventory": {"held": {"id": "held-coffee", "kind": "coffee", "label": "coffee"}}}
        directive_frame = server._live_agent_loop_build_goal_frame("resident-a", {"at": server._utc_now_iso(), "needs": {}, "social": {}}, directive_state)
        directive_prompt = server._live_agent_model_decision_prompt("resident-a", {"goalFrame": directive_frame, "candidates": [], "topNeed": {"id": "curiosity", "value": 0}, "spatialContext": {}}, directive_state)
        directive_offset = directive_prompt.find("DIRECT USER PRIORITY - ACTIVE")
        working_set_offset = directive_prompt.find("CURRENT WORKING SET")
        check("direct user directive outranks prior goals in the recurrent prompt", directive_frame.get("goals", [])[0].get("kind") == "direct-user" and directive_offset >= 0 and "Go to the water cooler instead" in directive_prompt and 0 <= directive_offset < working_set_offset, directive_prompt[:2500])
        oversized_prompt = server._live_agent_model_prompt_trim(
            "DIRECT USER PRIORITY - ACTIVE\nThe user directly asked: finish the carried coffee.\n"
            + ("lower-priority-memory " * 1200)
            + "\nAvailable interactions/tools right now:\n- use-seating-object: Use available seating"
        )
        check(
            "prompt budget preserves user authority and safe executable tail",
            "DIRECT USER PRIORITY - ACTIVE" in oversized_prompt
            and "use-seating-object" in oversized_prompt
            and len(oversized_prompt) <= server.LIVE_AGENT_MODEL_PROMPT_CHAR_BUDGET,
            oversized_prompt,
        )

        server._live_agent_session_open("resident-b", reason="social-memory-verification")
        social_state = {}
        social_details = server._live_agent_loop_record_social_outcome(
            social_state,
            "resident-a",
            {
                "target": {"kind": "agent", "targetAgentId": "resident-b"},
                "params": {"conversationTopic": "The office often needs another shared armchair."},
            },
            {"id": "social-action", "actionType": "life.social", "status": "completed", "result": {"conversationId": "talk-1"}},
            "2026-07-17T15:15:00Z",
        )
        peer_memory = server._live_agent_loop_resident_profile_context(server._live_agent_loop_resident_profile("resident-b", persist=False))["memory"]
        check("meaningful social action propagates its topic to the other Resident", social_details.get("topic") and any("shared armchair" in str(item.get("text") or "").lower() for item in peer_memory.get("longTerm") or []), json.dumps(peer_memory, default=str)[:1200])

        server._live_agent_session_update("resident-b", working_memory={"userDirectives": [
            {"at": "2026-07-17T15:00:00Z", "text": "Go to the water cooler.", "status": "pending", "source": "user"},
            {"at": "2026-07-17T15:09:00Z", "text": "Please get a coffee.", "status": "pending", "source": "user"},
        ]})
        held_directive_item = {"id": "held-directive-coffee", "kind": "coffee", "label": "coffee", "acquiredAt": "2026-07-17T15:10:00Z", "sourceActionId": "wa-directive-coffee", "sourceActionType": "life.getCoffee"}
        reconciled_directives = server._live_agent_session_reconcile_user_directives("resident-b", inventory={"held": held_directive_item})
        check("verified acquisition completes the current simple directive and supersedes older redirects", reconciled_directives[0].get("status") == "superseded" and reconciled_directives[1].get("status") == "completed", json.dumps(reconciled_directives, default=str))

        server._live_agent_session_update("resident-b", working_memory={"userDirectives": [
            {"at": "2026-07-17T15:20:00Z", "text": "Get coffee, then sit in a chair and drink it.", "status": "pending", "source": "user"},
        ]})
        multi_item = {**held_directive_item, "acquiredAt": "2026-07-17T15:21:00Z", "sourceActionId": "wa-multi-coffee"}
        multi_progress = server._live_agent_session_reconcile_user_directives("resident-b", inventory={"held": multi_item}, event={"event": "acquired", "item": multi_item})
        consumed_item = {**multi_item, "consumedAt": "2026-07-17T15:22:00Z", "seatingActionId": "wa-multi-seat"}
        multi_complete = server._live_agent_session_reconcile_user_directives("resident-b", inventory={"held": None}, event={"event": "consumed", "item": consumed_item})
        check("multi-step directive remains active until its physical follow-up is verified", multi_progress[-1].get("status") == "in_progress" and multi_complete[-1].get("status") == "completed", json.dumps({"progress": multi_progress, "complete": multi_complete}, default=str))

        start_calls = []
        server.start_live_agent_loop = lambda: start_calls.append(True) or None
        server._claim_live_agent_world_or_conflict = lambda agent_id, agent_name="", meta=None: (True, {"agentId": agent_id})
        server._agent_live_world_claim_payload = lambda agent_id, **kwargs: {"agentId": agent_id, "conflict": False, "currentWorld": {"worldId": "test"}}
        ok, activation, status = server.set_agent_live_mode_setting("resident-b", True)
        loop = server.get_live_agent_loop_state(persist_migration=False)
        check("one Live toggle atomically starts scheduler and resident session", ok and status == 200 and loop.get("enabled") is True and loop["agents"]["resident-b"].get("enabled") is True and start_calls and activation.get("liveSession", {}).get("activationId"), json.dumps({"ok": ok, "status": status, "activation": activation, "loop": loop, "startCalls": start_calls}, default=str)[:2000])

    failures = [name for name, ok, _detail in CHECKS if not ok]
    if failures:
        raise SystemExit(f"FAILED: {len(failures)} lived-session checks: {', '.join(failures)}")
    print(f"verify-live-agent-lived-session: ALL PASS ({len(CHECKS)}/{len(CHECKS)})")


if __name__ == "__main__":
    main()
