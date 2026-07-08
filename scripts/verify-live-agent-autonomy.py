#!/usr/bin/env python3
"""Verify Live Agent Mode autonomy upgrades:

1. User chat preemption: marking user attention cancels live-mode actions and
   the loop skips the agent while the hold is active.
2. Model decision layer: model choice/skip/invalid parsing, provider gating,
   and fallback to planner-v2 when the model is unavailable.
3. Settings: new toggles persist through the settings endpoint.

Runs against an isolated temp world; no live data or gateway required.
"""

import importlib.util
import json
import os
import sys
import time
from pathlib import Path
import tempfile


ROOT = Path(__file__).resolve().parents[1]
SERVER_PATH = ROOT / "src" / "server" / "server.py"

CHECKS = []


def check(name, condition, detail=""):
    CHECKS.append((name, bool(condition), detail))
    marker = "PASS" if condition else "FAIL"
    print(f"[{marker}] {name}" + (f" — {detail}" if detail and not condition else ""))
    return bool(condition)


def load_server(tmpdir):
    data_dir = tmpdir / "data"
    openclaw_dir = tmpdir / "openclaw"
    (data_dir / "buildings").mkdir(parents=True, exist_ok=True)
    (data_dir / "chunks").mkdir(parents=True, exist_ok=True)
    openclaw_dir.mkdir(parents=True, exist_ok=True)
    os.environ["VW_DATA_DIR"] = str(data_dir)
    os.environ["VW_OPENCLAW_PATH"] = str(openclaw_dir)
    os.environ["VW_OPENCLAW_HOST_PATH"] = str(openclaw_dir)
    os.environ["VW_CODEX_INCLUDE_NATIVE_AGENTS"] = "0"
    os.environ["VW_CLAUDE_CODE_INCLUDE_NATIVE_AGENTS"] = "0"
    os.environ["_VW_INT"] = "1"  # developer license so agentLiveMode is not trial-locked
    spec = importlib.util.spec_from_file_location("mvw_server_autonomy_test", SERVER_PATH)
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    module._agent_roster = [
        {"id": "tester", "statusKey": "tester", "name": "Test Resident", "providerKind": "openclaw", "providerAgentId": "tester"},
        {"id": "hermie", "statusKey": "hermie", "name": "Hermes Resident", "providerKind": "hermes", "providerAgentId": "hermie"},
    ]
    module._roster_time = time.time()
    return module


def seed_live_mode(server, agent_id="tester"):
    meta = server.load_world_meta()
    profiles = meta.get("agentProfiles") or {}
    profiles[agent_id] = {**(profiles.get(agent_id) or {}), "agentLiveModeEnabled": True}
    meta["agentProfiles"] = profiles
    features = meta.get("features") or {}
    features["agentLiveMode"] = True
    meta["features"] = features
    server.save_world_meta(meta)


def main():
    with tempfile.TemporaryDirectory(prefix="vw-live-autonomy-") as raw:
        tmpdir = Path(raw)
        server = load_server(tmpdir)
        seed_live_mode(server, "tester")

        # ------------------------------------------------------------------
        # 1) USER CHAT PREEMPTION
        # ------------------------------------------------------------------
        record = server.live_agent_note_user_attention("tester", source="verify", message_preview="hello agent")
        check("user attention record created", isinstance(record, dict) and record.get("agentId") == "tester")
        status = server.live_agent_user_attention_status("tester")
        check("user attention active", status.get("active") is True and status.get("remainingSec") > 0)

        tick = server.live_agent_loop_tick(reason="verify", force=True)
        skipped = [item for item in tick.get("skipped") or [] if item.get("agentId") == "tester"]
        check(
            "loop skips agent while attending user",
            any(item.get("reason") == "user-attention" for item in skipped),
            json.dumps(skipped)[:300],
        )
        check("no live actions created while attending", not tick.get("actionsCreated"))

        cleared = server.live_agent_clear_user_attention("tester")
        check("user attention cleared", cleared is True)
        status_after = server.live_agent_user_attention_status("tester")
        check("user attention inactive after clear", status_after.get("active") is False)

        # Halt path: fabricate an active live-mode world action, then preempt.
        store = server.get_world_actions_store()
        now_iso = server._utc_now_iso()
        store.setdefault("active", []).append({
            "id": "wa-live-test-1",
            "agentId": "tester",
            "status": "routing",
            "actionType": "life.getWater",
            "capabilityTag": "life.hydration",
            "source": {"kind": "agent-live-mode", "requestedBy": "verify"},
            "params": {"loopActionId": "hydrate-water-cooler"},
            "createdAt": now_iso,
            "updatedAt": now_iso,
            "priority": "normal",
            "target": {"kind": "world-point", "x": 0, "y": 0, "z": 0},
            "timing": {"createdAt": now_iso, "updatedAt": now_iso},
            "lifecycle": {
                "previousStatus": "route_pending",
                "allowedNext": server._world_action_allowed_next("routing"),
                "transitionLog": [],
            },
        })
        saved_ok, saved_detail = server.save_world_actions_store(store)
        check("fabricated live world action saved", saved_ok, json.dumps(saved_detail, default=str)[:300] if not saved_ok else "")
        record2 = server.live_agent_note_user_attention("tester", source="verify-halt", message_preview="drop everything")
        interrupted = record2.get("interrupted") or []
        check(
            "active live world action cancelled on preemption",
            any(item.get("type") == "world-action" and item.get("cancelled") for item in interrupted),
            json.dumps(interrupted)[:300],
        )
        refreshed = server.get_world_actions_store()
        still_active = [a for a in refreshed.get("active", []) if a.get("id") == "wa-live-test-1" and server._canonical_world_action_status(a.get("status")) in server.WORLD_ACTION_ACTIVE_STATES]
        check("live world action no longer active", not still_active)
        server.live_agent_clear_user_attention("tester")

        # ------------------------------------------------------------------
        # 2) MODEL DECISION LAYER
        # ------------------------------------------------------------------
        parse = server._live_agent_model_decision_parse
        ids = ["hydrate-water-cooler", "talk-with-nearby-agent"]
        check("parse ACTION line", parse("ACTION: hydrate-water-cooler", ids)[0] == "hydrate-water-cooler")
        check("parse skip", parse("action: SKIP", ids)[0] == "skip")
        check("parse unknown id rejected", parse("ACTION: fly-to-moon", ids)[0] is None)
        check("parse mention fallback", parse("I think talk-with-nearby-agent is best.", ids)[0] == "talk-with-nearby-agent")
        check("parse empty rejected", parse("", ids)[0] is None)

        # Intention replies (model-intention-v2)
        chosen_i, status_i, intent_i = parse('INTENTION: {"activity": "I am thirsty, getting water", "action": "hydrate-water-cooler"}', ids)
        check("intention with direct action resolves", chosen_i == "hydrate-water-cooler" and status_i == "intention-action" and intent_i.get("activity"), json.dumps(intent_i or {}))
        chosen_c, status_c, intent_c = parse('INTENTION: {"activity": "continue my chair testing goal", "category": "seating"}', ids)
        check("intention category request parsed", chosen_c is None and status_c == "intention-category-request" and intent_c.get("category") == "seating", json.dumps(intent_c or {}))
        chosen_s, status_s, intent_s = parse('INTENTION: {"activity": "nothing worth doing", "action": "skip"}', ids)
        check("intention skip parsed", chosen_s == "skip" and status_s == "intention-skip")
        chosen_a, status_a, _ = parse('INTENTION: {"activity": "go talk-with-nearby-agent to socialize"}', ids)
        check("intention activity mention matches candidate", chosen_a == "talk-with-nearby-agent" and status_a == "intention-activity-match")
        chosen_l, status_l, intent_l = parse("INTENTION: {'activity': 'test the couch', 'category': 'couch'}", ids)
        check("intention single-quote salvage works", status_l == "intention-category-request" and intent_l.get("category") == "couch", json.dumps(intent_l or {}))
        planner_reply = json.dumps({
            "reflection": "I tested water already and should now continue the seating exploration.",
            "currentGoal": "Explore and verify seating objects across the world.",
            "plan": ["Find an untested seat", "Use it visibly", "Record whether it worked", "Choose the next untested object"],
            "nextStep": {
                "intent": "Talk with a nearby resident to satisfy social need.",
                "action": "talk-with-nearby-agent",
                "category": "social",
                "targetCriteria": "nearest visible resident",
                "successCriteria": "conversation completes visibly",
            },
            "memoryUpdate": {"lesson": "Carry forward tested targets instead of repeating the same one."},
        })
        chosen_p, status_p, intent_p = parse(planner_reply, ids)
        check("planner JSON direct action resolves", chosen_p == "talk-with-nearby-agent" and status_p == "planner-step-action" and isinstance(intent_p.get("plannerTurn"), dict), json.dumps(intent_p or {})[:500])
        planner_category = json.dumps({
            "reflection": "The same chair was repeated; broaden coverage.",
            "currentGoal": "Test varied seating.",
            "plan": ["Find a new seating category", "Use it", "Reflect"],
            "nextStep": {"intent": "Find a bench or couch", "category": "seating", "targetCriteria": "untested seating object"},
            "memoryUpdate": {"lesson": "Prefer untested seating types."},
        })
        chosen_pc, status_pc, intent_pc = parse(planner_category, ids)
        check("planner JSON category request parsed", chosen_pc is None and status_pc == "planner-step-category-request" and intent_pc.get("category") == "seating", json.dumps(intent_pc or {})[:500])
        planner_tool = json.dumps({
            "reflection": "I need more information before acting.",
            "currentGoal": "Inspect available objects.",
            "plan": ["Request an inventory tool", "Pick an object", "Execute a visible action"],
            "nextStep": {"intent": "Ask for world object inventory"},
            "toolRequests": ["world.inventoryNearby"],
            "memoryUpdate": {"lesson": "Request context when no safe visible target is obvious."},
        })
        chosen_pt, status_pt, intent_pt = parse(planner_tool, ids)
        check("planner JSON tool/event request carries plan without unsafe execution", chosen_pt is None and status_pt == "planner-tool-or-event-request" and intent_pt.get("plannerTurn", {}).get("toolRequests"), json.dumps(intent_pt or {})[:500])

        # Category alias registration feeds the dynamic affordance layer.
        check("category alias couch -> seating", server._live_agent_loop_note_requested_category("tester", "couch") == "seating")
        check("unknown category rejected", server._live_agent_loop_note_requested_category("tester", "rocketship") is None)
        check("requested category active", "seating" in server._live_agent_loop_requested_categories("tester"))
        with server._live_agent_model_decision_lock:
            server._live_agent_model_decision_state.get("tester", {}).pop("requestedCategories", None)
        check("requested category cleared", "seating" not in server._live_agent_loop_requested_categories("tester"))

        check("provider kind resolves openclaw", server._live_agent_model_decision_provider_kind("tester") == "openclaw")
        check("provider kind resolves hermes", server._live_agent_model_decision_provider_kind("hermie") == "hermes")

        # Provider gating: hermes agent should be refused by the model layer.
        state = server.get_live_agent_loop_state()
        config = server._live_agent_model_decision_config(state)
        frame = {"candidates": [{"id": "hydrate-water-cooler", "label": "get water", "need": "hydration", "score": 1, "decision": "candidate"}]}
        chosen, detail = server._live_agent_model_decide("hermie", frame, {}, config)
        check("non-openclaw provider skipped by model layer", chosen is None and detail.get("status") == "provider-not-supported", json.dumps(detail))

        # Async request path: first call starts a background request and falls back
        # to planner-v2 for this tick; the worker then fails gracefully without a gateway.
        chosen2, detail2 = server._live_agent_model_decide("tester", frame, {}, config)
        check(
            "model decide is non-blocking and falls back gracefully",
            chosen2 in (None, "skip") and detail2.get("status") in {"model-request-started", "gateway-error", "gateway-rejected", "model-decision-cooldown", "model-decision-in-flight", "reply-timeout"},
            json.dumps(detail2)[:300],
        )
        # Async completed-choice application: seed a pending choice and confirm the
        # next decide call applies it immediately.
        with server._live_agent_model_decision_lock:
            row = server._live_agent_model_decision_state.setdefault("tester", {})
            row["pendingChoice"] = {
                "chosen": "hydrate-water-cooler",
                "detail": {
                    "mode": server.LIVE_AGENT_LOOP_MODEL_DECISION_MODE,
                    "status": "planner-step-action",
                    "plannerTurn": intent_p.get("plannerTurn"),
                    "intention": intent_p,
                },
                "candidateIds": ["hydrate-water-cooler"],
                "intention": intent_p,
            }
            row["inFlight"] = False
        planner_state = {}
        chosen3, detail3 = server._live_agent_model_decide("tester", frame, {}, config)
        check("async completed model choice applied on next tick", chosen3 == "hydrate-water-cooler" and detail3.get("applied") == "async-previous-request", json.dumps(detail3)[:200])
        server._live_agent_loop_apply_planner_turn(planner_state, detail3)
        check("planner turn persists autonomy plan", (planner_state.get("autonomyPlan") or {}).get("currentGoal") == "Explore and verify seating objects across the world.", json.dumps(planner_state.get("autonomyPlan"), default=str))
        check("planner turn stores reflection memory", any("tested water" in (item.get("text") or "") for item in (planner_state.get("memory") or {}).get("reflections", [])), json.dumps((planner_state.get("memory") or {}).get("reflections"), default=str))
        # Stale choice (candidate no longer available) is discarded safely.
        with server._live_agent_model_decision_lock:
            row = server._live_agent_model_decision_state.setdefault("tester", {})
            row["pendingChoice"] = {"chosen": "not-a-candidate-anymore", "detail": {"status": "model-choice"}, "candidateIds": ["not-a-candidate-anymore"]}
        chosen4, detail4 = server._live_agent_model_decide("tester", frame, {}, config)
        check("stale async model choice discarded", chosen4 is None and detail4.get("status") == "stale-choice-discarded", json.dumps(detail4)[:200])

        # Selection integration: with model decisions disabled the planner-v2 path is used untouched.
        ok, result, status_code = server.update_live_agent_loop_settings({"modelDecisionEnabled": False})
        check("modelDecisionEnabled=false persists", ok and result["state"].get("modelDecisionEnabled") is False)
        agent_state = {}
        selected, decision = server._live_agent_loop_select_next_action("tester", agent_state)
        check("planner-v2 decision produced when model disabled", isinstance(decision, dict) and decision.get("mode") == "planner-v2")
        check("model decision detail absent when disabled", "modelDecision" not in decision)

        # Re-enable and confirm the failure path still yields a decision frame with model detail.
        server.update_live_agent_loop_settings({"modelDecisionEnabled": True, "modelDecisionMinIntervalSec": 30})
        agent_state2 = {}
        selected2, decision2 = server._live_agent_loop_select_next_action("tester", agent_state2)
        check(
            "model-enabled selection still returns a decision frame without gateway",
            isinstance(decision2, dict) and (decision2.get("modelDecision") is not None or decision2.get("mode") == "planner-v2"),
            json.dumps(decision2.get("modelDecision") or {})[:300],
        )

        # ------------------------------------------------------------------
        # 2a) SAFE AUTONOMY: PROFILE GOALS, ISSUE PRIORITY, AND NEED WEIGHTS
        # ------------------------------------------------------------------
        server.save_building("autonomy-lab", {
            "id": "autonomy-lab",
            "name": "Autonomy Lab",
            "type": "office",
            "worldX": 200,
            "worldY": 200,
            "widthTiles": 12,
            "heightTiles": 10,
            "interior": {
                "furniture": [
                    {"id": "autonomy-whiteboard", "catalogId": "whiteboard", "x": 2, "z": 2, "floor": 1},
                    {"id": "autonomy-armchair", "catalogId": "armchair", "x": 5, "z": 4, "floor": 1},
                    {"id": "autonomy-printer", "catalogId": "all-in-one-printer-scanner", "x": 8, "z": 2, "floor": 1},
                    {"id": "autonomy-water", "catalogId": "waterCooler", "x": 9, "z": 6, "floor": 1},
                ]
            },
        })
        meta_goal = server.load_world_meta()
        profiles_goal = meta_goal.get("agentProfiles") or {}
        profile_goal = profiles_goal.get("tester") or {}
        profile_goal["residentProfile"] = {
            "schemaVersion": server.RESIDENT_PROFILE_SCHEMA_VERSION,
            "identity": {"displayName": "Test Resident", "role": "world tester"},
            "goals": {
                "current": [
                    "Test chairs and seating furniture. Make sure they are seats, are interactive, and feel good to use."
                ],
                "daily": [],
                "longTerm": [],
            },
            "needs": {},
            "personality": {"curious": 0.9, "easygoing": 0.3, "outgoing": 0.2},
            "memory": {},
        }
        profiles_goal["tester"] = profile_goal
        meta_goal["agentProfiles"] = profiles_goal
        server.save_world_meta(meta_goal)

        goal_agent_state = {
            "needs": {
                "hydration": 0.32,
                "food": 0.25,
                "energy": 0.22,
                "curiosity": 0.54,
                "maintenance": 0.15,
                "shelter": 0.2,
                "social": 0.1,
            }
        }
        perception_goal = server._live_agent_loop_build_perception("tester", goal_agent_state)
        affordance_ids = [item.get("id") for item in perception_goal.get("affordances") or [] if item.get("available")]
        seating_affordance = next((item for item in perception_goal.get("affordances") or [] if item.get("id") == "use-seating-object"), None)
        check("seating goal activates dynamic seating affordance", "use-seating-object" in affordance_ids and seating_affordance.get("actionType") == "life.restAtArmchair", json.dumps(seating_affordance, default=str)[:500])

        # Dynamic affordances are goal/intention gated: an agent without a
        # seating goal or requested category must NOT see the seating candidate.
        nogoal_defs = [d.get("id") for d in server._live_agent_loop_action_defs_for_agent("hermie", {})]
        check("dynamic seating affordance hidden without goal/intention", "use-seating-object" not in nogoal_defs, json.dumps(nogoal_defs))
        server._live_agent_loop_note_requested_category("hermie", "chairs")
        withreq_defs = [d.get("id") for d in server._live_agent_loop_action_defs_for_agent("hermie", {})]
        check("model category request activates dynamic affordance", "use-seating-object" in withreq_defs, json.dumps(withreq_defs))
        with server._live_agent_model_decision_lock:
            server._live_agent_model_decision_state.get("hermie", {}).pop("requestedCategories", None)
        goal_frame = server._live_agent_loop_build_goal_frame("tester", perception_goal, goal_agent_state)
        top_goal = next((item for item in goal_frame.get("goals") or [] if item.get("kind") == "resident-profile"), {})
        check("profile goal frame preserves goal text and seating intent", top_goal.get("intent") == "seating-test" and "chairs" in top_goal.get("text", "").lower(), json.dumps(top_goal, default=str)[:500])
        decision_goal = server._live_agent_loop_build_decision_frame("tester", perception_goal, goal_agent_state)
        by_id = {item.get("id"): item for item in decision_goal.get("candidates") or []}
        check("seating goal outranks printer paperwork", by_id.get("use-seating-object", {}).get("score", 0) > by_id.get("print-copy-document", {}).get("score", 999), json.dumps({k: by_id.get(k) for k in ("use-seating-object", "print-copy-document")}, default=str)[:700])
        prompt_goal = server._live_agent_model_decision_prompt("tester", decision_goal, goal_agent_state)
        check("model prompt includes real goal text and planner JSON format", "Test chairs and seating furniture" in prompt_goal and "nextStep" in prompt_goal and "memoryUpdate" in prompt_goal and "use-seating-object" in prompt_goal and "category" in prompt_goal, prompt_goal[:900])
        check("model prompt presents continuous autonomy not one-shot command", "continuous autonomy loop" in prompt_goal.lower() and "observe, reflect, plan, execute, learn, and replan" in prompt_goal and "Reply with EXACTLY one line" not in prompt_goal, prompt_goal[:700])
        check("model prompt labels planner frame as ephemeral", "LIVE MODE PLANNER FRAME - EPHEMERAL LOOP CONTEXT" in prompt_goal and "not a life event" in prompt_goal and "Remember only your intention" in prompt_goal, prompt_goal[:700])

        # Goal progress: completed seating targets are remembered and the
        # resolver prefers untested seats, while the prompt shows progress.
        seating_def = server.LIVE_AGENT_DYNAMIC_OBJECT_AFFORDANCES["seating"]
        progress_state = dict(goal_agent_state)
        first_pick = server._live_agent_loop_find_seating_target(seating_def, agent_id="tester", agent_state=progress_state)
        first_key = server._live_agent_loop_target_key(first_pick.get("target")) if first_pick else None
        check("seating resolver finds a real target", bool(first_key), json.dumps(first_pick, default=str)[:300])
        server._live_agent_loop_record_goal_progress(progress_state, seating_def, first_key, True)
        row = (progress_state.get("goalProgress") or {}).get("category:seating") or {}
        check("goal progress records completed target", first_key in (row.get("completedTargets") or []), json.dumps(row, default=str))
        second_pick = server._live_agent_loop_find_seating_target(seating_def, agent_id="tester", agent_state=progress_state)
        second_key = server._live_agent_loop_target_key(second_pick.get("target")) if second_pick else None
        check("resolver still returns a target after progress (fallback ok)", bool(second_key), json.dumps(second_pick, default=str)[:300])
        progress_prompt = server._live_agent_model_decision_prompt("tester", decision_goal, progress_state)
        check("model prompt shows goal progress", "Goal progress so far" in progress_prompt and "category:seating" in progress_prompt, progress_prompt[:600])
        check("goal progress survives normalization", (server._live_agent_loop_normalize_memory(progress_state).get("goalProgress") or {}).get("category:seating", {}).get("completedTargets"), json.dumps(progress_state.get("goalProgress"), default=str))
        progress_state["autonomyPlan"] = planner_state.get("autonomyPlan")
        plan_prompt = server._live_agent_model_decision_prompt("tester", decision_goal, progress_state)
        check("model prompt carries active autonomy plan", "Active autonomy plan carried from prior loop" in plan_prompt and "Explore and verify seating objects" in plan_prompt, plan_prompt[:900])

        # Seating validation must not treat route/arrival completion as proof
        # that the agent actually entered a seated use state.
        seating_target = {
            "kind": "object-instance",
            "buildingId": "autonomy-lab",
            "objectInstanceId": "autonomy-armchair",
            "catalogId": "armchair",
            "interactionSpotId": "seat",
            "floor": 1,
        }

        def completed_seating_action(action_id, result):
            return {
                "id": action_id,
                "status": "completed",
                "actionType": "life.restAtArmchair",
                "agentId": "tester",
                "target": dict(seating_target),
                "params": {"loopActionId": "use-seating-object"},
                "timing": {"updatedAt": server._utc_now_iso(), "completedAt": server._utc_now_iso(), "terminalAt": server._utc_now_iso()},
                "result": result,
                "reservation": {"state": "released", "availabilityState": "available"},
                "effects": [{"type": "reservation-released"}],
            }

        validation_state = {"memory": {}, "goalProgress": {}}
        validation_loop_state = {"agents": {"tester": validation_state}}
        arrival_only_action = completed_seating_action("verify-seat-arrival-only", {
            "status": "completed",
            "applied": True,
            "reason": "server_authoritative_live_action_completed",
            "route": {"arrived": True, "distanceToTarget": 0},
        })
        arrival_only_summary = server._live_agent_loop_action_summary(arrival_only_action)
        remembered_arrival = server._live_agent_loop_remember_settled_action(validation_loop_state, "tester", validation_state, arrival_only_action, arrival_only_summary)
        seating_progress = (validation_state.get("goalProgress") or {}).get("category:seating") or {}
        seating_key = server._live_agent_loop_target_key(seating_target)
        check(
            "arrival-only seating completion records failed validation",
            remembered_arrival.get("status") == "failed" and seating_key in (seating_progress.get("failedTargets") or []) and seating_key not in (seating_progress.get("completedTargets") or []),
            json.dumps({"remembered": remembered_arrival, "progress": seating_progress}, default=str)[:700],
        )
        check(
            "arrival-only seating failure explains missing embodied evidence",
            "seated" in ((remembered_arrival.get("failure") or {}).get("learningText") or "").lower() and "arrival" in ((remembered_arrival.get("failure") or {}).get("learningText") or "").lower(),
            json.dumps(remembered_arrival.get("failure"), default=str)[:700],
        )

        embodied_action = completed_seating_action("verify-seat-embodied", {
            "status": "completed",
            "applied": True,
            "reason": "server_authoritative_live_action_completed",
            "runtime": "agent-runtime-room.mjs#tickLiveActionRuntime",
            "embodiedState": {
                "useState": "completed",
                "activeUseState": "completed",
                "seated": True,
                "poseKind": "seat",
                "posture": "seated",
                "animationId": "sit",
                "docked": True,
                "finalPlacement": {"x": 200.0, "y": 200.0, "floor": 1, "buildingId": "autonomy-lab", "facingAngleRad": 0},
            },
        })
        embodied_summary = server._live_agent_loop_action_summary(embodied_action)
        remembered_embodied = server._live_agent_loop_remember_settled_action(validation_loop_state, "tester", validation_state, embodied_action, embodied_summary)
        seating_progress = (validation_state.get("goalProgress") or {}).get("category:seating") or {}
        check(
            "embodied seating completion records tested target",
            remembered_embodied.get("status") == "completed" and seating_key in (seating_progress.get("completedTargets") or []) and seating_key not in (seating_progress.get("failedTargets") or []),
            json.dumps({"remembered": remembered_embodied, "progress": seating_progress}, default=str)[:700],
        )

        thirsty_state = {**goal_agent_state, "needs": {**goal_agent_state["needs"], "hydration": 0.93}}
        thirsty_perception = server._live_agent_loop_build_perception("tester", thirsty_state)
        thirsty_decision = server._live_agent_loop_build_decision_frame("tester", thirsty_perception, thirsty_state)
        check("critical hydration overrides active seating goal", thirsty_decision.get("selectedActionId") == "hydrate-water-cooler", json.dumps(thirsty_decision.get("candidates") or [], default=str)[:900])

        issue_state = {
            **goal_agent_state,
            "memory": {
                "recentActions": [
                    {
                        "loopActionId": "use-seating-object",
                        "status": "failed",
                        "label": "use a seating object",
                        "targetKey": "object:autonomy-armchair:seat",
                        "failure": {"learningText": "seat reservation failed; avoid retrying the same target until fixed", "targetKey": "object:autonomy-armchair:seat"},
                    },
                    {
                        "loopActionId": "use-seating-object",
                        "status": "failed",
                        "label": "use a seating object",
                        "targetKey": "object:autonomy-armchair:seat",
                        "failure": {"learningText": "seat reservation failed again; investigate the seating target", "targetKey": "object:autonomy-armchair:seat"},
                    },
                ]
            },
        }
        issue_perception = server._live_agent_loop_build_perception("tester", issue_state)
        issue_decision = server._live_agent_loop_build_decision_frame("tester", issue_perception, issue_state)
        issue_candidates = {item.get("id"): item for item in issue_decision.get("candidates") or []}
        check("unresolved issue prioritizes investigation over retry", issue_decision.get("selectedActionId") == "investigate-blocking-issue" and issue_candidates.get("use-seating-object", {}).get("score", 0) < issue_candidates.get("investigate-blocking-issue", {}).get("score", 0), json.dumps(issue_candidates, default=str)[:900])

        home_site = server._live_agent_loop_find_home_build_site("tester")
        home_target = home_site.get("target") if isinstance(home_site, dict) else {}
        build_site = home_site.get("buildSite") if isinstance(home_site, dict) else {}
        street_approach = build_site.get("streetApproach") if isinstance(build_site, dict) else {}
        approach_tile = street_approach.get("approachTile") if isinstance(street_approach, dict) else {}
        street_surface = street_approach.get("streetSurface") if isinstance(street_approach, dict) else {}
        target_tile = {
            "x": home_target.get("x") / server.LIVE_AGENT_LOOP_API_TILE if isinstance(home_target.get("x"), (int, float)) else None,
            "y": home_target.get("y") / server.LIVE_AGENT_LOOP_API_TILE if isinstance(home_target.get("y"), (int, float)) else None,
        }
        target_matches_approach = (
            isinstance(approach_tile.get("x"), (int, float))
            and isinstance(approach_tile.get("y"), (int, float))
            and abs(target_tile["x"] - approach_tile["x"]) < 0.001
            and abs(target_tile["y"] - approach_tile["y"]) < 0.001
        )
        approach_on_surface = (
            street_surface
            and street_surface.get("minX") <= approach_tile.get("x", 999999) <= street_surface.get("maxX")
            and street_surface.get("minZ") <= approach_tile.get("y", 999999) <= street_surface.get("maxZ")
        )
        placement = server.validate_building_placement(build_site)
        check("home build site is street-adjacent and valid", placement.get("ok") is True and street_approach.get("source") == "street-adjacent-build-site", json.dumps({"site": build_site, "placement": placement}, default=str)[:500])
        check("home build route target is on street surface", target_matches_approach and approach_on_surface, json.dumps({"targetTile": target_tile, "approach": approach_tile, "surface": street_surface}, default=str))

        server.save_building("live-home-tester", {
            "id": "live-home-tester",
            "name": "Tester Home",
            "type": "house",
            "worldX": -20,
            "worldY": 132,
            "widthTiles": 10,
            "heightTiles": 8,
            "_rotation": 270,
            "liveModeHomeForAgentId": "tester",
        })
        home_action_point = server._live_agent_action_target_point({
            "target": {"kind": "building", "buildingId": "live-home-tester", "floor": 1}
        })
        expected_home_point = server._live_agent_building_target_point(server.load_building("live-home-tester"))
        check(
            "building target resolves to interior entry for watchdog context",
            home_action_point and expected_home_point
            and abs(home_action_point["x"] - expected_home_point["x"]) < 0.001
            and abs(home_action_point["y"] - expected_home_point["y"]) < 0.001
            and home_action_point.get("buildingId") == "live-home-tester",
            json.dumps({"actual": home_action_point, "expected": expected_home_point}, default=str),
        )

        # ------------------------------------------------------------------
        # 3) SETTINGS PERSISTENCE
        # ------------------------------------------------------------------
        # ------------------------------------------------------------------
        # 2b) LOCATION AWARENESS + ROUTE PROGRESS WATCHDOG
        # ------------------------------------------------------------------
        runtime_doc = {
            "agents": {
                "tester": {"x": 100.0, "y": -200.0, "floor": 1, "buildingId": "", "state": "working", "mode": "live", "updatedAt": server._utc_now_iso()},
            },
        }
        runtime_path = Path(server.DATA_DIR) / "agent-runtime.json"
        runtime_path.write_text(json.dumps(runtime_doc), encoding="utf-8")
        pos = server._live_agent_runtime_position("tester")
        check("runtime position readable", pos is not None and pos.get("x") == 100.0 and pos.get("y") == -200.0)

        now_iso = server._utc_now_iso()
        store = server.get_world_actions_store()
        store.setdefault("active", []).append({
            "id": "wa-route-stuck-1",
            "agentId": "tester",
            "status": "routing",
            "actionType": "life.getWater",
            "capabilityTag": "life.hydration",
            "source": {"kind": "agent-live-mode", "requestedBy": "verify"},
            "params": {"loopActionId": "hydrate-water-cooler"},
            "createdAt": now_iso,
            "updatedAt": now_iso,
            "priority": "normal",
            "target": {"kind": "world-point", "x": 900.0, "y": 900.0, "z": 0},
            "timing": {"createdAt": now_iso, "updatedAt": now_iso},
            "lifecycle": {
                "previousStatus": "route_pending",
                "allowedNext": server._world_action_allowed_next("routing"),
                "transitionLog": [],
            },
        })
        saved_ok2, saved_detail2 = server.save_world_actions_store(store)
        check("stuck-route action saved", saved_ok2, json.dumps(saved_detail2, default=str)[:200] if not saved_ok2 else "")

        records = server._active_behavior_records_for_agent("tester")
        frame = server._live_agent_loop_location_frame("tester", records)
        check(
            "location frame includes position/target/distance",
            frame.get("position") and frame.get("activeTarget") and isinstance(frame.get("distanceToTarget"), float),
            json.dumps(frame, default=str)[:250],
        )

        # Simulate no-progress samples over the watchdog window (agent never moves).
        state_wd = server.get_live_agent_loop_state()
        agent_state_wd = server._live_agent_loop_agent_state(state_wd, "tester")
        agent_state_wd["lastActionId"] = "wa-route-stuck-1"
        base_epoch = time.time() - 90
        agent_state_wd["routeProgress"] = {
            "worldActionId": "wa-route-stuck-1",
            "samples": [
                {"atEpoch": base_epoch, "distance": 1360.0, "x": 100.0, "y": -200.0},
                {"atEpoch": base_epoch + 30, "distance": 1360.0, "x": 100.0, "y": -200.0},
                {"atEpoch": base_epoch + 60, "distance": 1360.0, "x": 100.0, "y": -200.0},
            ],
        }
        detail_wd = server._live_agent_loop_monitor_route_progress(
            state_wd, "tester", agent_state_wd, server._active_behavior_records_for_agent("tester"), time.time(), server._utc_now_iso()
        )
        check(
            "watchdog cancels stalled route",
            isinstance(detail_wd, dict) and detail_wd.get("cancelled") is True,
            json.dumps(detail_wd, default=str)[:250] if detail_wd else "no detail",
        )
        refreshed_wd = server.get_world_actions_store()
        still_routing = [a for a in refreshed_wd.get("active", []) if a.get("id") == "wa-route-stuck-1" and server._canonical_world_action_status(a.get("status")) in server.WORLD_ACTION_ACTIVE_STATES]
        check("stalled action no longer active", not still_routing)

        server._live_agent_loop_refresh_completed_outcomes(state_wd)
        memory_blob = json.dumps(agent_state_wd.get("memory") or {}, default=str)
        check(
            "watchdog failure stored as detailed short-term memory",
            "no_route_progress" in memory_blob and "900" in memory_blob and "avoid retrying the same target" in memory_blob,
            memory_blob[-800:],
        )
        failed_affordance = {"id": "hydrate-water-cooler", "need": "hydration", "label": "get water", "target": {"kind": "world-point", "x": 900.0, "y": 900.0}}
        failure_score, failure_breakdown = server._live_agent_loop_decision_score(
            failed_affordance,
            agent_state_wd,
            {"goals": [], "recentOutcomes": server._live_agent_loop_recent_outcome_summary(agent_state_wd)},
        )
        check(
            "same-target failure strongly penalizes future selection",
            failure_breakdown.get("reliability", 0) <= -0.7 and failure_score < 0.5,
            json.dumps({"score": failure_score, "breakdown": failure_breakdown}, default=str),
        )
        memory_prompt = server._live_agent_model_decision_prompt(
            "tester",
            {
                "goalFrame": {"context": {"residentProfile": {"identity": {"displayName": "Tester"}}}, "goals": []},
                "topNeed": {"id": "hydration", "value": 0.5},
                "candidates": [{"id": "hydrate-water-cooler", "decision": "candidate", "label": "get water", "need": "hydration", "score": 0.1}],
            },
            agent_state_wd,
        )
        check(
            "model prompt includes short-term failure learning",
            "Important short-term memory" in memory_prompt and "no_route_progress" in memory_prompt and "900" in memory_prompt,
            memory_prompt,
        )

        # Perception now carries the location frame.
        state_p = server.get_live_agent_loop_state()
        agent_state_p = server._live_agent_loop_agent_state(state_p, "tester")
        perception_p = server._live_agent_loop_build_perception("tester", agent_state_p)
        check(
            "perception includes location awareness",
            isinstance(perception_p.get("location"), dict) and perception_p["location"].get("position") is not None,
        )
        check(
            "perception includes live world awareness",
            perception_p.get("liveWorld", {}).get("currentWorld", {}).get("port") == str(server.PUBLIC_HOST_PORT),
            json.dumps(perception_p.get("liveWorld") or {}, default=str)[:250],
        )

        # ------------------------------------------------------------------
        # 2c) LIVE WORLD CONFLICT REGISTRY
        # ------------------------------------------------------------------
        tester_world = server.get_live_agent_world_status("tester")
        check(
            "enabled agent claims current live world",
            tester_world.get("claim", {}).get("currentWorld") is True and tester_world.get("claim", {}).get("port") == str(server.PUBLIC_HOST_PORT),
            json.dumps(tester_world, default=str)[:300],
        )

        def seed_other_world_claim(doc):
            now_epoch = time.time()
            now_iso = server._live_agent_world_iso(now_epoch)
            doc.setdefault("agents", {})["hermie"] = {
                "agentId": "hermie",
                "agentName": "Hermes Resident",
                "worldId": "vw-other-port",
                "worldName": "Other Test World",
                "port": "8586",
                "publicOrigin": "http://127.0.0.1:8586",
                "claimedAt": now_iso,
                "lastSeenAt": now_iso,
                "lastSeenEpoch": now_epoch,
                "status": "live",
            }
            return True

        server._with_live_agent_world_registry(seed_other_world_claim, write=True)
        ok_conflict, result_conflict, status_conflict = server.set_agent_live_mode_setting("hermie", True)
        conflict_message = result_conflict.get("error", {}).get("message", "")
        check(
            "activation blocked when agent is live in another world",
            ok_conflict is False and status_conflict == 409 and "port 8586" in conflict_message,
            json.dumps(result_conflict, default=str)[:300],
        )
        hermie_setting = server.get_agent_live_mode_setting("hermie")
        check("conflict does not enable local live mode", hermie_setting.get("agentLiveModeEnabled") is False)
        check(
            "live world status exposes conflict notice",
            hermie_setting.get("liveWorld", {}).get("conflict") is True and "port 8586" in hermie_setting.get("liveWorld", {}).get("notice", ""),
            json.dumps(hermie_setting.get("liveWorld") or {}, default=str)[:300],
        )
        meta_conflict = server.load_world_meta()
        profiles_conflict = meta_conflict.get("agentProfiles") or {}
        profiles_conflict["hermie"] = {**(profiles_conflict.get("hermie") or {}), "agentLiveModeEnabled": True}
        meta_conflict["agentProfiles"] = profiles_conflict
        server.save_world_meta(meta_conflict)
        ok_action_conflict, result_action_conflict, status_action_conflict = server.create_agent_live_mode_action_request({
            "agentId": "hermie",
            "actionType": "life.getWater",
            "capabilityTag": "life.hydration",
            "source": {"kind": "agent-live-mode", "requestedBy": "verify"},
            "target": {"kind": "world-point", "x": 1, "y": 2},
        })
        check(
            "live action request blocked by other-world claim",
            ok_action_conflict is False and status_action_conflict == 409 and result_action_conflict.get("error", {}).get("code") == "agent_live_mode_world_conflict",
            json.dumps(result_action_conflict, default=str)[:300],
        )

        ok3, result3, _ = server.update_live_agent_loop_settings({
            "userChatPreemptionEnabled": True,
            "userChatPreemptionHoldSec": 240,
            "modelDecisionTimeoutSec": 60,
        })
        state3 = result3["state"]
        check("preemption hold persists", state3.get("userChatPreemptionHoldSec") == 240)
        check("model timeout persists", state3.get("modelDecisionTimeoutSec") == 60)
        status_payload = server.get_live_agent_loop_status()
        runtime = status_payload.get("runtime") or {}
        check("status exposes modelDecision runtime", isinstance(runtime.get("modelDecision"), dict))
        check("status exposes preemption guardrail", runtime.get("guardrails", {}).get("userChatPreemptionEnabled") is True)

    failed = [name for name, passed, _ in CHECKS if not passed]
    print()
    print(f"{len(CHECKS) - len(failed)}/{len(CHECKS)} checks passed")
    if failed:
        print("FAILED:", ", ".join(failed))
        sys.exit(1)
    print("verify-live-agent-autonomy: ALL PASS")


if __name__ == "__main__":
    main()
