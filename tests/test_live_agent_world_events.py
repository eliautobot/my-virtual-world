#!/usr/bin/env python3
"""Regression coverage for the Live Agent Mode world-event feed."""

import importlib.util
import os
import sys
import tempfile
import threading
import unittest
import uuid
from pathlib import Path


REPO_ROOT = Path(__file__).resolve().parents[1]
SERVER = REPO_ROOT / "src" / "server" / "server.py"


def _load_server_module(data_dir):
    module_name = f"vw_server_world_events_{uuid.uuid4().hex}"
    env_keys = ("VW_DATA_DIR", "VW_PORT", "VW_HOST_PORT", "VW_PUBLIC_ORIGIN", "_VW_INT")
    previous_env = {key: os.environ.get(key) for key in env_keys}
    server_dir = str(SERVER.parent)
    added_server_dir = server_dir not in sys.path
    if added_server_dir:
        sys.path.insert(0, server_dir)
    os.environ.update({
        "VW_DATA_DIR": str(data_dir),
        "VW_PORT": "8587",
        "VW_HOST_PORT": "8587",
        "VW_PUBLIC_ORIGIN": "http://127.0.0.1:8587",
        "_VW_INT": "1",
    })
    try:
        spec = importlib.util.spec_from_file_location(module_name, SERVER)
        module = importlib.util.module_from_spec(spec)
        sys.modules[module_name] = module
        spec.loader.exec_module(module)
        return module
    finally:
        for key, value in previous_env.items():
            if value is None:
                os.environ.pop(key, None)
            else:
                os.environ[key] = value
        if added_server_dir:
            try:
                sys.path.remove(server_dir)
            except ValueError:
                pass


class LiveAgentWorldEventFeedTest(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory(prefix="vw-world-events-test-")
        self.data_dir = Path(self.tmp.name)
        self.server = _load_server_module(self.data_dir)
        self.addCleanup(lambda: sys.modules.pop(self.server.__name__, None))

    def tearDown(self):
        self.tmp.cleanup()

    def test_concurrent_appends_keep_all_events_and_unique_sequences(self):
        thread_count = 20
        appends_per_thread = 10
        expected_count = thread_count * appends_per_thread
        barrier = threading.Barrier(thread_count)
        returned_events = []
        returned_events_lock = threading.Lock()
        errors = []
        errors_lock = threading.Lock()

        def worker(thread_index):
            try:
                barrier.wait(timeout=5)
                local_events = []
                for event_index in range(appends_per_thread):
                    event_id = f"evt-{thread_index}-{event_index}"
                    local_events.extend(self.server.append_live_agent_world_events([{
                        "eventType": "test-concurrent-append",
                        "eventId": event_id,
                        "threadIndex": thread_index,
                        "eventIndex": event_index,
                    }]))
                with returned_events_lock:
                    returned_events.extend(local_events)
            except Exception as exc:  # noqa: BLE001 - report full worker failures.
                with errors_lock:
                    errors.append(exc)

        threads = [threading.Thread(target=worker, args=(thread_index,)) for thread_index in range(thread_count)]
        for thread in threads:
            thread.start()
        for thread in threads:
            thread.join(timeout=15)
        still_running = [thread.name for thread in threads if thread.is_alive()]

        self.assertFalse(still_running, f"threads did not finish: {still_running}")
        self.assertFalse(errors, f"worker errors: {errors}")
        self.assertEqual(len(returned_events), expected_count)

        store = self.server.get_live_agent_world_event_feed_store(persist_migration=False)
        events = store.get("events") or []
        sequences = [event.get("sequence") for event in events]
        expected_sequences = list(range(1, expected_count + 1))
        expected_event_ids = {f"evt-{thread_index}-{event_index}" for thread_index in range(thread_count) for event_index in range(appends_per_thread)}

        self.assertEqual(len(events), expected_count)
        self.assertEqual(store.get("nextSequence"), expected_count + 1)
        self.assertEqual(sequences, expected_sequences)
        self.assertEqual(len(set(sequences)), expected_count)
        self.assertEqual({event.get("eventId") for event in events}, expected_event_ids)

    def test_event_listing_requires_snapshot_when_unseen_events_exceed_limit(self):
        total_events = 250
        for index in range(total_events):
            self.server.append_live_agent_world_events([{
                "eventType": "test-feed-limit-gap",
                "eventId": f"evt-limit-gap-{index}",
            }])

        over_limit = self.server.list_live_agent_world_events({"since": "0", "limit": "200"})

        self.assertTrue(over_limit["requiresSnapshotRefresh"])
        self.assertEqual(over_limit["events"], [])
        self.assertIn("snapshot", over_limit)
        self.assertEqual(over_limit["snapshot"]["cursor"], total_events)
        self.assertEqual(over_limit["nextCursor"], total_events)

        within_limit = self.server.list_live_agent_world_events({"since": "50", "limit": "200"})

        self.assertFalse(within_limit["requiresSnapshotRefresh"])
        self.assertNotIn("snapshot", within_limit)
        self.assertEqual([event.get("sequence") for event in within_limit["events"]], list(range(51, total_events + 1)))

    def test_live_agent_build_completion_publishes_building_world_events(self):
        building_id = "live-home-world-events-regression"
        action = {
            "id": "world-action-build-regression",
            "actionType": "world.buildStructure",
            "agentId": "agent-world-events",
            "target": {
                "x": 120,
                "y": 160,
                "buildSite": {
                    "buildingId": building_id,
                    "buildingName": "World Events Regression Home",
                    "worldX": 7,
                    "worldY": 11,
                    "widthTiles": 10,
                    "heightTiles": 8,
                },
            },
        }

        effect = self.server.apply_live_agent_build_completion_effect(action)
        building = self.server.load_building(building_id)
        listing = self.server.list_live_agent_world_events({"since": "0", "limit": "50"})
        events = listing.get("events") or []
        building_events = [
            event for event in events
            if event.get("eventType") == "building-created"
            and (event.get("patch") or {}).get("buildingId") == building_id
        ]

        self.assertIsInstance(effect, dict)
        self.assertEqual(effect.get("effect"), "building-persisted")
        self.assertFalse(effect.get("alreadyExisted"))
        self.assertIsInstance(building, dict)
        self.assertEqual(building.get("id"), building_id)
        self.assertGreater(effect.get("worldEventCount") or 0, 0)
        self.assertEqual(effect.get("worldEventCount"), len(events))
        self.assertFalse(listing["requiresSnapshotRefresh"])
        self.assertEqual(listing["nextCursor"], len(events))
        self.assertEqual(len(building_events), 1)
        self.assertEqual((building_events[0].get("patch") or {}).get("op"), "upsert")
        self.assertEqual(((building_events[0].get("patch") or {}).get("value") or {}).get("id"), building_id)
        self.assertEqual(building_events[0].get("source"), "server.py#apply_live_agent_build_completion_effect")

    def test_outdoor_area_nodes_publish_object_world_events(self):
        building_id = "park-world-events-regression"
        node_id = "park-bench-world-events"
        before_empty = {
            "id": building_id,
            "type": "park",
            "outdoorArea": {"id": f"{building_id}-area", "outdoorAreaType": "park", "nodes": []},
        }
        after_create = {
            **before_empty,
            "outdoorArea": {
                **before_empty["outdoorArea"],
                "nodes": [{
                    "id": node_id,
                    "catalogId": "parkBench",
                    "type": "parkBench",
                    "x": 4,
                    "z": 6,
                    "label": "Bench A",
                }],
            },
        }
        after_update = {
            **after_create,
            "outdoorArea": {
                **after_create["outdoorArea"],
                "nodes": [{**after_create["outdoorArea"]["nodes"][0], "label": "Bench B"}],
            },
        }

        created = self.server.publish_building_world_events(before_empty, after_create, source="test-outdoor-area-nodes")
        updated = self.server.publish_building_world_events(after_create, after_update, source="test-outdoor-area-nodes")
        deleted = self.server.publish_building_world_events(after_update, before_empty, source="test-outdoor-area-nodes")

        self.assertEqual([event.get("eventType") for event in created], ["building-updated", "object-created"])
        self.assertEqual([event.get("eventType") for event in updated], ["building-updated", "object-updated"])
        self.assertEqual([event.get("eventType") for event in deleted], ["building-updated", "object-deleted"])

        object_events = [created[1], updated[1], deleted[1]]
        self.assertEqual([event.get("sequence") for event in object_events], [2, 4, 6])
        self.assertEqual([event.get("eventType") for event in object_events], ["object-created", "object-updated", "object-deleted"])
        for event in object_events:
            self.assertEqual((event.get("target") or {}).get("kind"), "object-instance")
            self.assertEqual((event.get("target") or {}).get("buildingId"), building_id)
            self.assertEqual((event.get("target") or {}).get("objectInstanceId"), node_id)
            self.assertEqual((event.get("target") or {}).get("catalogId"), "parkBench")
            self.assertEqual((event.get("patch") or {}).get("collection"), "buildingObjects")
            self.assertEqual((event.get("patch") or {}).get("buildingId"), building_id)
            self.assertEqual((event.get("patch") or {}).get("objectInstanceId"), node_id)

        self.assertEqual((created[1].get("patch") or {}).get("op"), "upsert")
        self.assertEqual((updated[1].get("patch") or {}).get("op"), "upsert")
        self.assertEqual((deleted[1].get("patch") or {}).get("op"), "delete")
        self.assertEqual(((deleted[1].get("patch") or {}).get("buildingPatch") or {}).get("op"), "delete-object")

    def test_metrics_ignore_replay_latency_and_sample_live_incremental_latency(self):
        replay_query = {
            "client": "main3d-world-event-feed",
            "sessionId": "client-replay",
            "lastAppliedLatencyMs": "7000",
            "lastAppliedLatencySource": "replay",
        }
        self.server.list_live_agent_world_events(replay_query)

        replay_metrics = self.server.get_live_agent_world_event_feed_metrics()

        self.assertTrue(replay_metrics["ok"])
        self.assertEqual(replay_metrics["latency"]["sampleCount"], 0)
        self.assertEqual(replay_metrics["p95MultiClientSyncLatencyMs"], 0)

        live_query = {
            "client": "main3d-world-event-feed",
            "sessionId": "client-live",
            "lastAppliedLatencyMs": "1200",
            "lastAppliedLatencySource": "live-incremental",
        }
        self.server.list_live_agent_world_events(live_query)

        live_metrics = self.server.get_live_agent_world_event_feed_metrics()

        self.assertTrue(live_metrics["ok"])
        self.assertEqual(live_metrics["latency"]["sampleCount"], 1)
        self.assertEqual(live_metrics["p95MultiClientSyncLatencyMs"], 1200)


if __name__ == "__main__":
    unittest.main(verbosity=2)
