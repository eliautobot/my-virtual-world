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

    def _seed_two_live_agents_for_reactions(self):
        previous_vw_int = os.environ.get("_VW_INT")
        os.environ["_VW_INT"] = "1"
        self.addCleanup(lambda: os.environ.pop("_VW_INT", None) if previous_vw_int is None else os.environ.__setitem__("_VW_INT", previous_vw_int))
        self.server.VW_CONFIG.setdefault("features", {})["agentLiveMode"] = True
        now = "2026-06-21T12:00:00Z"
        building = {
            "id": "reaction-office",
            "name": "Reaction Office",
            "type": "office",
            "worldX": 1,
            "worldY": 1,
            "widthTiles": 8,
            "heightTiles": 8,
            "interior": {"furniture": []},
        }
        self.server.save_building(building["id"], building)
        meta = self.server.load_world_meta()
        meta["agentProfiles"] = {
            "speaker-agent": {
                "name": "Speaker Agent",
                "providerKind": "fake",
                "providerType": "profile-backed",
                "providerAgentId": "speaker-agent",
                "agentLiveModeEnabled": True,
            },
            "listener-agent": {
                "name": "Listener Agent",
                "providerKind": "fake",
                "providerType": "profile-backed",
                "providerAgentId": "listener-agent",
                "agentLiveModeEnabled": True,
                "personality": {"outgoing": 0.9, "curious": 0.8, "easygoing": 0.7},
            },
        }
        meta["agentAssignments"] = {
            "speaker-agent": {"work": building["id"]},
            "listener-agent": {"work": building["id"]},
        }
        presence = {
            "schemaVersion": self.server.LIVE_AGENT_PRESENCE_SCHEMA_VERSION,
            "agents": {
                "speaker-agent": {
                    "agentId": "speaker-agent",
                    "buildingId": building["id"],
                    "floor": 1,
                    "x": 3,
                    "z": 3,
                    "apiX": 120,
                    "apiZ": 120,
                    "source": "reaction-test",
                    "state": "arrived",
                    "updatedAt": now,
                },
                "listener-agent": {
                    "agentId": "listener-agent",
                    "buildingId": building["id"],
                    "floor": 1,
                    "x": 4,
                    "z": 3,
                    "apiX": 160,
                    "apiZ": 120,
                    "source": "reaction-test",
                    "state": "arrived",
                    "updatedAt": now,
                },
            },
            "agentLocations": {},
            "history": [],
            "updatedAt": now,
        }
        presence["agentLocations"] = dict(presence["agents"])
        meta["agentLife"] = {
            "presence": presence,
            "simulation": {
                "schemaVersion": self.server.LIVE_AGENT_SIMULATION_SCHEMA_VERSION,
                "agentLocations": dict(presence["agents"]),
                "updatedAt": now,
            },
            "liveModeLoop": {
                "schemaVersion": self.server.LIVE_AGENT_LOOP_SCHEMA_VERSION,
                "enabled": True,
                "worldClientRequired": False,
                "minActionIntervalSec": 120,
                "maxActionsPerTick": 1,
                "maxToolCallsPerTurn": 5,
                "agents": {
                    "speaker-agent": {"enabled": True, "needs": {"social": 0.3, "curiosity": 0.2}},
                    "listener-agent": {"enabled": True, "needs": {"social": 0.95, "curiosity": 0.2}},
                },
            },
        }
        self.server.save_world_meta(meta)
        return now, building

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

    def test_explicit_snapshot_without_cursor_omits_retained_backlog(self):
        total_events = 250
        for index in range(total_events):
            self.server.append_live_agent_world_events([{
                "eventType": "test-initial-snapshot",
                "eventId": f"evt-initial-snapshot-{index}",
            }])

        listing = self.server.list_live_agent_world_events({"snapshot": "1", "limit": "200"})

        self.assertFalse(listing["requiresSnapshotRefresh"])
        self.assertEqual(listing["events"], [])
        self.assertIn("snapshot", listing)
        self.assertEqual(listing["snapshot"]["cursor"], total_events)
        self.assertEqual(listing["nextCursor"], total_events)

    def test_api_presence_save_publishes_world_event_even_when_location_matches(self):
        agent_id = "presence-world-event-agent"
        now = "2026-06-20T00:00:00Z"
        presence = {
            "agentId": agent_id,
            "buildingId": "office",
            "floor": 1,
            "x": 15,
            "z": 10,
            "apiX": 600,
            "apiZ": 400,
            "source": "live-agent-loop",
            "state": "arrived",
            "routeState": "arrived",
            "updatedAt": now,
        }
        meta = self.server.load_world_meta()
        meta["agentProfiles"] = {
            agent_id: {
                "name": "Presence World Event Agent",
                "providerKind": "fake",
                "agentLiveModeEnabled": True,
            }
        }
        meta["agentLife"] = {
            "presence": {
                "schemaVersion": self.server.LIVE_AGENT_PRESENCE_SCHEMA_VERSION,
                "agents": {agent_id: presence},
                "agentLocations": {agent_id: presence},
                "history": [],
                "updatedAt": now,
            }
        }
        self.server.save_world_meta(meta)

        ok, result, status = self.server.save_agent_presence_from_payload(agent_id, {
            "source": "api-regression",
            "state": "arrived",
            "location": {
                "agentId": agent_id,
                "buildingId": "office",
                "floor": 1,
                "x": 15,
                "z": 10,
                "apiX": 600,
                "apiZ": 400,
            },
        })
        listing = self.server.list_live_agent_world_events({"since": "0", "limit": "10"})
        events = listing.get("events") or []

        self.assertTrue(ok, result)
        self.assertEqual(status, 200)
        self.assertEqual(result["presence"]["apiX"], 600)
        self.assertEqual(listing["nextCursor"], 1)
        self.assertEqual(len(events), 1)
        self.assertEqual(events[0].get("eventType"), "agent-presence-updated")
        self.assertEqual(events[0].get("agentId"), agent_id)
        self.assertEqual((events[0].get("patch") or {}).get("collection"), "agentPresence")
        self.assertIsInstance(events[0].get("createdEpochMs"), int)
        self.assertIsInstance(events[0].get("publishedEpochMs"), int)
        self.assertGreater(events[0].get("publishedEpochMs"), 0)

    def test_direct_presence_save_clears_stale_route_and_blocks_browser_replay(self):
        agent_id = "presence-direct-move-agent"
        previous_action_id = "wa-stale-browser-replay"
        now = "2026-06-20T00:00:00Z"
        previous = {
            "agentId": agent_id,
            "buildingId": "office",
            "floor": 1,
            "x": 20,
            "z": 14,
            "apiX": 800,
            "apiZ": 560,
            "source": "live-agent-loop",
            "state": "completed",
            "routeState": "completed",
            "routeStatus": "completed",
            "worldActionId": previous_action_id,
            "actionId": previous_action_id,
            "routeId": "route-stale-browser-replay",
            "updatedAt": now,
        }
        meta = self.server.load_world_meta()
        meta["agentProfiles"] = {
            agent_id: {
                "name": "Presence Direct Move Agent",
                "providerKind": "fake",
                "agentLiveModeEnabled": True,
            }
        }
        meta["agentLife"] = {
            "presence": {
                "schemaVersion": self.server.LIVE_AGENT_PRESENCE_SCHEMA_VERSION,
                "agents": {agent_id: previous},
                "agentLocations": {agent_id: previous},
                "history": [],
                "updatedAt": now,
            }
        }
        self.server.save_world_meta(meta)

        ok, result, status = self.server.save_agent_presence_from_payload(agent_id, {
            "source": "8587-two-client-world-event-feed",
            "state": "arrived",
            "location": {
                "agentId": agent_id,
                "buildingId": "office",
                "floor": 1,
                "x": -9,
                "z": -4.5,
                "apiX": -360,
                "apiZ": -180,
            },
        })

        self.assertTrue(ok, result)
        self.assertEqual(status, 200)
        self.assertEqual(result["presence"]["apiX"], -360)
        self.assertNotIn("worldActionId", result["presence"])
        self.assertNotIn("routeId", result["presence"])

        replay_ok, replay_result, replay_status = self.server.save_agent_presence_from_payload(agent_id, {
            "source": "browser-replay",
            "state": "completed",
            "actionId": previous_action_id,
            "worldActionId": previous_action_id,
            "routeId": "route-stale-browser-replay",
            "location": {
                "agentId": agent_id,
                "buildingId": "office",
                "floor": 1,
                "x": 20,
                "z": 14,
                "apiX": 800,
                "apiZ": 560,
                "worldActionId": previous_action_id,
                "actionId": previous_action_id,
                "routeId": "route-stale-browser-replay",
            },
        })
        listing = self.server.list_live_agent_world_events({"since": "0", "limit": "10"})

        self.assertTrue(replay_ok, replay_result)
        self.assertEqual(replay_status, 200)
        self.assertTrue(replay_result.get("ignored"), replay_result)
        self.assertEqual(replay_result["presence"]["apiX"], -360)
        self.assertEqual(listing["nextCursor"], 1)
        self.assertEqual(len(listing.get("events") or []), 1)
        self.assertEqual(((listing["events"][0].get("patch") or {}).get("value") or {}).get("apiX"), -360)

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

    def test_live_agent_final_gate_default_turn_target_is_five(self):
        metrics = self.server.get_live_agent_mode_autonomy_metrics()

        self.assertEqual(metrics["finalGate"]["evidence"]["requiredEnabledAgentCount"], 5)
        self.assertEqual(metrics["finalGate"]["evidence"]["requiredCompletedTurnCount"], 5)
        self.assertFalse(metrics["finalGate"]["checks"]["defaultSoakCompletedTurnTargetMet"])
        self.assertFalse(metrics["finalGate"]["checks"]["defaultSoakCompletedBackendActionTargetMet"])

    def test_nearby_speech_enqueues_and_runs_bounded_reaction_turn(self):
        now, building = self._seed_two_live_agents_for_reactions()
        event = {
            "id": "comm-reaction-regression",
            "at": now,
            "fromAgentId": "speaker-agent",
            "targetAgentId": "listener-agent",
            "observerIds": ["listener-agent"],
            "scope": "nearby-agent-speech",
            "text": "Can you take a quick look at this?",
            "conversationId": "reaction-regression",
            "location": {"buildingId": building["id"], "floor": 1},
            "reactionOpportunities": [{
                "id": "react-comm-reaction-regression-listener-agent",
                "agentId": "listener-agent",
                "status": "open",
                "createdAt": now,
                "reason": "direct-target",
                "suggestedTools": ["say_to_agent"],
            }],
            "source": {"kind": "agent-live-mode", "tool": "say_to_agent"},
            "spatial": True,
        }

        side_effects = self.server._live_agent_record_communication_side_effects(event)
        state = self.server.get_live_agent_loop_state(persist_migration=False)
        queued = state.get("reactionQueue") or []
        metrics_before = self.server.get_live_agent_mode_autonomy_metrics()

        self.assertEqual(side_effects["queuedReactionTurns"][0]["id"], "react-comm-reaction-regression-listener-agent")
        self.assertEqual(len(queued), 1)
        self.assertEqual(queued[0]["triggerKind"], "nearby-speech")
        self.assertEqual(queued[0]["agentId"], "listener-agent")
        self.assertLess(queued[0]["bounds"]["reactionMaxToolCallsPerTurn"], queued[0]["bounds"]["regularMaxToolCallsPerTurn"])
        self.assertLess(queued[0]["bounds"]["reactionCooldownSec"], queued[0]["bounds"]["regularCooldownSec"])
        self.assertEqual(metrics_before["metrics"]["reactionTriggers"]["byTriggerKind"]["nearby-speech"], 1)

        regular_tick = self.server.live_agent_loop_tick(reason="reaction-regression-forced-regular", force=True, skip_reactions=True)
        state_after_regular = self.server.get_live_agent_loop_state(persist_migration=False)
        original_reaction = next(item for item in state_after_regular.get("reactionQueue") or [] if item.get("id") == "react-comm-reaction-regression-listener-agent")
        self.assertTrue(regular_tick["ok"], regular_tick)
        self.assertTrue(regular_tick["reaction"]["selectionSkipped"], regular_tick)
        self.assertNotEqual(regular_tick["turn"]["turnType"], "reaction")
        self.assertEqual(original_reaction["status"], "queued")

        tick = self.server.live_agent_loop_tick(reason="reaction-regression", force=True)
        metrics_after = self.server.get_live_agent_mode_autonomy_metrics()

        self.assertTrue(tick["ok"], tick)
        self.assertEqual(tick["turn"]["turnType"], "reaction")
        self.assertEqual(tick["turn"]["agentId"], "listener-agent")
        self.assertEqual(tick["turn"]["reaction"]["triggerKind"], "nearby-speech")
        self.assertEqual(tick["turn"]["bounds"]["maxToolCallsPerTurn"], 2)
        self.assertLess(tick["turn"]["bounds"]["cooldownSec"], tick["turn"]["bounds"]["regularCooldownSec"])
        self.assertGreaterEqual(metrics_after["metrics"]["completedReactionTurnCount"], 1)
        self.assertGreaterEqual(metrics_after["metrics"]["completedRegularTurnCount"], 0)
        self.assertEqual(metrics_after["metrics"]["reactionTriggers"]["completedCount"], 1)

    def test_nearby_visible_action_enqueues_reaction_opportunity(self):
        now, building = self._seed_two_live_agents_for_reactions()
        state = self.server.get_live_agent_loop_state(persist_migration=True)
        action = {
            "id": "world-action-reaction-regression",
            "actionType": "life.getCoffee",
            "agentId": "speaker-agent",
            "target": {"kind": "object-instance", "buildingId": building["id"], "floor": 1, "objectInstanceId": "coffee"},
            "params": {"loopActionId": "get-coffee"},
        }
        summary = {
            "id": action["id"],
            "status": "completed",
            "actionType": action["actionType"],
            "loopActionId": "get-coffee",
        }

        update = self.server._live_agent_society_record_world_action_event(state, "speaker-agent", action, summary, now)
        saved = self.server.save_live_agent_loop_state(state)
        metrics = self.server.get_live_agent_mode_autonomy_metrics()
        action_reactions = [item for item in saved.get("reactionQueue") or [] if item.get("triggerKind") == "nearby-action"]

        self.assertIsInstance(update, dict)
        self.assertEqual(update["nearbyObserverIds"], ["listener-agent"])
        self.assertEqual(len(update["queuedReactionTurns"]), 1)
        self.assertEqual(len(action_reactions), 1)
        self.assertEqual(action_reactions[0]["agentId"], "listener-agent")
        self.assertEqual(action_reactions[0]["subjectAgentId"], "speaker-agent")
        self.assertEqual(metrics["metrics"]["reactionTriggers"]["byTriggerKind"]["nearby-action"], 1)


if __name__ == "__main__":
    unittest.main(verbosity=2)
