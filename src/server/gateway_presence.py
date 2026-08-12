#!/usr/bin/env python3
"""Provider-neutral lifecycle presence coordinator.

All agent runtimes report the same small lifecycle vocabulary here. OpenClaw's
Gateway observer is one event source; Hermes, Codex, the Universal Provider SDK,
and extension providers call the public ``lifecycle_*`` functions directly.

Architecture:
  provider lifecycle events → shared in-memory coordinator → server.py APIs

The OpenClaw connection remains a read-only observer and never modifies the
Gateway.
"""

import asyncio
import json
import time
import threading
import traceback

try:
    import websockets
    from websockets.asyncio.client import connect as ws_connect
except ImportError:
    websockets = None


# ─── In-Memory Presence State ────────────────────────────────────

_state = {}        # agent_id → {state, task, updated, source}
_state_lock = threading.RLock()
_lifecycle_lock = threading.RLock()
_meetings = []     # Meetings still managed manually via office.py
_meetings_lock = threading.Lock()

# Manual overrides (from office.py or POST /api/presence) expire after this many seconds
MANUAL_OVERRIDE_TTL = 30

# How long after last activity before an agent is considered idle
IDLE_TIMEOUT_SEC = 120

# Rare bootstrap/fallback snapshot size. Do not poll sessions.list on an interval.
SESSIONS_BOOTSTRAP_LIMIT = 100

# Short grace period after a lifecycle end before showing idle, to avoid UI flicker.
FINISHING_GRACE_SEC = 12

# Safety net for missed lifecycle/chat/tool terminal events. Quiet long-running
# commands may not emit events for many minutes, so do not treat silence as idle.
ACTIVE_RUN_STALE_SEC = 6 * 60 * 60
ACTIVE_TOOL_STALE_SEC = 6 * 60 * 60
ACTIVE_APPROVAL_STALE_SEC = 6 * 60 * 60

# Track last known updatedAt per session key for change detection during rare snapshots
_last_updated_at = {}  # session_key → updatedAt timestamp (ms)

# Track real-time event activity per agent
_last_event_at = {}   # agent_id → timestamp (seconds)
_last_event_task = {}  # agent_id → task description from event
_run_agents = {}       # runId → agent_id
_active_runs_by_agent = {}  # agent_id → set(runId); while non-empty the agent is working
_active_run_last_seen = {}  # runId → timestamp (seconds)
_active_tools_by_agent = {}  # agent_id → set(toolCallId); while non-empty the agent is working
_active_tool_last_seen = {}  # toolCallId → timestamp (seconds)
_tool_runs = {}        # toolCallId → runId
_active_approvals_by_agent = {}  # agent_id → set(approvalId)
_active_approval_last_seen = {}  # approvalId → timestamp (seconds)
_approval_runs = {}    # approvalId → runId
_finish_idle_at = {}   # agent_id → timestamp (seconds)
_provider_health = {}  # agent_id → normalized provider connectivity record

# Manual override tracking
_manual_overrides = {}  # agent_id → {state, task, updated, expires}

# Gateway connection state
_gw_connected = False
_gw_error = None
_gw_origin = ""
_debug = {
    "connectedAt": 0,
    "lastEventAt": 0,
    "lastSnapshotAt": 0,
    "events": {},
    "snapshots": 0,
    "sessionListCalls": 0,
}


def get_state():
    """Return current presence state dict. Called by server.py for /status endpoint."""
    with _lifecycle_lock, _state_lock:
        result = {agent_id: _decorate_agent_snapshot(agent_id, value) for agent_id, value in _state.items()}
    with _meetings_lock:
        result["_meetings"] = list(_meetings)
    return result


def get_agent_state(agent_id):
    """Return state for a single agent."""
    with _lifecycle_lock, _state_lock:
        value = _state.get(agent_id, {"state": "idle", "task": "", "updated": 0})
        return _decorate_agent_snapshot(agent_id, value)


def get_provider_health(agent_id=None):
    """Return the provider-health plane without conflating it with task presence."""
    with _lifecycle_lock:
        if agent_id is not None:
            return dict(_provider_health.get(str(agent_id), {}))
        return {key: dict(value) for key, value in _provider_health.items()}


def _decorate_agent_snapshot(agent_id, value):
    snapshot = dict(value or {})
    snapshot["activeRunCount"] = len(_active_runs_by_agent.get(agent_id, ()))
    snapshot["activeToolCount"] = len(_active_tools_by_agent.get(agent_id, ()))
    snapshot["waitingApprovalCount"] = len(_active_approvals_by_agent.get(agent_id, ()))
    health = _provider_health.get(agent_id)
    if isinstance(health, dict):
        snapshot["providerHealth"] = dict(health)
    return snapshot


def set_manual_override(agent_id, state, task=""):
    """Set a manual override (from office.py or POST /api/presence).
    Takes priority over gateway-derived state for MANUAL_OVERRIDE_TTL seconds."""
    with _lifecycle_lock:
        now = int(time.time())
        _manual_overrides[agent_id] = {
            "state": state,
            "task": task,
            "updated": now,
            "expires": now + MANUAL_OVERRIDE_TTL
        }
        # Immediately apply to state. Active provider lifecycle state will still
        # supersede manual idle/offline values, while explicit meeting/break
        # states remain operator-owned.
        with _state_lock:
            if agent_id not in _state:
                _state[agent_id] = {}
            _state[agent_id].update({
                "state": state,
                "task": task,
                "updated": now,
                "source": "manual"
            })


def _note_provider_health(agent_id, connected, provider_kind="", connection_state="", error=""):
    if not agent_id:
        return
    now = int(time.time())
    previous = _provider_health.get(agent_id, {})
    _provider_health[agent_id] = {
        "connected": bool(connected),
        "connectionState": str(connection_state or ("connected" if connected else "offline")),
        "providerKind": str(provider_kind or previous.get("providerKind") or ""),
        "error": str(error or ""),
        "updated": now,
    }


def lifecycle_provider_connected(agent_id, provider_kind="", connection_state="connected"):
    """Record provider health without manufacturing task activity."""
    agent_id = str(agent_id or "").strip()
    if not agent_id:
        return
    with _lifecycle_lock:
        _ensure_agent(agent_id, "provider-health")
        _note_provider_health(agent_id, True, provider_kind, connection_state)
        with _state_lock:
            current = str(_state.get(agent_id, {}).get("state") or "")
        if current == "offline" and not _agent_has_active_activity(agent_id):
            _set_idle(agent_id, "provider-connected")


def lifecycle_provider_disconnected(agent_id, provider_kind="", connection_state="offline", error=""):
    """Make offline authoritative only when provider health reports a loss."""
    agent_id = str(agent_id or "").strip()
    if not agent_id:
        return
    with _lifecycle_lock:
        now = int(time.time())
        _ensure_agent(agent_id, "provider-health")
        _note_provider_health(agent_id, False, provider_kind, connection_state, error)
        _finish_idle_at.pop(agent_id, None)
        with _state_lock:
            _state[agent_id].update({
                "state": "offline",
                "task": "",
                "updated": now,
                "source": "provider-health",
            })


def lifecycle_run_started(agent_id, run_id, provider_kind="", task="Working"):
    agent_id = str(agent_id or "").strip()
    run_id = str(run_id or "").strip()
    if not agent_id or not run_id:
        return
    with _lifecycle_lock:
        _note_provider_health(agent_id, True, provider_kind)
        _set_working(agent_id, task or "Working", f"{provider_kind or 'provider'}-lifecycle", run_id)


def lifecycle_output_streaming(agent_id, run_id, provider_kind="", task="Responding"):
    lifecycle_run_started(agent_id, run_id, provider_kind, task or "Responding")


def lifecycle_tool_started(agent_id, run_id, tool_id, tool_name="", provider_kind="", task=""):
    agent_id = str(agent_id or "").strip()
    run_id = str(run_id or "").strip()
    tool_id = str(tool_id or "").strip()
    if not agent_id or not tool_id:
        return
    with _lifecycle_lock:
        _note_provider_health(agent_id, True, provider_kind)
        if run_id:
            _mark_run_active(agent_id, run_id)
            _tool_runs[tool_id] = run_id
        _mark_tool_active(agent_id, tool_id)
        label = task or (f"Using {tool_name}" if tool_name else "Using tool")
        _set_working(agent_id, label, f"{provider_kind or 'provider'}-tool", None)


def lifecycle_tool_updated(agent_id, run_id, tool_id, tool_name="", provider_kind="", task=""):
    lifecycle_tool_started(agent_id, run_id, tool_id, tool_name, provider_kind, task)


def lifecycle_tool_finished(agent_id, run_id, tool_id, provider_kind="", outcome="completed"):
    agent_id = str(agent_id or "").strip()
    tool_id = str(tool_id or "").strip()
    if not agent_id or not tool_id:
        return
    with _lifecycle_lock:
        _mark_tool_inactive(agent_id, tool_id)
        _tool_runs.pop(tool_id, None)
        if _agent_has_active_activity(agent_id):
            _set_working(agent_id, _last_event_task.get(agent_id) or "Working", f"{provider_kind or 'provider'}-tool", None)
        else:
            _set_finishing(agent_id, f"{provider_kind or 'provider'}-tool")


def lifecycle_approval_requested(agent_id, run_id, approval_id, provider_kind="", task="Waiting for approval"):
    agent_id = str(agent_id or "").strip()
    run_id = str(run_id or "").strip()
    approval_id = str(approval_id or "").strip()
    if not agent_id or not approval_id:
        return
    with _lifecycle_lock:
        _note_provider_health(agent_id, True, provider_kind)
        if run_id:
            _mark_run_active(agent_id, run_id)
            _approval_runs[approval_id] = run_id
        _active_approvals_by_agent.setdefault(agent_id, set()).add(approval_id)
        _active_approval_last_seen[approval_id] = time.time()
        _set_working(agent_id, task or "Waiting for approval", f"{provider_kind or 'provider'}-approval", None)


def lifecycle_approval_resolved(agent_id, run_id, approval_id, provider_kind="", outcome="resolved"):
    agent_id = str(agent_id or "").strip()
    approval_id = str(approval_id or "").strip()
    if not agent_id or not approval_id:
        return
    with _lifecycle_lock:
        approvals = _active_approvals_by_agent.get(agent_id)
        if approvals:
            approvals.discard(approval_id)
            if not approvals:
                _active_approvals_by_agent.pop(agent_id, None)
        _active_approval_last_seen.pop(approval_id, None)
        _approval_runs.pop(approval_id, None)
        if _agent_has_active_activity(agent_id):
            _set_working(agent_id, "Resuming work", f"{provider_kind or 'provider'}-approval", None)
        else:
            _set_finishing(agent_id, f"{provider_kind or 'provider'}-approval")


def _clear_run_children(agent_id, run_id):
    for tool_id, owner_run_id in list(_tool_runs.items()):
        if owner_run_id == run_id:
            _mark_tool_inactive(agent_id, tool_id)
            _tool_runs.pop(tool_id, None)
    for approval_id, owner_run_id in list(_approval_runs.items()):
        if owner_run_id == run_id:
            approvals = _active_approvals_by_agent.get(agent_id)
            if approvals:
                approvals.discard(approval_id)
                if not approvals:
                    _active_approvals_by_agent.pop(agent_id, None)
            _active_approval_last_seen.pop(approval_id, None)
            _approval_runs.pop(approval_id, None)


def lifecycle_run_finished(agent_id, run_id, provider_kind="", outcome="completed", error=""):
    """End a run as finishing/idle; a run error never means provider offline."""
    agent_id = str(agent_id or "").strip()
    run_id = str(run_id or "").strip()
    if not agent_id or not run_id:
        return
    with _lifecycle_lock:
        _clear_run_children(agent_id, run_id)
        _mark_run_inactive(agent_id, run_id)
        _run_agents.pop(run_id, None)
        _ensure_agent(agent_id)
        with _state_lock:
            _state[agent_id]["lastRunOutcome"] = str(outcome or "completed")
            _state[agent_id]["lastRunError"] = str(error or "")
            _state[agent_id]["lastRunId"] = run_id
            if provider_kind:
                _state[agent_id]["providerKind"] = str(provider_kind)
        _set_finishing(agent_id, f"{provider_kind or 'provider'}-lifecycle", None)


def set_meetings(meetings_list):
    """Replace meetings list (from office.py --meet/--end-meet)."""
    with _meetings_lock:
        _meetings.clear()
        _meetings.extend(meetings_list)


def get_meetings():
    """Get current meetings."""
    with _meetings_lock:
        return list(_meetings)


def add_meeting(meeting):
    """Add a meeting."""
    with _meetings_lock:
        # Remove existing with same id
        _meetings[:] = [m for m in _meetings if m.get("id") != meeting.get("id")]
        _meetings.append(meeting)


def end_meeting(meet_id):
    """End a meeting by id."""
    with _meetings_lock:
        before = len(_meetings)
        _meetings[:] = [m for m in _meetings if m.get("id") != meet_id]
        return len(_meetings) < before


def end_all_meetings():
    """End all meetings."""
    with _meetings_lock:
        _meetings.clear()


def get_connection_status():
    """Return coordinator and optional OpenClaw observer status."""
    with _lifecycle_lock, _state_lock:
        agents_cached = len([k for k in _state.keys() if not k.startswith("_")])
    return {
        "connected": _gw_connected,
        "coordinatorActive": bool(_maintenance_thread and _maintenance_thread.is_alive()),
        "error": _gw_error,
        "origin": _gw_origin,
        "agentsCached": agents_cached,
        "providerHealthCached": len(_provider_health),
        "debug": dict(_debug),
    }


def init_agents(agent_ids, prune=False):
    """Initialize state for discovered agents.

    When ``prune`` is true, treat ``agent_ids`` as the authoritative roster and
    remove state/tracking for agents that no longer exist. This keeps crash
    snapshots from retaining deleted agents indefinitely.
    """
    agent_ids = {str(agent_id) for agent_id in agent_ids if str(agent_id or "").strip()}
    with _lifecycle_lock:
        stale_agent_ids = set()
        with _state_lock:
            if prune:
                stale_agent_ids = set(_state) - agent_ids
                for agent_id in stale_agent_ids:
                    _state.pop(agent_id, None)
            for aid in agent_ids:
                if aid not in _state:
                    _state[aid] = {"state": "idle", "task": "", "updated": 0, "source": "init"}

        if not stale_agent_ids:
            return

        removed_run_ids = set()
        removed_tool_ids = set()
        removed_approval_ids = set()
        for agent_id in stale_agent_ids:
            removed_run_ids.update(_active_runs_by_agent.pop(agent_id, set()))
            removed_tool_ids.update(_active_tools_by_agent.pop(agent_id, set()))
            removed_approval_ids.update(_active_approvals_by_agent.pop(agent_id, set()))
            _last_event_at.pop(agent_id, None)
            _last_event_task.pop(agent_id, None)
            _finish_idle_at.pop(agent_id, None)
            _manual_overrides.pop(agent_id, None)
            _provider_health.pop(agent_id, None)
        for run_id, agent_id in list(_run_agents.items()):
            if agent_id in stale_agent_ids:
                removed_run_ids.add(run_id)
                _run_agents.pop(run_id, None)
        for run_id in removed_run_ids:
            _active_run_last_seen.pop(run_id, None)
        for tool_id in removed_tool_ids:
            _active_tool_last_seen.pop(tool_id, None)
            _tool_runs.pop(tool_id, None)
        for approval_id in removed_approval_ids:
            _active_approval_last_seen.pop(approval_id, None)
            _approval_runs.pop(approval_id, None)
        for session_key in list(_last_updated_at):
            if _extract_agent_id(session_key) in stale_agent_ids:
                _last_updated_at.pop(session_key, None)


# ─── Event Processing ────────────────────────────────────────────

def _extract_agent_id(session_key):
    """Extract agent_id from session key like 'agent:pq-mike:main'."""
    if not session_key or not str(session_key).startswith("agent:"):
        return None
    parts = str(session_key).split(":")
    if len(parts) >= 2:
        return parts[1]
    return None


def _note_event(event_type):
    _debug["lastEventAt"] = int(time.time())
    counts = _debug.setdefault("events", {})
    counts[event_type] = counts.get(event_type, 0) + 1


def _is_manual_override_active(agent_id, now=None):
    now = now or time.time()
    override = _manual_overrides.get(agent_id)
    if override and override["expires"] > now:
        return True
    if override and override["expires"] <= now:
        del _manual_overrides[agent_id]
        with _state_lock:
            if agent_id in _state and _state[agent_id].get("source") == "manual":
                _state[agent_id]["source"] = "manual-expired"
    return False


def _ensure_agent(agent_id, source="discovered"):
    if not agent_id:
        return
    with _state_lock:
        if agent_id not in _state:
            _state[agent_id] = {"state": "idle", "task": "", "updated": 0, "source": source}


def _mark_run_active(agent_id, run_id):
    if not agent_id or not run_id:
        return
    _run_agents[run_id] = agent_id
    _active_runs_by_agent.setdefault(agent_id, set()).add(run_id)
    _active_run_last_seen[run_id] = time.time()


def _mark_run_inactive(agent_id, run_id):
    if not agent_id or not run_id:
        return
    _active_run_last_seen.pop(run_id, None)
    runs = _active_runs_by_agent.get(agent_id)
    if runs:
        runs.discard(run_id)
        if not runs:
            _active_runs_by_agent.pop(agent_id, None)
    _run_agents.pop(run_id, None)


def _mark_tool_active(agent_id, tool_id):
    if not agent_id or not tool_id:
        return
    _active_tools_by_agent.setdefault(agent_id, set()).add(tool_id)
    _active_tool_last_seen[tool_id] = time.time()


def _mark_tool_inactive(agent_id, tool_id):
    if not agent_id or not tool_id:
        return
    _active_tool_last_seen.pop(tool_id, None)
    tools = _active_tools_by_agent.get(agent_id)
    if tools:
        tools.discard(tool_id)
        if not tools:
            _active_tools_by_agent.pop(agent_id, None)
    _tool_runs.pop(tool_id, None)


def _agent_has_active_activity(agent_id):
    runs = _active_runs_by_agent.get(agent_id)
    now = time.time()
    has_runs = False
    if runs:
        stale = {run_id for run_id in runs if now - _active_run_last_seen.get(run_id, 0) > ACTIVE_RUN_STALE_SEC}
        if stale:
            runs.difference_update(stale)
            for run_id in stale:
                _active_run_last_seen.pop(run_id, None)
                _run_agents.pop(run_id, None)
            if not runs:
                _active_runs_by_agent.pop(agent_id, None)
        has_runs = bool(runs)

    tools = _active_tools_by_agent.get(agent_id)
    has_tools = False
    if tools:
        stale = {tool_id for tool_id in tools if now - _active_tool_last_seen.get(tool_id, 0) > ACTIVE_TOOL_STALE_SEC}
        if stale:
            tools.difference_update(stale)
            for tool_id in stale:
                _active_tool_last_seen.pop(tool_id, None)
                _tool_runs.pop(tool_id, None)
            if not tools:
                _active_tools_by_agent.pop(agent_id, None)
        has_tools = bool(tools)

    approvals = _active_approvals_by_agent.get(agent_id)
    has_approvals = False
    if approvals:
        stale = {
            approval_id for approval_id in approvals
            if now - _active_approval_last_seen.get(approval_id, 0) > ACTIVE_APPROVAL_STALE_SEC
        }
        if stale:
            approvals.difference_update(stale)
            for approval_id in stale:
                _active_approval_last_seen.pop(approval_id, None)
                _approval_runs.pop(approval_id, None)
            if not approvals:
                _active_approvals_by_agent.pop(agent_id, None)
        has_approvals = bool(approvals)

    return has_runs or has_tools or has_approvals


def _agent_has_active_run(agent_id):
    return _agent_has_active_activity(agent_id)


def _set_working(agent_id, task="Working", source="gateway-event", run_id=None):
    if not agent_id:
        return
    now = time.time()
    _ensure_agent(agent_id)
    if run_id:
        _mark_run_active(agent_id, run_id)
    manual_active = _is_manual_override_active(agent_id)
    manual_state = str((_manual_overrides.get(agent_id) or {}).get("state") or "")
    if manual_active and manual_state in {"meeting", "break"}:
        return
    _last_event_at[agent_id] = now
    _last_event_task[agent_id] = task or "Working"
    _finish_idle_at.pop(agent_id, None)
    with _state_lock:
        _state[agent_id].update({
            "state": "working",
            "task": task or "Working",
            "updated": int(now),
            "source": source,
            **({"runId": run_id} if run_id else {})
        })


def _set_finishing(agent_id, source="gateway-lifecycle", run_id=None):
    if not agent_id:
        return
    now = time.time()
    _ensure_agent(agent_id)
    if run_id:
        _mark_run_inactive(agent_id, run_id)
    manual_active = _is_manual_override_active(agent_id)
    manual_state = str((_manual_overrides.get(agent_id) or {}).get("state") or "")
    if manual_active and manual_state in {"meeting", "break"}:
        return
    if _agent_has_active_run(agent_id):
        _set_working(agent_id, _last_event_task.get(agent_id) or "Working", source, None)
        return
    _last_event_at[agent_id] = now
    _finish_idle_at[agent_id] = now + FINISHING_GRACE_SEC
    with _state_lock:
        current_task = _state.get(agent_id, {}).get("task") or _last_event_task.get(agent_id, "")
        _state[agent_id].update({
            "state": "finishing",
            "task": current_task,
            "updated": int(now),
            "source": source,
            **({"runId": run_id} if run_id else {})
        })


def _set_idle(agent_id, source="gateway-idle"):
    if not agent_id or _is_manual_override_active(agent_id) or _agent_has_active_run(agent_id):
        return
    now = time.time()
    _ensure_agent(agent_id)
    _finish_idle_at.pop(agent_id, None)
    with _state_lock:
        _state[agent_id].update({
            "state": "idle",
            "task": "",
            "updated": int(now),
            "source": source
        })


def _format_tool_task(name, arguments):
    """Format a tool call into a human-readable task description."""
    args = arguments or {}
    if not isinstance(args, dict):
        args = {}
    if name == "exec":
        cmd = args.get("command", "")
        if "openclaw agent" in cmd:
            import re
            m_agent = re.search(r'--agent\s+(\S+)', cmd)
            m_msg = re.search(r'--message\s+"([^"]*)"', cmd)
            aname = m_agent.group(1) if m_agent else "agent"
            mtxt = m_msg.group(1)[:40] if m_msg else ""
            return f"Delegating to {aname}" + (f": {mtxt}" if mtxt else "")
        elif "office.py" in cmd:
            return None  # Ignore office.py calls (legacy)
        elif "outlook-cli" in cmd:
            return "Working with Outlook"
        elif "gog " in cmd:
            return "Working with Google"
        elif "curl" in cmd:
            return "Making HTTP request"
        return "Running command"
    elif name in ("sessions_send", "sessions_spawn"):
        label = args.get("label", args.get("sessionKey", args.get("agentId", "")))
        return f"Messaging {label}" if label else "Messaging agent"
    elif name == "web_search":
        q = args.get("query", "")[:40]
        return f"Searching: {q}" if q else "Web search"
    elif name == "web_fetch":
        return "Fetching web page"
    elif name == "browser":
        return "Using browser"
    elif name in ("read", "Read"):
        return "Reading file"
    elif name in ("write", "Write"):
        return "Writing file"
    elif name in ("edit", "Edit"):
        return "Editing file"
    elif name == "memory_search":
        return "Searching memory"
    elif name == "tts":
        return "Text to speech"
    elif name == "image":
        return "Analyzing image"
    elif name == "pdf":
        return "Analyzing PDF"
    return f"Using {name}" if name else "Working"


def _read_tool_name_and_args(data):
    if not isinstance(data, dict):
        return "", {}
    name = (
        data.get("name") or data.get("toolName") or data.get("tool") or
        data.get("command") or data.get("function") or data.get("recipient_name") or ""
    )
    args = data.get("arguments") or data.get("args") or data.get("input") or data.get("params") or {}
    # Some events carry a nested tool_call shape.
    if not name and isinstance(data.get("toolCall"), dict):
        tc = data.get("toolCall")
        name = tc.get("name") or tc.get("toolName") or ""
        args = tc.get("arguments") or tc.get("args") or args
    return str(name), args if isinstance(args, dict) else {}


def _read_tool_id(payload, data=None):
    data = data if isinstance(data, dict) else {}
    if not isinstance(payload, dict):
        payload = {}
    return (
        data.get("toolCallId") or data.get("tool_call_id") or data.get("callId") or data.get("id") or
        payload.get("toolCallId") or payload.get("tool_call_id") or payload.get("callId") or payload.get("id")
    )


def _process_event(event_type, payload):
    """Process a gateway event and update presence state.

    Supports current OpenClaw event frames:
      - agent: {runId, stream, sessionKey, data:{...}}
      - session.tool/session.message/sessions.changed: session-scoped events
      - presence: gateway/client/node presence, used only as a liveness signal
    """
    if not isinstance(payload, dict):
        return
    with _lifecycle_lock:
        _process_event_locked(event_type, payload)


def _process_event_locked(event_type, payload):
    _note_event(event_type)

    session_key = payload.get("sessionKey") or payload.get("key") or ""
    agent_id = _extract_agent_id(session_key)
    run_id = payload.get("runId") or payload.get("id")
    if run_id and not agent_id:
        agent_id = _run_agents.get(run_id)

    # Some payloads nest useful fields under data.
    data = payload.get("data") if isinstance(payload.get("data"), dict) else {}
    if not agent_id:
        agent_id = _extract_agent_id(data.get("sessionKey") or data.get("key") or "")
    if run_id and agent_id:
        _run_agents[run_id] = agent_id

    if event_type == "agent":
        stream = str(payload.get("stream") or data.get("stream") or payload.get("type") or "")
        phase = str(data.get("phase") or payload.get("phase") or "")

        if stream == "lifecycle" or phase:
            if phase in ("start", "accepted", "running"):
                _set_working(agent_id, "Working", "agent-lifecycle", run_id)
            elif phase in ("end", "done", "final", "complete", "completed", "error", "aborted", "cancelled", "canceled", "failed"):
                outcome = "completed" if phase in ("end", "done", "final", "complete", "completed") else phase
                lifecycle_run_finished(agent_id, run_id, "openclaw", outcome=outcome)
            else:
                _set_working(agent_id, "Working", "agent-lifecycle", run_id)
            return

        if stream in ("tool", "tool_start", "command_output", "approval", "plan", "patch", "item"):
            name, args = _read_tool_name_and_args(data or payload)
            task = _format_tool_task(name, args)
            if task is None:
                return
            tool_id = _read_tool_id(payload, data)
            if phase in ("result", "end", "done", "error", "aborted", "cancelled", "canceled", "failed"):
                _mark_tool_inactive(agent_id, tool_id)
                if _agent_has_active_activity(agent_id):
                    _set_working(agent_id, _last_event_task.get(agent_id) or task, f"agent-{stream}", run_id)
                else:
                    _set_finishing(agent_id, f"agent-{stream}", None)
            else:
                if tool_id:
                    _mark_tool_active(agent_id, tool_id)
                _set_working(agent_id, task, f"agent-{stream}", run_id)
            return

        # Any other agent stream means the run is alive.
        _set_working(agent_id, "Working", f"agent-{stream or 'event'}", run_id)
        return

    if event_type == "session.tool":
        name, args = _read_tool_name_and_args(payload)
        task = _format_tool_task(name, args)
        if task is None:
            return
        phase = str(payload.get("phase") or data.get("phase") or payload.get("status") or "")
        tool_id = _read_tool_id(payload, data)
        if phase in ("result", "end", "done", "error", "aborted", "cancelled", "canceled", "failed"):
            _mark_tool_inactive(agent_id, tool_id)
            if _agent_has_active_activity(agent_id):
                _set_working(agent_id, _last_event_task.get(agent_id) or task, "session-tool", run_id)
            else:
                _set_finishing(agent_id, "session-tool", None)
        else:
            if tool_id:
                _mark_tool_active(agent_id, tool_id)
            _set_working(agent_id, task, "session-tool", run_id)
        return

    if event_type == "session.message":
        role = payload.get("role") or data.get("role")
        if role == "assistant":
            # Assistant messages can appear between tool calls/stream phases. Do not
            # let them flip an actively running agent out of working state.
            if not _agent_has_active_activity(agent_id):
                _set_finishing(agent_id, "session-message", run_id)
        elif role == "user":
            _set_working(agent_id, "Responding", "session-message", run_id)
        return

    if event_type == "sessions.changed":
        reason = str(payload.get("reason") or "")
        if reason in ("run-started", "run_started", "created", "send", "message"):
            _set_working(agent_id, "Active", "sessions-changed", run_id)
        return

    if event_type == "chat":
        state_val = str(payload.get("state", ""))
        if state_val in ("delta", "streaming"):
            _set_working(agent_id, "Responding...", "chat", run_id)
        elif state_val in ("final", "done"):
            lifecycle_run_finished(agent_id, run_id, "openclaw", outcome="completed")


def _process_sessions_list(sessions):
    """Process a rare sessions.list snapshot for startup/reconnect recovery only."""
    with _lifecycle_lock:
        now = time.time()
        now_ms = now * 1000
        _debug["lastSnapshotAt"] = int(now)
        _debug["snapshots"] = _debug.get("snapshots", 0) + 1

        for s in sessions:
            if not isinstance(s, dict):
                continue
            key = s.get("key", "")
            if not str(key).startswith("agent:"):
                continue
            agent_id = _extract_agent_id(key)
            if not agent_id:
                continue
            _ensure_agent(agent_id, "snapshot")
            updated_at = s.get("updatedAt", 0) or s.get("lastMessageAt", 0) or 0
            _last_updated_at[key] = updated_at
            session_status = str(s.get("status") or "").lower()
            if session_status in ("done", "ended", "complete", "completed", "error", "aborted", "cancelled", "canceled", "failed"):
                _set_idle(agent_id, "snapshot-session-ended")
            elif updated_at and ((now_ms - updated_at) / 1000) < IDLE_TIMEOUT_SEC:
                _set_working(agent_id, _last_event_task.get(agent_id) or "Recently active", "snapshot")


def _maintenance_tick():
    """Expire finishing/working states without calling OpenClaw."""
    with _lifecycle_lock:
        now = time.time()
        _sync_meetings_from_file()

        # Expire manual overrides.
        for agent_id in list(_manual_overrides.keys()):
            _is_manual_override_active(agent_id, now)

        # finishing -> idle after grace.
        for agent_id, idle_at in list(_finish_idle_at.items()):
            if now >= idle_at:
                _set_idle(agent_id, "finish-grace-expired")

        # Quiet long-running tool calls are protected by active run/tool ids. If no
        # active run/tool remains, stale display states must age out so missed
        # terminal events do not leave agents stuck working.
        for agent_id, last_at in list(_last_event_at.items()):
            if now - last_at > IDLE_TIMEOUT_SEC:
                with _state_lock:
                    current = _state.get(agent_id, {}).get("state")
                if current in ("working", "finishing") and not _agent_has_active_activity(agent_id):
                    _set_idle(agent_id, "event-idle-timeout")

# ─── Meeting File Sync ────────────────────────────────────────────

_meetings_file = None  # Set by start() to STATUS_FILE path


def set_meetings_file(filepath):
    """Set the path to the status file that office.py writes meetings to."""
    global _meetings_file
    _meetings_file = filepath


def _sync_meetings_from_file():
    """Read _meetings from the status JSON file (written by office.py --meet)."""
    if not _meetings_file:
        return
    try:
        with open(_meetings_file, "r") as f:
            data = json.load(f)
        file_meetings = data.get("_meetings", [])
        if isinstance(file_meetings, list):
            with _meetings_lock:
                _meetings.clear()
                _meetings.extend(file_meetings)
    except (FileNotFoundError, json.JSONDecodeError):
        pass
    except Exception as e:
        print(f"⚠️  Gateway presence: meeting sync error: {e}")


# ─── Gateway Connection ──────────────────────────────────────────

async def _gateway_loop(gateway_url, gateway_token, origin, client_version="unknown"):
    """Main gateway connection loop with reconnection.
    
    Uses a single-reader architecture: one coroutine reads all WS messages
    and dispatches to event processing + routes responses to the poller.
    """
    global _gw_connected, _gw_error

    _consecutive_failures = 0
    _origin_tip_shown = False

    while True:
        try:
            _gw_connected = False
            _gw_error = None

            async with ws_connect(
                gateway_url,
                max_size=10 * 1024 * 1024,
                additional_headers={"Origin": origin},
                close_timeout=5,
            ) as ws:
                # Wait for challenge
                raw = await asyncio.wait_for(ws.recv(), timeout=10)
                msg = json.loads(raw)

                if msg.get("type") != "event" or msg.get("event") != "connect.challenge":
                    print(f"⚠️  Gateway presence: unexpected first message: {msg.get('type')}")
                    await asyncio.sleep(5)
                    continue

                # Send connect
                connect_msg = {
                    "type": "req",
                    "id": f"gp-connect-{int(time.time())}",
                    "method": "connect",
                    "params": {
                        "minProtocol": 4,
                        "maxProtocol": 4,
                        "client": {
                            "id": "openclaw-control-ui",
                            "version": client_version or "unknown",
                            "platform": "server",
                            "mode": "webchat"
                        },
                        "role": "operator",
                        "scopes": ["operator.read"],
                        "caps": [],
                        "commands": [],
                        "permissions": {},
                        "auth": {"token": gateway_token}
                    }
                }
                await ws.send(json.dumps(connect_msg))

                # Wait for connect response
                raw = await asyncio.wait_for(ws.recv(), timeout=10)
                res = json.loads(raw)
                if not res.get("ok"):
                    _gw_connected = False
                    err = res.get("error", {}).get("message", "unknown error")
                    _gw_error = err
                    _consecutive_failures += 1
                    should_log = (_consecutive_failures == 1 or _consecutive_failures % 10 == 0)
                    if should_log:
                        print(f"❌ Gateway presence: connect failed: {err} (attempt {_consecutive_failures})")
                    # Show one-time tip for origin not allowed
                    if not _origin_tip_shown and ("origin" in err.lower() or "not allowed" in err.lower()):
                        print("💡 Tip: Run the setup wizard or add your origin to gateway.controlUi.allowedOrigins in openclaw.json")
                        _origin_tip_shown = True
                    sleep_sec = min(60, 5 * (2 ** min(_consecutive_failures - 1, 4)))
                    await asyncio.sleep(sleep_sec)
                    continue

                # Successful connection — reset failure counter
                _consecutive_failures = 0
                _gw_connected = True
                _debug["connectedAt"] = int(time.time())
                print("✅ Gateway presence: connected")

                # Subscribe once; after this, presence is event-driven.
                await _send_subscriptions_and_snapshot(ws)

                tasks = [
                    asyncio.create_task(_message_reader(ws)),
                    asyncio.create_task(_ping_loop(ws)),
                ]
                done, pending = await asyncio.wait(tasks, return_when=asyncio.FIRST_COMPLETED)
                for task in pending:
                    task.cancel()
                if pending:
                    await asyncio.gather(*pending, return_exceptions=True)
                for task in done:
                    task.result()

        except asyncio.CancelledError:
            break
        except (ConnectionRefusedError, ConnectionResetError, OSError) as e:
            # Gateway not available — quiet retry, no traceback spam
            _gw_connected = False
            _gw_error = str(e)
            _consecutive_failures += 1
            should_log = (_consecutive_failures == 1 or _consecutive_failures % 10 == 0)
            if should_log:
                if "Connect call failed" in str(e) or "Connection refused" in str(e):
                    print(f"⚠️  Gateway presence: gateway not reachable at {gateway_url} (attempt {_consecutive_failures})")
                else:
                    print(f"⚠️  Gateway presence: connection error: {e} (attempt {_consecutive_failures})")
            sleep_sec = min(60, 5 * (2 ** min(_consecutive_failures - 1, 4)))
            await asyncio.sleep(sleep_sec)
        except Exception as e:
            _gw_connected = False
            _gw_error = str(e)
            _consecutive_failures += 1
            should_log = (_consecutive_failures == 1 or _consecutive_failures % 10 == 0)
            if should_log:
                print(f"⚠️  Gateway presence: error: {e} (attempt {_consecutive_failures})")
                traceback.print_exc()
            sleep_sec = min(60, 5 * (2 ** min(_consecutive_failures - 1, 4)))
            await asyncio.sleep(sleep_sec)


async def _send_subscriptions_and_snapshot(ws):
    """Subscribe to incremental events and request one bounded startup snapshot."""
    reqs = [
        {"type": "req", "id": "gp-sub-sessions", "method": "sessions.subscribe", "params": {}},
        {"type": "req", "id": "gp-presence", "method": "system-presence", "params": {}},
        {
            "type": "req",
            "id": "gp-snapshot-1",
            "method": "sessions.list",
            "params": {"limit": SESSIONS_BOOTSTRAP_LIMIT},
        },
    ]
    for req in reqs:
        if req["method"] == "sessions.list":
            _debug["sessionListCalls"] = _debug.get("sessionListCalls", 0) + 1
        await ws.send(json.dumps(req))


async def _message_reader(ws):
    """Single reader: reads all WS messages and dispatches events/responses."""
    global _gw_connected
    try:
        async for raw in ws:
            try:
                msg = json.loads(raw)
            except json.JSONDecodeError:
                continue

            msg_type = msg.get("type")

            if msg_type == "event":
                event = msg.get("event", "")
                payload = msg.get("payload", {})
                if event in ("chat", "agent", "session.message", "session.tool", "sessions.changed", "presence"):
                    _process_event(event, payload)

            elif msg_type == "res":
                req_id = str(msg.get("id") or "")
                if req_id.startswith("gp-snapshot") and msg.get("ok"):
                    payload = msg.get("payload") or {}
                    sessions = payload.get("sessions", []) if isinstance(payload, dict) else []
                    _process_sessions_list(sessions)
                elif req_id == "gp-presence" and msg.get("ok"):
                    _debug["lastSnapshotAt"] = int(time.time())

    except websockets.exceptions.ConnectionClosed:
        _gw_connected = False
        print("⚠️  Gateway presence: connection closed")
    except Exception as e:
        _gw_connected = False
        print(f"⚠️  Gateway presence: reader error: {e}")


async def _ping_loop(ws):
    """Keep connection alive."""
    try:
        while True:
            await asyncio.sleep(30)
            await ws.ping()
    except Exception:
        pass


# ─── Public Start/Stop ────────────────────────────────────────────

_thread = None
_loop = None
_maintenance_thread = None
_maintenance_stop = threading.Event()


def start_maintenance():
    """Start provider-neutral lifecycle maintenance without requiring OpenClaw."""
    global _maintenance_thread
    if _maintenance_thread and _maintenance_thread.is_alive():
        return
    _maintenance_stop.clear()

    def run():
        while not _maintenance_stop.wait(2):
            try:
                _maintenance_tick()
            except Exception as exc:
                print(f"⚠️  Presence coordinator maintenance error: {exc}")

    _maintenance_thread = threading.Thread(target=run, daemon=True, name="presence-coordinator")
    _maintenance_thread.start()


def stop_maintenance():
    """Stop maintenance. Intended for process shutdown and isolated tests."""
    global _maintenance_thread
    _maintenance_stop.set()
    thread = _maintenance_thread
    if thread and thread.is_alive() and thread is not threading.current_thread():
        thread.join(timeout=2.5)
    if not thread or not thread.is_alive():
        _maintenance_thread = None


def start(gateway_url, gateway_token, port=8590, client_version="unknown", origin=None):
    """Start the gateway presence listener in a background thread."""
    global _thread, _loop, _gw_origin

    start_maintenance()

    if websockets is None:
        print("⚠️  Gateway presence: websockets not installed, skipping")
        return

    if _thread and _thread.is_alive():
        print("⚠️  Gateway presence: already running")
        return

    _thread = None
    _loop = None
    origin = origin or f"http://127.0.0.1:{port}"
    _gw_origin = origin

    def run():
        global _loop
        loop = asyncio.new_event_loop()
        _loop = loop
        asyncio.set_event_loop(loop)
        try:
            loop.run_until_complete(_gateway_loop(gateway_url, gateway_token, origin, client_version))
        except RuntimeError as e:
            if "Event loop stopped" not in str(e):
                print(f"⚠️  Gateway presence: runtime error: {e}")
        except Exception as e:
            print(f"⚠️  Gateway presence: thread error: {e}")
        finally:
            # Clean up pending tasks
            try:
                if not loop.is_closed():
                    pending = asyncio.all_tasks(loop)
                    for task in pending:
                        task.cancel()
                    if pending:
                        loop.run_until_complete(asyncio.gather(*pending, return_exceptions=True))
                    loop.close()
            except Exception:
                pass
            if _loop is loop:
                _loop = None

    _thread = threading.Thread(target=run, daemon=True, name="gateway-presence")
    _thread.start()
    print(f"🔌 Gateway presence: started background listener → {gateway_url}")


def stop():
    """Stop the gateway presence listener."""
    global _thread, _loop, _gw_connected
    _gw_connected = False

    loop = _loop
    thread = _thread

    if loop and not loop.is_closed():
        try:
            loop.call_soon_threadsafe(loop.stop)
        except RuntimeError:
            pass

    if thread and thread.is_alive() and thread is not threading.current_thread():
        thread.join(timeout=2)

    if not thread or not thread.is_alive():
        _thread = None
    if not loop or loop.is_closed() or not thread or not thread.is_alive():
        _loop = None


# ─── Snapshot to Disk (for crash recovery) ────────────────────────

def save_snapshot(filepath):
    """Save current state to disk for crash recovery."""
    data = get_state()
    try:
        with open(filepath, "w") as f:
            json.dump(data, f, indent=2)
    except Exception as e:
        print(f"⚠️  Gateway presence: snapshot save error: {e}")


def load_snapshot(filepath, allowed_agent_ids=None):
    """Load state from disk snapshot (on startup).

    If ``allowed_agent_ids`` is provided, ignore records for agents outside the
    current roster. Old snapshots may otherwise resurrect deleted agents.
    """
    allowed = None
    if allowed_agent_ids is not None:
        allowed = {str(agent_id) for agent_id in allowed_agent_ids if str(agent_id or "").strip()}
    try:
        with open(filepath, "r") as f:
            data = json.load(f)
        with _state_lock:
            if allowed is not None:
                for key in set(_state) - allowed:
                    _state.pop(key, None)
            for key, val in data.items():
                if key == "_meetings":
                    with _meetings_lock:
                        _meetings.clear()
                        _meetings.extend(val if isinstance(val, list) else [])
                elif isinstance(val, dict) and (allowed is None or key in allowed):
                    # Reset to idle on load (we don't know if they're still working)
                    _state[key] = {
                        "state": "idle",
                        "task": "",
                        "updated": val.get("updated", 0),
                        "source": "snapshot"
                    }
        print(f"✅ Gateway presence: loaded snapshot from {filepath}")
    except FileNotFoundError:
        pass
    except Exception as e:
        print(f"⚠️  Gateway presence: snapshot load error: {e}")


def reset_state_for_tests():
    """Clear coordinator memory for deterministic isolated regression tests."""
    with _lifecycle_lock, _state_lock:
        _state.clear()
        _manual_overrides.clear()
        _last_updated_at.clear()
        _last_event_at.clear()
        _last_event_task.clear()
        _run_agents.clear()
        _active_runs_by_agent.clear()
        _active_run_last_seen.clear()
        _active_tools_by_agent.clear()
        _active_tool_last_seen.clear()
        _tool_runs.clear()
        _active_approvals_by_agent.clear()
        _active_approval_last_seen.clear()
        _approval_runs.clear()
        _finish_idle_at.clear()
        _provider_health.clear()
    with _meetings_lock:
        _meetings.clear()
