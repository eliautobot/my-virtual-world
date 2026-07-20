#!/usr/bin/env python3
"""Correctness and stress verification for authoritative Live Agent perception."""

import importlib.util
import json
import math
import os
from pathlib import Path
import random
import sys
import tempfile
import time


ROOT = Path(__file__).resolve().parents[1]
SERVER_PATH = ROOT / "src" / "server" / "server.py"
SPATIAL_PATH = ROOT / "src" / "server" / "live_agent_spatial.py"
CHECKS = []


def check(name, condition, detail=""):
    CHECKS.append((name, bool(condition), detail))
    print(f"[{'PASS' if condition else 'FAIL'}] {name}" + (f" — {detail}" if detail and not condition else ""))
    return bool(condition)


def load_module(name, path):
    spec = importlib.util.spec_from_file_location(name, path)
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


def load_server(tmpdir):
    data_dir = tmpdir / "data"
    openclaw_dir = tmpdir / "openclaw"
    (data_dir / "buildings").mkdir(parents=True)
    (data_dir / "chunks").mkdir(parents=True)
    openclaw_dir.mkdir(parents=True)
    os.environ["VW_DATA_DIR"] = str(data_dir)
    os.environ["VW_OPENCLAW_PATH"] = str(openclaw_dir)
    os.environ["VW_OPENCLAW_HOST_PATH"] = str(openclaw_dir)
    os.environ["VW_CODEX_INCLUDE_NATIVE_AGENTS"] = "0"
    os.environ["VW_CLAUDE_CODE_INCLUDE_NATIVE_AGENTS"] = "0"
    os.environ["_VW_INT"] = "1"
    server = load_module("mvw_server_spatial_test", SERVER_PATH)
    server._agent_roster = []
    server._roster_time = time.time()
    return server


def action_location(object_id, *, action_id="life.restAtArmchair", spot_id="seat", x=5, z=6, floor=1):
    return {
        "id": spot_id,
        "actionLocationId": f"{object_id}:{spot_id}",
        "objectInstanceId": object_id,
        "catalogId": "armchair",
        "interactionSpotId": spot_id,
        "activationSpotId": spot_id,
        "actionId": action_id,
        "roles": ["seat", "rest"],
        "capacity": {"kind": "exclusive", "maxAgents": 1, "reservable": True},
        "floor": floor,
        "coordinateSpace": "building-local",
        "buildingLocal": {"x": x, "z": z},
        "actionTarget": {"x": x, "z": z, "floor": floor, "coordinateSpace": "building-local"},
    }


def furniture(object_id, x, z, *, floor=1, room="room-a"):
    return {
        "id": object_id,
        "objectInstanceId": object_id,
        "type": "armchair",
        "catalogId": "armchair",
        "x": x,
        "z": z,
        "floor": floor,
        "room": room,
        "actionLocations": [action_location(object_id, x=x, z=z, floor=floor)],
    }


def runtime_agent(x, y, *, floor=1, building="lab", room="room-a", heading=0, target=None, route_id=""):
    return {
        "x": x,
        "y": y,
        "floor": floor,
        "buildingId": building,
        "roomId": room,
        "heading": heading,
        "state": "routing" if route_id else "idle",
        "mode": "live",
        "owner": "agent-live-mode",
        "routeId": route_id,
        "worldActionId": "wa-spatial-route" if route_id else "",
        "leaseOwner": "server-live-action" if route_id else "",
        "leaseExpiresAt": "2099-01-01T00:00:00Z" if route_id else "",
        "target": target,
        "updatedAt": "2026-07-16T22:00:00.000Z",
        "version": 1,
    }


def main():
    spatial = load_module("mvw_spatial_pure_test", SPATIAL_PATH)

    # Pure cone/place geometry: 0 radians faces +Y, matching realtime routing.
    origin = {"x": 0, "y": 0, "floor": 1, "buildingId": "lab", "roomId": "a", "heading": 0}
    front = spatial.spatial_relation(origin, {**origin, "y": 200})
    side = spatial.spatial_relation(origin, {**origin, "x": 200})
    behind = spatial.spatial_relation(origin, {**origin, "y": -200})
    close_behind = spatial.spatial_relation(origin, {**origin, "y": -40})
    check("forward target is inside 120-degree field of view", front["inFieldOfView"] and front["visible"], json.dumps(front))
    check("side target is outside field of view", not side["inFieldOfView"] and side["occludedBy"] == "outside-field-of-view", json.dumps(side))
    check("distant rear target is not visible", not behind["visible"] and behind["relativeBearingDegrees"] in {-180.0, 180.0}, json.dumps(behind))
    check("close rear target remains perceptible for safety without false visual claim", close_behind["perceived"] and close_behind["interactionReady"] and close_behind["closeAwareness"] and not close_behind["visible"] and not close_behind["inFieldOfView"], json.dumps(close_behind))
    floor_blocked = spatial.spatial_relation(origin, {**origin, "y": 40, "floor": 2})
    room_blocked = spatial.spatial_relation(origin, {**origin, "y": 40, "roomId": "b"})
    outside_blocked = spatial.spatial_relation(origin, {**origin, "y": 40, "buildingId": "", "roomId": ""})
    check("different floor is never visible", not floor_blocked["visible"] and floor_blocked["occludedBy"] == "floor-boundary")
    check("different canonical room is occluded", not room_blocked["visible"] and room_blocked["occludedBy"] == "room-boundary")
    check("inside/outside boundary is occluded", not outside_blocked["visible"] and outside_blocked["occludedBy"] == "inside-outside-boundary")

    with tempfile.TemporaryDirectory(prefix="vw-spatial-verify-") as raw:
        tmpdir = Path(raw)
        server = load_server(tmpdir)
        roster_ids = ["tester", "same-spot", "front-peer", "close-behind", "far-behind", "wall-peer", "floor-peer", "room-peer", "outside-peer"]
        server._agent_roster = [
            {"id": agent_id, "statusKey": agent_id, "name": agent_id.replace("-", " ").title(), "providerKind": "openclaw", "providerAgentId": agent_id}
            for agent_id in roster_ids
        ]
        server._roster_time = time.time()
        server.VW_CONFIG.setdefault("features", {})["agentLiveMode"] = True

        building = {
            "id": "lab",
            "name": "Perception Lab",
            "type": "office",
            "worldX": 0,
            "worldY": 0,
            "widthTiles": 14,
            "heightTiles": 14,
            "interior": {
                "floors": [{"level": 1, "name": "Floor 1"}, {"level": 2, "name": "Floor 2"}],
                "walls": [{"x1": 3, "z1": 7, "x2": 7, "z2": 7, "floor": 1}],
                "furniture": [
                    furniture("front-chair", 5, 6),
                    furniture("rear-chair", 5, 2),
                    furniture("close-rear-chair", 5, 4),
                    furniture("wall-chair", 5, 9),
                    furniture("floor-chair", 5, 6, floor=2),
                    furniture("room-chair", 6, 6, room="room-b"),
                ],
            },
        }
        server.save_building("lab", building)
        rotated_building = {"id": "rotated", "worldX": 100, "worldY": 50, "widthTiles": 10, "heightTiles": 8, "_rotation": 90}
        rotated_point = server._live_agent_building_local_api_point(rotated_building, 2, 3)
        rotated_local = server._live_agent_spatial_building_local_point(rotated_building, rotated_point)
        check(
            "rotated building local/world transforms round-trip",
            rotated_point == {"x": 4200, "y": 2080}
            and abs(rotated_local["x"] - 2) < 1e-9
            and abs(rotated_local["z"] - 3) < 1e-9,
            json.dumps({"point": rotated_point, "local": rotated_local}),
        )
        park = {
            "id": "park",
            "name": "Perception Park",
            "type": "park",
            "worldX": 20,
            "worldY": 0,
            "widthTiles": 12,
            "heightTiles": 12,
            "interior": {"furniture": [], "walls": []},
            "outdoorArea": {"id": "park-area", "nodes": [furniture("park-chair", 2, 2, room="")]},
        }
        server.save_building("park", park)

        target = {"x": 200, "y": 440, "floor": 1, "buildingId": "lab", "roomId": "room-a", "targetKind": "world-point"}
        runtime = {
            "schemaVersion": "agent-runtime/v1",
            "worldId": "spatial-test",
            "updatedAt": "2026-07-16T22:00:00.000Z",
            "agents": {
                "tester": runtime_agent(200, 200, heading=0, target=target, route_id="route-test"),
                "same-spot": runtime_agent(200, 200),
                "front-peer": runtime_agent(200, 250),
                "close-behind": runtime_agent(200, 160),
                "far-behind": runtime_agent(200, 40),
                "wall-peer": runtime_agent(200, 360),
                "floor-peer": runtime_agent(200, 250, floor=2),
                "room-peer": runtime_agent(240, 250, room="room-b"),
                "outside-peer": runtime_agent(200, 250, building="", room=""),
                "deleted-runtime-residue": runtime_agent(200, 220),
            },
            "objects": {
                "lab:furniture:0:armchair": {
                    "buildingId": "lab", "furnitureIndex": 0, "objectType": "armchair", "state": "active",
                    "agentId": "front-peer", "actionId": "life.restAtArmchair", "activeUseId": "use-front", "updatedAt": "2026-07-16T22:00:00.000Z",
                },
            },
        }
        runtime_path = Path(server.DATA_DIR) / "agent-runtime.json"
        runtime_path.write_text(json.dumps(runtime), encoding="utf-8")

        perception = server._live_agent_loop_build_spatial_perception("tester")
        agents = {item["agentId"]: item for item in perception["nearbyAgents"]}
        objects = {item["objectInstanceId"]: item for item in perception["nearbyObjects"]}
        check("spatial authority uses realtime document", perception["authority"]["available"] and perception["self"]["x"] == 200.0, json.dumps(perception["authority"]))
        check("runtime residue outside authoritative roster is ignored", "deleted-runtime-residue" not in agents, json.dumps(sorted(agents)))
        check("front peer has exact distance and is visible", agents["front-peer"]["distance"] == 50.0 and agents["front-peer"]["visible"], json.dumps(agents["front-peer"]))
        check("close rear peer uses omnidirectional safety awareness without false visual claim", agents["close-behind"]["perceived"] and agents["close-behind"]["interactionReady"] and not agents["close-behind"]["visible"], json.dumps(agents["close-behind"]))
        check("far rear peer is sensed but not visually identified", agents["far-behind"]["withinAwareness"] and not agents["far-behind"]["visible"], json.dumps(agents["far-behind"]))
        check("interior wall blocks forward peer line of sight", not agents["wall-peer"]["lineOfSight"] and agents["wall-peer"]["occludedBy"] == "interior-wall", json.dumps(agents["wall-peer"]))
        check("different floor peer is not visible", not agents["floor-peer"]["visible"] and agents["floor-peer"]["occludedBy"] == "floor-boundary")
        check("different room peer is not visible", not agents["room-peer"]["visible"] and agents["room-peer"]["occludedBy"] == "room-boundary")
        check("outside peer is not visible through building boundary", not agents["outside-peer"]["visible"] and agents["outside-peer"]["occludedBy"] == "inside-outside-boundary")
        check("occupancy reports building floor and room separately", perception["occupancy"]["buildingFloor"] == 7 and perception["occupancy"]["room"] == 6, json.dumps(perception["occupancy"]))
        check("zero-distance residents remain first in stable distance order", perception["nearbyAgents"][0]["agentId"] == "same-spot" and perception["nearbyAgents"][0]["distance"] == 0.0, json.dumps([(item["agentId"], item["distance"]) for item in perception["nearbyAgents"]]))
        check("spatial result metadata reports complete returned sets", perception["resultSets"]["nearbyAgents"] == {"total": 8, "returned": 8, "truncated": False}, json.dumps(perception["resultSets"]))
        check("front object coordinates and distance are authoritative", objects["front-chair"]["position"] == {"x": 200.0, "y": 240.0, "floor": 1} and objects["front-chair"]["distanceTiles"] == 1.0, json.dumps(objects["front-chair"]))
        check("wall occludes object even inside forward cone", objects["wall-chair"]["inFieldOfView"] and not objects["wall-chair"]["visible"] and objects["wall-chair"]["occludedBy"] == "interior-wall", json.dumps(objects["wall-chair"]))
        check("room and floor object boundaries are respected", not objects["room-chair"]["visible"] and not objects["floor-chair"]["visible"])
        check("runtime object occupancy prevents false interaction-ready", objects["front-chair"]["runtimeOccupied"] and not objects["front-chair"]["interactionReady"], json.dumps(objects["front-chair"]))
        check("available close object exposes interaction context", objects["close-rear-chair"]["interactionReady"] and objects["close-rear-chair"]["nearestInteraction"]["actionId"] == "life.restAtArmchair", json.dumps(objects["close-rear-chair"]))
        check("route context includes exact target distance and owner", perception["route"]["active"] and perception["route"]["distanceToTargetTiles"] == 6.0 and perception["route"]["leaseOwner"] == "server-live-action", json.dumps(perception["route"]))
        check("route context identifies nearby agent blockers", any(item["agentId"] == "front-peer" for item in perception["route"]["nearbyAgentBlockers"]), json.dumps(perception["route"]["nearbyAgentBlockers"]))

        social = server._live_agent_loop_social_perception("tester", spatial=perception)
        social_ids = {item.get("agentId") for item in social.get("nearbyAgents") or []}
        check("social target selection uses spatial visibility and distance", "front-peer" in social_ids and "wall-peer" not in social_ids and "floor-peer" not in social_ids, json.dumps(social.get("nearbyAgents")))

        state = server.get_live_agent_loop_state()
        agent_state = server._live_agent_loop_agent_state(state, "tester")
        full_perception = server._live_agent_loop_build_perception("tester", agent_state)
        decision = server._live_agent_loop_build_decision_frame("tester", full_perception, agent_state)
        prompt = server._live_agent_model_decision_prompt("tester", decision, agent_state)
        check("planner frame receives compact authoritative spatial context", decision.get("spatialContext", {}).get("summary", {}).get("nearbyAgentCount") == perception["summary"]["nearbyAgentCount"])
        check(
            "model prompt preserves compact occupancy, route, nearby residents, and nearby objects",
            all(token in prompt for token in ('"spatial":', '"occupancy":', '"route":', '"nearbyResidents":', '"nearbyObjects":')),
            prompt[-3000:],
        )
        ok_get, api_result, api_status = server.get_live_agent_spatial_perception("tester")
        check("spatial read API returns versioned snapshot", ok_get and api_status == 200 and api_result["spatialPerception"]["schemaVersion"] == spatial.SPATIAL_SCHEMA_VERSION, json.dumps(api_result)[:500])

        # Outdoor perception: interior furniture must disappear while the park
        # node is sensed from its transformed world position.
        runtime["agents"]["tester"] = runtime_agent(880, 80, building="", room="", heading=0)
        runtime_path.write_text(json.dumps(runtime), encoding="utf-8")
        outdoor = server._live_agent_loop_build_spatial_perception("tester")
        outdoor_ids = {item["objectInstanceId"] for item in outdoor["nearbyObjects"]}
        check("outdoor perception includes outdoor nodes", "park-chair" in outdoor_ids, json.dumps(outdoor["nearbyObjects"])[:1200])
        check("outdoor perception excludes furniture behind building boundary", "front-chair" not in outdoor_ids, json.dumps(sorted(outdoor_ids)))

        # Missing authority must fail closed instead of inventing a location.
        runtime_path.write_text(json.dumps({"schemaVersion": "agent-runtime/v1", "agents": {}}), encoding="utf-8")
        missing = server._live_agent_loop_build_spatial_perception("tester")
        check("missing realtime position fails closed", not missing["authority"]["available"] and not missing["nearbyAgents"] and not missing["nearbyObjects"], json.dumps(missing))

    # High-volume pure geometry stress and invariants.
    rng = random.Random(7331)
    iterations = 100_000
    started = time.perf_counter()
    invariant_failures = 0
    visible_count = 0
    for _ in range(iterations):
        source = {
            "x": rng.uniform(-20_000, 20_000), "y": rng.uniform(-20_000, 20_000),
            "floor": rng.randint(1, 8), "buildingId": rng.choice(["", "a", "b"]),
            "roomId": rng.choice(["", "north", "south"]), "heading": rng.uniform(-math.pi, math.pi),
        }
        target = {
            "x": source["x"] + rng.uniform(-1_000, 1_000), "y": source["y"] + rng.uniform(-1_000, 1_000),
            "floor": rng.randint(1, 8), "buildingId": rng.choice(["", "a", "b"]),
            "roomId": rng.choice(["", "north", "south"]), "heading": 0,
        }
        relation = spatial.spatial_relation(source, target, line_of_sight=rng.random() > 0.2)
        if relation["visible"]:
            visible_count += 1
            if not (relation["inFieldOfView"] and relation["lineOfSight"] and relation["sameFloor"] and relation["placeCompatible"] and relation["withinVisualRange"]):
                invariant_failures += 1
        if relation["interactionReady"] and not (relation["perceived"] and relation["lineOfSight"] and relation["withinInteractionRange"]):
            invariant_failures += 1
        if relation["distance"] is None or relation["distance"] < 0 or not math.isfinite(relation["distance"]):
            invariant_failures += 1
    elapsed = time.perf_counter() - started
    check("100k randomized spatial relations preserve visibility invariants", invariant_failures == 0, f"failures={invariant_failures}")
    check("100k randomized spatial relations complete efficiently", elapsed < 8.0, f"elapsed={elapsed:.3f}s visible={visible_count}")

    failed = [item for item in CHECKS if not item[1]]
    print(f"\n{len(CHECKS) - len(failed)}/{len(CHECKS)} checks passed")
    if failed:
        print("verify-live-agent-spatial-perception: FAILED")
        return 1
    print("verify-live-agent-spatial-perception: ALL PASS")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
