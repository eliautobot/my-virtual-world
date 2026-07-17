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
import hashlib
import json
import os
import sys
import threading
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


def snapshot_tree(root):
    root = Path(root)
    snapshot = {}
    for path in sorted(item for item in root.rglob("*") if item.is_file()):
        relative = str(path.relative_to(root))
        snapshot[relative] = hashlib.sha256(path.read_bytes()).hexdigest()
    return snapshot


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
    server.VW_CONFIG.setdefault("features", {})["agentLiveMode"] = True
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

        # Presence crash snapshots must not resurrect agents that have been
        # removed from the authoritative roster. Stale records used to feed the
        # realtime ambient planner forever after endurance tests or deletions.
        presence_snapshot = tmpdir / "data" / "presence-snapshot.json"
        presence_snapshot.write_text(json.dumps({
            "tester": {"state": "working", "task": "current", "updated": 123},
            "vw-endurance-stale": {"state": "working", "task": "deleted", "updated": 456},
            "_meetings": [],
        }))
        server._gateway_presence.init_agents(["tester", "hermie", "vw-endurance-stale"], prune=True)
        server._gateway_presence.init_agents(["tester", "hermie"], prune=True)
        server._gateway_presence.load_snapshot(
            presence_snapshot,
            allowed_agent_ids=["tester", "hermie"],
        )
        presence_state = server._gateway_presence.get_state()
        check(
            "presence snapshot excludes agents removed from roster",
            "vw-endurance-stale" not in presence_state
            and presence_state.get("tester", {}).get("source") == "snapshot"
            and "hermie" in presence_state,
            json.dumps(presence_state, default=str)[:700],
        )

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
        structured_planner_reply = json.dumps({
            "reflection": "Hydration is complete only after world verification, then I should rest.",
            "goal": {
                "id": "goal-verify-recovery",
                "title": "Hydrate and recover with verified outcomes",
                "successCriteria": ["water action verified", "rest action verified"],
            },
            "tasks": [
                {
                    "id": "task-hydrate",
                    "title": "Hydrate",
                    "dependsOn": [],
                    "steps": [{
                        "id": "step-hydrate",
                        "title": "Use the water cooler",
                        "dependsOn": [],
                        "loopActionId": "hydrate-water-cooler",
                        "successCriteria": ["server verification reports completed"],
                        "maxRetries": 1,
                    }],
                },
                {
                    "id": "task-rest",
                    "title": "Rest after hydration",
                    "dependsOn": ["task-hydrate"],
                    "steps": [{
                        "id": "step-rest",
                        "title": "Use a seat",
                        "loopActionId": "use-seating-object",
                        "successCriteria": ["server verification reports completed"],
                        "failureCriteria": ["target disappears"],
                        "maxRetries": 1,
                    }],
                },
            ],
            "nextStep": {
                "taskId": "task-hydrate",
                "stepId": "step-hydrate",
                "intent": "Use the reachable water cooler",
                "action": "hydrate-water-cooler",
                "successCriteria": "server verification reports completed",
            },
            "memoryUpdate": {"lesson": "Preserve verified steps when replanning."},
        })
        chosen_structured, status_structured, intent_structured = parse(structured_planner_reply, [*ids, "use-seating-object"])
        structured_turn = (intent_structured or {}).get("plannerTurn") or {}
        check(
            "structured planner JSON preserves stable goal task and step ids",
            chosen_structured == "hydrate-water-cooler"
            and status_structured == "planner-step-action"
            and (structured_turn.get("goal") or {}).get("id") == "goal-verify-recovery"
            and (structured_turn.get("tasks") or [{}])[0].get("id") == "task-hydrate"
            and (structured_turn.get("nextStep") or {}).get("stepId") == "step-hydrate",
            json.dumps(structured_turn, default=str)[:900],
        )
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
        server._live_agent_model_decision_cancel("tester", reason="verify-two-phase-model-decision")
        with server._live_agent_model_decision_lock:
            server._live_agent_model_decision_state.setdefault("tester", {})["nextAllowedEpoch"] = 0
        agent_state2 = {}
        selected2, decision2 = server._live_agent_loop_select_next_action("tester", agent_state2)
        check(
            "model request waits without starting a stale deterministic action",
            isinstance(decision2, dict)
            and (decision2.get("modelDecision") or {}).get("status") == "model-request-started"
            and selected2 is None
            and decision2.get("selectedActionId") is None,
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
        # resolver stops returning already-verified seats, while the prompt
        # shows progress for the next loop.
        seating_def = server.LIVE_AGENT_DYNAMIC_OBJECT_AFFORDANCES["seating"]
        progress_state = dict(goal_agent_state)
        first_pick = server._live_agent_loop_find_seating_target(seating_def, agent_id="tester", agent_state=progress_state)
        first_key = server._live_agent_loop_target_key(first_pick.get("target")) if first_pick else None
        check("seating resolver finds a real target", bool(first_key), json.dumps(first_pick, default=str)[:300])
        server._live_agent_loop_record_goal_progress(progress_state, seating_def, first_key, True)
        row = (progress_state.get("goalProgress") or {}).get("category:seating") or {}
        check("goal progress records completed target", first_key in (row.get("completedTargets") or []), json.dumps(row, default=str))
        second_pick = server._live_agent_loop_find_seating_target(seating_def, agent_id="tester", agent_state=progress_state)
        check("resolver does not repeat the only verified seating target", second_pick is None, json.dumps(second_pick, default=str)[:300])
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
        saturated_state = {
            "needs": dict(goal_agent_state["needs"]),
            "episodes": [
                {
                    "schemaVersion": server.LIVE_AGENT_EPISODE_SCHEMA_VERSION,
                    "id": "episode-verified-armchair-repeat",
                    "agentId": "tester",
                    "planId": "plan-verified-armchair-repeat",
                    "loopActionId": "use-seating-object",
                    "status": "completed",
                    "phase": "continue",
                    "createdAt": server._utc_now_iso(),
                    "updatedAt": server._utc_now_iso(),
                    "completedAt": server._utc_now_iso(),
                    "targetKey": seating_key,
                    "verification": {"id": "verify-verified-armchair-repeat", "ok": True},
                }
            ],
        }
        repeat_affordance = {
            **seating_def,
            "available": True,
            "target": dict(seating_target),
            "autonomyKind": "goal-work",
        }
        fresh_score, fresh_breakdown = server._live_agent_loop_decision_score(repeat_affordance, {"needs": dict(goal_agent_state["needs"])}, goal_frame)
        saturated_score, saturated_breakdown = server._live_agent_loop_decision_score(repeat_affordance, saturated_state, goal_frame)
        check(
            "verified episode history penalizes repeating the same seating target",
            saturated_score < fresh_score - 0.5 and saturated_breakdown.get("episodeSaturation", 0) < 0,
            json.dumps({"fresh": [fresh_score, fresh_breakdown], "saturated": [saturated_score, saturated_breakdown]}, default=str)[:900],
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
        check(
            "unresolved repeated issue escalates to Coder report over decorative investigation",
            issue_decision.get("selectedActionId") == "report-issue-to-coder"
            and issue_candidates.get("report-issue-to-coder", {}).get("score", 0) > issue_candidates.get("investigate-blocking-issue", {}).get("score", 0)
            and issue_candidates.get("use-seating-object", {}).get("score", 0) < issue_candidates.get("report-issue-to-coder", {}).get("score", 0),
            json.dumps({k: issue_candidates.get(k) for k in ("report-issue-to-coder", "investigate-blocking-issue", "use-seating-object")}, default=str)[:900],
        )
        planner_turn = {
            "reflection": "The shelter issue keeps coming back and I need Coder to know.",
            "currentGoal": "Escalate blocked shelter work instead of only standing at the board.",
            "plan": ["write down the blocker", "send Coder an actionable report"],
            "nextStep": {
                "intent": "tell Coder about the repeated shelter blocker",
                "successCriteria": "Coder receives a report and the note is durable",
            },
            "memoryUpdate": {"lesson": "When I need help from Coder, I must use the report tool, not just the whiteboard."},
            "toolRequests": ["message Coder about shelter and routing failures"],
        }
        planner_state = {"memory": {}, "needs": dict(goal_agent_state["needs"])}
        applied = server._live_agent_loop_apply_planner_turn(
            planner_state,
            {"agentId": "tester", "status": "planner-tool-or-event-request", "plannerTurn": planner_turn, "chosen": None},
            agent_id="tester",
        )
        support_requests = planner_state.get("supportRequests") or []
        notes_after_planner = server._live_agent_loop_recent_internal_notes("tester", limit=4)
        check(
            "planner tool request creates support request and internal note",
            applied
            and any(item.get("kind") == "coder-report" for item in support_requests)
            and any("Escalate blocked shelter" in (item.get("title") or item.get("text") or "") for item in notes_after_planner),
            json.dumps({"requests": support_requests, "notes": notes_after_planner}, default=str)[:900],
        )
        support_perception = server._live_agent_loop_build_perception("tester", planner_state)
        support_decision = server._live_agent_loop_build_decision_frame("tester", support_perception, planner_state)
        support_candidates = {item.get("id"): item for item in support_decision.get("candidates") or []}
        check(
            "support request exposes report and note tools to planner",
            support_candidates.get("report-issue-to-coder", {}).get("available") is True
            and support_candidates.get("record-internal-note", {}).get("available") is True,
            json.dumps({k: support_candidates.get(k) for k in ("report-issue-to-coder", "record-internal-note")}, default=str)[:900],
        )
        autonomy_note_agent_id = "tester-note-cooldown"
        autonomy_note_state = {"memory": {}, "needs": dict(goal_agent_state["needs"])}
        autonomy_note_turn = {
            "reflection": "Social is highest, but no concrete social target is listed.",
            "currentGoal": "Find a real social target instead of repeating utility objects.",
            "plan": ["request a social target", "avoid replaying verified utility actions"],
            "nextStep": {
                "intent": "Ask the world for a social target.",
                "category": "social",
                "successCriteria": "A reachable social interaction target is resolved.",
            },
            "memoryUpdate": {"lesson": "Do not write repeated notes when the same social-target plan is already saved."},
        }
        autonomy_note_applied = server._live_agent_loop_apply_planner_turn(
            autonomy_note_state,
            {"agentId": autonomy_note_agent_id, "status": "planner-step-unresolved", "plannerTurn": autonomy_note_turn, "chosen": None},
            agent_id=autonomy_note_agent_id,
        )
        autonomy_note_context = server._live_agent_loop_note_context(autonomy_note_agent_id, autonomy_note_state)
        autonomy_note_record = server._live_agent_loop_append_internal_note(
            autonomy_note_agent_id,
            note_type="autonomy-plan",
            title="write internal note",
            text=(autonomy_note_context or {}).get("summary") or "Autonomy plan note.",
            details={"supportContext": {"kind": "autonomy-plan"}},
            agent_state=autonomy_note_state,
        )
        cooled_note_context = server._live_agent_loop_note_context(autonomy_note_agent_id, autonomy_note_state)
        cooled_note_decision = server._live_agent_loop_build_decision_frame(
            autonomy_note_agent_id,
            server._live_agent_loop_build_perception(autonomy_note_agent_id, autonomy_note_state),
            autonomy_note_state,
        )
        cooled_note_candidates = {item.get("id"): item for item in cooled_note_decision.get("candidates") or []}
        check(
            "recent autonomy-plan note suppresses repeated internal-note action",
            autonomy_note_applied
            and not autonomy_note_state.get("supportRequests")
            and autonomy_note_context
            and autonomy_note_record
            and (not cooled_note_context or cooled_note_context.get("kind") != "autonomy-plan")
            and cooled_note_candidates.get("record-internal-note", {}).get("available") is not True,
            json.dumps({"context": cooled_note_context, "candidate": cooled_note_candidates.get("record-internal-note")}, default=str)[:900],
        )
        selected_report = (support_candidates.get("report-issue-to-coder") or {}).get("selected")
        support_loop_state = {"agents": {"tester": planner_state}, "events": []}
        support_plan = server._live_agent_loop_new_plan("tester", server._live_agent_loop_action_definition("report-issue-to-coder"), support_decision, selected_report, server._utc_now_iso())
        report_outcome = server._live_agent_loop_execute_support_action(
            support_loop_state,
            "tester",
            planner_state,
            server._live_agent_loop_action_definition("report-issue-to-coder"),
            support_decision,
            selected_report,
            support_plan,
        )
        comm_history = server._load_comm_history(limit=20, conversation_id="live-agent-report:tester:coder")
        notes_after_report = server._live_agent_loop_recent_internal_notes("tester", limit=8)
        check(
            "report support action logs communication and durable note without fake world action",
            report_outcome.get("ok") is True
            and report_outcome.get("supportTool") == "coder-report"
            and any(event.get("direction") == "request" and "Live Agent field report" in (event.get("text") or "") for event in comm_history)
            and any(item.get("type") == "coder-report" for item in notes_after_report),
            json.dumps({"outcome": report_outcome, "comm": comm_history[-3:], "notes": notes_after_report[:3]}, default=str)[:1200],
        )
        check(
            "successful Coder report consumes matching support request",
            report_outcome.get("consumedSupportRequestId")
            and not any(item.get("kind") == "coder-report" and "message Coder about shelter" in (item.get("text") or "") for item in planner_state.get("supportRequests") or []),
            json.dumps({"outcome": report_outcome, "requests": planner_state.get("supportRequests")}, default=str)[:900],
        )
        lesson_only_state = {"memory": {}, "needs": dict(goal_agent_state["needs"])}
        lesson_only_turn = {
            "reflection": "The water cooler completed cleanly.",
            "currentGoal": "Move to the next object.",
            "plan": ["avoid repeating completed objects", "continue validation"],
            "memoryUpdate": {
                "lesson": "Water cooler hydration completed successfully; do not retest it unless new evidence or Coder feedback calls for it."
            },
        }
        lesson_applied = server._live_agent_loop_apply_planner_turn(
            lesson_only_state,
            {"agentId": "tester", "status": "planner-step-action", "plannerTurn": lesson_only_turn, "chosen": "print-copy-document"},
            agent_id="tester",
        )
        check(
            "Coder feedback mention in memory lesson does not create report request",
            lesson_applied
            and server._live_agent_loop_support_request_kind(lesson_only_turn["memoryUpdate"]["lesson"]) == ""
            and not any(item.get("kind") == "coder-report" for item in lesson_only_state.get("supportRequests") or []),
            json.dumps({"requests": lesson_only_state.get("supportRequests"), "memory": lesson_only_state.get("memory")}, default=str)[:900],
        )
        water_cooler_lesson = "Water cooler hydration completed successfully in building bld_1781275645157; do not retest it unless new evidence or Coder feedback calls for it. Next object to validate is the printer/copier."
        water_cooler_state = {"memory": {}, "needs": dict(goal_agent_state["needs"])}
        water_cooler_turn = {
            "reflection": "The water cooler already has successful hydration evidence.",
            "currentGoal": "Move on to printer/copier validation.",
            "memoryUpdate": {"lesson": water_cooler_lesson},
        }
        water_cooler_applied = server._live_agent_loop_apply_planner_turn(
            water_cooler_state,
            {"agentId": "tester", "status": "planner-step-action", "plannerTurn": water_cooler_turn, "chosen": "print-copy-document"},
            agent_id="tester",
        )
        check(
            "water cooler success lesson does not create report request",
            water_cooler_applied
            and server._live_agent_loop_support_request_kind(water_cooler_lesson) == ""
            and not any(item.get("kind") == "coder-report" for item in water_cooler_state.get("supportRequests") or []),
            json.dumps({"requests": water_cooler_state.get("supportRequests"), "memory": water_cooler_state.get("memory")}, default=str)[:900],
        )
        printer_success_report = (
            "Send Coder a concise field report that the printer/copier interaction completed successfully and left me ready to continue testing other objects. "
            "| Coder report about verified printer/copier in building bld_1781275645157 on active world port 8590 "
            "| Coder receives a practical success report and future loops can advance to the whiteboard instead of retesting the printer/copier. "
            "| Printer/copier in building bld_1781275645157 has been verified successfully; avoid repeating it unless Coder asks or new evidence suggests a problem."
        )
        printer_success_report_truncated = (
            "Send Coder a concise field report that the printer/copier interaction completed successfully and left me ready to continue testing other objects. "
            "| Coder report about verified printer/copier in building bld_1781275645157 on active world port 8590 "
            "| Coder receives a practical success report and future loops can advance to the whiteboard instead of retesting the printer/copier. "
            "| Printer/copier in building bld_1781275645157 has been verified successfully; avoid repeating it unless Coder asks or ne"
        )
        printer_success_state = {"memory": {}, "needs": dict(goal_agent_state["needs"])}
        printer_success_turn = {
            "reflection": "The printer/copier already completed successfully.",
            "currentGoal": "Continue testing other objects.",
            "toolRequests": [printer_success_report],
        }
        printer_success_applied = server._live_agent_loop_apply_planner_turn(
            printer_success_state,
            {"agentId": "tester", "status": "planner-tool-or-event-request", "plannerTurn": printer_success_turn, "chosen": None},
            agent_id="tester",
        )
        check(
            "explicit Coder success report does not create issue report request",
            printer_success_applied
            and server._live_agent_loop_support_request_kind(printer_success_report) == ""
            and not any(item.get("kind") == "coder-report" for item in printer_success_state.get("supportRequests") or []),
            json.dumps({"requests": printer_success_state.get("supportRequests"), "memory": printer_success_state.get("memory")}, default=str)[:900],
        )
        check(
            "truncated production Coder success report does not create issue report request",
            server._live_agent_loop_support_request_kind(printer_success_report_truncated) == "",
            printer_success_report_truncated[:900],
        )
        armchair_lesson = "Do not repeat the verified armchair unless new visual evidence or Coder feedback shows a posture, facing, placement, or recovery problem; proceed to microwave validation."
        armchair_lesson_state = {"memory": {}, "needs": dict(goal_agent_state["needs"])}
        armchair_lesson_turn = {
            "reflection": "The armchair already has verification evidence.",
            "currentGoal": "Proceed to the next object.",
            "plan": ["skip repeated armchair", "validate microwave"],
            "memoryUpdate": {"lesson": armchair_lesson},
        }
        armchair_lesson_applied = server._live_agent_loop_apply_planner_turn(
            armchair_lesson_state,
            {"agentId": "tester", "status": "planner-step-action", "plannerTurn": armchair_lesson_turn, "chosen": "heat-microwave-food"},
            agent_id="tester",
        )
        check(
            "verified armchair skip lesson does not create report request",
            armchair_lesson_applied
            and server._live_agent_loop_support_request_kind(armchair_lesson) == ""
            and not any(item.get("kind") == "coder-report" for item in armchair_lesson_state.get("supportRequests") or []),
            json.dumps({"requests": armchair_lesson_state.get("supportRequests"), "memory": armchair_lesson_state.get("memory")}, default=str)[:900],
        )
        port_guidance_lesson = "Coder receives a field report noting active world port 8590, older 8587-only guidance, and that I am following the live frame as instructed."
        port_guidance_state = {"memory": {}, "needs": dict(goal_agent_state["needs"])}
        port_guidance_turn = {
            "reflection": "The live frame already identifies the active world.",
            "currentGoal": "Follow the live frame instead of stale port guidance.",
            "nextStep": {"successCriteria": port_guidance_lesson},
            "memoryUpdate": {"lesson": port_guidance_lesson},
        }
        port_guidance_applied = server._live_agent_loop_apply_planner_turn(
            port_guidance_state,
            {"agentId": "tester", "status": "planner-step-action", "plannerTurn": port_guidance_turn, "chosen": "work-on-active-goal"},
            agent_id="tester",
        )
        check(
            "passive port field-report guidance does not create report request",
            port_guidance_applied
            and server._live_agent_loop_support_request_kind(port_guidance_lesson) == ""
            and not any(item.get("kind") == "coder-report" for item in port_guidance_state.get("supportRequests") or []),
            json.dumps({"requests": port_guidance_state.get("supportRequests"), "memory": port_guidance_state.get("memory")}, default=str)[:900],
        )
        legacy_false_report_state = {
            "needs": dict(goal_agent_state["needs"]),
            "supportRequests": [
                {
                    "at": server._utc_now_iso(),
                    "kind": "coder-report",
                    "issueId": "support.false-positive",
                    "text": lesson_only_turn["memoryUpdate"]["lesson"],
                    "source": "planner-step-action",
                }
            ],
        }
        server._live_agent_loop_normalize_memory(legacy_false_report_state)
        check(
            "normalization drops legacy false-positive Coder feedback report request",
            not legacy_false_report_state.get("supportRequests"),
            json.dumps(legacy_false_report_state.get("supportRequests"), default=str)[:900],
        )
        legacy_water_false_report_state = {
            "needs": dict(goal_agent_state["needs"]),
            "supportRequests": [
                {
                    "at": server._utc_now_iso(),
                    "kind": "coder-report",
                    "issueId": "support.water-cooler-false-positive",
                    "text": water_cooler_lesson,
                    "source": "planner-step-action",
                }
            ],
        }
        server._live_agent_loop_normalize_memory(legacy_water_false_report_state)
        check(
            "normalization drops legacy water cooler success report request",
            not legacy_water_false_report_state.get("supportRequests"),
            json.dumps(legacy_water_false_report_state.get("supportRequests"), default=str)[:900],
        )
        legacy_printer_success_report_state = {
            "needs": dict(goal_agent_state["needs"]),
            "supportRequests": [
                {
                    "at": server._utc_now_iso(),
                    "kind": "coder-report",
                    "issueId": "support.printer-success-false-positive",
                    "text": printer_success_report,
                    "source": "planner-tool-or-event-request",
                }
            ],
        }
        server._live_agent_loop_normalize_memory(legacy_printer_success_report_state)
        check(
            "normalization drops legacy explicit Coder success report request",
            not legacy_printer_success_report_state.get("supportRequests"),
            json.dumps(legacy_printer_success_report_state.get("supportRequests"), default=str)[:900],
        )
        legacy_truncated_printer_success_report_state = {
            "needs": dict(goal_agent_state["needs"]),
            "supportRequests": [
                {
                    "at": server._utc_now_iso(),
                    "kind": "coder-report",
                    "issueId": "support.printer-success-truncated-false-positive",
                    "text": printer_success_report_truncated,
                    "source": "planner-tool-or-event-request",
                }
            ],
        }
        server._live_agent_loop_normalize_memory(legacy_truncated_printer_success_report_state)
        check(
            "normalization drops legacy truncated Coder success report request",
            not legacy_truncated_printer_success_report_state.get("supportRequests"),
            json.dumps(legacy_truncated_printer_success_report_state.get("supportRequests"), default=str)[:900],
        )
        legacy_armchair_false_report_state = {
            "needs": dict(goal_agent_state["needs"]),
            "supportRequests": [
                {
                    "at": server._utc_now_iso(),
                    "kind": "coder-report",
                    "issueId": "support.armchair-false-positive",
                    "text": armchair_lesson,
                    "source": "planner-step-action",
                }
            ],
        }
        server._live_agent_loop_normalize_memory(legacy_armchair_false_report_state)
        check(
            "normalization drops legacy verified armchair skip report request",
            not legacy_armchair_false_report_state.get("supportRequests"),
            json.dumps(legacy_armchair_false_report_state.get("supportRequests"), default=str)[:900],
        )
        legacy_port_false_report_state = {
            "needs": dict(goal_agent_state["needs"]),
            "supportRequests": [
                {
                    "at": server._utc_now_iso(),
                    "kind": "coder-report",
                    "issueId": "support.port-guidance-false-positive",
                    "text": port_guidance_lesson,
                    "source": "planner-step-action",
                }
            ],
        }
        server._live_agent_loop_normalize_memory(legacy_port_false_report_state)
        check(
            "normalization drops legacy passive port field-report request",
            not legacy_port_false_report_state.get("supportRequests"),
            json.dumps(legacy_port_false_report_state.get("supportRequests"), default=str)[:900],
        )

        episode_state = {"memory": {}, "needs": dict(goal_agent_state["needs"])}
        episode_loop_state = {"agents": {"tester": episode_state}, "events": []}
        episode_action_def = server._live_agent_loop_action_definition("use-seating-object")
        episode_decision = {
            "selectedActionId": "use-seating-object",
            "selectedActionLabel": "test seating on an armchair",
            "mode": "planner-v2",
            "score": 1.0,
            "reason": "verify the armchair end to end",
            "goalFrame": {"goals": [{"kind": "resident-profile", "priority": 0.9, "reason": "verify armchair use loop"}]},
        }
        episode_selected = {"action": episode_action_def, "target": dict(seating_target)}
        episode_plan = server._live_agent_loop_prepare_plan(
            episode_state,
            "tester",
            episode_action_def,
            episode_decision,
            episode_selected,
            server._utc_now_iso(),
            persist=True,
        )
        started_episode = episode_state.get("activeEpisode") or {}
        check(
            "feedback loop starts durable episode before execution",
            started_episode.get("phase") == "decide"
            and started_episode.get("planId") == episode_plan.get("id")
            and started_episode.get("loopActionId") == "use-seating-object",
            json.dumps(started_episode, default=str)[:900],
        )
        episode_plan = server._live_agent_loop_mark_plan_action_created(
            episode_loop_state,
            "tester",
            episode_state,
            episode_plan,
            "wa-episode-armchair-arrival-only",
            server._utc_now_iso(),
        )
        executing_episode = episode_state.get("activeEpisode") or {}
        check(
            "feedback loop records execute phase with action id",
            executing_episode.get("phase") == "execute" and executing_episode.get("actionId") == "wa-episode-armchair-arrival-only",
            json.dumps(executing_episode, default=str)[:900],
        )
        episode_action = completed_seating_action("wa-episode-armchair-arrival-only", {
            "status": "completed",
            "applied": True,
            "reason": "server_authoritative_live_action_completed",
            "route": {"arrived": True, "distanceToTarget": 0},
        })
        episode_action["params"] = {
            **episode_action["params"],
            "planId": episode_plan.get("id"),
            "planStepId": "execute-visible-action",
        }
        episode_summary = server._live_agent_loop_action_summary(episode_action)
        episode_recent = server._live_agent_loop_remember_settled_action(episode_loop_state, "tester", episode_state, episode_action, episode_summary)
        verifying_plan = server._live_agent_loop_update_plan_from_settled_action(
            episode_loop_state,
            "tester",
            episode_state,
            episode_summary,
            "completed",
            server._utc_now_iso(),
        )
        verify_step = server._live_agent_loop_plan_current_step(verifying_plan)
        check(
            "settled action opens observe-outcome verification step",
            verify_step.get("id") == "observe-outcome" and verify_step.get("status") == "in_progress" and verifying_plan.get("status") == "in_progress",
            json.dumps(verifying_plan, default=str)[:900],
        )
        verified_episode = server._live_agent_loop_record_episode_verification(
            episode_loop_state,
            "tester",
            episode_state,
            episode_action,
            episode_summary,
            episode_recent,
            verifying_plan,
            server._utc_now_iso(),
        )
        failed_episode_plan = server._live_agent_loop_find_plan_for_action(episode_state, {"planId": episode_plan.get("id"), "planStepId": "observe-outcome", "id": "wa-episode-armchair-arrival-only"})
        check(
            "failed verification creates issue and Coder report request",
            verified_episode.get("status") == "awaiting_report"
            and verified_episode.get("phase") == "report"
            and (verified_episode.get("verification") or {}).get("ok") is False
            and failed_episode_plan.get("status") == "failed"
            and any(req.get("kind") == "coder-report" and req.get("issueId") == verified_episode.get("issueId") for req in episode_state.get("supportRequests") or []),
            json.dumps({"episode": verified_episode, "plan": failed_episode_plan, "requests": episode_state.get("supportRequests")}, default=str)[:1400],
        )
        episode_support_perception = server._live_agent_loop_build_perception("tester", episode_state)
        episode_support_decision = server._live_agent_loop_build_decision_frame("tester", episode_support_perception, episode_state)
        episode_support_candidate = next((item for item in episode_support_decision.get("candidates") or [] if item.get("id") == "report-issue-to-coder"), {})
        episode_report_plan = server._live_agent_loop_prepare_plan(
            episode_state,
            "tester",
            server._live_agent_loop_action_definition("report-issue-to-coder"),
            episode_support_decision,
            episode_support_candidate.get("selected"),
            server._utc_now_iso(),
            persist=True,
        )
        episode_report_outcome = server._live_agent_loop_execute_support_action(
            episode_loop_state,
            "tester",
            episode_state,
            server._live_agent_loop_action_definition("report-issue-to-coder"),
            episode_support_decision,
            episode_support_candidate.get("selected"),
            episode_report_plan,
        )
        reported_episode = server._live_agent_loop_find_episode(episode_state, issue_id=verified_episode.get("issueId")) or {}
        check(
            "Coder report marks failed episode awaiting Coder",
            episode_report_outcome.get("ok") is True
            and reported_episode.get("status") == "awaiting_coder"
            and reported_episode.get("phase") == "await-coder"
            and reported_episode.get("updatedAt") == reported_episode.get("reportedAt")
            and reported_episode.get("conversationId"),
            json.dumps({"outcome": episode_report_outcome, "episode": reported_episode}, default=str)[:1400],
        )
        stale_reported_episode = server._live_agent_loop_normalize_episode({
            **reported_episode,
            "status": "awaiting_report",
            "phase": "report",
            "updatedAt": verified_episode.get("updatedAt"),
        })
        check(
            "reported episodes do not normalize back to awaiting report",
            stale_reported_episode.get("status") == "awaiting_coder"
            and stale_reported_episode.get("phase") == "await-coder"
            and stale_reported_episode.get("updatedAt") == stale_reported_episode.get("reportedAt"),
            json.dumps({"stale": stale_reported_episode, "reported": reported_episode}, default=str)[:1200],
        )
        server._append_comm_event({
            "type": "message",
            "direction": "request",
            "conversationId": reported_episode.get("conversationId"),
            "from": {"id": "coder", "providerKind": "openclaw", "name": "Coder"},
            "to": {"id": "tester", "providerKind": "openclaw", "name": "Test Resident"},
            "text": "Coder reviewed the armchair issue: do not count arrival as success; retry only after verifying seated pose and use-state evidence.",
        })
        ingested_feedback = server._live_agent_loop_ingest_coder_feedback("tester", episode_state)
        responded_episode = server._live_agent_loop_find_episode(episode_state, issue_id=verified_episode.get("issueId")) or {}
        episode_prompt = server._live_agent_model_decision_prompt(
            "tester",
            {
                "goalFrame": {
                    "context": {"residentProfile": {"identity": {"displayName": "Tester"}}},
                    "goals": [],
                    "episodes": server._live_agent_loop_recent_episode_summary(episode_state),
                },
                "topNeed": {"id": "curiosity", "value": 0.4},
                "candidates": [{"id": "use-seating-object", "decision": "candidate", "label": "test seating", "need": "curiosity", "score": 0.8}],
            },
            episode_state,
        )
        check(
            "Coder feedback is ingested into episode and next planner prompt",
            ingested_feedback
            and responded_episode.get("status") == "coder_responded"
            and "Coder reviewed the armchair issue" in episode_prompt
            and "Recent verification episodes" in episode_prompt,
            json.dumps({"episode": responded_episode, "prompt": episode_prompt[-1200:]}, default=str)[:1400],
        )
        resolved_retry_action = completed_seating_action("wa-episode-armchair-verified-retry", {
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
                "finalPlacement": {"x": 200.0, "y": 200.0, "floor": 1, "buildingId": "autonomy-lab"},
            },
        })
        resolved_retry_summary = server._live_agent_loop_action_summary(resolved_retry_action)
        resolved_retry_recent = server._live_agent_loop_remember_settled_action(
            episode_loop_state,
            "tester",
            episode_state,
            resolved_retry_action,
            resolved_retry_summary,
        )
        resolved_retry_episode = server._live_agent_loop_record_episode_verification(
            episode_loop_state,
            "tester",
            episode_state,
            resolved_retry_action,
            resolved_retry_summary,
            resolved_retry_recent,
            None,
            server._utc_now_iso(),
        )
        resolved_reported_episode = server._live_agent_loop_find_episode(episode_state, issue_id=verified_episode.get("issueId")) or {}
        check(
            "later verified retry resolves the matching reported episode",
            resolved_retry_episode.get("status") == "completed"
            and resolved_reported_episode.get("status") == "completed"
            and (resolved_reported_episode.get("resolution") or {}).get("actionId") == resolved_retry_action.get("id")
            and (episode_state.get("activeEpisode") or {}).get("id") != resolved_reported_episode.get("id")
            and not any(req.get("issueId") == verified_episode.get("issueId") for req in episode_state.get("supportRequests") or []),
            json.dumps({
                "retryEpisode": resolved_retry_episode,
                "reportedEpisode": resolved_reported_episode,
                "activeEpisode": episode_state.get("activeEpisode"),
                "requests": episode_state.get("supportRequests"),
            }, default=str)[:1800],
        )
        historical_reported_episode = server._copy_jsonable(responded_episode)
        historical_recent_success = server._copy_jsonable(resolved_retry_recent)
        historical_recent_success["at"] = server._epoch_to_utc_iso(
            max(
                time.time() + 5,
                (server._parse_isoish_epoch(responded_episode.get("coderRespondedAt")) or 0) + 5,
            )
        )
        historical_reconciliation_state = {
            "needs": dict(goal_agent_state["needs"]),
            "memory": {
                "recentActions": [historical_recent_success],
                "observations": [],
                "reflections": [],
                "internalNotes": [],
            },
            "episodes": [historical_reported_episode],
            "activeEpisode": historical_reported_episode,
            "supportRequests": [{
                "id": "support-historical-episode",
                "at": responded_episode.get("updatedAt"),
                "kind": "coder-report",
                "issueId": responded_episode.get("issueId"),
                "text": "Historical failure awaiting reconciliation.",
            }],
        }
        server._live_agent_loop_normalize_memory(historical_reconciliation_state)
        historical_resolved_episode = server._live_agent_loop_find_episode(
            historical_reconciliation_state,
            issue_id=responded_episode.get("issueId"),
        ) or {}
        check(
            "restart normalization reconciles historical reports from later verified action history",
            historical_resolved_episode.get("status") == "completed"
            and (historical_resolved_episode.get("resolution") or {}).get("kind") == "later-verified-action-history"
            and (historical_resolved_episode.get("resolution") or {}).get("actionId") == resolved_retry_action.get("id")
            and not historical_reconciliation_state.get("activeEpisode")
            and not historical_reconciliation_state.get("supportRequests"),
            json.dumps({
                "episode": historical_resolved_episode,
                "activeEpisode": historical_reconciliation_state.get("activeEpisode"),
                "requests": historical_reconciliation_state.get("supportRequests"),
            }, default=str)[:1800],
        )
        legacy_episode_state = {"memory": {}, "needs": dict(goal_agent_state["needs"])}
        legacy_loop_state = {"agents": {"tester": legacy_episode_state}, "events": []}
        legacy_plan = server._live_agent_loop_new_plan("tester", episode_action_def, episode_decision, episode_selected, server._utc_now_iso())
        legacy_plan["status"] = "in_progress"
        legacy_plan["operatorSummary"] = "Legacy active plan from before episode ledger migration."
        legacy_episode_state["activePlan"] = legacy_plan
        legacy_episode_state["plans"] = [legacy_plan]
        legacy_resumed_plan = server._live_agent_loop_prepare_plan(
            legacy_episode_state,
            "tester",
            episode_action_def,
            episode_decision,
            episode_selected,
            server._utc_now_iso(),
            persist=True,
        )
        legacy_started_episode = legacy_episode_state.get("activeEpisode") or {}
        legacy_marked_plan = server._live_agent_loop_mark_plan_action_created(
            legacy_loop_state,
            "tester",
            legacy_episode_state,
            legacy_resumed_plan,
            "wa-legacy-episode-armchair",
            server._utc_now_iso(),
            action_def=episode_action_def,
            decision=episode_decision,
            selected=episode_selected,
        )
        legacy_action = completed_seating_action("wa-legacy-episode-armchair", {
            "status": "completed",
            "applied": True,
            "reason": "server_authoritative_live_action_completed",
            "embodiedState": {
                "useState": "completed",
                "poseKind": "seat",
                "posture": "seated",
                "seated": True,
                "animationId": "sit",
                "activeUseState": "completed",
                "finalPlacement": {"x": 10, "y": 20, "floor": 1},
            },
        })
        legacy_action["params"] = {
            **legacy_action["params"],
            "planId": legacy_marked_plan.get("id"),
            "planStepId": "execute-visible-action",
        }
        legacy_summary = server._live_agent_loop_action_summary(legacy_action)
        legacy_recent = server._live_agent_loop_remember_settled_action(legacy_loop_state, "tester", legacy_episode_state, legacy_action, legacy_summary)
        legacy_verifying_plan = server._live_agent_loop_update_plan_from_settled_action(
            legacy_loop_state,
            "tester",
            legacy_episode_state,
            legacy_summary,
            "completed",
            server._utc_now_iso(),
        )
        legacy_completed_episode = server._live_agent_loop_record_episode_verification(
            legacy_loop_state,
            "tester",
            legacy_episode_state,
            legacy_action,
            legacy_summary,
            legacy_recent,
            legacy_verifying_plan,
            server._utc_now_iso(),
        )
        legacy_episodes = legacy_episode_state.get("episodes") or []
        check(
            "legacy active plan gets durable episode and clears active pointers after verification",
            legacy_started_episode.get("planId") == legacy_resumed_plan.get("id")
            and legacy_completed_episode.get("status") == "completed"
            and len(legacy_episodes) == 1
            and (legacy_episodes[-1].get("verification") or {}).get("ok") is True
            and not legacy_episode_state.get("activeEpisode")
            and not legacy_episode_state.get("activePlan"),
            json.dumps({"started": legacy_started_episode, "completed": legacy_completed_episode, "state": legacy_episode_state}, default=str)[:1500],
        )
        merge_plan = server._live_agent_loop_new_plan("merge-tester", episode_action_def, episode_decision, episode_selected, "2026-07-08T00:00:00Z")
        merge_plan["id"] = "plan-merge-race"
        merge_completed_plan = {**merge_plan, "status": "completed", "updatedAt": "2026-07-08T00:00:10Z", "completedAt": "2026-07-08T00:00:10Z"}
        merge_stale_plan = {**merge_plan, "status": "in_progress", "updatedAt": "2026-07-08T00:00:01Z"}
        merge_completed_episode = {
            "schemaVersion": server.LIVE_AGENT_EPISODE_SCHEMA_VERSION,
            "id": "episode-merge-race",
            "agentId": "merge-tester",
            "planId": "plan-merge-race",
            "loopActionId": "use-seating-object",
            "status": "completed",
            "phase": "continue",
            "createdAt": "2026-07-08T00:00:00Z",
            "updatedAt": "2026-07-08T00:00:10Z",
            "verifiedAt": "2026-07-08T00:00:10Z",
            "verification": {"id": "verify-merge-race", "ok": True},
        }
        merge_stale_episode = {
            **merge_completed_episode,
            "status": "executing",
            "phase": "execute",
            "updatedAt": "2026-07-08T00:00:01Z",
            "actionId": "wa-stale-save-copy",
        }
        server.save_live_agent_loop_state({
            "schemaVersion": server.LIVE_AGENT_LOOP_SCHEMA_VERSION,
            "agents": {"merge-tester": {"episodes": [merge_completed_episode], "plans": [merge_completed_plan]}},
            "events": [],
        })
        server.save_live_agent_loop_state({
            "schemaVersion": server.LIVE_AGENT_LOOP_SCHEMA_VERSION,
            "agents": {"merge-tester": {"episodes": [merge_stale_episode], "activeEpisode": merge_stale_episode, "plans": [merge_stale_plan], "activePlan": merge_stale_plan}},
            "events": [],
        })
        merged_loop_state = server.get_live_agent_loop_state()
        merge_row = (merged_loop_state.get("agents") or {}).get("merge-tester") or {}
        merge_episode_after = (merge_row.get("episodes") or [{}])[-1]
        merge_plan_after = (merge_row.get("plans") or [{}])[-1]
        check(
            "save merge preserves verified episode and completed plan over stale active copy",
            merge_episode_after.get("status") == "completed"
            and merge_plan_after.get("status") == "completed"
            and not merge_row.get("activeEpisode")
            and not merge_row.get("activePlan"),
            json.dumps(merge_row, default=str)[:1500],
        )
        event_episode = {
            **merge_completed_episode,
            "id": "episode-event-reconcile",
            "agentId": "event-reconcile",
            "planId": "plan-event-reconcile",
            "status": "executing",
            "phase": "execute",
            "updatedAt": "2026-07-08T00:01:00Z",
        }
        event_plan = {
            **merge_plan,
            "id": "plan-event-reconcile",
            "agentId": "event-reconcile",
            "status": "in_progress",
            "updatedAt": "2026-07-08T00:01:00Z",
        }
        server.save_live_agent_loop_state({
            "schemaVersion": server.LIVE_AGENT_LOOP_SCHEMA_VERSION,
            "agents": {
                "event-reconcile": {
                    "episodes": [event_episode],
                    "activeEpisode": event_episode,
                    "plans": [event_plan],
                    "activePlan": event_plan,
                }
            },
            "events": [
                {
                    "at": "2026-07-08T00:01:10Z",
                    "type": "plan-completed",
                    "agentId": "event-reconcile",
                    "details": {"planId": "plan-event-reconcile", "verificationId": "verify-event-reconcile", "status": "verified"},
                },
                {
                    "at": "2026-07-08T00:01:10Z",
                    "type": "episode-verified",
                    "agentId": "event-reconcile",
                    "details": {"episodeId": "episode-event-reconcile", "verificationId": "verify-event-reconcile", "ok": True},
                },
            ],
        })
        event_loop_state = server.get_live_agent_loop_state()
        event_row = (event_loop_state.get("agents") or {}).get("event-reconcile") or {}
        event_episode_after = (event_row.get("episodes") or [{}])[-1]
        event_plan_after = (event_row.get("plans") or [{}])[-1]
        check(
            "verified events reconcile stale active episode and plan records",
            event_episode_after.get("status") == "completed"
            and event_plan_after.get("status") == "completed"
            and not event_row.get("activeEpisode")
            and not event_row.get("activePlan"),
            json.dumps(event_row, default=str)[:1500],
        )
        board_action = {
            "id": "wa-board-note-regression",
            "status": "completed",
            "actionType": "planning.brainstorm",
            "agentId": "tester",
            "target": {"kind": "object-instance", "buildingId": "autonomy-lab", "objectInstanceId": "autonomy-whiteboard", "catalogId": "whiteboard", "floor": 1},
            "params": {"loopActionId": "investigate-blocking-issue"},
            "timing": {"updatedAt": server._utc_now_iso(), "completedAt": server._utc_now_iso(), "terminalAt": server._utc_now_iso()},
            "result": {"status": "completed", "applied": True, "reason": "server_authoritative_live_action_completed"},
        }
        board_state = {"needs": dict(goal_agent_state["needs"]), "memory": {}}
        board_loop_state = {"agents": {"tester": board_state}, "events": []}
        board_summary = server._live_agent_loop_action_summary(board_action)
        remembered_board = server._live_agent_loop_remember_settled_action(board_loop_state, "tester", board_state, board_action, board_summary)
        board_notes = server._live_agent_loop_recent_internal_notes("tester", limit=12)
        check(
            "completed planning board action writes real internal note",
            remembered_board.get("status") == "completed"
            and any(item.get("type") == "investigate-blocking-issue" and "whiteboard" in json.dumps(item).lower() for item in board_notes),
            json.dumps({"remembered": remembered_board, "notes": board_notes[:5]}, default=str)[:1000],
        )

        social_target = {
            "kind": "agent",
            "targetAgentId": "hermie",
            "targetAgentName": "Hermes Resident",
            "buildingId": "autonomy-lab",
            "floor": 1,
        }
        normalized_social_target, social_target_metadata, social_target_error = server._normalize_move_target(
            social_target,
            "tester",
            "wa-social-agent-route",
        )
        check(
            "social move target uses authoritative realtime agent routing",
            not social_target_error
            and normalized_social_target.get("kind") == "agent"
            and normalized_social_target.get("targetAgentId") == "hermie"
            and "catalogId" not in normalized_social_target
            and social_target_metadata.get("routingPlan") == "authoritative-realtime-agent-position"
            and social_target_metadata.get("dynamicTarget") is True
            and server._move_target_invalid_reason(normalized_social_target) is None
            and server._live_agent_loop_target_key(social_target) == "agent:hermie"
            and server._live_agent_loop_target_keys_compatible("object:autonomy-lab:agent", "agent:hermie"),
            json.dumps({
                "target": normalized_social_target,
                "metadata": social_target_metadata,
                "error": social_target_error,
            }, default=str)[:1400],
        )
        social_request_ok, social_request_result, social_request_status = server.create_agent_live_mode_action_request({
            "agentId": "tester",
            "source": {
                "kind": "agent-live-mode",
                "requestedBy": "verify-live-agent-autonomy",
                "requestId": "verify-social-agent-route",
                "surface": "agent-live-loop",
                "roles": ["participant"],
            },
            "actionType": "life.social",
            "capabilityTag": "life.social",
            "target": social_target,
            "priority": "normal",
            "params": {
                "loopActionId": "talk-with-nearby-agent",
                "serverRuntimeAuthority": True,
                "serverExecutor": server.WORLD_ACTION_SERVER_RUNTIME_OWNER,
            },
        })
        social_world_action = (social_request_result.get("action") or {}) if isinstance(social_request_result, dict) else {}
        social_linked_action = (social_request_result.get("linkedAction") or {}) if isinstance(social_request_result, dict) else {}
        social_move_intent = (social_request_result.get("moveIntent") or {}) if isinstance(social_request_result, dict) else {}
        check(
            "Live Agent social request completes world-action to move-intent handoff",
            social_request_ok
            and social_request_status == 202
            and social_world_action.get("status") == "reserved"
            and social_linked_action.get("status") == "route_pending"
            and (social_linked_action.get("route") or {}).get("routeOwner") == "server-authoritative-runtime"
            and (social_move_intent.get("target") or {}).get("targetAgentId") == "hermie"
            and (social_move_intent.get("targetMetadata") or {}).get("dynamicTarget") is True,
            json.dumps({
                "ok": social_request_ok,
                "status": social_request_status,
                "action": social_world_action,
                "linkedAction": social_linked_action,
                "moveIntent": social_move_intent,
                "result": social_request_result,
            }, default=str)[:1800],
        )
        if social_world_action.get("id"):
            server.cancel_world_action(social_world_action.get("id"), {
                "failureReason": "cancelled_by_system",
                "reason": "cancelled_by_system",
                "actor": "verify-live-agent-autonomy",
                "source": "agent-live-mode",
            })
            server.reconcile_move_intents()

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
        shelter_state = {
            "needs": {
                "hydration": 0.24,
                "food": 0.20,
                "energy": 0.82,
                "curiosity": 0.10,
                "maintenance": 0.12,
                "shelter": 1.25,
                "social": 0.08,
            }
        }
        shelter_perception = server._live_agent_loop_build_perception("tester", shelter_state)
        shelter_decision = server._live_agent_loop_build_decision_frame("tester", shelter_perception, shelter_state)
        rest_candidate = next((item for item in shelter_decision.get("candidates") or [] if item.get("id") == "rest-at-home"), {})
        check(
            "critical shelter with owned home selects rest-at-home",
            shelter_decision.get("selectedActionId") == "rest-at-home"
            and rest_candidate.get("need") == "shelter"
            and {"shelter", "energy"}.issubset(set(rest_candidate.get("satisfiesNeeds") or [])),
            json.dumps({"selected": shelter_decision.get("selectedActionId"), "rest": rest_candidate}, default=str)[:700],
        )
        rest_action = {
            "id": "wa-rest-home-regression",
            "status": "completed",
            "actionType": "life.restAtHome",
            "agentId": "tester",
            "target": {"kind": "building", "buildingId": "live-home-tester", "floor": 1},
            "params": {"loopActionId": "rest-at-home"},
            "timing": {"updatedAt": server._utc_now_iso(), "completedAt": server._utc_now_iso(), "terminalAt": server._utc_now_iso()},
            "result": {"status": "completed", "applied": True, "reason": "server_authoritative_live_action_completed"},
        }
        rest_summary = server._live_agent_loop_action_summary(rest_action)
        rest_memory_state = {
            "needs": {
                "hydration": 0.24,
                "food": 0.20,
                "energy": 0.82,
                "curiosity": 0.10,
                "maintenance": 0.12,
                "shelter": 1.25,
                "social": 0.08,
            },
            "memory": {},
        }
        rest_loop_state = {"agents": {"tester": rest_memory_state}}
        remembered_rest = server._live_agent_loop_remember_settled_action(rest_loop_state, "tester", rest_memory_state, rest_action, rest_summary)
        rest_needs_after = rest_memory_state.get("needs") or {}
        check(
            "completed home rest clears shelter and energy needs",
            remembered_rest.get("status") == "completed"
            and rest_needs_after.get("shelter") == 0.12
            and rest_needs_after.get("energy") == 0.12
            and rest_needs_after.get("curiosity") == 0.14,
            json.dumps({"remembered": remembered_rest, "needs": rest_needs_after}, default=str)[:700],
        )
        rest_cancel_action = {
            **rest_action,
            "id": "wa-rest-home-cancelled-once",
            "status": "cancelled",
            "timing": {"updatedAt": server._utc_now_iso(), "cancelledAt": server._utc_now_iso(), "terminalAt": server._utc_now_iso()},
            "failureReason": "cancelled_by_system",
            "result": {"status": "cancelled", "reason": "cancelled_by_system"},
        }
        rest_cancel_state = {"needs": dict(rest_memory_state["needs"]), "memory": {}}
        server._live_agent_loop_remember_settled_action(
            {"agents": {"tester": rest_cancel_state}},
            "tester",
            rest_cancel_state,
            rest_cancel_action,
            server._live_agent_loop_action_summary(rest_cancel_action),
        )
        single_cancel_recent = server._live_agent_loop_recent_outcome_summary(rest_cancel_state)
        single_cancel_report = server._live_agent_loop_report_context("tester", rest_cancel_state)
        check(
            "single benign rest-at-home system cancel does not escalate to Coder",
            not single_cancel_recent.get("issues")
            and not single_cancel_report,
            json.dumps({"recent": single_cancel_recent, "report": single_cancel_report}, default=str)[:900],
        )
        legacy_single_cancel_state = {
            "needs": dict(rest_memory_state["needs"]),
            "memory": {
                "recentActions": [
                    {
                        "actionId": "wa-rest-home-legacy-cancelled-once",
                        "loopActionId": "rest-at-home",
                        "status": "cancelled",
                        "targetKey": "object:live-home-tester:building",
                        "failure": {
                            "status": "cancelled",
                            "reason": "cancelled_by_system",
                            "failureReason": "cancelled_by_system",
                            "targetKey": "object:live-home-tester:building",
                            "learningText": "reason cancelled_by_system; target building in building live-home-tester; avoid retrying the same target unless the route, target, or conditions change.",
                        },
                    }
                ]
            },
        }
        server._live_agent_loop_normalize_memory(legacy_single_cancel_state)
        legacy_single_cancel_recent = server._live_agent_loop_recent_outcome_summary(legacy_single_cancel_state)
        legacy_single_cancel_failure = (((legacy_single_cancel_state.get("memory") or {}).get("recentActions") or [{}])[-1].get("failure") or {})
        check(
            "legacy single rest-at-home system cancel normalizes as non-reportable",
            legacy_single_cancel_failure.get("reportable") is False
            and legacy_single_cancel_failure.get("benignSystemCancel") is True
            and not legacy_single_cancel_recent.get("issues"),
            json.dumps({"failure": legacy_single_cancel_failure, "recent": legacy_single_cancel_recent}, default=str)[:900],
        )
        rest_episode_state = {
            "needs": dict(rest_memory_state["needs"]),
            "memory": {},
        }
        rest_episode_loop_state = {"agents": {"tester": rest_episode_state}, "events": []}
        rest_action_def = server._live_agent_loop_action_definition("rest-at-home")
        rest_episode_decision = {
            "selectedActionId": "rest-at-home",
            "reason": "rest at home best matches planner-v2 goals for shelter",
            "score": 0.91,
            "mode": "deterministic",
            "goalFrame": {"goals": [{"text": "restore shelter at owned home"}]},
        }
        rest_episode_selected = {"target": {"kind": "building", "buildingId": "live-home-tester", "floor": 1}}
        rest_episode_plan = server._live_agent_loop_prepare_plan(
            rest_episode_state,
            "tester",
            rest_action_def,
            rest_episode_decision,
            rest_episode_selected,
            server._utc_now_iso(),
            persist=True,
        )
        rest_episode_plan = server._live_agent_loop_mark_plan_action_created(
            rest_episode_loop_state,
            "tester",
            rest_episode_state,
            rest_episode_plan,
            "wa-rest-home-verification-cancelled-once",
            server._utc_now_iso(),
            action_def=rest_action_def,
            decision=rest_episode_decision,
            selected=rest_episode_selected,
        )
        rest_cancel_verification_action = {
            **rest_cancel_action,
            "id": "wa-rest-home-verification-cancelled-once",
            "params": {
                **(rest_cancel_action.get("params") or {}),
                "planId": rest_episode_plan.get("id"),
                "planStepId": "execute-visible-action",
            },
            "timing": {"updatedAt": server._utc_now_iso(), "cancelledAt": server._utc_now_iso(), "terminalAt": server._utc_now_iso()},
        }
        rest_cancel_verification_summary = server._live_agent_loop_action_summary(rest_cancel_verification_action)
        rest_cancel_verification_recent = server._live_agent_loop_remember_settled_action(
            rest_episode_loop_state,
            "tester",
            rest_episode_state,
            rest_cancel_verification_action,
            rest_cancel_verification_summary,
        )
        rest_cancel_verifying_plan = server._live_agent_loop_update_plan_from_settled_action(
            rest_episode_loop_state,
            "tester",
            rest_episode_state,
            rest_cancel_verification_summary,
            "cancelled",
            server._utc_now_iso(),
        )
        rest_cancel_failed_episode = server._live_agent_loop_record_episode_verification(
            rest_episode_loop_state,
            "tester",
            rest_episode_state,
            rest_cancel_verification_action,
            rest_cancel_verification_summary,
            rest_cancel_verification_recent,
            rest_cancel_verifying_plan,
            server._utc_now_iso(),
        )
        rest_cancel_verification_report = server._live_agent_loop_report_context("tester", rest_episode_state)
        check(
            "single benign rest-at-home verification failure does not escalate to Coder",
            rest_cancel_failed_episode.get("status") == "failed"
            and rest_cancel_failed_episode.get("phase") == "continue"
            and not rest_cancel_failed_episode.get("issueId")
            and (rest_cancel_failed_episode.get("verification") or {}).get("reportableFailure") is False
            and not any(item.get("kind") == "coder-report" for item in rest_episode_state.get("supportRequests") or [])
            and not rest_cancel_verification_report,
            json.dumps({"episode": rest_cancel_failed_episode, "requests": rest_episode_state.get("supportRequests"), "report": rest_cancel_verification_report}, default=str)[:1400],
        )
        legacy_false_episode = {
            "id": "episode-legacy-benign-rest-awaiting-coder",
            "status": "awaiting_coder",
            "phase": "await-coder",
            "loopActionId": "rest-at-home",
            "issueId": "episode.issue.legacy-rest",
            "targetKey": "building:live-home-tester",
            "createdAt": server._utc_now_iso(),
            "updatedAt": "2026-07-08T12:40:27Z",
            "reportedAt": "2026-07-08T12:42:14Z",
            "verification": {"id": "verify-legacy-rest", "ok": False, "status": "failed"},
            "reports": [{"at": "2026-07-08T12:42:14Z", "supportActionId": "lsa-legacy-rest-report", "status": "completed", "ok": True}],
        }
        legacy_false_episode_state = {
            "needs": dict(rest_memory_state["needs"]),
            "memory": {
                "recentActions": [
                    {
                        "actionId": "wa-rest-home-legacy-episode-cancelled-once",
                        "loopActionId": "rest-at-home",
                        "status": "cancelled",
                        "targetKey": "object:live-home-tester:building",
                        "failure": {
                            "status": "cancelled",
                            "reason": "cancelled_by_system",
                            "targetKey": "object:live-home-tester:building",
                        },
                    }
                ]
            },
            "episodes": [legacy_false_episode],
            "activeEpisode": legacy_false_episode,
        }
        server._live_agent_loop_normalize_memory(legacy_false_episode_state)
        cleared_false_episode = (legacy_false_episode_state.get("episodes") or [{}])[-1]
        check(
            "legacy false rest-at-home report episode retires after normalization",
            cleared_false_episode.get("status") == "failed"
            and cleared_false_episode.get("phase") == "continue"
            and (cleared_false_episode.get("verification") or {}).get("reportableFailure") is False
            and not legacy_false_episode_state.get("activeEpisode"),
            json.dumps({"episode": cleared_false_episode, "active": legacy_false_episode_state.get("activeEpisode")}, default=str)[:1200],
        )
        legacy_loop_normalized = server._normalize_live_agent_loop_state({
            "agents": {
                "tester": {
                    "needs": dict(rest_memory_state["needs"]),
                    "memory": {
                        "recentActions": [
                            {
                                "actionId": "wa-rest-home-legacy-loop-cancelled-once",
                                "loopActionId": "rest-at-home",
                                "status": "cancelled",
                                "targetKey": "object:live-home-tester:building",
                                "failure": {
                                    "status": "cancelled",
                                    "reason": "cancelled_by_system",
                                    "targetKey": "object:live-home-tester:building",
                                },
                            }
                        ]
                    },
                    "episodes": [legacy_false_episode],
                    "activeEpisode": legacy_false_episode,
                }
            }
        })
        legacy_loop_agent = (legacy_loop_normalized.get("agents") or {}).get("tester") or {}
        legacy_loop_episode = (legacy_loop_agent.get("episodes") or [{}])[-1]
        legacy_loop_failure = ((((legacy_loop_agent.get("memory") or {}).get("recentActions") or [{}])[-1]).get("failure") or {})
        check(
            "top-level loop normalization retires legacy false rest issue",
            legacy_loop_failure.get("reportable") is False
            and legacy_loop_episode.get("status") == "failed"
            and not legacy_loop_agent.get("activeEpisode"),
            json.dumps({"failure": legacy_loop_failure, "episode": legacy_loop_episode, "active": legacy_loop_agent.get("activeEpisode")}, default=str)[:1200],
        )
        rest_cancel_action_2 = {
            **rest_cancel_action,
            "id": "wa-rest-home-cancelled-twice",
            "timing": {"updatedAt": server._utc_now_iso(), "cancelledAt": server._utc_now_iso(), "terminalAt": server._utc_now_iso()},
        }
        server._live_agent_loop_remember_settled_action(
            {"agents": {"tester": rest_cancel_state}},
            "tester",
            rest_cancel_state,
            rest_cancel_action_2,
            server._live_agent_loop_action_summary(rest_cancel_action_2),
        )
        repeated_cancel_recent = server._live_agent_loop_recent_outcome_summary(rest_cancel_state)
        repeated_cancel_report = server._live_agent_loop_report_context("tester", rest_cancel_state)
        check(
            "repeated rest-at-home system cancels can still escalate",
            any(item.get("loopActionId") == "rest-at-home" for item in repeated_cancel_recent.get("issues") or [])
            and (repeated_cancel_report or {}).get("kind") == "recent-issue",
            json.dumps({"recent": repeated_cancel_recent, "report": repeated_cancel_report}, default=str)[:900],
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

        shutdown_state = server.get_live_agent_loop_state(persist_migration=True)
        shutdown_agent = server._live_agent_loop_agent_state(shutdown_state, "tester")
        shutdown_agent["enabled"] = True
        shutdown_agent["autonomyPlan"] = {"status": "active", "currentGoal": "stale shutdown goal", "plan": ["stale shutdown step"]}
        shutdown_action_def = server._live_agent_loop_action_definition("brainstorm-whiteboard")
        shutdown_decision = {
            "selectedActionId": "brainstorm-whiteboard",
            "reason": "verify shutdown cleanup",
            "score": 0.9,
            "goalFrame": {"goals": [{"text": "verify shutdown cleanup"}]},
        }
        shutdown_selected = {"target": {"kind": "object-instance", "buildingId": "autonomy-lab", "objectInstanceId": "autonomy-whiteboard", "catalogId": "whiteboard", "floor": 1}}
        shutdown_plan = server._live_agent_loop_prepare_plan(
            shutdown_agent,
            "tester",
            shutdown_action_def,
            shutdown_decision,
            shutdown_selected,
            server._utc_now_iso(),
            persist=True,
        )
        with server._live_agent_model_decision_lock:
            row = server._live_agent_model_decision_state.setdefault("tester", {})
            row["inFlight"] = True
            row["pendingChoice"] = {"chosen": "brainstorm-whiteboard", "detail": {"status": "planner-step-action"}, "candidateIds": ["brainstorm-whiteboard"]}
        server.save_live_agent_loop_state(shutdown_state)
        ok_disable, disable_result, _ = server.set_agent_live_mode_setting("tester", False, agent_loop_enabled=True)
        disabled_setting = server.get_agent_live_mode_setting("tester")
        disabled_loop_state = server.get_live_agent_loop_state(persist_migration=True)
        disabled_agent = (disabled_loop_state.get("agents") or {}).get("tester") or {}
        with server._live_agent_model_decision_lock:
            disabled_model_row = dict(server._live_agent_model_decision_state.get("tester") or {})
        check(
            "disabling Agent Live Mode also disables planner loop",
            ok_disable
            and disable_result.get("agentLiveModeEnabled") is False
            and disable_result.get("agentLiveModeLoopEnabled") is False
            and disabled_setting.get("agentLiveModeEnabled") is False
            and disabled_setting.get("agentLiveModeLoopEnabled") is False
            and disabled_agent.get("enabled") is False,
            json.dumps({"result": disable_result, "setting": disabled_setting, "agent": disabled_agent}, default=str)[:900],
        )
        check(
            "disabling Agent Live Mode clears active planner state",
            not disabled_agent.get("activePlan")
            and not disabled_agent.get("activeEpisode")
            and not disabled_agent.get("autonomyPlan")
            and disabled_model_row.get("inFlight") is False
            and not disabled_model_row.get("pendingChoice"),
            json.dumps({"agent": disabled_agent, "model": disabled_model_row}, default=str)[:900],
        )
        disabled_world = server.get_live_agent_world_status("tester")
        check(
            "disabling Agent Live Mode releases live world claim",
            not disabled_world.get("claim"),
            json.dumps(disabled_world, default=str)[:500],
        )
        ok_reenable, reenable_result, _ = server.set_agent_live_mode_setting("tester", True, agent_loop_enabled=True)
        check(
            "Agent Live Mode can be re-enabled after shutdown cleanup",
            ok_reenable and reenable_result.get("agentLiveModeEnabled") is True and reenable_result.get("agentLiveModeLoopEnabled") is True,
            json.dumps(reenable_result, default=str)[:500],
        )

        global_shutdown_state = server.get_live_agent_loop_state(persist_migration=True)
        global_agent = server._live_agent_loop_agent_state(global_shutdown_state, "tester")
        global_agent["enabled"] = True
        global_plan = server._live_agent_loop_prepare_plan(
            global_agent,
            "tester",
            shutdown_action_def,
            shutdown_decision,
            shutdown_selected,
            server._utc_now_iso(),
            persist=True,
        )
        with server._live_agent_model_decision_lock:
            row = server._live_agent_model_decision_state.setdefault("tester", {})
            row["inFlight"] = True
            row["pendingChoice"] = {"chosen": "brainstorm-whiteboard", "detail": {"status": "planner-step-action"}, "candidateIds": ["brainstorm-whiteboard"]}
        server.save_live_agent_loop_state(global_shutdown_state)
        ok_loop_off, loop_off_result, _ = server.update_live_agent_loop_settings({"enabled": False})
        loop_off_agent = ((loop_off_result.get("state") or {}).get("agents") or {}).get("tester") or {}
        with server._live_agent_model_decision_lock:
            loop_off_model_row = dict(server._live_agent_model_decision_state.get("tester") or {})
        check(
            "global live-agent loop disable clears planner state without disabling agent selection",
            ok_loop_off
            and loop_off_result["state"].get("enabled") is False
            and loop_off_agent.get("enabled") is True
            and not loop_off_agent.get("activePlan")
            and not loop_off_agent.get("activeEpisode")
            and loop_off_model_row.get("inFlight") is False
            and not loop_off_model_row.get("pendingChoice"),
            json.dumps({"agent": loop_off_agent, "model": loop_off_model_row}, default=str)[:900],
        )
        server.update_live_agent_loop_settings({"enabled": True})

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
        busy_reads = {}

        def read_observability_while_busy():
            busy_reads["status"] = server.get_live_agent_loop_status()
            _, busy_reads["perception"], _ = server.get_live_agent_loop_perception("tester")
            _, busy_reads["proposals"], _ = server.get_live_agent_loop_operator_proposals("tester")

        server._live_agent_loop_lock.acquire()
        try:
            started_busy_read = time.time()
            busy_thread = threading.Thread(target=read_observability_while_busy)
            busy_thread.start()
            busy_thread.join(4)
            elapsed_busy_read = time.time() - started_busy_read
        finally:
            server._live_agent_loop_lock.release()
        if busy_thread.is_alive():
            busy_thread.join(2)
        check(
            "observability endpoints return read-only snapshots while loop lock is busy",
            not busy_thread.is_alive()
            and elapsed_busy_read < 4
            and busy_reads.get("status", {}).get("runtime", {}).get("readOnlySnapshot") is True
            and busy_reads.get("perception", {}).get("readOnlySnapshot") is True
            and busy_reads.get("proposals", {}).get("readOnlySnapshot") is True,
            json.dumps(busy_reads, default=str)[:900],
        )

        # ------------------------------------------------------------------
        # 4) P0 PRODUCTION HARDENING
        # ------------------------------------------------------------------
        round_robin_fixture = [
            {"agentId": "resident-a"},
            {"agentId": "resident-b"},
            {"agentId": "resident-c"},
        ]
        order_after_a = [item["agentId"] for item in server._live_agent_loop_round_robin_roster(round_robin_fixture, "resident-a")]
        order_after_b = [item["agentId"] for item in server._live_agent_loop_round_robin_roster(round_robin_fixture, "resident-b")]
        check("round-robin scheduler rotates after last served resident", order_after_a == ["resident-b", "resident-c", "resident-a"] and order_after_b == ["resident-c", "resident-a", "resident-b"], json.dumps({"afterA": order_after_a, "afterB": order_after_b}))

        fence_agent = "generation-fence-resident"
        old_generation = server._live_agent_model_decision_start(fence_agent)
        server._live_agent_model_decision_cancel(fence_agent, reason="verification-cancel")
        new_generation = server._live_agent_model_decision_start(fence_agent)
        old_publish = server._live_agent_model_decision_publish(fence_agent, old_generation, {"chosen": "hydrate-water-cooler"})
        old_finish = server._live_agent_model_decision_mark(fence_agent, in_flight=False, outcome={"status": "late-old-worker"}, generation=old_generation)
        with server._live_agent_model_decision_lock:
            fenced_row = dict(server._live_agent_model_decision_state.get(fence_agent) or {})
        check(
            "generation fence rejects late model reply without clearing newer worker",
            old_publish is False
            and old_finish is False
            and new_generation > old_generation
            and fenced_row.get("generation") == new_generation
            and fenced_row.get("inFlight") is True
            and not fenced_row.get("pendingChoice"),
            json.dumps(fenced_row, default=str),
        )
        server._live_agent_model_decision_cancel(fence_agent, reason="verification-complete")

        # Gateway cleanup is mandatory even when an old generation is fenced.
        # A cancelled worker must delete its own generation-scoped session, and
        # restart recovery must only delete planner sessions for locally owned
        # residents.
        original_gateway_rpc = server._gateway_rpc_call
        original_recover_reply = server._live_agent_model_decision_recover_reply
        original_sleep = server.time.sleep
        gateway_calls = []

        def cleanup_gateway_rpc(method, params=None, timeout=20):
            gateway_calls.append((method, dict(params or {})))
            if method == "chat.send":
                return {"ok": True}
            if method == "sessions.list":
                return {
                    "ok": True,
                    "sessions": [
                        {"key": "agent:tester:g7:vw-live-mode-planner"},
                        {"key": "agent:tester:vw-live-mode-planner"},
                        {"key": "agent:hermie:g2:vw-live-mode-planner"},
                        {"key": "agent:tester:main"},
                    ],
                }
            if method == "sessions.delete":
                return {"ok": True}
            return {"ok": False, "error": f"unexpected method: {method}"}

        try:
            server._gateway_rpc_call = cleanup_gateway_rpc
            server._live_agent_model_decision_recover_reply = lambda *_args, **_kwargs: '{"reflection":"done","currentGoal":"stay safe","plan":["wait"],"nextStep":{"action":"skip"},"memoryUpdate":{"lesson":"cleanup"}}'
            server.time.sleep = lambda _seconds: None
            cleanup_agent = "cleanup-fenced-resident"
            cleanup_generation = server._live_agent_model_decision_start(cleanup_agent)
            server._live_agent_model_decision_cancel(cleanup_agent, reason="verification-fence-before-worker")
            server._live_agent_model_decision_worker(
                cleanup_agent,
                "cleanup verification prompt",
                ["hydrate-water-cooler"],
                {"timeoutSec": 10, "minIntervalSec": 30},
                cleanup_generation,
            )
            fenced_key = server._live_agent_model_planner_session_key(cleanup_agent, cleanup_generation)
            check(
                "fenced model worker still deletes its Gateway planner session",
                any(method == "sessions.delete" and params.get("key") == fenced_key for method, params in gateway_calls),
                json.dumps(gateway_calls, default=str),
            )

            gateway_calls.clear()
            orphan_cleanup = server._cleanup_orphaned_live_agent_model_planner_sessions(["tester"])
            deleted_keys = [params.get("key") for method, params in gateway_calls if method == "sessions.delete"]
            check(
                "restart cleanup deletes only locally owned planner sessions",
                orphan_cleanup.get("ok") is True
                and set(deleted_keys) == {
                    "agent:tester:g7:vw-live-mode-planner",
                    "agent:tester:vw-live-mode-planner",
                },
                json.dumps({"result": orphan_cleanup, "deleted": deleted_keys}, default=str),
            )

            server._gateway_rpc_call = lambda *_args, **_kwargs: {"ok": False, "error": "verification failure"}
            check(
                "Gateway planner cleanup reports delete failures",
                server._live_agent_model_planner_session_cleanup("tester", 99) is False,
            )
        finally:
            server._gateway_rpc_call = original_gateway_rpc
            server._live_agent_model_decision_recover_reply = original_recover_reply
            server.time.sleep = original_sleep

        # Seed one active request and planner worker, then prove the global
        # feature switch cancels both while preserving the resident selection.
        feature_action = {
            "id": "wa-feature-kill-verification",
            "agentId": "tester",
            "status": "routing",
            "actionType": "life.getWater",
            "capabilityTag": "life.hydration",
            "source": {"kind": "agent-live-mode", "requestedBy": "verify"},
            "params": {"loopActionId": "hydrate-water-cooler"},
            "priority": "normal",
            "target": {"kind": "world-point", "x": 0, "y": 0, "z": 0},
            "timing": {"createdAt": server._utc_now_iso(), "updatedAt": server._utc_now_iso()},
            "lifecycle": {
                "previousStatus": "route_pending",
                "allowedNext": server._world_action_allowed_next("routing"),
                "transitionLog": [],
            },
        }
        feature_store = server.get_world_actions_store()
        feature_store.setdefault("active", []).append(feature_action)
        saved_feature_action, saved_feature_detail = server.save_world_actions_store(feature_store)
        check("feature-kill fixture action saved", saved_feature_action, json.dumps(saved_feature_detail, default=str)[:500] if not saved_feature_action else "")
        feature_generation = server._live_agent_model_decision_start("tester")
        config_off_result, config_off_status = server._save_vw_config_update({"features": {"agentLiveMode": False}})
        kill_result = config_off_result.get("liveAgentModeRuntime") or {}
        killed_state = server.get_live_agent_loop_state(persist_migration=False)
        killed_store = server.get_world_actions_store()
        with server._live_agent_model_decision_lock:
            killed_model = dict(server._live_agent_model_decision_state.get("tester") or {})
        tester_profile_after_kill = (server.load_world_meta().get("agentProfiles") or {}).get("tester") or {}
        check(
            "global feature switch is a server-enforced kill switch",
            config_off_status == 200
            and config_off_result.get("config", {}).get("features", {}).get("agentLiveMode") is False
            and kill_result.get("active") is True
            and (killed_state.get("featureKill") or {}).get("active") is True
            and not any(item.get("id") == feature_action["id"] for item in killed_store.get("active") or [])
            and killed_model.get("inFlight") is False
            and int(killed_model.get("generation") or 0) > feature_generation
            and tester_profile_after_kill.get("agentLiveModeEnabled") is True,
            json.dumps({"kill": kill_result, "model": killed_model, "profile": tester_profile_after_kill}, default=str)[:1400],
        )
        blocked_ok, blocked_result, blocked_status = server.create_agent_live_mode_action_request({
            "agentId": "tester",
            "actionType": "life.getWater",
            "capabilityTag": "life.hydration",
            "source": {"kind": "agent-live-mode", "requestedBy": "verify"},
            "target": {"kind": "world-point", "x": 1, "y": 2},
        })
        check(
            "global feature switch rejects direct Live Agent action calls",
            blocked_ok is False and blocked_status == 409 and blocked_result.get("error", {}).get("code") == "agent_live_mode_feature_disabled",
            json.dumps(blocked_result, default=str)[:500],
        )
        sig_before_disabled_tick = server._world_meta_file_sig()
        disabled_tick = server.live_agent_loop_tick(reason="verification-disabled", force=True)
        sig_after_disabled_tick = server._world_meta_file_sig()
        check(
            "disabled timer tick is read-only even when force is requested",
            disabled_tick.get("ok") is False and sig_after_disabled_tick == sig_before_disabled_tick,
            json.dumps({"tick": disabled_tick, "before": sig_before_disabled_tick, "after": sig_after_disabled_tick}, default=str)[:900],
        )

        # The global-off state is an authority boundary, not merely a scheduler
        # pause. Exercise every externally reachable Live Agent mutation helper
        # and prove the complete isolated runtime tree remains byte-identical.
        disabled_tree_before = snapshot_tree(tmpdir)
        attention_ok, attention_result, attention_status = server.handle_live_agent_user_attention({
            "agentId": "tester",
            "source": "verification-disabled-chat",
            "messagePreview": "this normal chat must not touch Live Agent state",
        })
        direct_attention = server.live_agent_note_user_attention(
            "tester",
            source="verification-disabled-direct",
            message_preview="direct helper bypass attempt",
        )
        world_client_claimed = server.note_live_agent_loop_world_client_activity(
            client_version=server.LIVE_AGENT_LOOP_CLIENT_MARKER_VERSION,
            client_info={"sessionId": "disabled-client", "client": "main3d-live-sync"},
        )
        loop_update_ok, loop_update_result, loop_update_status = server.update_live_agent_loop_settings({"intervalSec": 77})
        proposal_ok, proposal_result, proposal_status = server.resolve_live_agent_loop_operator_proposal({
            "proposalId": "disabled-proposal",
            "status": "acknowledged",
        })
        world_action_ok, world_action_result, world_action_status = server.create_world_action({
            "agentId": "tester",
            "actionType": "life.getWater",
            "capabilityTag": "life.hydration",
            "source": {"kind": "agent-live-mode", "requestedBy": "verify-disabled", "requestId": "disabled-world-action"},
            "target": {"kind": "world-point", "x": 1, "y": 0, "z": 2},
        })
        move_ok, move_result, move_status = server.create_move_intent("tester", {
            "source": {"kind": "agent-live-mode", "requestedBy": "verify-disabled", "requestId": "disabled-move"},
            "target": {"kind": "world-point", "x": 1, "y": 0, "z": 2},
        })
        setting_ok, setting_result, setting_status = server.set_agent_live_mode_setting(
            "tester",
            agent_loop_enabled=True,
        )
        goal_write_ok, goal_write_result, goal_write_status = server.update_live_agent_goals("tester", {
            "operation": "create",
            "goal": {"id": "disabled-goal", "title": "Must not be created while globally disabled"},
        })
        disabled_status_payload = server.get_live_agent_loop_status()
        server.get_live_agent_goals("tester")
        server.get_live_agent_loop_feedback("tester")
        server.get_live_agent_loop_operator_proposals("tester")
        server.get_live_agent_loop_operator_timeline("tester")
        time.sleep(0.1)
        disabled_tree_after = snapshot_tree(tmpdir)
        disabled_codes = {
            "attention": (attention_result.get("error") or {}).get("code"),
            "loop": (loop_update_result.get("error") or {}).get("code"),
            "proposal": (proposal_result.get("error") or {}).get("code"),
            "worldAction": (world_action_result.get("error") or {}).get("code"),
            "move": (move_result.get("error") or {}).get("code"),
            "agentSetting": (setting_result.get("error") or {}).get("code"),
            "goalWrite": (goal_write_result.get("error") or {}).get("code"),
        }
        check(
            "global-off rejects chat attention and all Live Agent mutation helpers",
            attention_ok is False
            and attention_status == 409
            and direct_attention is None
            and world_client_claimed is False
            and loop_update_ok is False
            and loop_update_status == 409
            and proposal_ok is False
            and proposal_status == 409
            and world_action_ok is False
            and world_action_status == 409
            and move_ok is False
            and move_status == 409
            and setting_ok is False
            and setting_status == 409
            and goal_write_ok is False
            and goal_write_status == 409
            and set(disabled_codes.values()) == {"agent_live_mode_feature_disabled"}
            and server.live_agent_user_attention_status("tester").get("active") is False,
            json.dumps({"codes": disabled_codes, "statuses": [attention_status, loop_update_status, proposal_status, world_action_status, move_status, setting_status, goal_write_status]}, default=str),
        )
        check(
            "global-off chat, API attempts, and observability reads perform zero file writes",
            disabled_tree_after == disabled_tree_before
            and disabled_status_payload.get("runtime", {}).get("readOnlySnapshot") is True,
            json.dumps({
                "added": sorted(set(disabled_tree_after) - set(disabled_tree_before)),
                "removed": sorted(set(disabled_tree_before) - set(disabled_tree_after)),
                "changed": sorted(path for path in set(disabled_tree_before) & set(disabled_tree_after) if disabled_tree_before[path] != disabled_tree_after[path]),
                "statusReadOnly": disabled_status_payload.get("runtime", {}).get("readOnlySnapshot"),
            }),
        )
        config_on_result, config_on_status = server._save_vw_config_update({"features": {"agentLiveMode": True}})
        clear_kill = config_on_result.get("liveAgentModeRuntime") or {}
        check("global feature kill clears explicitly on re-enable", config_on_status == 200 and config_on_result.get("config", {}).get("features", {}).get("agentLiveMode") is True and clear_kill.get("active") is False and clear_kill.get("changed") is True, json.dumps(clear_kill, default=str)[:500])

        unchanged_meta = server.load_world_meta()
        server.save_world_meta(unchanged_meta)
        unchanged_sig_before = server._world_meta_file_sig()
        time.sleep(0.02)
        unchanged_write = server.save_world_meta(unchanged_meta)
        unchanged_sig_after = server._world_meta_file_sig()
        check(
            "identical world metadata save performs no disk write",
            unchanged_write is False and unchanged_sig_after == unchanged_sig_before,
            json.dumps({"write": unchanged_write, "before": unchanged_sig_before, "after": unchanged_sig_after}),
        )

        # Durable goal ledger: ordered dependencies, bounded retries, verified
        # outcomes, world-change replanning, API control, and restart recovery.
        durable_state = server.get_live_agent_loop_state(persist_migration=False)
        durable_agent = server._live_agent_loop_agent_state(durable_state, "tester")
        durable_detail = {
            "agentId": "tester",
            "status": "planner-step-action",
            "chosen": "hydrate-water-cooler",
            "plannerTurn": structured_turn,
            "intention": {"action": "hydrate-water-cooler", "plannerTurn": structured_turn},
        }
        applied_durable = server._live_agent_loop_apply_planner_turn(durable_agent, durable_detail, agent_id="tester")
        durable_goal = durable_agent.get("activeGoal") or {}
        check(
            "planner turn creates ordered durable goal task and step ledger",
            applied_durable
            and durable_goal.get("schemaVersion") == server.LIVE_AGENT_DURABLE_GOAL_SCHEMA_VERSION
            and durable_goal.get("currentTaskId") == "task-hydrate"
            and durable_goal.get("currentStepId") == "step-hydrate"
            and (durable_goal.get("tasks") or [{}, {}])[1].get("dependsOn") == ["task-hydrate"],
            json.dumps(durable_goal, default=str)[:1400],
        )
        server.save_live_agent_loop_state(durable_state)
        server = load_server(tmpdir)
        server.VW_CONFIG.setdefault("features", {})["agentLiveMode"] = True
        restarted_goal_state = server.get_live_agent_loop_state(persist_migration=False)
        restarted_goal_agent = server._live_agent_loop_agent_state(restarted_goal_state, "tester")
        restarted_goal = restarted_goal_agent.get("activeGoal") or {}
        check(
            "durable goal ledger survives process restart with current ids",
            restarted_goal.get("id") == "goal-verify-recovery"
            and restarted_goal.get("currentTaskId") == "task-hydrate"
            and restarted_goal.get("currentStepId") == "step-hydrate",
            json.dumps(restarted_goal, default=str)[:1000],
        )

        selected_target = {"target": {"kind": "world-point", "buildingId": "autonomy-lab", "x": 200, "y": 200, "z": 0}}
        goal_context = server._live_agent_loop_bind_durable_goal_action(restarted_goal_agent, "hydrate-water-cooler", selected_target, now_iso=server._utc_now_iso())
        server._live_agent_loop_mark_durable_goal_action_started(restarted_goal_state, "tester", restarted_goal_agent, goal_context, "wa-goal-hydrate", "hydrate-water-cooler", server._utc_now_iso())
        server._live_agent_loop_record_durable_goal_verification(restarted_goal_state, "tester", restarted_goal_agent, {
            "id": "verify-goal-hydrate",
            "actionId": "wa-goal-hydrate",
            "loopActionId": "hydrate-water-cooler",
            "goalId": goal_context.get("goalId"),
            "goalTaskId": goal_context.get("goalTaskId"),
            "goalStepId": goal_context.get("goalStepId"),
            "ok": True,
            "evidence": {"method": "verification-test", "status": "completed"},
        }, server._utc_now_iso())
        advanced_goal = restarted_goal_agent.get("activeGoal") or {}
        check(
            "verified outcome advances dependency to the next ordered task",
            advanced_goal.get("currentTaskId") == "task-rest"
            and advanced_goal.get("currentStepId") == "step-rest"
            and ((advanced_goal.get("tasks") or [{}])[0].get("outcome") or {}).get("verified") is True,
            json.dumps(advanced_goal, default=str)[:1200],
        )

        retry_context = server._live_agent_loop_bind_durable_goal_action(restarted_goal_agent, "use-seating-object", selected_target, now_iso=server._utc_now_iso())
        server._live_agent_loop_mark_durable_goal_action_started(restarted_goal_state, "tester", restarted_goal_agent, retry_context, "wa-goal-rest-1", "use-seating-object", server._utc_now_iso())
        server._live_agent_loop_record_durable_goal_verification(restarted_goal_state, "tester", restarted_goal_agent, {
            "id": "verify-goal-rest-1",
            "actionId": "wa-goal-rest-1",
            "goalId": retry_context.get("goalId"),
            "goalTaskId": retry_context.get("goalTaskId"),
            "goalStepId": retry_context.get("goalStepId"),
            "ok": False,
            "reason": "seat target disappeared",
            "evidence": {"method": "verification-test", "status": "failed"},
        }, server._utc_now_iso())
        retry_goal = restarted_goal_agent.get("activeGoal") or {}
        retry_step = ((retry_goal.get("tasks") or [{}, {}])[1].get("steps") or [{}])[0]
        check(
            "failed verification schedules bounded durable step retry",
            retry_step.get("status") == "retry_wait"
            and (retry_step.get("retry") or {}).get("attempts") == 1
            and (retry_step.get("retry") or {}).get("maxRetries") == 1,
            json.dumps(retry_step, default=str),
        )
        retry_step.setdefault("retry", {})["nextRetryAt"] = "2000-01-01T00:00:00Z"
        retry_goal = server._live_agent_goals.recompute_goal(retry_goal, now_iso=server._utc_now_iso())
        server._live_agent_loop_store_durable_goal(restarted_goal_agent, retry_goal)
        retry_context = server._live_agent_loop_bind_durable_goal_action(restarted_goal_agent, "use-seating-object", selected_target, now_iso=server._utc_now_iso())
        server._live_agent_loop_mark_durable_goal_action_started(restarted_goal_state, "tester", restarted_goal_agent, retry_context, "wa-goal-rest-2", "use-seating-object", server._utc_now_iso())
        server._live_agent_loop_record_durable_goal_verification(restarted_goal_state, "tester", restarted_goal_agent, {
            "id": "verify-goal-rest-2",
            "actionId": "wa-goal-rest-2",
            "goalId": retry_context.get("goalId"),
            "goalTaskId": retry_context.get("goalTaskId"),
            "goalStepId": retry_context.get("goalStepId"),
            "ok": False,
            "reason": "seat target disappeared again",
        }, server._utc_now_iso())
        exhausted_goal = restarted_goal_agent.get("activeGoal") or {}
        check(
            "retry exhaustion blocks goal and requests replanning",
            exhausted_goal.get("status") == "blocked"
            and exhausted_goal.get("replanRequired") is True
            and "retries exhausted" in (exhausted_goal.get("replanReason") or ""),
            json.dumps(exhausted_goal, default=str)[:1200],
        )
        server.save_live_agent_loop_state(restarted_goal_state)
        ok_retry_goal, retry_goal_result, retry_goal_status = server.update_live_agent_goals("tester", {
            "operation": "retry",
            "goalId": "goal-verify-recovery",
            "loopActionId": "rest-at-home",
            "reason": "replace missing seat with owned home rest",
        })
        replanned_goal = (retry_goal_result or {}).get("goal") or {}
        check(
            "durable goal API replans only unfinished work and preserves verified work",
            ok_retry_goal
            and retry_goal_status == 200
            and replanned_goal.get("replanRequired") is False
            and (((replanned_goal.get("tasks") or [{}])[0].get("steps") or [{}])[0].get("outcome") or {}).get("verified") is True
            and (((replanned_goal.get("tasks") or [{}, {}])[1].get("steps") or [{}])[0].get("loopActionId") == "rest-at-home"),
            json.dumps(retry_goal_result, default=str)[:1500],
        )

        ok_goal_get, goal_get_result, goal_get_status = server.get_live_agent_goals("tester")
        check(
            "durable goals API exposes active ledger and status summary",
            ok_goal_get and goal_get_status == 200
            and (goal_get_result.get("activeGoal") or {}).get("id") == "goal-verify-recovery"
            and goal_get_result.get("schemaVersion") == server.LIVE_AGENT_GOAL_LEDGER_SCHEMA_VERSION,
            json.dumps(goal_get_result, default=str)[:1200],
        )

        world_state = server.get_live_agent_loop_state(persist_migration=False)
        world_agent = server._live_agent_loop_agent_state(world_state, "tester")
        available_frame = {"affordances": [{"id": "rest-at-home", "available": True, "target": selected_target["target"]}]}
        server._live_agent_loop_reconcile_durable_goal_world(world_state, "tester", world_agent, available_frame, server._utc_now_iso())
        missing_frame = {"affordances": [{"id": "rest-at-home", "available": False, "reason": "home removed"}]}
        changed_goal = server._live_agent_loop_reconcile_durable_goal_world(world_state, "tester", world_agent, missing_frame, server._utc_now_iso())
        check(
            "world affordance change blocks unfinished step and triggers replan",
            changed_goal.get("status") == "blocked"
            and changed_goal.get("replanRequired") is True
            and "no longer available" in (changed_goal.get("replanReason") or ""),
            json.dumps(changed_goal, default=str)[:1200],
        )
        server.save_live_agent_loop_state(world_state)
        ok_retry_world, _, _ = server.update_live_agent_goals("tester", {"operation": "retry", "goalId": "goal-verify-recovery", "loopActionId": "use-seating-object", "reason": "world changed"})
        check("operator can resume blocked durable goal after world replan", ok_retry_world)

        # A nonterminal goal pauses on disable and resumes on re-enable without
        # losing its task/step ledger.
        ok_create_pause, create_pause_result, _ = server.update_live_agent_goals("tester", {
            "operation": "create",
            "goal": {
                "id": "goal-pause-resume",
                "title": "Persist through a Live Mode restart",
                "tasks": [{"id": "task-persist", "title": "Continue after restart", "steps": [{"id": "step-persist", "title": "Use water", "loopActionId": "hydrate-water-cooler"}]}],
            },
        })
        ok_pause_disable, _, _ = server.set_agent_live_mode_setting("tester", False)
        paused_ledger = (server.get_live_agent_goals("tester")[1].get("goals") or [])
        paused_goal = next((item for item in paused_ledger if item.get("id") == "goal-pause-resume"), {})
        ok_pause_enable, _, _ = server.set_agent_live_mode_setting("tester", True, agent_loop_enabled=True)
        resumed_goal = (server.get_live_agent_goals("tester")[1].get("activeGoal") or {})
        check(
            "disable pauses and re-enable resumes durable goal without deleting progress",
            ok_create_pause and ok_pause_disable and ok_pause_enable
            and paused_goal.get("status") == "paused"
            and resumed_goal.get("id") == "goal-pause-resume"
            and resumed_goal.get("currentStepId") == "step-persist",
            json.dumps({"created": create_pause_result, "paused": paused_goal, "resumed": resumed_goal}, default=str)[:1500],
        )

        # Reset isolation: clear one resident's runtime state and separate note
        # files without changing the other resident or durable world/profile data.
        meta_before_reset = server.load_world_meta()
        profiles_before_reset = meta_before_reset.setdefault("agentProfiles", {})
        tester_profile = dict(profiles_before_reset.get("tester") or {})
        tester_profile["residentProfile"] = {
            **(tester_profile.get("residentProfile") or {}),
            "identity": {"displayName": "Reset Verification Resident", "continuityMarker": "preserve-me"},
        }
        profiles_before_reset["tester"] = tester_profile
        meta_before_reset["agentProfiles"] = profiles_before_reset
        server.save_world_meta(meta_before_reset)
        server._live_agent_loop_append_internal_note("tester", title="Reset fixture", text="Clear this runtime note.")
        server._live_agent_loop_append_internal_note("hermie", title="Isolation fixture", text="Keep this other resident note.")
        server._live_agent_planner_transcript_record("tester", session_key="verify-reset", started_epoch=time.time(), prompt="reset fixture prompt", reply_text="reset fixture reply", detail={"status": "complete"})
        server._live_agent_planner_transcript_record("hermie", session_key="verify-isolation", started_epoch=time.time(), prompt="other fixture prompt", reply_text="other fixture reply", detail={"status": "complete"})
        reset_seed_state = server.get_live_agent_loop_state(persist_migration=False)
        reset_tester = server._live_agent_loop_agent_state(reset_seed_state, "tester")
        reset_tester["autonomyPlan"] = {"currentGoal": "stale goal", "plan": ["stale step"], "nextStep": {"intent": "stale"}}
        reset_tester["memory"] = {"recentActions": [{"actionId": "stale-runtime-action", "status": "failed", "text": "stale"}]}
        reset_hermie = server._live_agent_loop_agent_state(reset_seed_state, "hermie")
        reset_hermie["memory"] = {"recentActions": [{"actionId": "other-resident-sentinel", "status": "completed", "text": "preserve"}]}
        server.save_live_agent_loop_state(reset_seed_state)
        ok_disable_for_reset, _, _ = server.set_agent_live_mode_setting("tester", False)
        building_ids_before_reset = sorted(str(item.get("id")) for item in server.list_buildings() if isinstance(item, dict))
        ok_reset, reset_result, reset_status = server.reset_agent_live_mode_state("tester", actor="verification")
        state_after_reset = server.get_live_agent_loop_state(persist_migration=False)
        tester_after_reset = (state_after_reset.get("agents") or {}).get("tester") or {}
        hermie_after_reset = (state_after_reset.get("agents") or {}).get("hermie") or {}
        profile_after_reset = ((server.load_world_meta().get("agentProfiles") or {}).get("tester") or {}).get("residentProfile") or {}
        notes_after_reset = server._load_live_agent_internal_notes().get("agents") or {}
        transcripts_after_reset = server._load_live_agent_planner_transcripts().get("agents") or {}
        building_ids_after_reset = sorted(str(item.get("id")) for item in server.list_buildings() if isinstance(item, dict))
        check(
            "selected-agent reset clears runtime state and preserves settings/profile/world isolation",
            ok_disable_for_reset
            and ok_reset
            and reset_status == 200
            and tester_after_reset.get("enabled") is False
            and not tester_after_reset.get("activePlan")
            and not tester_after_reset.get("activeEpisode")
            and not tester_after_reset.get("autonomyPlan")
            and not tester_after_reset.get("activeGoal")
            and not tester_after_reset.get("durableGoals")
            and not (tester_after_reset.get("memory") or {}).get("recentActions")
            and ((hermie_after_reset.get("memory") or {}).get("recentActions") or [{}])[-1].get("actionId") == "other-resident-sentinel"
            and (profile_after_reset.get("identity") or {}).get("continuityMarker") == "preserve-me"
            and "tester" not in notes_after_reset
            and "hermie" in notes_after_reset
            and "tester" not in transcripts_after_reset
            and "hermie" in transcripts_after_reset
            and building_ids_after_reset == building_ids_before_reset,
            json.dumps({"result": reset_result, "tester": tester_after_reset, "hermie": hermie_after_reset, "profile": profile_after_reset}, default=str)[:1800],
        )
        ok_clean_reenable, clean_reenable, _ = server.set_agent_live_mode_setting("tester", True, agent_loop_enabled=True)
        reenabled_state = (server.get_live_agent_loop_state(persist_migration=False).get("agents") or {}).get("tester") or {}
        check(
            "resident cleanly re-enables after disable and reset",
            ok_clean_reenable
            and clean_reenable.get("agentLiveModeEnabled") is True
            and reenabled_state.get("enabled") is True
            and not reenabled_state.get("activePlan")
            and not reenabled_state.get("autonomyPlan")
            and not reenabled_state.get("activeGoal")
            and not reenabled_state.get("durableGoals"),
            json.dumps({"setting": clean_reenable, "state": reenabled_state}, default=str)[:900],
        )

        restart_state = server.get_live_agent_loop_state(persist_migration=False)
        restart_state["schedulerCursorAgentId"] = "tester"
        server.save_live_agent_loop_state(restart_state)
        restarted_server = load_server(tmpdir)
        restarted_server.VW_CONFIG.setdefault("features", {})["agentLiveMode"] = True
        restarted_state = restarted_server.get_live_agent_loop_state(persist_migration=False)
        check(
            "scheduler cursor and clean reset state survive process restart",
            restarted_state.get("schedulerCursorAgentId") == "tester"
            and not (((restarted_state.get("agents") or {}).get("tester") or {}).get("activePlan"))
            and not (((restarted_state.get("agents") or {}).get("tester") or {}).get("autonomyPlan"))
            and not (((restarted_state.get("agents") or {}).get("tester") or {}).get("activeGoal"))
            and not (((restarted_state.get("agents") or {}).get("tester") or {}).get("durableGoals")),
            json.dumps(restarted_state, default=str)[:900],
        )

        server.set_agent_live_mode_setting("tester", False)
        server.set_agent_live_mode_setting("hermie", False)
        no_agent_sig_before = server._world_meta_file_sig()
        no_agent_tick = server.live_agent_loop_tick(reason="verification-no-enabled-agents")
        no_agent_sig_after = server._world_meta_file_sig()
        check(
            "enabled scheduler with no selected residents performs no persistence write",
            no_agent_tick.get("disabledReason") == "no agents have Agent Live Mode enabled"
            and no_agent_sig_after == no_agent_sig_before,
            json.dumps({"tick": no_agent_tick, "before": no_agent_sig_before, "after": no_agent_sig_after}, default=str)[:700],
        )
        server.set_agent_live_mode_setting("tester", True, agent_loop_enabled=True)

        # Byte-budget soak with intentionally small test budgets. Production
        # defaults remain configurable through environment variables.
        original_history_budget = server.WORLD_ACTION_HISTORY_MAX_BYTES
        original_record_budget = server.WORLD_ACTION_HISTORY_RECORD_MAX_BYTES
        original_notes_budget = server.LIVE_AGENT_INTERNAL_NOTES_MAX_BYTES
        original_transcript_budget = server.LIVE_AGENT_PLANNER_TRANSCRIPTS_MAX_BYTES
        try:
            server.WORLD_ACTION_HISTORY_MAX_BYTES = 24 * 1024
            server.WORLD_ACTION_HISTORY_RECORD_MAX_BYTES = 8 * 1024
            soak_store = server.get_world_actions_store()
            history = list(soak_store.get("history") or [])
            now_iso = server._utc_now_iso()
            for index in range(80):
                history.append({
                    "id": f"wa-storage-soak-{index}",
                    "agentId": "tester",
                    "status": "completed",
                    "actionType": "life.getWater",
                    "capabilityTag": "life.hydration",
                    "source": {"kind": "agent-live-mode", "requestedBy": "verify", "requestId": f"storage-{index}"},
                    "params": {"loopActionId": "hydrate-water-cooler", "diagnostic": "x" * 2200},
                    "priority": "normal",
                    "target": {"kind": "world-point", "x": 0, "y": 0, "z": 0},
                    "result": {"status": "completed", "diagnostic": "y" * 2200},
                    "timing": {"createdAt": now_iso, "updatedAt": now_iso, "completedAt": now_iso, "terminalAt": now_iso},
                    "lifecycle": {"previousStatus": "in_progress", "allowedNext": [], "terminalReason": "completed", "transitionLog": [{"from": "in_progress", "to": "completed", "at": now_iso, "actor": "verify"}]},
                })
            soak_ok, soak_saved = server.save_world_actions_store({"active": soak_store.get("active") or [], "history": history})
            check(
                "world-action history byte budget bounds storage soak",
                soak_ok
                and server._json_size_bytes(soak_saved.get("history") or []) <= server.WORLD_ACTION_HISTORY_MAX_BYTES
                and any(item.get("id") == "wa-storage-soak-79" for item in soak_saved.get("history") or []),
                json.dumps({"ok": soak_ok, "bytes": server._json_size_bytes((soak_saved or {}).get("history") or []), "count": len((soak_saved or {}).get("history") or [])}, default=str),
            )

            server.LIVE_AGENT_INTERNAL_NOTES_MAX_BYTES = 20 * 1024
            server.LIVE_AGENT_PLANNER_TRANSCRIPTS_MAX_BYTES = 28 * 1024
            for index in range(50):
                server._live_agent_loop_append_internal_note("tester", title=f"Storage note {index}", text=f"note {index} " + ("n" * 1800), details={"frame": "d" * 1800})
                server._live_agent_planner_transcript_record("tester", session_key=f"storage-{index}", started_epoch=time.time() + index, prompt="p" * 2200, reply_text="r" * 1800, detail={"status": "soak"})
            notes_size = os.path.getsize(server.LIVE_AGENT_INTERNAL_NOTES_FILE)
            transcripts_size = os.path.getsize(server.LIVE_AGENT_PLANNER_TRANSCRIPT_FILE)
            stale_temp_files = list(Path(server.DATA_DIR).glob("*.tmp-*"))
            check(
                "note/transcript byte budgets stabilize repeated writes without temp leaks",
                notes_size <= server.LIVE_AGENT_INTERNAL_NOTES_MAX_BYTES
                and transcripts_size <= server.LIVE_AGENT_PLANNER_TRANSCRIPTS_MAX_BYTES
                and not stale_temp_files,
                json.dumps({"notesBytes": notes_size, "transcriptsBytes": transcripts_size, "tmp": [str(item) for item in stale_temp_files]}),
            )
        finally:
            server.WORLD_ACTION_HISTORY_MAX_BYTES = original_history_budget
            server.WORLD_ACTION_HISTORY_RECORD_MAX_BYTES = original_record_budget
            server.LIVE_AGENT_INTERNAL_NOTES_MAX_BYTES = original_notes_budget
            server.LIVE_AGENT_PLANNER_TRANSCRIPTS_MAX_BYTES = original_transcript_budget

    failed = [name for name, passed, _ in CHECKS if not passed]
    print()
    print(f"{len(CHECKS) - len(failed)}/{len(CHECKS)} checks passed")
    if failed:
        print("FAILED:", ", ".join(failed))
        sys.exit(1)
    print("verify-live-agent-autonomy: ALL PASS")


if __name__ == "__main__":
    main()
