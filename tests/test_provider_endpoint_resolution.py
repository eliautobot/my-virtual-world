#!/usr/bin/env python3

import pathlib
import sys
import unittest
import urllib.error
import io
import http.server
import json
import threading
from concurrent.futures import ThreadPoolExecutor


ROOT = pathlib.Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "src" / "server"))

from providers.endpoint_resolution import (  # noqa: E402
    EndpointResolver,
    build_endpoint_candidates,
    endpoint_location,
    normalize_endpoint_url,
)
from providers.hermes import HermesApiClient  # noqa: E402


DEFAULTS = [
    {"url": "http://host.docker.internal:8642", "location": "host", "label": "Docker host"},
    {"url": "http://127.0.0.1:8642", "location": "container", "label": "Container local"},
]


class EndpointCandidateTests(unittest.TestCase):
    def test_location_is_process_topology_not_operating_system(self):
        self.assertEqual(endpoint_location("http://127.0.0.1:8642"), "container")
        self.assertEqual(endpoint_location("http://localhost:8642"), "container")
        self.assertEqual(endpoint_location("http://host.docker.internal:8642"), "host")
        self.assertEqual(endpoint_location("https://runtime.example.test"), "custom")

    def test_auto_prefers_configured_then_declared_fallbacks_without_duplicates(self):
        rows = build_endpoint_candidates(
            configured_url="http://127.0.0.1:8642/",
            mode="auto",
            defaults=DEFAULTS,
        )
        self.assertEqual([item.url for item in rows], [
            "http://127.0.0.1:8642",
            "http://host.docker.internal:8642",
        ])

    def test_auto_mirrors_the_configured_port_and_path_across_local_locations(self):
        rows = build_endpoint_candidates(
            configured_url="http://127.0.0.1:9020/hermes",
            mode="auto",
            defaults=DEFAULTS,
        )
        self.assertEqual([item.url for item in rows], [
            "http://127.0.0.1:9020/hermes",
            "http://host.docker.internal:9020/hermes",
        ])

    def test_explicit_modes_do_not_cross_locations(self):
        host = build_endpoint_candidates(mode="host", defaults=DEFAULTS)
        container = build_endpoint_candidates(mode="container", defaults=DEFAULTS)
        self.assertEqual([item.location for item in host], ["host"])
        self.assertEqual([item.location for item in container], ["container"])

    def test_explicit_modes_mirror_configured_port_and_path_to_selected_location(self):
        host = build_endpoint_candidates(
            configured_url="http://127.0.0.1:9020/hermes",
            mode="host",
            defaults=DEFAULTS,
        )
        container = build_endpoint_candidates(
            configured_url="http://host.docker.internal:9030/gateway",
            mode="container",
            defaults=DEFAULTS,
        )
        self.assertEqual([item.url for item in host], ["http://host.docker.internal:9020/hermes"])
        self.assertEqual([item.url for item in container], ["http://127.0.0.1:9030/gateway"])

    def test_custom_mode_never_adds_local_fallbacks(self):
        rows = build_endpoint_candidates(
            configured_url="https://runtime.example.test/api",
            mode="custom",
            defaults=DEFAULTS,
        )
        self.assertEqual(len(rows), 1)
        self.assertEqual(rows[0].location, "custom")

    def test_url_validation_rejects_credentials_and_wrong_protocol(self):
        with self.assertRaises(ValueError):
            normalize_endpoint_url("file:///tmp/service", ("http", "https"))
        with self.assertRaises(ValueError):
            normalize_endpoint_url("http://user:secret@127.0.0.1:8642", ("http", "https"))


class EndpointResolverTests(unittest.TestCase):
    def test_unreachable_candidate_falls_back_and_selects_exactly_one(self):
        calls = []

        def probe(url):
            calls.append(url)
            if "host.docker.internal" in url:
                raise ConnectionRefusedError("not listening")
            return {"ok": True, "version": "test"}

        result = EndpointResolver(cache_ttl_sec=0).resolve(
            cache_key="hermes:default",
            mode="auto",
            defaults=DEFAULTS,
            probe=probe,
        )
        self.assertTrue(result["ok"])
        self.assertEqual(result["endpoint"]["location"], "container")
        self.assertEqual(calls, ["http://host.docker.internal:8642", "http://127.0.0.1:8642"])

    def test_authentication_failure_is_terminal_and_never_bypassed(self):
        calls = []

        def probe(url):
            calls.append(url)
            error = urllib.error.HTTPError(url, 401, "Unauthorized", {}, io.BytesIO(b""))
            try:
                raise error
            finally:
                error.close()

        result = EndpointResolver(cache_ttl_sec=0).resolve(
            cache_key="hermes:default",
            mode="auto",
            defaults=DEFAULTS,
            probe=probe,
        )
        self.assertFalse(result["ok"])
        self.assertTrue(result["terminal"])
        self.assertEqual(result["code"], "endpoint_authentication_failed")
        self.assertEqual(calls, ["http://host.docker.internal:8642"])

    def test_protocol_mismatch_is_terminal(self):
        calls = []

        def probe(url):
            calls.append(url)
            return {
                "ok": False,
                "failureKind": "incompatible",
                "code": "missing_capabilities",
                "error": "Required streaming capability is missing",
            }

        result = EndpointResolver(cache_ttl_sec=0).resolve(
            cache_key="hermes:default",
            mode="auto",
            defaults=DEFAULTS,
            probe=probe,
        )
        self.assertFalse(result["ok"])
        self.assertEqual(calls, ["http://host.docker.internal:8642"])

    def test_cached_endpoint_is_rechecked_first_but_can_fail_over_before_a_run(self):
        now = [10.0]
        resolver = EndpointResolver(cache_ttl_sec=30, clock=lambda: now[0])
        first = resolver.resolve(
            cache_key="hermes:default",
            mode="auto",
            defaults=DEFAULTS,
            probe=lambda url: {"ok": "127.0.0.1" in url},
        )
        self.assertEqual(first["endpoint"]["location"], "container")
        calls = []

        def second_probe(url):
            calls.append(url)
            return {"ok": "host.docker.internal" in url}

        second = resolver.resolve(
            cache_key="hermes:default",
            mode="auto",
            defaults=DEFAULTS,
            probe=second_probe,
        )
        self.assertEqual(calls, ["http://127.0.0.1:8642", "http://host.docker.internal:8642"])
        self.assertEqual(second["endpoint"]["location"], "host")


class _HermesHandler(http.server.BaseHTTPRequestHandler):
    expected_token = "test-key"
    paths = []
    submissions = []
    sessions = {
        "session-one": {
            "id": "session-one", "title": "First session", "preview": "Hello",
            "last_active": 1786340000, "message_count": 2, "model": "test-model",
        },
    }
    messages = {
        "session-one": [
            {"id": "m1", "session_id": "session-one", "role": "user", "content": "Hello", "timestamp": 1786339999},
            {"id": "m2", "session_id": "session-one", "role": "assistant", "content": "Hi", "timestamp": 1786340000},
        ],
    }
    state_lock = threading.Lock()

    def do_GET(self):  # noqa: N802
        type(self).paths.append(self.path)
        if self.headers.get("Authorization") != f"Bearer {self.expected_token}":
            self.send_response(401)
            self.end_headers()
            return
        if self.path == "/health":
            payload = {"status": "healthy"}
        elif self.path == "/v1/capabilities":
            payload = {
                "model": "test-model",
                "features": {
                    "run_submission": True, "run_events_sse": True,
                    "session_resources": True, "skills_api": True,
                },
                "endpoints": {
                    "models": {"method": "GET", "path": "/v1/models"},
                    "skills": {"method": "GET", "path": "/v1/skills"},
                    "sessions": {"method": "GET", "path": "/api/sessions"},
                    "session_create": {"method": "POST", "path": "/api/sessions"},
                    "session_delete": {"method": "DELETE", "path": "/api/sessions/{session_id}"},
                    "session_messages": {"method": "GET", "path": "/api/sessions/{session_id}/messages"},
                },
            }
        elif self.path == "/v1/models":
            payload = {"object": "list", "data": [{"id": "test-model", "object": "model"}]}
        elif self.path == "/v1/skills":
            payload = {"object": "list", "data": [{"name": "research", "description": "Research sources", "category": "work"}]}
        elif self.path.startswith("/api/sessions?"):
            with self.state_lock:
                rows = list(self.sessions.values())
            payload = {"object": "list", "data": rows, "has_more": False}
        elif self.path.startswith("/api/sessions/") and self.path.endswith("/messages?limit=500&offset=0&order=oldest"):
            session_id = self.path.split("/", 4)[3]
            with self.state_lock:
                rows = list(self.messages.get(session_id, []))
            payload = {"object": "list", "session_id": session_id, "data": rows}
        elif self.path == "/v1/runs/run-integration/events":
            body = (
                'event: message.delta\ndata: {"event":"message.delta","delta":"Hello"}\n\n'
                'event: run.completed\ndata: {"event":"run.completed","output":"Hello"}\n\n'
            ).encode("utf-8")
            self.send_response(200)
            self.send_header("Content-Type", "text/event-stream")
            self.send_header("Content-Length", str(len(body)))
            self.end_headers()
            self.wfile.write(body)
            return
        else:
            self.send_response(404)
            self.end_headers()
            return
        body = json.dumps(payload).encode("utf-8")
        self.send_response(200)
        self.send_header("Content-Type", "application/json")
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def do_POST(self):  # noqa: N802
        type(self).paths.append(self.path)
        if self.headers.get("Authorization") != f"Bearer {self.expected_token}":
            self.send_response(401)
            self.end_headers()
            return
        if self.path == "/api/sessions":
            length = int(self.headers.get("Content-Length") or 0)
            payload = json.loads(self.rfile.read(length).decode("utf-8"))
            session_id = payload.get("session_id") or "session-created"
            session = {"id": session_id, "title": payload.get("title") or "", "last_active": 1786340001}
            with self.state_lock:
                self.sessions[session_id] = session
                self.messages.setdefault(session_id, [])
            body = json.dumps({"object": "hermes.session", "session": session}).encode("utf-8")
            self.send_response(201)
            self.send_header("Content-Type", "application/json")
            self.send_header("Content-Length", str(len(body)))
            self.end_headers()
            self.wfile.write(body)
            return
        if self.path != "/v1/runs":
            self.send_response(404)
            self.end_headers()
            return
        length = int(self.headers.get("Content-Length") or 0)
        payload = json.loads(self.rfile.read(length).decode("utf-8"))
        type(self).submissions.append(payload)
        body = json.dumps({"run_id": "run-integration"}).encode("utf-8")
        self.send_response(200)
        self.send_header("Content-Type", "application/json")
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def do_DELETE(self):  # noqa: N802
        type(self).paths.append(self.path)
        if self.headers.get("Authorization") != f"Bearer {self.expected_token}":
            self.send_response(401)
            self.end_headers()
            return
        if not self.path.startswith("/api/sessions/"):
            self.send_response(404)
            self.end_headers()
            return
        session_id = self.path.rsplit("/", 1)[-1]
        with self.state_lock:
            deleted = self.sessions.pop(session_id, None) is not None
            self.messages.pop(session_id, None)
        body = json.dumps({"object": "hermes.session.deleted", "id": session_id, "deleted": deleted}).encode("utf-8")
        self.send_response(200)
        self.send_header("Content-Type", "application/json")
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def log_message(self, _format, *_args):
        return


class HermesEndpointIntegrationTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.server = http.server.ThreadingHTTPServer(("127.0.0.1", 0), _HermesHandler)
        cls.thread = threading.Thread(target=cls.server.serve_forever, daemon=True)
        cls.thread.start()
        cls.url = f"http://127.0.0.1:{cls.server.server_port}"

    @classmethod
    def tearDownClass(cls):
        cls.server.shutdown()
        cls.server.server_close()
        cls.thread.join(timeout=2)

    def setUp(self):
        _HermesHandler.paths = []
        _HermesHandler.submissions = []
        _HermesHandler.sessions = {
            "session-one": {
                "id": "session-one", "title": "First session", "preview": "Hello",
                "last_active": 1786340000, "message_count": 2, "model": "test-model",
            },
        }
        _HermesHandler.messages = {
            "session-one": [
                {"id": "m1", "session_id": "session-one", "role": "user", "content": "Hello", "timestamp": 1786339999},
                {"id": "m2", "session_id": "session-one", "role": "assistant", "content": "Hi", "timestamp": 1786340000},
            ],
        }

    def _probe(self, key):
        def probe(url):
            client = HermesApiClient(base_url=url, api_key=key, timeout_sec=2)
            health = client.health()
            capabilities = client.capabilities()
            features = capabilities.get("features") or {}
            return {"ok": health.get("status") == "healthy" and features.get("run_submission") and features.get("run_events_sse")}
        return probe

    def test_real_authenticated_health_and_capability_probe(self):
        result = EndpointResolver(cache_ttl_sec=0).resolve(
            cache_key="hermes:integration",
            configured_url=self.url,
            mode="container",
            defaults=DEFAULTS,
            probe=self._probe("test-key"),
        )
        self.assertTrue(result["ok"])
        self.assertEqual(_HermesHandler.paths, ["/health", "/v1/capabilities"])

    def test_real_authentication_failure_stops_before_any_fallback(self):
        result = EndpointResolver(cache_ttl_sec=0).resolve(
            cache_key="hermes:integration",
            configured_url=self.url,
            mode="auto",
            defaults=DEFAULTS,
            probe=self._probe("wrong-key"),
        )
        self.assertFalse(result["ok"])
        self.assertEqual(result["code"], "endpoint_authentication_failed")
        self.assertEqual(_HermesHandler.paths, ["/health"])

    def test_real_run_submission_and_sse_use_the_single_resolved_endpoint(self):
        resolution = EndpointResolver(cache_ttl_sec=0).resolve(
            cache_key="hermes:run",
            configured_url=self.url,
            mode="container",
            defaults=DEFAULTS,
            probe=self._probe("test-key"),
        )
        self.assertTrue(resolution["ok"])
        client = HermesApiClient(base_url=resolution["endpoint"]["url"], api_key="test-key", timeout_sec=2)
        history = [
            {"role": "user", "content": "Remember cobalt."},
            {"role": "assistant", "content": "I will remember cobalt."},
        ]
        started = client.start_run("Say hello", session_id="session-one", conversation_history=history)
        events = list(client.stream_run_events(started["run_id"], timeout_sec=2))
        self.assertEqual([{
            "input": "Say hello",
            "session_id": "session-one",
            "conversation_history": history,
        }], _HermesHandler.submissions)
        self.assertEqual(["message.delta", "run.completed"], [item["event"] for item in events])

    def test_authenticated_discovery_sessions_models_and_skills(self):
        client = HermesApiClient(base_url=self.url, api_key="test-key", timeout_sec=2)
        self.assertEqual("test-model", client.models()["data"][0]["id"])
        self.assertEqual("research", client.skills()["data"][0]["name"])
        self.assertEqual("session-one", client.list_sessions(limit=40)["data"][0]["id"])
        self.assertEqual(["Hello", "Hi"], [row["content"] for row in client.session_messages("session-one")["data"]])

        created = client.create_session(session_id="session-two", title="Second session")
        self.assertEqual("session-two", created["session"]["id"])
        self.assertTrue(client.delete_session("session-two")["deleted"])

    def test_multiplex_profile_prefix_is_preserved_for_every_api_route(self):
        client = HermesApiClient(base_url="https://hermes.example.test/p/coder", api_key="test-key")
        self.assertEqual("https://hermes.example.test/p/coder/v1/capabilities", client._url("/v1/capabilities"))
        self.assertEqual("https://hermes.example.test/p/coder/api/sessions/session-one", client._url("/api/sessions/session-one"))

    def test_read_only_api_discovery_handles_parallel_stress(self):
        def read_snapshot(_index):
            client = HermesApiClient(base_url=self.url, api_key="test-key", timeout_sec=3)
            return (
                client.capabilities()["model"],
                client.models()["data"][0]["id"],
                client.skills()["data"][0]["name"],
                client.list_sessions(limit=5)["data"][0]["id"],
            )

        with ThreadPoolExecutor(max_workers=20) as pool:
            results = list(pool.map(read_snapshot, range(100)))
        self.assertEqual(100, len(results))
        self.assertEqual({("test-model", "test-model", "research", "session-one")}, set(results))


if __name__ == "__main__":
    unittest.main()
