#!/usr/bin/env python3
"""Verify buildings cannot be saved over roads or sidewalks."""

import importlib.util
import json
import os
from pathlib import Path
import tempfile


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

    spec = importlib.util.spec_from_file_location("mvw_server_building_rules_test", SERVER_PATH)
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


def assert_true(condition, message):
    if not condition:
        raise AssertionError(message)


def main():
    with tempfile.TemporaryDirectory(prefix="mvw-building-rules-") as raw_tmp:
        server = load_server(Path(raw_tmp))
        meta = server._default_world_meta()
        meta["streets"] = [
            {"x1": 0, "z1": 0, "x2": 20, "z2": 0},
            {"x1": 30, "z1": -10, "x2": 30, "z2": 10},
            {"x1": 60, "z1": 0, "x2": 60, "z2": 0, "type": "x-int"},
        ]
        server.save_world_meta(meta)

        rules = server.get_building_placement_rules()
        assert_true(rules["constraints"]["noRoadwayOrSidewalkOverlap"] is True, "rules advertise roadway/sidewalk rejection")

        blocked_road = server.validate_building_placement({"id": "road", "worldX": 5, "worldY": 0, "widthTiles": 4, "heightTiles": 4})
        assert_true(not blocked_road["ok"], "building over road is rejected")
        assert_true(blocked_road["error"]["code"] == "building_roadway_overlap", "road rejection is machine-readable")

        blocked_sidewalk = server.validate_building_placement({"id": "sidewalk", "worldX": 0, "worldY": 5.79, "widthTiles": 3, "heightTiles": 3})
        assert_true(not blocked_sidewalk["ok"], "building over sidewalk edge is rejected")

        edge_touch = server.validate_building_placement({"id": "edge", "worldX": 0, "worldY": 5.8, "widthTiles": 3, "heightTiles": 3})
        assert_true(edge_touch["ok"], "building touching street surface edge is allowed")

        blocked_vertical = server.validate_building_placement({"id": "vertical", "worldX": 35.79, "worldY": -2, "widthTiles": 3, "heightTiles": 3})
        assert_true(not blocked_vertical["ok"], "building over vertical street sidewalk is rejected")

        allowed_vertical_edge = server.validate_building_placement({"id": "vertical-edge", "worldX": 35.8, "worldY": -2, "widthTiles": 3, "heightTiles": 3})
        assert_true(allowed_vertical_edge["ok"], "building touching vertical street edge is allowed")

        blocked_intersection = server.validate_building_placement({"id": "intersection", "worldX": 59, "worldY": -1, "widthTiles": 3, "heightTiles": 3})
        assert_true(not blocked_intersection["ok"], "building over intersection surface is rejected")

        rotated_blocked = server.validate_building_placement({"id": "rotated", "worldX": 25, "worldY": -2, "widthTiles": 2, "heightTiles": 8, "_rotation": 90})
        assert_true(not rotated_blocked["ok"], "rotated building footprint is checked using rotated AABB")

        saved = {"id": "allowed", "worldX": -8, "worldY": 8, "widthTiles": 3, "heightTiles": 3}
        assert_true(server.validate_building_placement(saved)["ok"], "non-overlapping building is allowed")
        server.save_building(saved["id"], saved)
        loaded = server.load_building(saved["id"])
        assert_true(loaded["id"] == "allowed", "allowed building can still be saved and loaded")

        # Ensure validation details stay JSON serializable for HTTP 409 responses.
        json.dumps(blocked_road)

    print("Building placement rules verifier passed.")


if __name__ == "__main__":
    main()
