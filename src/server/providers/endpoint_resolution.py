"""Provider-neutral network endpoint selection for container deployments.

The resolver deliberately separates *where* a service runs from the operating
system hosting Docker.  Providers declare their valid endpoints and supply an
authenticated, read-only probe.  The resolver selects exactly one endpoint
before any run is submitted and never fans a request out to multiple targets.
"""

from __future__ import annotations

import socket
import threading
import time
import urllib.error
import urllib.parse
from dataclasses import dataclass
from typing import Any, Callable, Iterable


ENDPOINT_MODES = {"auto", "container", "host", "custom"}
LOCAL_HOSTS = {"127.0.0.1", "localhost", "::1"}
DOCKER_HOSTS = {"host.docker.internal"}
TERMINAL_FAILURE_KINDS = {"authentication", "authorization", "incompatible", "rejected"}


@dataclass(frozen=True)
class EndpointCandidate:
    """One declared, normalized endpoint candidate."""

    url: str
    location: str
    source: str
    label: str

    def as_dict(self) -> dict[str, str]:
        return {
            "url": self.url,
            "location": self.location,
            "source": self.source,
            "label": self.label,
        }


def endpoint_location(url: str) -> str:
    """Classify an endpoint by process location, never by host operating system."""
    try:
        host = (urllib.parse.urlparse(str(url or "")).hostname or "").lower()
    except ValueError:
        return "custom"
    if host in LOCAL_HOSTS:
        return "container"
    if host in DOCKER_HOSTS:
        return "host"
    return "custom"


def normalize_endpoint_url(url: str, allowed_schemes: Iterable[str]) -> str:
    value = str(url or "").strip().rstrip("/")
    if not value:
        raise ValueError("Endpoint URL is required")
    try:
        parsed = urllib.parse.urlparse(value)
        port = parsed.port
    except ValueError as exc:
        raise ValueError("Endpoint URL has an invalid port") from exc
    allowed = {str(item).lower() for item in allowed_schemes}
    if parsed.scheme.lower() not in allowed or not parsed.hostname:
        readable = "/".join(sorted(allowed))
        raise ValueError(f"Endpoint URL must use {readable} and include a host")
    if parsed.username or parsed.password:
        raise ValueError("Endpoint credentials must use the provider secret field, not the URL")
    if port is not None and not (1 <= port <= 65535):
        raise ValueError("Endpoint URL port must be between 1 and 65535")
    return value


def build_endpoint_candidates(
    *,
    configured_url: str = "",
    mode: str = "auto",
    defaults: Iterable[dict[str, Any]] = (),
    allowed_schemes: Iterable[str] = ("http", "https"),
) -> list[EndpointCandidate]:
    """Build an ordered, de-duplicated candidate list from a manifest transport.

    ``custom`` is intentionally exclusive.  The other explicit modes select
    only the declared location.  ``auto`` tries the configured/preferred URL
    first and then the remaining provider-declared defaults.
    """
    resolved_mode = str(mode or "auto").strip().lower()
    if resolved_mode not in ENDPOINT_MODES:
        raise ValueError(f"Unsupported endpoint mode: {resolved_mode}")

    declared: list[EndpointCandidate] = []
    for item in defaults:
        if not isinstance(item, dict):
            continue
        url = normalize_endpoint_url(item.get("url") or "", allowed_schemes)
        location = str(item.get("location") or endpoint_location(url)).strip().lower()
        if location not in {"container", "host", "custom"}:
            raise ValueError(f"Unsupported endpoint location: {location}")
        declared.append(EndpointCandidate(
            url=url,
            location=location,
            source="declared",
            label=str(item.get("label") or location.replace("-", " ").title()),
        ))

    configured: EndpointCandidate | None = None
    if str(configured_url or "").strip():
        url = normalize_endpoint_url(configured_url, allowed_schemes)
        location = endpoint_location(url)
        configured = EndpointCandidate(
            url=url,
            location=location,
            source="configured",
            label={
                "container": "Container local",
                "host": "Docker host",
                "custom": "Custom endpoint",
            }[location],
        )

    if configured is not None and resolved_mode in {"auto", "container", "host"} and configured.location in {"container", "host"}:
        preferred = urllib.parse.urlparse(configured.url)
        rebased = []
        for item in declared:
            if item.location not in {"container", "host"}:
                rebased.append(item)
                continue
            target = urllib.parse.urlparse(item.url)
            host = target.hostname or ""
            if ":" in host and not host.startswith("["):
                host = f"[{host}]"
            netloc = f"{host}:{preferred.port}" if preferred.port else host
            url = urllib.parse.urlunparse(preferred._replace(netloc=netloc))
            rebased.append(EndpointCandidate(url=url, location=item.location, source=item.source, label=item.label))
        declared = rebased

    if resolved_mode == "custom":
        if configured is None:
            raise ValueError("Custom endpoint mode requires an endpoint URL")
        return [configured]

    if resolved_mode in {"container", "host"}:
        selected: list[EndpointCandidate] = []
        if configured is not None and configured.location == resolved_mode:
            selected.append(configured)
        selected.extend(item for item in declared if item.location == resolved_mode)
    else:
        selected = ([configured] if configured is not None else []) + declared

    result: list[EndpointCandidate] = []
    seen: set[str] = set()
    for item in selected:
        key = item.url.casefold()
        if key in seen:
            continue
        seen.add(key)
        result.append(item)
    if not result:
        raise ValueError(f"No endpoints are declared for {resolved_mode} mode")
    return result


def classify_probe_exception(exc: Exception) -> dict[str, Any]:
    """Classify failures so authentication is never bypassed by fallback."""
    if isinstance(exc, urllib.error.HTTPError):
        status = int(getattr(exc, "code", 0) or 0)
        exc.close()
        if status == 401:
            return {"ok": False, "failureKind": "authentication", "code": "endpoint_authentication_failed", "error": "Endpoint authentication failed"}
        if status == 403:
            return {"ok": False, "failureKind": "authorization", "code": "endpoint_authorization_failed", "error": "Endpoint authorization failed"}
        if 400 <= status < 500:
            return {"ok": False, "failureKind": "rejected", "code": "endpoint_request_rejected", "error": f"Endpoint rejected the health probe (HTTP {status})"}
        return {"ok": False, "failureKind": "unreachable", "code": "endpoint_http_unavailable", "error": f"Endpoint health probe failed (HTTP {status})"}
    if isinstance(exc, (TimeoutError, socket.timeout)):
        return {"ok": False, "failureKind": "unreachable", "code": "endpoint_timeout", "error": "Endpoint health probe timed out"}
    if isinstance(exc, (urllib.error.URLError, ConnectionError, OSError)):
        return {"ok": False, "failureKind": "unreachable", "code": "endpoint_unreachable", "error": "Endpoint is unreachable"}
    return {"ok": False, "failureKind": "unreachable", "code": "endpoint_probe_failed", "error": str(exc)[:500] or "Endpoint health probe failed"}


class EndpointResolver:
    """Select one healthy endpoint using provider-supplied authenticated probes."""

    def __init__(self, *, cache_ttl_sec: float = 30.0, clock: Callable[[], float] | None = None) -> None:
        self.cache_ttl_sec = max(0.0, float(cache_ttl_sec))
        self.clock = clock or time.monotonic
        self._cache: dict[str, tuple[float, str]] = {}
        self._lock = threading.RLock()

    def invalidate(self, cache_key: str = "") -> None:
        with self._lock:
            if cache_key:
                self._cache.pop(str(cache_key), None)
            else:
                self._cache.clear()

    def resolve(
        self,
        *,
        cache_key: str,
        configured_url: str = "",
        mode: str = "auto",
        defaults: Iterable[dict[str, Any]] = (),
        allowed_schemes: Iterable[str] = ("http", "https"),
        probe: Callable[[str], dict[str, Any] | bool],
        force_probe: bool = False,
    ) -> dict[str, Any]:
        candidates = build_endpoint_candidates(
            configured_url=configured_url,
            mode=mode,
            defaults=defaults,
            allowed_schemes=allowed_schemes,
        )
        key = str(cache_key or "default")
        with self._lock:
            cached = self._cache.get(key)
        if cached and not force_probe and self.clock() - cached[0] <= self.cache_ttl_sec:
            cached_url = cached[1]
            candidates.sort(key=lambda item: 0 if item.url == cached_url else 1)

        attempts: list[dict[str, Any]] = []
        for candidate in candidates:
            try:
                raw = probe(candidate.url)
                outcome = dict(raw) if isinstance(raw, dict) else {"ok": bool(raw)}
            except Exception as exc:  # provider probes must never crash resolution
                outcome = classify_probe_exception(exc)
            ok = bool(outcome.get("ok"))
            failure_kind = str(outcome.get("failureKind") or ("" if ok else "unreachable"))
            attempt = {
                "location": candidate.location,
                "label": candidate.label,
                "ok": ok,
            }
            if not ok:
                attempt["code"] = str(outcome.get("code") or "endpoint_unavailable")
                attempt["error"] = str(outcome.get("error") or "Endpoint is unavailable")[:500]
            attempts.append(attempt)
            if ok:
                with self._lock:
                    self._cache[key] = (self.clock(), candidate.url)
                return {
                    "ok": True,
                    "mode": str(mode or "auto").lower(),
                    "endpoint": candidate.as_dict(),
                    "attempts": attempts,
                    "probe": {k: v for k, v in outcome.items() if k not in {"ok", "error", "failureKind"}},
                }
            if failure_kind in TERMINAL_FAILURE_KINDS:
                with self._lock:
                    self._cache.pop(key, None)
                return {
                    "ok": False,
                    "mode": str(mode or "auto").lower(),
                    "code": str(outcome.get("code") or "endpoint_rejected"),
                    "error": str(outcome.get("error") or "Endpoint rejected the health probe")[:500],
                    "attempts": attempts,
                    "terminal": True,
                }

        with self._lock:
            self._cache.pop(key, None)
        return {
            "ok": False,
            "mode": str(mode or "auto").lower(),
            "code": "no_healthy_endpoint",
            "error": "No configured provider endpoint passed its health check",
            "attempts": attempts,
            "terminal": False,
        }
