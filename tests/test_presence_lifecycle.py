import os
import sys
import tempfile
import threading
import time
import unittest
from pathlib import Path
from unittest import mock


_SERVER_DATA_DIR = tempfile.TemporaryDirectory(prefix="vw-presence-tests-")
os.environ.setdefault("VW_DATA_DIR", _SERVER_DATA_DIR.name)

PROJECT_ROOT = Path(__file__).resolve().parents[1]
SERVER_ROOT = PROJECT_ROOT / "src" / "server"
if str(SERVER_ROOT) not in sys.path:
    sys.path.insert(0, str(SERVER_ROOT))

import server  # noqa: E402


presence = server._gateway_presence


class PresenceCoordinatorTests(unittest.TestCase):
    def setUp(self):
        presence.reset_state_for_tests()
        server._PROVIDER_RUNS.clear()
        server.HERMES_ACTIVE_RUNS.clear()
        server.CODEX_ACTIVE_RUNS.clear()
        self.temp = tempfile.TemporaryDirectory(prefix="vw-presence-case-")

    def tearDown(self):
        presence.reset_state_for_tests()
        server._PROVIDER_RUNS.clear()
        server.HERMES_ACTIVE_RUNS.clear()
        server.CODEX_ACTIVE_RUNS.clear()
        self.temp.cleanup()

    def test_quiet_run_stays_working_past_ninety_seconds_then_finishes(self):
        with mock.patch.object(presence.time, "time", return_value=1_000.0):
            presence.lifecycle_run_started("aster", "run-quiet", "hermes", "Hermes native run")
        with mock.patch.object(presence.time, "time", return_value=1_090.0):
            presence._maintenance_tick()
            active = presence.get_agent_state("aster")
        self.assertEqual("working", active["state"])
        self.assertEqual(1, active["activeRunCount"])

        with mock.patch.object(presence.time, "time", return_value=1_091.0):
            presence.lifecycle_run_finished("aster", "run-quiet", "hermes", "completed")
            finishing = presence.get_agent_state("aster")
        self.assertEqual("finishing", finishing["state"])
        with mock.patch.object(presence.time, "time", return_value=1_091.0 + presence.FINISHING_GRACE_SEC + 1):
            presence._maintenance_tick()
            idle = presence.get_agent_state("aster")
        self.assertEqual("idle", idle["state"])

    def test_failure_records_error_without_marking_provider_offline(self):
        presence.lifecycle_run_started("agent", "run-fail", "codex", "Codex task")
        presence.lifecycle_run_finished("agent", "run-fail", "codex", "failed", "model error")
        state = presence.get_agent_state("agent")
        self.assertEqual("finishing", state["state"])
        self.assertEqual("failed", state["lastRunOutcome"])
        self.assertEqual("model error", state["lastRunError"])
        self.assertTrue(state["providerHealth"]["connected"])

    def test_overlapping_runs_do_not_finish_early(self):
        presence.lifecycle_run_started("agent", "run-one", "test")
        presence.lifecycle_run_started("agent", "run-two", "test")
        presence.lifecycle_run_finished("agent", "run-one", "test", "completed")
        state = presence.get_agent_state("agent")
        self.assertEqual("working", state["state"])
        self.assertEqual(1, state["activeRunCount"])
        presence.lifecycle_run_finished("agent", "run-two", "test", "completed")
        self.assertEqual("finishing", presence.get_agent_state("agent")["state"])

    def test_run_terminal_clears_tools_and_approvals(self):
        presence.lifecycle_run_started("agent", "run-one", "codex")
        presence.lifecycle_tool_started("agent", "run-one", "tool-one", "shell", "codex")
        presence.lifecycle_approval_requested("agent", "run-one", "approval-one", "codex")
        active = presence.get_agent_state("agent")
        self.assertEqual((1, 1, 1), (
            active["activeRunCount"], active["activeToolCount"], active["waitingApprovalCount"],
        ))
        presence.lifecycle_run_finished("agent", "run-one", "codex", "cancelled")
        terminal = presence.get_agent_state("agent")
        self.assertEqual((0, 0, 0), (
            terminal["activeRunCount"], terminal["activeToolCount"], terminal["waitingApprovalCount"],
        ))
        self.assertEqual("finishing", terminal["state"])

    def test_only_provider_health_sets_offline(self):
        presence.lifecycle_provider_connected("agent", "opencode")
        self.assertEqual("idle", presence.get_agent_state("agent")["state"])
        presence.lifecycle_provider_disconnected("agent", "opencode", "offline", "not reachable")
        offline = presence.get_agent_state("agent")
        self.assertEqual("offline", offline["state"])
        self.assertFalse(offline["providerHealth"]["connected"])
        presence.lifecycle_provider_connected("agent", "opencode")
        self.assertEqual("idle", presence.get_agent_state("agent")["state"])

    def test_manual_idle_cannot_hide_an_active_provider_run(self):
        presence.set_manual_override("agent", "idle", "")
        presence.lifecycle_run_started("agent", "run-one", "hermes", "Hermes run")
        self.assertEqual("working", presence.get_agent_state("agent")["state"])

    def test_openclaw_gateway_events_use_the_same_coordinator(self):
        presence._process_event("agent", {
            "runId": "openclaw-run",
            "sessionKey": "agent:main:main",
            "stream": "lifecycle",
            "data": {"phase": "start"},
        })
        self.assertEqual("working", presence.get_agent_state("main")["state"])
        presence._process_event("agent", {
            "runId": "openclaw-run",
            "sessionKey": "agent:main:main",
            "stream": "lifecycle",
            "data": {"phase": "completed"},
        })
        self.assertEqual("finishing", presence.get_agent_state("main")["state"])

    def test_discovered_profile_is_offline_when_provider_health_fails(self):
        class Registry:
            @staticmethod
            def manifests(include_health=False):
                self.assertTrue(include_health)
                return [{
                    "id": "claude-code",
                    "capabilities": {"health": True},
                    "health": {"ok": False, "installed": True, "authOk": False},
                }]

            @staticmethod
            def discover_agents():
                return [{
                    "id": "claude-code-main", "statusKey": "claude-code-main",
                    "providerKind": "claude-code", "providerAgentId": "main",
                    "available": True, "connectionState": "connected",
                }]

        with mock.patch.object(server, "_get_provider_registry", return_value=Registry()), \
             mock.patch.object(server, "_load_provider_discovery_cache", return_value=[]), \
             mock.patch.object(server, "_save_provider_discovery_cache"):
            roster = server._discover_provider_roster()
        self.assertEqual(1, len(roster))
        self.assertFalse(roster[0]["available"])
        self.assertEqual("offline", roster[0]["connectionState"])

    def test_generic_lifecycle_covers_every_process_provider_and_extensions(self):
        provider_kinds = ["hermes", "codex", "claude-code", "opencode", "antigravity", "sample-extension"]
        for provider_kind in provider_kinds:
            with self.subTest(provider_kind=provider_kind):
                presence.reset_state_for_tests()
                server._PROVIDER_RUNS.clear()
                entered = threading.Event()
                release = threading.Event()
                status_key = f"{provider_kind}:agent"
                agent = {
                    "id": status_key,
                    "statusKey": status_key,
                    "providerKind": provider_kind,
                    "providerAgentId": "main",
                    "profile": "main",
                    "name": provider_kind,
                    "available": True,
                    "capabilities": {"chat": True, "interrupt": True},
                }

                class Registry:
                    @staticmethod
                    def invoke(_kind, operation, *_args, **kwargs):
                        if operation == "test":
                            return {"ok": True, "installed": True, "authOk": True}
                        if operation == "send_chat_message":
                            kwargs["on_progress"]({
                                "thinking": "working",
                                "tools": [{"id": "tool-one", "name": "read", "status": "running"}],
                            })
                            entered.set()
                            release.wait(timeout=2)
                            return {
                                "ok": True,
                                "reply": "done",
                                "sessionId": "session-one",
                                "tools": [{"id": "tool-one", "name": "read", "status": "done"}],
                            }
                        if operation == "interrupt":
                            return {"ok": True}
                        return {"ok": False, "error": operation}

                with mock.patch.object(server, "_agent_record_for", return_value=agent), \
                     mock.patch.object(server, "_get_provider_registry", return_value=Registry()), \
                     mock.patch.object(server, "STATUS_DIR", self.temp.name):
                    started = server._handle_provider_run_start({"agentId": status_key, "message": "test"})
                    self.assertTrue(started["ok"])
                    self.assertTrue(entered.wait(timeout=1))
                    active = presence.get_agent_state(status_key)
                    self.assertEqual("working", active["state"])
                    self.assertEqual(1, active["activeRunCount"])
                    release.set()
                    meta = server._PROVIDER_RUNS[started["runId"]]
                    deadline = time.time() + 2
                    while not meta.get("done") and time.time() < deadline:
                        time.sleep(0.005)
                    self.assertTrue(meta.get("done"))
                    terminal = presence.get_agent_state(status_key)
                    self.assertEqual("finishing", terminal["state"])
                    self.assertEqual(0, terminal["activeRunCount"])

    def test_native_hermes_finishes_without_browser_event_attachment(self):
        entered = threading.Event()
        release = threading.Event()

        class Client:
            base_url = "http://127.0.0.1:8642"

            @staticmethod
            def is_available():
                return True

            @staticmethod
            def start_run(*_args, **_kwargs):
                return {"run_id": "hermes-native-one"}

            @staticmethod
            def stream_run_events(*_args, **_kwargs):
                entered.set()
                release.wait(timeout=2)
                yield {"event": "message.delta", "delta": "done"}
                yield {"event": "run.completed", "output": "done"}

        agent = {
            "id": "hermes-default", "statusKey": "hermes-default", "providerKind": "hermes",
            "profile": "default", "providerAgentId": "default", "apiAvailable": True,
            "capabilities": {"sessionSwitch": True},
        }
        with mock.patch.object(server, "_get_hermes_agent", return_value=agent), \
             mock.patch.object(server, "_hermes_api_client_for_profile", return_value=Client()), \
             mock.patch.object(server, "_get_hermes_session_id", return_value=""), \
             mock.patch.object(server, "_set_hermes_session_id"), \
             mock.patch.object(server, "_load_hermes_history", return_value=[]), \
             mock.patch.object(server, "_save_hermes_history"), \
             mock.patch.object(server, "_publish_hermes_api_progress"):
            started = server._handle_hermes_run_start({"agentId": "hermes-default", "message": "test"})
            self.assertTrue(started["ok"])
            self.assertTrue(entered.wait(timeout=1))
            self.assertEqual("working", presence.get_agent_state("hermes-default")["state"])
            release.set()
            runtime = server._get_hermes_active_run("hermes-native-one")["runtime"]
            deadline = time.time() + 2
            while not runtime.get("done") and time.time() < deadline:
                time.sleep(0.005)
            self.assertTrue(runtime.get("done"))
            self.assertEqual("finishing", presence.get_agent_state("hermes-default")["state"])

    def test_native_codex_finishes_without_browser_event_attachment(self):
        entered = threading.Event()
        release = threading.Event()

        class State:
            completed = False

        class Run:
            thread_id = "thread-one"
            turn_id = "turn-one"
            state = State()

            def next_event(self, timeout=0.5):
                entered.set()
                release.wait(timeout=2)
                self.state.completed = True
                return {
                    "event": "run.completed", "ok": True, "reply": "done",
                    "sessionId": self.thread_id, "tools": [], "thinking": "",
                }

            def snapshot(self):
                return {
                    "sessionId": self.thread_id, "reply": "done", "tools": [],
                    "thinking": "", "error": "",
                }

            def close(self):
                return None

        class Provider:
            prefer_app_server = True

            @staticmethod
            def start_chat_stream(*_args, **_kwargs):
                return Run()

        agent = {
            "id": "codex-main", "statusKey": "codex-main", "providerKind": "codex",
            "profile": "main", "providerAgentId": "main",
        }
        with mock.patch.object(server, "_get_codex_agent", return_value=agent), \
             mock.patch.object(server, "_codex_provider", return_value=Provider()), \
             mock.patch.object(server, "_get_codex_session_id", return_value=""), \
             mock.patch.object(server, "_set_codex_session_id"), \
             mock.patch.object(server, "_load_codex_history", return_value=[]), \
             mock.patch.object(server, "_save_codex_history"):
            started = server._handle_codex_run_start({"agentId": "codex-main", "message": "test"})
            self.assertTrue(started["ok"])
            self.assertTrue(entered.wait(timeout=1))
            self.assertEqual("working", presence.get_agent_state("codex-main")["state"])
            release.set()
            runtime = server._get_codex_active_run("turn-one")["runtime"]
            deadline = time.time() + 2
            while not runtime.get("done") and time.time() < deadline:
                time.sleep(0.005)
            self.assertTrue(runtime.get("done"))
            self.assertEqual("finishing", presence.get_agent_state("codex-main")["state"])


if __name__ == "__main__":
    unittest.main()
