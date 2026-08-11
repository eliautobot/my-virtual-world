"""Reusable OpenClaw Gateway client for Virtual World's server-side proxy.

One process-level WebSocket carries concurrent RPC requests and Gateway events.
HTTP request threads submit work to a dedicated asyncio loop; browser SSE clients
subscribe to a fan-out queue.  Requests that may have reached the Gateway are
never replayed automatically after a disconnect.
"""

from __future__ import annotations

import asyncio
import concurrent.futures
import json
import queue
import threading
import time
import uuid
from collections.abc import Callable
from typing import Any


class GatewayClientError(RuntimeError):
    """Base error raised by the reusable Gateway client."""


class GatewayUnavailableError(GatewayClientError):
    """The client could not establish a ready Gateway connection in time."""


class GatewayDisconnectedError(GatewayClientError):
    """The Gateway disconnected after a request may have been transmitted."""


class GatewaySubscription:
    """Thread-safe event subscription owned by one downstream SSE request."""

    def __init__(self, owner: "OpenClawGatewayClient", subscription_id: str, events: queue.Queue):
        self._owner = owner
        self.id = subscription_id
        self.events = events
        self._closed = False

    def get(self, timeout: float | None = None) -> dict[str, Any]:
        return self.events.get(timeout=timeout)

    def close(self) -> None:
        if self._closed:
            return
        self._closed = True
        self._owner.unsubscribe(self.id)

    def __enter__(self) -> "GatewaySubscription":
        return self

    def __exit__(self, _exc_type, _exc, _traceback) -> None:
        self.close()


class OpenClawGatewayClient:
    """Long-lived, multiplexed OpenClaw Gateway connection.

    ``connection_factory`` is called only when a connection must be established
    or re-established.  It receives the current opaque configuration key and
    returns ``url``, ``token``, ``origin``, and optional public metadata.
    """

    def __init__(
        self,
        connection_factory: Callable[[Any], dict[str, Any]],
        connector: Callable[..., Any],
        *,
        max_size: int = 8 * 1024 * 1024,
        reconnect_min_sec: float = 0.25,
        reconnect_max_sec: float = 5.0,
        event_names: set[str] | None = None,
        logger: Callable[[str], None] | None = None,
    ) -> None:
        if connector is None:
            raise ValueError("Gateway websocket connector is required")
        self._connection_factory = connection_factory
        self._connector = connector
        self._max_size = max(1024 * 1024, int(max_size))
        self._reconnect_min_sec = max(0.01, float(reconnect_min_sec))
        self._reconnect_max_sec = max(self._reconnect_min_sec, float(reconnect_max_sec))
        self._event_names = event_names or {"chat", "agent", "session.message"}
        self._logger = logger or (lambda _message: None)

        self._lifecycle_lock = threading.RLock()
        self._subscriber_lock = threading.RLock()
        self._status_lock = threading.RLock()
        self._subscribers: dict[str, queue.Queue] = {}
        self._thread: threading.Thread | None = None
        self._loop: asyncio.AbstractEventLoop | None = None
        self._loop_ready = threading.Event()
        self._stopped = threading.Event()
        self._desired_config_key: Any = None

        # The fields below are mutated by the asyncio thread. Status readers use
        # ``_status_lock`` and never receive credentials or raw config keys.
        self._ready: asyncio.Event | None = None
        self._send_lock: asyncio.Lock | None = None
        self._websocket = None
        self._pending: dict[str, asyncio.Future] = {}
        self._connected_config_key: Any = None
        self._last_error = ""
        self._connected_at = 0.0
        self._connection_generation = 0
        self._endpoint_metadata: dict[str, Any] = {}
        self._connected = False

    def _set_desired_config_key(self, config_key: Any) -> bool:
        changed = False
        with self._lifecycle_lock:
            if self._desired_config_key != config_key:
                self._desired_config_key = config_key
                changed = True
        if changed and self._loop and self._loop.is_running():
            try:
                asyncio.run_coroutine_threadsafe(self._interrupt_for_config_change(), self._loop)
            except RuntimeError:
                pass
        return changed

    def start(self, config_key: Any) -> None:
        self._set_desired_config_key(config_key)
        with self._lifecycle_lock:
            if not (self._thread and self._thread.is_alive()):
                self._stopped.clear()
                self._loop_ready.clear()
                self._thread = threading.Thread(
                    target=self._thread_main,
                    name="vw-openclaw-gateway",
                    daemon=True,
                )
                self._thread.start()
        # Every simultaneous first caller waits for the same loop readiness;
        # only the caller that created the thread used to wait here.
        if not self._loop_ready.wait(timeout=5):
            raise GatewayUnavailableError("OpenClaw Gateway client thread did not start")

    def close(self, timeout: float = 5.0) -> None:
        self._stopped.set()
        loop = self._loop
        if loop and loop.is_running():
            try:
                future = asyncio.run_coroutine_threadsafe(self._shutdown_async(), loop)
                future.result(timeout=max(0.1, timeout))
            except Exception:
                pass
        thread = self._thread
        if thread and thread.is_alive() and thread is not threading.current_thread():
            thread.join(timeout=max(0.1, timeout))

    def request(
        self,
        method: str,
        params: dict[str, Any] | None = None,
        *,
        timeout: float = 20.0,
        config_key: Any = None,
    ) -> dict[str, Any]:
        timeout = max(0.1, float(timeout))
        self.start(config_key)
        loop = self._loop
        if not loop or not loop.is_running():
            raise GatewayUnavailableError("OpenClaw Gateway client is unavailable")
        future = asyncio.run_coroutine_threadsafe(
            self._request_async(str(method or ""), params or {}, timeout, config_key),
            loop,
        )
        try:
            return future.result(timeout=timeout + 1.0)
        except concurrent.futures.TimeoutError as exc:
            future.cancel()
            raise GatewayUnavailableError(f"Gateway request '{method}' timed out") from exc

    def subscribe(self, *, config_key: Any = None, max_events: int = 2048) -> GatewaySubscription:
        self.start(config_key)
        subscription_id = uuid.uuid4().hex
        events: queue.Queue = queue.Queue(maxsize=max(32, int(max_events)))
        with self._subscriber_lock:
            self._subscribers[subscription_id] = events
        status = self.status()
        if status["connected"]:
            self._queue_event(events, self._ready_event(status))
        return GatewaySubscription(self, subscription_id, events)

    def unsubscribe(self, subscription_id: str) -> None:
        with self._subscriber_lock:
            self._subscribers.pop(str(subscription_id), None)

    def status(self) -> dict[str, Any]:
        with self._status_lock:
            return {
                "connected": bool(self._connected),
                "connectedAt": self._connected_at,
                "generation": self._connection_generation,
                "pendingRequests": len(self._pending),
                "subscriberCount": len(self._subscribers),
                "lastError": self._last_error,
                **self._endpoint_metadata,
            }

    def _thread_main(self) -> None:
        loop = asyncio.new_event_loop()
        asyncio.set_event_loop(loop)
        self._loop = loop

        async def run() -> None:
            self._ready = asyncio.Event()
            self._send_lock = asyncio.Lock()
            # Set readiness only after the event loop is actually running. This
            # prevents simultaneous first requests from observing a loop object
            # in the tiny window before ``run_until_complete`` starts it.
            self._loop_ready.set()
            await self._connection_loop()

        try:
            loop.run_until_complete(run())
        finally:
            try:
                loop.run_until_complete(loop.shutdown_asyncgens())
            except Exception:
                pass
            loop.close()
            self._loop = None

    async def _connection_loop(self) -> None:
        backoff = self._reconnect_min_sec
        while not self._stopped.is_set():
            with self._lifecycle_lock:
                config_key = self._desired_config_key
            if config_key is None:
                await asyncio.sleep(0.05)
                continue
            was_connected = False
            try:
                settings = await asyncio.to_thread(self._connection_factory, config_key)
                if not isinstance(settings, dict) or not settings.get("url") or not settings.get("token"):
                    raise GatewayUnavailableError("Gateway connection settings are incomplete")
                with self._lifecycle_lock:
                    if config_key != self._desired_config_key:
                        continue
                await self._run_connection(config_key, settings)
                was_connected = True
                backoff = self._reconnect_min_sec
            except asyncio.CancelledError:
                break
            except Exception as exc:
                message = str(exc)[:500] or type(exc).__name__
                with self._status_lock:
                    was_connected = was_connected or self._connected
                    self._last_error = message
                if was_connected:
                    backoff = self._reconnect_min_sec
                self._mark_disconnected(message)
                if not self._stopped.is_set():
                    self._broadcast({"type": "proxy.error", "payload": {"message": message}})
                    self._logger(f"[openclaw-proxy] Gateway unavailable: {message}")
            if self._stopped.is_set():
                break
            await asyncio.sleep(backoff)
            backoff = min(self._reconnect_max_sec, backoff * 2)

    async def _run_connection(self, config_key: Any, settings: dict[str, Any]) -> None:
        connector_options = {
            "max_size": self._max_size,
            "additional_headers": {"Origin": str(settings.get("origin") or "http://127.0.0.1")},
            "close_timeout": 3,
        }
        async with self._connector(str(settings["url"]), **connector_options) as websocket:
            self._websocket = websocket
            await asyncio.wait_for(websocket.recv(), timeout=5)
            connect_id = f"vw-gateway-connect-{uuid.uuid4()}"
            await websocket.send(json.dumps({
                "type": "req",
                "id": connect_id,
                "method": "connect",
                "params": {
                    "minProtocol": 4,
                    "maxProtocol": 4,
                    "client": {
                        "id": "openclaw-control-ui",
                        "version": str(settings.get("clientVersion") or "unknown"),
                        "platform": "server",
                        "mode": "webchat",
                    },
                    "role": "operator",
                    "scopes": ["operator.read", "operator.write", "operator.admin"],
                    "caps": ["tool-events"],
                    "commands": [],
                    "permissions": {},
                    "auth": {"token": str(settings["token"])},
                    "locale": "en-US",
                    "userAgent": "virtual-world-server/gateway-client",
                },
            }))
            while True:
                response = json.loads(await asyncio.wait_for(websocket.recv(), timeout=10))
                if response.get("id") != connect_id:
                    continue
                if not response.get("ok"):
                    error = response.get("error") if isinstance(response.get("error"), dict) else {}
                    raise GatewayUnavailableError(error.get("message") or "Gateway authentication failed")
                break

            with self._lifecycle_lock:
                if config_key != self._desired_config_key:
                    await websocket.close(code=1000, reason="Gateway configuration changed")
                    return
            self._connected_config_key = config_key
            public_metadata = {
                key: value
                for key, value in settings.items()
                if key in {"transport", "endpointMode", "endpointLocation", "endpointLabel"}
            }
            with self._status_lock:
                self._connected = True
                self._connected_at = time.time()
                self._connection_generation += 1
                self._last_error = ""
                self._endpoint_metadata = public_metadata
                generation = self._connection_generation
            self._ready.set()
            self._logger(f"[openclaw-proxy] Gateway connection ready (generation {generation})")
            self._broadcast(self._ready_event(self.status()))

            try:
                async for raw in websocket:
                    try:
                        message = json.loads(raw)
                    except (TypeError, ValueError):
                        continue
                    message_type = message.get("type")
                    if message_type == "res":
                        pending = self._pending.pop(str(message.get("id") or ""), None)
                        if pending and not pending.done():
                            pending.set_result(message)
                    elif message_type == "event" and message.get("event") in self._event_names:
                        self._broadcast(message)
            finally:
                self._websocket = None
                if not self._stopped.is_set():
                    raise GatewayDisconnectedError("OpenClaw Gateway connection closed")

    async def _request_async(
        self,
        method: str,
        params: dict[str, Any],
        timeout: float,
        expected_config_key: Any,
    ) -> dict[str, Any]:
        if not method:
            raise ValueError("Gateway method is required")
        started = asyncio.get_running_loop().time()
        while True:
            with self._lifecycle_lock:
                desired = self._desired_config_key
            if desired != expected_config_key:
                raise GatewayUnavailableError("Gateway configuration changed before the request was sent")
            remaining = timeout - (asyncio.get_running_loop().time() - started)
            if remaining <= 0:
                error = self.status().get("lastError") or "Gateway connection timed out"
                raise GatewayUnavailableError(str(error))
            try:
                await asyncio.wait_for(self._ready.wait(), timeout=remaining)
            except asyncio.TimeoutError as exc:
                error = self.status().get("lastError") or "Gateway connection timed out"
                raise GatewayUnavailableError(str(error)) from exc
            if self._connected_config_key == expected_config_key and self._websocket is not None:
                break
            await asyncio.sleep(0)

        request_id = f"vw-gateway-{uuid.uuid4()}"
        response_future = asyncio.get_running_loop().create_future()
        self._pending[request_id] = response_future
        frame = {"type": "req", "id": request_id, "method": method, "params": params}
        try:
            async with self._send_lock:
                websocket = self._websocket
                if websocket is None:
                    raise GatewayDisconnectedError("Gateway disconnected before the request was sent")
                await websocket.send(json.dumps(frame))
            remaining = timeout - (asyncio.get_running_loop().time() - started)
            if remaining <= 0:
                raise asyncio.TimeoutError
            return await asyncio.wait_for(response_future, timeout=remaining)
        except asyncio.TimeoutError as exc:
            raise GatewayUnavailableError(f"Gateway request '{method}' timed out") from exc
        finally:
            pending = self._pending.pop(request_id, None)
            if pending and not pending.done():
                pending.cancel()

    async def _interrupt_for_config_change(self) -> None:
        websocket = self._websocket
        if websocket is not None:
            await websocket.close(code=1000, reason="Gateway configuration changed")

    async def _shutdown_async(self) -> None:
        self._stopped.set()
        websocket = self._websocket
        if websocket is not None:
            try:
                await websocket.close(code=1001, reason="Virtual World shutting down")
            except Exception:
                pass
        self._mark_disconnected("Virtual World Gateway client stopped")

    def _mark_disconnected(self, message: str) -> None:
        if self._ready:
            self._ready.clear()
        self._connected_config_key = None
        with self._status_lock:
            self._connected = False
            if message:
                self._last_error = str(message)[:500]
        error = GatewayDisconnectedError(
            "Gateway disconnected while awaiting a response; the request was not replayed"
        )
        pending = list(self._pending.values())
        self._pending.clear()
        for future in pending:
            if not future.done():
                future.set_exception(error)

    def _ready_event(self, status: dict[str, Any]) -> dict[str, Any]:
        return {
            "type": "proxy.ready",
            "payload": {
                "transport": "server-proxy",
                "generation": status.get("generation") or 0,
            },
        }

    def _broadcast(self, event: dict[str, Any]) -> None:
        with self._subscriber_lock:
            subscribers = list(self._subscribers.values())
        for events in subscribers:
            self._queue_event(events, event)

    @staticmethod
    def _queue_event(events: queue.Queue, event: dict[str, Any]) -> None:
        try:
            events.put_nowait(event)
            return
        except queue.Full:
            pass
        # A stalled browser must not block the Gateway receiver. Drop the oldest
        # event; the browser's existing final/history reconciliation repairs it.
        try:
            events.get_nowait()
        except queue.Empty:
            pass
        try:
            events.put_nowait(event)
        except queue.Full:
            pass
