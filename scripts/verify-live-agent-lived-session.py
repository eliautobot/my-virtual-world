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
        check("Live session has activation-scoped provider identity", first.get("activationId") and first.get("providerSessionKey", "").startswith("agent:resident-a:g"), json.dumps(first, default=str)[:600])
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
        check("provider cognition reuses the activation-scoped session", exchange_one.get("ok") and exchange_two.get("ok") and len(set(provider_keys)) == 1 and provider_keys[0] == replaced.get("providerSessionKey"), json.dumps(gateway_calls, default=str))
        check("normal provider turns do not delete the Live session", not any(method == "sessions.delete" for method, _params in gateway_calls))

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
        check("world lifecycle becomes visible recurrent microsteps", all(value in phases for value in ("select-target", "reserve-or-queue", "route", "revalidate-target", "begin-use", "verify", "continue")), json.dumps(phases))
        check("queue position and target are visible in the lived journal", "position 3" in text_blob and "coffee" in text_blob.lower(), text_blob)
        check("lived target narration includes authoritative coordinates", "(968.0, -460.0)" in text_blob, text_blob)
        check("operational effects do not duplicate terminal journal lines", sum(1 for row in lived.get("messages", []) if row.get("actionId") == "wa-lived-1" and row.get("phase") == "verify") == 1 and sum(1 for row in lived.get("messages", []) if row.get("actionId") == "wa-lived-1" and "released my reservation" in row.get("text", "")) == 1, text_blob)
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
            and "user changed my priority" in redirect_message[2]
            and "could not finish" not in redirect_message[2].lower(),
            json.dumps(redirect_message),
        )

        original_provider = server._live_agent_model_provider_request
        original_perception = server._live_agent_loop_build_perception
        original_halt = server._live_agent_halt_live_actions_for_user
        original_cancel = server._live_agent_cancel_live_actions
        halt_calls = []
        cancel_calls = []
        server._live_agent_model_provider_request = lambda *_args, **_kwargs: {"ok": True, "providerKind": "openclaw", "sessionId": replaced.get("providerSessionKey"), "reply": "I’m walking to the coffee machine and I’ll keep going after answering you."}
        server._live_agent_loop_build_perception = lambda *_args, **_kwargs: {"location": {"buildingId": "office"}, "active": [{"id": "wa-lived-1", "status": "routing"}], "spatial": {"nearbyObjects": []}}
        server._live_agent_halt_live_actions_for_user = lambda agent_id: halt_calls.append(agent_id) or [{"id": "wa-lived-1", "cancelled": True}]
        server._live_agent_cancel_live_actions = lambda agent_id, **kwargs: cancel_calls.append((agent_id, kwargs)) or [{"id": "wa-lived-1", "cancelled": True}]
        try:
            ok, question, status = server.handle_live_agent_session_message({"agentId": "resident-a", "sessionId": f"vw-live-mode:resident-a", "message": "Where are you going?"})
            check("status question answers in the same Live session", ok and status == 200 and "coffee machine" in question.get("reply", "").lower(), json.dumps({"ok": ok, "status": status, "result": question}, default=str)[:1500])
            check("status question does not cancel the physical action", not halt_calls and not cancel_calls)
            ok, stopped, status = server.handle_live_agent_session_message({"agentId": "resident-a", "message": "Stop and wait."})
            check("explicit stop interrupts and pauses at a checkpoint", ok and halt_calls == ["resident-a"] and server._live_agent_session_current("resident-a")["checkpoint"].get("pausedByUser") is True, json.dumps({"ok": ok, "status": status, "result": stopped, "halts": halt_calls, "session": server._live_agent_session_current("resident-a")}, default=str)[:1500])
            server.live_agent_clear_user_attention("resident-a")
            loop_state = server.get_live_agent_loop_state(persist_migration=True)
            loop_agent = server._live_agent_loop_agent_state(loop_state, "resident-a")
            loop_agent["autonomyPlan"] = server._live_agent_loop_normalize_autonomy_plan({"currentGoal": "Finish the carried item first.", "nextStep": {"intent": "Use another seat."}})
            server.save_live_agent_loop_state(loop_state)
            ok, redirected, status = server.handle_live_agent_session_message({"agentId": "resident-a", "message": "Go to the water cooler instead."})
            current = server._live_agent_session_current("resident-a")
            redirected_agent = (server.get_live_agent_loop_state(persist_migration=False).get("agents") or {}).get("resident-a") or {}
            check("redirect cancels current work, records the directive, and supersedes stale planning", ok and cancel_calls and current["checkpoint"].get("userDirective") == "Go to the water cooler instead." and current["workingMemory"]["userDirectives"][-1]["status"] == "pending" and (redirected_agent.get("autonomyPlan") or {}).get("currentGoal") == "Go to the water cooler instead.", json.dumps({"ok": ok, "status": status, "result": redirected, "cancels": cancel_calls, "session": current, "agent": redirected_agent}, default=str)[:2000])
        finally:
            server._live_agent_model_provider_request = original_provider
            server._live_agent_loop_build_perception = original_perception
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
        check("repeated shortage becomes working memory and operator-visible observation", signal.get("observationCount") == 2 and signal.get("memoryRecordedAt") and "available alternative" in signal.get("text", ""))
        check("important repeated shortage reaches durable Resident memory", "seating resource has been unavailable" in memory_blob, memory_blob[:1000])

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
        profile_offset = directive_prompt.find("RESIDENT PROFILE AUTHORITY - REQUIRED")
        check("direct user directive outranks prior goals in the recurrent prompt", directive_frame.get("goals", [])[0].get("kind") == "direct-user" and directive_offset >= 0 and "Go to the water cooler instead" in directive_prompt and 0 <= directive_offset < profile_offset, directive_prompt[:2500])
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
