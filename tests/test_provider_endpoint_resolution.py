#!/usr/bin/env python3

import pathlib
import sys
import unittest
import urllib.error
import io
import http.server
import json
import threading


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

    def do_GET(self):  # noqa: N802
        type(self).paths.append(self.path)
        if self.headers.get("Authorization") != f"Bearer {self.expected_token}":
            self.send_response(401)
            self.end_headers()
            return
        if self.path == "/health":
            payload = {"status": "healthy"}
        elif self.path == "/v1/capabilities":
            payload = {"model": "test-model", "features": {"run_submission": True, "run_events_sse": True}}
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
        started = client.start_run("Say hello", session_id="session-one")
        events = list(client.stream_run_events(started["run_id"], timeout_sec=2))
        self.assertEqual([{"input": "Say hello", "session_id": "session-one"}], _HermesHandler.submissions)
        self.assertEqual(["message.delta", "run.completed"], [item["event"] for item in events])


if __name__ == "__main__":
    unittest.main()
