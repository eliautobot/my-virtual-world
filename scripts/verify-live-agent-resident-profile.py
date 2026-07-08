#!/usr/bin/env python3
"""Verify Live Agent Mode consumes Resident Profile context and memory."""

import importlib.util
import json
import os
from pathlib import Path
import tempfile
import time


ROOT = Path(__file__).resolve().parents[1]
SERVER_PATH = ROOT / "src" / "server" / "server.py"


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

    spec = importlib.util.spec_from_file_location("mvw_server_under_test", SERVER_PATH)
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    module._agent_roster = [
        {
            "id": "tester",
            "statusKey": "tester",
            "name": "Test Resident",
            "providerKind": "openclaw",
            "providerAgentId": "tester",
        },
        {
            "id": "neighbor",
            "statusKey": "neighbor",
            "name": "Neighbor Resident",
            "providerKind": "openclaw",
            "providerAgentId": "neighbor",
        },
    ]
    module._roster_time = time.time()
    return module


def write_json(path, payload):
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(payload, indent=2) + "\n", encoding="utf-8")


def seed_world(server):
    write_json(
        Path(server.BUILDINGS_DIR) / "home-1.json",
        {
            "id": "home-1",
            "name": "Tester Home",
            "type": "home",
            "worldX": 1,
            "worldY": 1,
            "widthTiles": 8,
            "heightTiles": 6,
            "liveModeHomeForAgentId": "tester",
            "interior": {"furniture": []},
        },
    )
    write_json(
        Path(server.BUILDINGS_DIR) / "office-1.json",
        {
            "id": "office-1",
            "name": "Tester Office",
            "type": "office",
            "worldX": 12,
            "worldY": 3,
            "widthTiles": 12,
            "heightTiles": 8,
            "interior": {"furniture": []},
        },
    )

    meta = server._default_world_meta()
    resident = server._default_resident_profile("tester", meta, {"name": "Test Resident"})
    resident["identity"]["displayName"] = "Test Resident"
    resident["identity"]["lifePurpose"] = "Be a believable resident who builds friendships."
    resident["world"]["homeBuildingId"] = "home-1"
    resident["world"]["workBuildingId"] = "office-1"
    resident["goals"]["current"] = ["Talk with a nearby resident and build a friendship."]
    resident["goals"]["daily"] = [{"title": "Rest at home after work", "need": "energy"}]
    resident["memory"]["summary"] = "Tester recently moved in and wants to meet neighbors."
    resident["memory"]["relationships"] = {
        "tester::legacy": {
            "otherAgentId": "legacy",
            "summary": "Knows a previous neighbor.",
            "score": "0.2",
            "updatedAt": "2026-01-01T00:00:00Z",
        }
    }
    resident["personality"]["outgoing"] = 1.8
    meta["agentProfiles"] = {
        "tester": {
            "name": "Test Resident",
            "agentLiveModeEnabled": True,
            "residentProfile": resident,
        },
        "neighbor": {
            "name": "Neighbor Resident",
            "agentLiveModeEnabled": True,
        },
    }
    server.save_world_meta(meta)


def assert_true(condition, message):
    if not condition:
        raise AssertionError(message)


def main():
    with tempfile.TemporaryDirectory(prefix="mvw-live-profile-") as tmp:
        server = load_server(Path(tmp))
        seed_world(server)

        agent_state = {"needs": dict(server.LIVE_AGENT_LOOP_NEED_DEFAULTS), "memory": {}}
        server._live_agent_loop_normalize_memory(agent_state)

        context = server._live_agent_loop_agent_context("tester")
        resident_context = context.get("residentProfile") or {}
        assert_true(resident_context.get("identity", {}).get("displayName") == "Test Resident", "resident identity is exposed to loop context")
        assert_true(context.get("home", {}).get("buildingId") == "home-1", "resident home is exposed to loop context")
        assert_true(context.get("work", {}).get("buildingId") == "office-1", "resident work is exposed to loop context")
        assert_true(context.get("personality", {}).get("outgoing") == 1.8, "resident personality is used by loop context")
        assert_true(any(item.get("id") == "tester::legacy" for item in context.get("relationships", []) if isinstance(item, dict)), "resident relationships merge into loop context")

        perception = server._live_agent_loop_build_perception(
            "tester",
            agent_state,
            world_client={"active": True, "clientId": "test"},
            now_epoch=1_800_000_000,
        )
        assert_true(perception.get("residentProfile", {}).get("memory", {}).get("summary"), "perception includes resident memory summary")

        goal_frame = server._live_agent_loop_build_goal_frame("tester", perception, agent_state)
        profile_goals = [goal for goal in goal_frame.get("goals", []) if goal.get("kind") == "resident-profile"]
        assert_true(profile_goals, "resident goals are promoted into the planner goal frame")

        affordance = {
            "id": "talk-with-nearby-agent",
            "label": "talk with a nearby agent",
            "need": "social",
            "available": True,
        }
        _score, breakdown = server._live_agent_loop_decision_score(affordance, agent_state, goal_frame)
        assert_true(breakdown.get("goalAlignment", 0) > 0.1, "resident profile goal boosts matching actions")

        loop_state = {"agents": {"tester": agent_state}, "events": []}
        action = {"target": {"kind": "agent", "targetAgentId": "neighbor"}}
        summary = {
            "id": "world-action-1",
            "status": "completed",
            "actionType": "life.social",
            "loopActionId": "talk-with-nearby-agent",
            "result": {"conversationId": "conversation-1"},
        }
        remembered = server._live_agent_loop_remember_settled_action(loop_state, "tester", agent_state, action, summary)
        assert_true(remembered and remembered.get("actionId") == "world-action-1", "settled action is remembered by loop memory")

        saved_profile = server.get_agent_resident_profile("tester", persist=False)[1]["residentProfile"]
        profile_memory = saved_profile.get("memory", {})
        assert_true(any(item.get("actionId") == "world-action-1" for item in profile_memory.get("shortTerm", []) if isinstance(item, dict)), "settled action mirrors into resident short-term memory")
        assert_true(any(item.get("actionId") == "world-action-1" for item in profile_memory.get("reflections", []) if isinstance(item, dict)), "settled action mirrors into resident reflections")
        assert_true(any("neighbor" in key for key in profile_memory.get("relationships", {}).keys()), "social outcome mirrors into resident relationships")

    print("Live Agent Resident Profile verifier passed.")


if __name__ == "__main__":
    main()
