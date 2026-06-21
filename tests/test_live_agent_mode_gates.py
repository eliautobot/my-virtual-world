#!/usr/bin/env python3
"""Regression coverage for Live Agent Mode safety gates."""

import importlib.util
import json
import os
import socket
import subprocess
import sys
import tempfile
import time
import unittest
import urllib.error
import urllib.request
import uuid
from pathlib import Path


REPO_ROOT = Path(__file__).resolve().parents[1]
SERVER = REPO_ROOT / "src" / "server" / "server.py"


def _free_port():
    with socket.socket(socket.AF_INET, socket.SOCK_STREAM) as sock:
        sock.bind(("127.0.0.1", 0))
        return sock.getsockname()[1]


def _read_json(path):
    if not path.exists():
        return {}
    with path.open() as f:
        return json.load(f)


def _live_agent_state_keys(meta_path):
    meta = _read_json(meta_path)
    maybe_agent_life = meta.get("agentLife")
    agent_life = maybe_agent_life if isinstance(maybe_agent_life, dict) else {}
    return sorted(agent_life.keys())


def _write_unlocked_config(data_dir):
    config_path = data_dir / "vw-config.json"
    config_path.write_text(json.dumps({"features": {"agentLiveMode": True}}), encoding="utf-8")
    return config_path


def _load_server_module(data_dir):
    module_name = f"vw_server_live_agent_gates_{uuid.uuid4().hex}"
    config_path = _write_unlocked_config(data_dir)
    env_keys = ("VW_DATA_DIR", "VW_CONFIG", "VW_PORT", "VW_HOST_PORT", "VW_PUBLIC_ORIGIN", "_VW_INT")
    previous_env = {key: os.environ.get(key) for key in env_keys}
    server_dir = str(SERVER.parent)
    added_server_dir = server_dir not in sys.path
    if added_server_dir:
        sys.path.insert(0, server_dir)
    os.environ.update({
        "VW_DATA_DIR": str(data_dir),
        "VW_CONFIG": str(config_path),
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


def _action_fixture(server, *, action_id="wa-live-regression", status="arrived"):
    now = "2026-06-20T00:00:00Z"
    target = {"kind": "world-point", "x": 12, "z": 8, "floor": 1}
    action = {
        "id": action_id,
        "actionType": "life.getCoffee",
        "agentId": "live-agent-regression",
        "capabilityTag": "life.hydration",
        "status": status,
        "priority": "normal",
        "source": {
            "kind": "agent-live-mode",
            "behaviorSourceKind": "agent-live-mode",
            "behaviorMode": "agent-live",
            "requestedBy": "live-agent-regression",
        },
        "target": target,
        "route": {
            "id": f"route-{action_id}",
            "state": status,
            "target": target,
            "targetMetadata": target,
            "arrivedAt": now,
            "routeOwner": "server-simulation",
            "routingOwner": server.LIVE_AGENT_BACKEND_EXECUTOR_ID,
            "clientRequiredForProgress": False,
        },
        "execution": {
            "schemaVersion": server.LIVE_AGENT_BACKEND_EXECUTION_VERSION,
            "owner": "server-simulation",
            "state": "running",
            "clientRequiredForProgress": False,
        },
        "timing": {"createdAt": now, "updatedAt": now, "arrivedAt": now},
        "lifecycle": {
            "previousStatus": "routing" if status == "arrived" else None,
            "allowedNext": server._world_action_allowed_next(status),
            "transitionLog": [
                {
                    "at": now,
                    "from": "routing" if status == "arrived" else None,
                    "to": status,
                    "actor": "test",
                    "source": "agent-live-mode",
                    "reason": status,
                }
            ],
        },
    }
    if status in server.WORLD_ACTION_TERMINAL_STATES:
        action["result"] = {"status": status, "reason": status}
        action["lifecycle"]["terminalReason"] = status
        action["timing"]["terminalAt"] = now
    return action


def _http_json(method, url, payload=None):
    data = None if payload is None else json.dumps(payload).encode("utf-8")
    request = urllib.request.Request(
        url,
        data=data,
        method=method,
        headers={"Content-Type": "application/json"},
    )
    try:
        with urllib.request.urlopen(request, timeout=5) as resp:
            return resp.status, json.loads(resp.read().decode("utf-8"))
    except urllib.error.HTTPError as exc:
        return exc.code, json.loads(exc.read().decode("utf-8"))


class LiveAgentModeGateRegressionTest(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory(prefix="vw-live-agent-gate-test-")
        self.data_dir = Path(self.tmp.name)
        self.port = _free_port()
        self.base_url = f"http://127.0.0.1:{self.port}"
        env = os.environ.copy()
        env.update({
            "VW_PORT": str(self.port),
            "VW_HOST_PORT": str(self.port),
            "VW_PUBLIC_ORIGIN": self.base_url,
            "VW_DATA_DIR": str(self.data_dir),
        })
        # Do not set _VW_INT: this exercises the default locked demo mode.
        env.pop("_VW_INT", None)
        self.proc = subprocess.Popen(
            [sys.executable, str(SERVER)],
            cwd=str(REPO_ROOT),
            env=env,
            stdout=subprocess.PIPE,
            stderr=subprocess.STDOUT,
            text=True,
        )
        self.addCleanup(self._stop_server)
        self._wait_for_server()

    def tearDown(self):
        self.tmp.cleanup()

    def _stop_server(self):
        if getattr(self, "proc", None) and self.proc.poll() is None:
            self.proc.terminate()
            try:
                self.proc.wait(timeout=5)
            except subprocess.TimeoutExpired:
                self.proc.kill()
                self.proc.wait(timeout=5)
        if getattr(self, "proc", None) and self.proc.stdout:
            self.proc.stdout.close()

    def _wait_for_server(self):
        deadline = time.time() + 15
        last_error = None
        while time.time() < deadline:
            if self.proc.poll() is not None:
                output = self.proc.stdout.read() if self.proc.stdout else ""
                self.fail(f"server exited before becoming ready:\n{output}")
            try:
                with urllib.request.urlopen(f"{self.base_url}/healthz", timeout=0.5) as resp:
                    if resp.status == 200:
                        return
            except Exception as exc:  # noqa: BLE001 - keep startup diagnostics broad.
                last_error = exc
            time.sleep(0.1)
        self.fail(f"server did not become ready: {last_error}")

    def _get_json(self, path):
        try:
            with urllib.request.urlopen(f"{self.base_url}{path}", timeout=5) as resp:
                return resp.status, json.loads(resp.read().decode("utf-8"))
        except urllib.error.HTTPError as exc:
            return exc.code, json.loads(exc.read().decode("utf-8"))

    def test_default_locked_startup_does_not_persist_live_loop_state(self):
        time.sleep(0.25)
        self.assertNotIn("liveModeLoop", _live_agent_state_keys(self.data_dir / "world-meta.json"))

    def test_locked_live_agent_get_endpoints_are_forbidden_before_side_effects(self):
        blocked_paths = [
            "/api/agent-live-loop/perception?agentId=adam",
            "/api/agent-live-loop/feedback",
            "/api/agent-live-loop/proposals",
            "/api/agent-live-loop/timeline",
            "/api/agent-live-loop/events",
            "/api/live-agent-mode/animation-events",
            "/api/live-agent-mode/in-world-communications",
            "/api/live-agent-mode/memory/adam",
            "/api/agent-live-loop",
            "/api/live-agent-mode/tools",
        ]
        for path in blocked_paths:
            with self.subTest(path=path):
                before = _live_agent_state_keys(self.data_dir / "world-meta.json")
                status, body = self._get_json(path)
                after = _live_agent_state_keys(self.data_dir / "world-meta.json")
                self.assertEqual(status, 403)
                self.assertTrue(body.get("locked") or not body.get("ok"), body)
                self.assertEqual(after, before)
                self.assertNotIn("liveModeLoop", after)

    def test_locked_metrics_endpoint_remains_read_only_introspection(self):
        before = _live_agent_state_keys(self.data_dir / "world-meta.json")
        status, body = self._get_json("/api/live-agent-mode/metrics")
        after = _live_agent_state_keys(self.data_dir / "world-meta.json")
        self.assertEqual(status, 200)
        self.assertTrue(body.get("ok"), body)
        self.assertEqual(after, before)
        self.assertNotIn("liveModeLoop", after)
        self.assertNotIn("worldActions", after)
        self.assertNotIn("animationEvents", after)
        self.assertNotIn("inWorldCommunications", after)


class LiveAgentModeUnlockedMutationGateTest(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory(prefix="vw-live-agent-unlocked-gate-test-")
        self.data_dir = Path(self.tmp.name)
        self.port = _free_port()
        self.base_url = f"http://127.0.0.1:{self.port}"
        config_path = _write_unlocked_config(self.data_dir)
        env = os.environ.copy()
        env.update({
            "VW_PORT": str(self.port),
            "VW_HOST_PORT": str(self.port),
            "VW_PUBLIC_ORIGIN": self.base_url,
            "VW_DATA_DIR": str(self.data_dir),
            "VW_CONFIG": str(config_path),
            "_VW_INT": "1",
        })
        self.proc = subprocess.Popen(
            [sys.executable, str(SERVER)],
            cwd=str(REPO_ROOT),
            env=env,
            stdout=subprocess.PIPE,
            stderr=subprocess.STDOUT,
            text=True,
        )
        self.addCleanup(self._stop_server)
        self._wait_for_server()
        self.server = _load_server_module(self.data_dir)
        self.server._agent_live_mode_gate_error = lambda: None
        self.addCleanup(lambda: sys.modules.pop(self.server.__name__, None))

    def tearDown(self):
        self.tmp.cleanup()

    def _stop_server(self):
        if getattr(self, "proc", None) and self.proc.poll() is None:
            self.proc.terminate()
            try:
                self.proc.wait(timeout=5)
            except subprocess.TimeoutExpired:
                self.proc.kill()
                self.proc.wait(timeout=5)
        if getattr(self, "proc", None) and self.proc.stdout:
            self.proc.stdout.close()

    def _wait_for_server(self):
        deadline = time.time() + 15
        last_error = None
        while time.time() < deadline:
            if self.proc.poll() is not None:
                output = self.proc.stdout.read() if self.proc.stdout else ""
                self.fail(f"server exited before becoming ready:\n{output}")
            try:
                with urllib.request.urlopen(f"{self.base_url}/healthz", timeout=0.5) as resp:
                    if resp.status == 200:
                        return
            except Exception as exc:  # noqa: BLE001 - keep startup diagnostics broad.
                last_error = exc
            time.sleep(0.1)
        self.fail(f"server did not become ready: {last_error}")

    def test_live_agent_source_cannot_bulk_replace_active_actions(self):
        action = _action_fixture(self.server, action_id="wa-live-active-bulk", status="arrived")

        status, body = _http_json("POST", f"{self.base_url}/api/world-actions/active", {"active": [action]})
        store_status, store = _http_json("GET", f"{self.base_url}/api/world-actions/active")

        self.assertEqual(status, 422, body)
        self.assertEqual((body.get("error") or {}).get("code"), "live_agent_bulk_world_action_replace_forbidden")
        self.assertEqual(store_status, 200)
        self.assertEqual(store, [])

    def test_live_agent_source_cannot_bulk_replace_action_history(self):
        action = _action_fixture(self.server, action_id="wa-live-history-bulk", status="completed")

        status, body = _http_json("POST", f"{self.base_url}/api/world-actions/history", {"history": [action]})
        store_status, store = _http_json("GET", f"{self.base_url}/api/world-actions/history")

        self.assertEqual(status, 422, body)
        self.assertEqual((body.get("error") or {}).get("code"), "live_agent_bulk_world_action_replace_forbidden")
        self.assertEqual(store_status, 200)
        self.assertEqual(store, [])

    def test_rejected_in_progress_gate_does_not_persist_object_use_started_event(self):
        # No presence is stored for the agent, so the authoritative in_progress
        # transition gate must reject before object-use-started becomes visible.
        action = _action_fixture(self.server, action_id="wa-live-no-presence", status="arrived")
        ok, result = self.server.save_world_actions_store({"active": [action], "history": []})
        self.assertTrue(ok, result)

        advanced, response, status = self.server.advance_live_agent_backend_world_action(action["id"])
        events = self.server.list_live_agent_animation_events({"since": "0", "limit": "20"}).get("events") or []
        names = [event.get("name") for event in events]
        current_action = self.server.get_world_actions_store().get("active", [])[0]

        self.assertFalse(advanced, response)
        self.assertEqual(status, 409)
        self.assertEqual((response.get("error") or {}).get("code"), "presence_missing")
        self.assertNotIn("object-use-started", names)
        self.assertEqual(current_action.get("status"), "arrived")


if __name__ == "__main__":
    unittest.main(verbosity=2)
