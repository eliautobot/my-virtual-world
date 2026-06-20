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


if __name__ == "__main__":
    unittest.main(verbosity=2)
