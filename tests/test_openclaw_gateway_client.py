#!/usr/bin/env python3
"""Concurrency, event fan-out, and reconnect tests for the Gateway client."""

from __future__ import annotations

import asyncio
import concurrent.futures
import json
import os
import sys
import threading
import time
import unittest

from websockets.asyncio.client import connect
from websockets.asyncio.server import serve


SERVER_DIR = os.path.abspath(os.path.join(os.path.dirname(__file__), "..", "src", "server"))
if SERVER_DIR not in sys.path:
    sys.path.insert(0, SERVER_DIR)

from openclaw_gateway_client import (  # noqa: E402
    GatewayDisconnectedError,
    OpenClawGatewayClient,
)


class FakeGateway:
    def __init__(self) -> None:
        self.connection_count = 0
        self.requests: list[dict] = []
        self._state_lock = threading.RLock()
        self._loop = None
        self._server = None
        self._thread = None
        self._ready = threading.Event()
        self.port = 0

    async def _handler(self, websocket) -> None:
        with self._state_lock:
            self.connection_count += 1
        await websocket.send(json.dumps({
            "type": "event",
            "event": "connect.challenge",
            "payload": {"nonce": "test"},
        }))
        connect_frame = json.loads(await websocket.recv())
        if connect_frame.get("method") != "connect":
            await websocket.close(code=1002, reason="connect required")
            return
        token = ((connect_frame.get("params") or {}).get("auth") or {}).get("token")
        if token != "test-token":
            await websocket.send(json.dumps({
                "type": "res",
                "id": connect_frame.get("id"),
                "ok": False,
                "error": {"message": "invalid token"},
            }))
            return
        await websocket.send(json.dumps({
            "type": "res",
            "id": connect_frame.get("id"),
            "ok": True,
            "payload": {"protocol": 4},
        }))

        send_lock = asyncio.Lock()
        response_tasks: set[asyncio.Task] = set()

        async def respond(frame: dict) -> None:
            method = frame.get("method")
            params = frame.get("params") or {}
            delay_ms = max(0, int(params.get("delayMs") or 0))
            if delay_ms:
                await asyncio.sleep(delay_ms / 1000)
            if method == "test.drop":
                await websocket.close(code=1011, reason="forced test disconnect")
                return
            async with send_lock:
                if method == "test.emit":
                    await websocket.send(json.dumps({
                        "type": "event",
                        "event": "agent",
                        "payload": {
                            "runId": params.get("runId"),
                            "sessionKey": params.get("sessionKey"),
                            "stream": "tool",
                            "data": {"phase": "start", "name": "read"},
                        },
                    }))
                await websocket.send(json.dumps({
                    "type": "res",
                    "id": frame.get("id"),
                    "ok": True,
                    "payload": {"method": method, "echo": params},
                }))

        try:
            try:
                async for raw in websocket:
                    frame = json.loads(raw)
                    if frame.get("type") != "req":
                        continue
                    with self._state_lock:
                        self.requests.append(frame)
                    task = asyncio.create_task(respond(frame))
                    response_tasks.add(task)
                    task.add_done_callback(response_tasks.discard)
            except Exception:
                # Forced-disconnect tests intentionally end the receive loop
                # with a non-normal close code.
                pass
        finally:
            if response_tasks:
                await asyncio.gather(*response_tasks, return_exceptions=True)

    def start(self) -> None:
        def run() -> None:
            loop = asyncio.new_event_loop()
            asyncio.set_event_loop(loop)
            self._loop = loop

            async def start_server() -> None:
                self._server = await serve(self._handler, "127.0.0.1", 0)
                self.port = self._server.sockets[0].getsockname()[1]
                self._ready.set()

            loop.run_until_complete(start_server())
            loop.run_forever()
            loop.run_until_complete(loop.shutdown_asyncgens())
            loop.close()

        self._thread = threading.Thread(target=run, name="fake-openclaw-gateway", daemon=True)
        self._thread.start()
        if not self._ready.wait(timeout=5):
            raise RuntimeError("Fake Gateway failed to start")

    def stop(self) -> None:
        if not self._loop or not self._server:
            return

        async def stop_server() -> None:
            self._server.close()
            await self._server.wait_closed()

        future = asyncio.run_coroutine_threadsafe(stop_server(), self._loop)
        future.result(timeout=5)
        self._loop.call_soon_threadsafe(self._loop.stop)
        if self._thread:
            self._thread.join(timeout=5)

    def request_count(self, method: str) -> int:
        with self._state_lock:
            return sum(1 for item in self.requests if item.get("method") == method)


class OpenClawGatewayClientTests(unittest.TestCase):
    def setUp(self) -> None:
        self.gateway = FakeGateway()
        self.gateway.start()
        self.client = OpenClawGatewayClient(
            lambda _key: {
                "url": f"ws://127.0.0.1:{self.gateway.port}",
                "token": "test-token",
                "origin": "http://127.0.0.1:8590",
                "clientVersion": "test",
                "endpointMode": "custom",
                "endpointLocation": "container",
            },
            connect,
            reconnect_min_sec=0.02,
            reconnect_max_sec=0.1,
        )
        self.config_key = ("custom", self.gateway.port, "credential-fingerprint")

    def tearDown(self) -> None:
        self.client.close()
        self.gateway.stop()

    def test_parallel_requests_share_one_connection_and_correlate_responses(self) -> None:
        count = 64

        def call(index: int) -> dict:
            return self.client.request(
                "test.echo",
                {"index": index, "delayMs": (count - index) % 11},
                timeout=5,
                config_key=self.config_key,
            )

        with concurrent.futures.ThreadPoolExecutor(max_workers=24) as pool:
            responses = list(pool.map(call, range(count)))

        self.assertEqual(self.gateway.connection_count, 1)
        self.assertEqual(self.gateway.request_count("test.echo"), count)
        self.assertEqual(
            sorted(response["payload"]["echo"]["index"] for response in responses),
            list(range(count)),
        )
        self.assertEqual(self.client.status()["pendingRequests"], 0)

    def test_gateway_events_are_fanned_out_to_multiple_browser_subscribers(self) -> None:
        first = self.client.subscribe(config_key=self.config_key)
        second = self.client.subscribe(config_key=self.config_key)
        try:
            self.assertEqual(first.get(timeout=3)["type"], "proxy.ready")
            self.assertEqual(second.get(timeout=3)["type"], "proxy.ready")
            response = self.client.request(
                "test.emit",
                {"runId": "run-1", "sessionKey": "agent:coder:main"},
                timeout=3,
                config_key=self.config_key,
            )
            self.assertTrue(response["ok"])
            first_event = first.get(timeout=3)
            second_event = second.get(timeout=3)
            self.assertEqual(first_event["event"], "agent")
            self.assertEqual(second_event, first_event)
            self.assertEqual(first_event["payload"]["runId"], "run-1")
        finally:
            first.close()
            second.close()

    def test_uncertain_request_is_not_replayed_after_reconnect(self) -> None:
        with self.assertRaises(GatewayDisconnectedError):
            self.client.request(
                "test.drop",
                {"idempotencyKey": "send-once"},
                timeout=3,
                config_key=self.config_key,
            )

        deadline = time.time() + 5
        while time.time() < deadline and self.client.status()["generation"] < 2:
            time.sleep(0.02)
        self.assertGreaterEqual(self.client.status()["generation"], 2)
        self.assertEqual(self.gateway.request_count("test.drop"), 1)

        response = self.client.request(
            "test.echo",
            {"afterReconnect": True},
            timeout=3,
            config_key=self.config_key,
        )
        self.assertTrue(response["ok"])
        self.assertEqual(self.gateway.request_count("test.drop"), 1)
        self.assertGreaterEqual(self.gateway.connection_count, 2)


if __name__ == "__main__":
    unittest.main(verbosity=2)
