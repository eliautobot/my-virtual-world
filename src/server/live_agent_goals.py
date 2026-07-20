#!/usr/bin/env python3
"""Durable goal/task/step ledger for Live Agent Mode.

This module is intentionally pure state-machine code. It never executes a
world action or mutates world data directly; server.py remains the authority
for validated visible actions, persistence, and operator controls.
"""

from __future__ import annotations

import copy
import datetime as _datetime
import hashlib
import json
import re
import time


GOAL_SCHEMA_VERSION = "agent-live-mode-durable-goal/v1"
TASK_SCHEMA_VERSION = "agent-live-mode-durable-task/v1"
STEP_SCHEMA_VERSION = "agent-live-mode-durable-step/v1"
LEDGER_SCHEMA_VERSION = "agent-live-mode-goal-ledger/v1"

GOAL_STATUSES = {
    "pending", "active", "paused", "blocked", "completed", "failed",
    "cancelled", "superseded",
}
TASK_STATUSES = {
    "pending", "ready", "active", "retry_wait", "blocked", "completed",
    "failed", "cancelled", "skipped",
}
STEP_STATUSES = {
    "pending", "ready", "active", "retry_wait", "blocked", "completed",
    "failed", "cancelled", "skipped",
}
TERMINAL_GOAL_STATUSES = {"completed", "failed", "cancelled", "superseded"}
TERMINAL_TASK_STATUSES = {"completed", "failed", "cancelled", "skipped"}
TERMINAL_STEP_STATUSES = {"completed", "failed", "cancelled", "skipped"}
ACTIVE_GOAL_STATUSES = {"pending", "active", "paused", "blocked"}


def _now_iso() -> str:
    return time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime())


def _epoch(value) -> float:
    if isinstance(value, (int, float)):
        return float(value)
    if not isinstance(value, str) or not value.strip():
        return 0.0
    text = value.strip()
    try:
        return _datetime.datetime.fromisoformat(text.replace("Z", "+00:00")).timestamp()
    except (TypeError, ValueError, OverflowError):
        return 0.0


def _valid_iso(value, fallback=None):
    return value if _epoch(value) else fallback


def _clean(value, limit=320):
    text = str(value or "").strip()
    return text[:limit] if text else ""


def _status(value, allowed, fallback):
    candidate = str(value or fallback).strip().lower().replace("-", "_")
    return candidate if candidate in allowed else fallback


def _integer(value, fallback=0, minimum=0, maximum=100):
    try:
        number = int(value)
    except (TypeError, ValueError):
        number = int(fallback)
    return max(minimum, min(maximum, number))


def _number(value, fallback=0.0, minimum=0.0, maximum=1.0):
    try:
        number = float(value)
    except (TypeError, ValueError):
        number = float(fallback)
    return max(minimum, min(maximum, number))


def _slug(value, fallback="item"):
    token = re.sub(r"[^a-z0-9]+", "-", str(value or "").strip().lower()).strip("-")
    return (token[:64] or fallback)


def _text_list(value, limit=8, item_limit=420):
    if isinstance(value, str):
        value = [value]
    if not isinstance(value, list):
        return []
    rows = []
    for item in value[:limit]:
        if isinstance(item, dict):
            item = item.get("text") or item.get("label") or item.get("description") or item.get("criterion")
        text = _clean(item, item_limit)
        if text:
            rows.append(text)
    return rows


def _dict_copy(value):
    return copy.deepcopy(value) if isinstance(value, dict) else {}


def _history(value, limit=30):
    if not isinstance(value, list):
        return []
    return [copy.deepcopy(item) for item in value if isinstance(item, dict)][-limit:]


def _unique_id(prefix, *parts):
    basis = ":".join(str(part or "") for part in parts)
    return f"{prefix}-" + hashlib.sha1(basis.encode("utf-8", errors="ignore")).hexdigest()[:16]


def _normalize_retry(value, *, default_max=2):
    value = value if isinstance(value, dict) else {}
    retry = {
        "attempts": _integer(value.get("attempts"), 0, maximum=100),
        "maxRetries": _integer(value.get("maxRetries"), default_max, maximum=10),
        "retryDelaySec": _integer(value.get("retryDelaySec"), 30, maximum=3600),
    }
    next_retry = _valid_iso(value.get("nextRetryAt"))
    if next_retry:
        retry["nextRetryAt"] = next_retry
    if _clean(value.get("lastFailureReason"), 500):
        retry["lastFailureReason"] = _clean(value.get("lastFailureReason"), 500)
    return retry


def _normalize_step(raw, index, task_id, previous_step_id=None, now_iso=None):
    raw = raw if isinstance(raw, dict) else {"title": raw}
    now_iso = now_iso or _now_iso()
    title = _clean(raw.get("title") or raw.get("label") or raw.get("intent") or raw.get("description"), 320) or f"Step {index + 1}"
    step_id = _clean(raw.get("id"), 120) or f"{task_id}.step-{index + 1}-{_slug(title)}"
    if "dependsOn" in raw or "dependsOnStepIds" in raw:
        dependencies = raw.get("dependsOn") if "dependsOn" in raw else raw.get("dependsOnStepIds")
        dependencies = [_clean(item, 120) for item in (dependencies or []) if _clean(item, 120)] if isinstance(dependencies, list) else []
    else:
        dependencies = [previous_step_id] if previous_step_id else []
    normalized = {
        "schemaVersion": STEP_SCHEMA_VERSION,
        "id": step_id,
        "order": _integer(raw.get("order"), index, maximum=99),
        "title": title,
        "status": _status(raw.get("status"), STEP_STATUSES, "pending"),
        "dependsOn": list(dict.fromkeys(dependencies))[:12],
        "successCriteria": _text_list(raw.get("successCriteria") or raw.get("doneWhen"), limit=8),
        "failureCriteria": _text_list(raw.get("failureCriteria") or raw.get("watchFor"), limit=8),
        "successPostconditions": _text_list(
            raw.get("successPostconditions") or raw.get("successCriteria") or raw.get("doneWhen"), limit=8
        ),
        "failurePostconditions": _text_list(
            raw.get("failurePostconditions") or raw.get("failureCriteria") or raw.get("watchFor"), limit=8
        ),
        "retry": _normalize_retry(raw.get("retry"), default_max=_integer(raw.get("maxRetries"), 2, maximum=10)),
        "createdAt": _valid_iso(raw.get("createdAt"), now_iso),
        "updatedAt": _valid_iso(raw.get("updatedAt"), now_iso),
        "history": _history(raw.get("history"), limit=24),
    }
    for key, limit in (
        ("loopActionId", 120), ("actionType", 120), ("actionFamily", 120), ("actionId", 180),
        ("targetKey", 260), ("targetIdentity", 260), ("targetCriteria", 420), ("category", 120),
        ("evidenceDomain", 160),
        ("blockedReason", 500), ("failureReason", 500),
        ("operatorSummary", 700),
    ):
        value = _clean(raw.get(key), limit)
        if value:
            normalized[key] = value
    for key in ("startedAt", "settledAt", "completedAt", "failedAt"):
        value = _valid_iso(raw.get(key))
        if value:
            normalized[key] = value
    if isinstance(raw.get("target"), dict):
        normalized["target"] = copy.deepcopy(raw["target"])
    if isinstance(raw.get("outcome"), dict):
        normalized["outcome"] = copy.deepcopy(raw["outcome"])
    normalized["actionFamily"] = normalized.get("actionFamily") or normalized.get("loopActionId") or normalized.get("actionType") or "unassigned"
    normalized["targetIdentity"] = normalized.get("targetIdentity") or normalized.get("targetKey") or normalized.get("targetCriteria") or "unassigned"
    normalized["evidenceDomain"] = normalized.get("evidenceDomain") or normalized.get("category") or normalized.get("actionFamily") or "world-action"
    return normalized


def _normalize_task(raw, index, goal_id, previous_task_id=None, now_iso=None):
    raw = raw if isinstance(raw, dict) else {"title": raw}
    now_iso = now_iso or _now_iso()
    title = _clean(raw.get("title") or raw.get("label") or raw.get("description"), 320) or f"Task {index + 1}"
    task_id = _clean(raw.get("id"), 120) or f"{goal_id}.task-{index + 1}-{_slug(title)}"
    if "dependsOn" in raw or "dependsOnTaskIds" in raw:
        dependencies = raw.get("dependsOn") if "dependsOn" in raw else raw.get("dependsOnTaskIds")
        dependencies = [_clean(item, 120) for item in (dependencies or []) if _clean(item, 120)] if isinstance(dependencies, list) else []
    else:
        dependencies = [previous_task_id] if previous_task_id else []
    raw_steps = raw.get("steps") if isinstance(raw.get("steps"), list) else []
    if not raw_steps:
        raw_steps = [{
            "title": title,
            "loopActionId": raw.get("loopActionId") or raw.get("action"),
            "successCriteria": raw.get("successCriteria"),
            "maxRetries": raw.get("maxRetries"),
        }]
    steps = []
    previous_step_id = None
    for step_index, step in enumerate(raw_steps[:20]):
        normalized_step = _normalize_step(step, step_index, task_id, previous_step_id, now_iso)
        if normalized_step["id"] in {item["id"] for item in steps}:
            normalized_step["id"] = f"{normalized_step['id']}-{step_index + 1}"
        steps.append(normalized_step)
        previous_step_id = normalized_step["id"]
    normalized = {
        "schemaVersion": TASK_SCHEMA_VERSION,
        "id": task_id,
        "order": _integer(raw.get("order"), index, maximum=99),
        "title": title,
        "status": _status(raw.get("status"), TASK_STATUSES, "pending"),
        "dependsOn": list(dict.fromkeys(dependencies))[:12],
        "successCriteria": _text_list(raw.get("successCriteria") or raw.get("doneWhen"), limit=8),
        "retry": _normalize_retry(raw.get("retry"), default_max=_integer(raw.get("maxRetries"), 2, maximum=10)),
        "steps": steps,
        "createdAt": _valid_iso(raw.get("createdAt"), now_iso),
        "updatedAt": _valid_iso(raw.get("updatedAt"), now_iso),
        "history": _history(raw.get("history"), limit=24),
    }
    for key, limit in (("blockedReason", 500), ("failureReason", 500), ("operatorSummary", 700)):
        value = _clean(raw.get(key), limit)
        if value:
            normalized[key] = value
    for key in ("startedAt", "completedAt", "failedAt"):
        value = _valid_iso(raw.get(key))
        if value:
            normalized[key] = value
    if isinstance(raw.get("outcome"), dict):
        normalized["outcome"] = copy.deepcopy(raw["outcome"])
    return normalized


def normalize_goal(raw, *, agent_id=None, now_iso=None):
    if not isinstance(raw, dict):
        return None
    now_iso = now_iso or _now_iso()
    resolved_agent = _clean(raw.get("agentId") or agent_id, 120)
    title = _clean(raw.get("title") or raw.get("currentGoal") or raw.get("goal"), 500)
    if not title:
        return None
    created_at = _valid_iso(raw.get("createdAt"), now_iso)
    goal_id = _clean(raw.get("id"), 140) or _unique_id("goal", resolved_agent, title.lower())
    raw_tasks = raw.get("tasks") if isinstance(raw.get("tasks"), list) else []
    if not raw_tasks:
        legacy_steps = raw.get("steps") or raw.get("plan")
        if isinstance(legacy_steps, list) and legacy_steps:
            raw_tasks = [{"title": item if isinstance(item, str) else (item.get("title") or item.get("label") or item.get("intent") or f"Task {index + 1}"), "steps": [item] if isinstance(item, dict) else [{"title": item}]} for index, item in enumerate(legacy_steps)]
        elif raw.get("nextStep"):
            raw_tasks = [{"title": title, "steps": [raw.get("nextStep")]}]
    tasks = []
    previous_task_id = None
    for task_index, task in enumerate(raw_tasks[:16]):
        normalized_task = _normalize_task(task, task_index, goal_id, previous_task_id, now_iso)
        if normalized_task["id"] in {item["id"] for item in tasks}:
            normalized_task["id"] = f"{normalized_task['id']}-{task_index + 1}"
        tasks.append(normalized_task)
        previous_task_id = normalized_task["id"]
    normalized = {
        "schemaVersion": GOAL_SCHEMA_VERSION,
        "id": goal_id,
        "agentId": resolved_agent,
        "title": title,
        "description": _clean(raw.get("description"), 900),
        "status": _status(raw.get("status"), GOAL_STATUSES, "active"),
        "priority": _number(raw.get("priority"), 0.74, maximum=1.5),
        "source": _clean(raw.get("source"), 120) or "live-agent-planner",
        "successCriteria": _text_list(raw.get("successCriteria") or raw.get("doneWhen"), limit=12),
        "tasks": tasks,
        "revision": _integer(raw.get("revision"), 1, minimum=1, maximum=100000),
        "replanCount": _integer(raw.get("replanCount"), 0, maximum=10000),
        "replanRequired": bool(raw.get("replanRequired")),
        "createdAt": created_at,
        "updatedAt": _valid_iso(raw.get("updatedAt"), created_at),
        "history": _history(raw.get("history"), limit=40),
    }
    for key, limit in (
        ("currentTaskId", 140), ("currentStepId", 140), ("worldRevision", 100),
        ("worldTargetKey", 260), ("replanReason", 500), ("blockedReason", 500),
        ("failureReason", 500), ("operatorSummary", 900),
    ):
        value = _clean(raw.get(key), limit)
        if value:
            normalized[key] = value
    for key in ("activatedAt", "pausedAt", "completedAt", "failedAt", "cancelledAt", "lastReplannedAt", "lastWorldCheckAt"):
        value = _valid_iso(raw.get(key))
        if value:
            normalized[key] = value
    if isinstance(raw.get("outcome"), dict):
        normalized["outcome"] = copy.deepcopy(raw["outcome"])
    return recompute_goal(normalized, now_iso=now_iso)


def _dependency_state(items, dependency_ids):
    by_id = {item.get("id"): item for item in items if isinstance(item, dict)}
    missing = [item for item in dependency_ids if item not in by_id]
    failed = [item for item in dependency_ids if (by_id.get(item) or {}).get("status") in {"failed", "cancelled"}]
    waiting = [item for item in dependency_ids if (by_id.get(item) or {}).get("status") not in {"completed", "skipped"}]
    return missing, failed, waiting


def recompute_goal(goal, *, now_iso=None, now_epoch=None):
    goal = copy.deepcopy(goal) if isinstance(goal, dict) else {}
    if not goal:
        return goal
    now_iso = now_iso or _now_iso()
    now_epoch = float(now_epoch if now_epoch is not None else (_epoch(now_iso) or time.time()))
    tasks = sorted([item for item in goal.get("tasks") or [] if isinstance(item, dict)], key=lambda item: (item.get("order", 0), item.get("id", "")))
    task_by_id = {task.get("id"): task for task in tasks}
    current_task = None
    current_step = None
    for task in tasks:
        if task.get("status") in {"completed", "cancelled", "skipped"}:
            continue
        missing, failed, waiting = _dependency_state(tasks, task.get("dependsOn") or [])
        if missing or failed:
            task["status"] = "blocked"
            task["blockedReason"] = "missing task dependency" if missing else "task dependency failed"
            continue
        if waiting:
            if task.get("status") not in {"failed", "retry_wait"}:
                task["status"] = "pending"
            continue
        steps = sorted([item for item in task.get("steps") or [] if isinstance(item, dict)], key=lambda item: (item.get("order", 0), item.get("id", "")))
        task["steps"] = steps
        for step in steps:
            if step.get("status") in {"completed", "cancelled", "skipped"}:
                continue
            missing_step, failed_step, waiting_step = _dependency_state(steps, step.get("dependsOn") or [])
            retry = step.get("retry") if isinstance(step.get("retry"), dict) else _normalize_retry({})
            step["retry"] = retry
            if missing_step or failed_step:
                step["status"] = "blocked"
                step["blockedReason"] = "missing step dependency" if missing_step else "step dependency failed"
                continue
            if waiting_step:
                if step.get("status") not in {"failed", "retry_wait"}:
                    step["status"] = "pending"
                continue
            if step.get("status") == "retry_wait":
                retry_epoch = _epoch(retry.get("nextRetryAt"))
                if retry_epoch and now_epoch < retry_epoch:
                    if current_step is None:
                        current_task = task
                        current_step = step
                    continue
                step["status"] = "ready"
                retry.pop("nextRetryAt", None)
                step.pop("blockedReason", None)
            elif step.get("status") in {"pending", "blocked"} and not goal.get("replanRequired"):
                step["status"] = "ready"
                step.pop("blockedReason", None)
            if current_step is None and step.get("status") in {"ready", "active", "retry_wait"}:
                current_task = task
                current_step = step
        if steps and all(step.get("status") in {"completed", "skipped"} for step in steps):
            task["status"] = "completed"
            task["completedAt"] = task.get("completedAt") or now_iso
            verified = all((step.get("outcome") or {}).get("verified") is True for step in steps if step.get("status") == "completed")
            task["outcome"] = {"status": "completed", "verified": verified, "at": task["completedAt"]}
        elif any(step.get("status") == "failed" for step in steps):
            task["status"] = "failed"
            task["failedAt"] = task.get("failedAt") or now_iso
            task["failureReason"] = next((step.get("failureReason") for step in steps if step.get("status") == "failed" and step.get("failureReason")), "step retries exhausted")
        elif any(step.get("status") == "active" for step in steps):
            task["status"] = "active"
            task["startedAt"] = task.get("startedAt") or now_iso
        elif any(step.get("status") == "retry_wait" for step in steps):
            task["status"] = "retry_wait"
        elif any(step.get("status") == "ready" for step in steps):
            task["status"] = "ready"
    goal["tasks"] = tasks
    if goal.get("status") not in TERMINAL_GOAL_STATUSES and goal.get("status") != "paused":
        if tasks and all(task.get("status") in {"completed", "skipped"} for task in tasks):
            verified = all((task.get("outcome") or {}).get("verified") is True for task in tasks if task.get("status") == "completed")
            goal["status"] = "completed" if verified else "blocked"
            goal["completedAt"] = goal.get("completedAt") or (now_iso if verified else None)
            goal["outcome"] = {"status": "completed" if verified else "unverified", "verified": verified, "at": now_iso}
            goal["replanRequired"] = not verified
            if not verified:
                goal["replanReason"] = "all tasks settled but one or more outcomes lack verification"
        elif any(task.get("status") == "failed" for task in tasks):
            goal["status"] = "blocked"
            goal["replanRequired"] = True
            goal["replanReason"] = goal.get("replanReason") or "task retries exhausted"
        elif current_step:
            goal["status"] = "active"
            goal.pop("blockedReason", None)
        elif tasks:
            goal["status"] = "blocked"
            goal["blockedReason"] = goal.get("blockedReason") or "waiting for dependencies or replanning"
    if current_task and current_step:
        goal["currentTaskId"] = current_task.get("id")
        goal["currentStepId"] = current_step.get("id")
    else:
        goal.pop("currentTaskId", None)
        goal.pop("currentStepId", None)
    goal["updatedAt"] = _valid_iso(goal.get("updatedAt"), now_iso)
    return goal


def current_context(goal, *, now_epoch=None):
    goal = recompute_goal(goal, now_epoch=now_epoch)
    task_id = goal.get("currentTaskId")
    step_id = goal.get("currentStepId")
    for task in goal.get("tasks") or []:
        if task.get("id") != task_id:
            continue
        for step in task.get("steps") or []:
            if step.get("id") == step_id:
                return {"goal": goal, "task": task, "step": step}
    return {"goal": goal, "task": None, "step": None}


def _prefer_goal(current, candidate):
    if not current:
        return candidate
    if not candidate:
        return current
    current_terminal = current.get("status") in TERMINAL_GOAL_STATUSES
    candidate_terminal = candidate.get("status") in TERMINAL_GOAL_STATUSES
    if current_terminal != candidate_terminal:
        return current if current_terminal else candidate
    return candidate if _epoch(candidate.get("updatedAt")) >= _epoch(current.get("updatedAt")) else current


def merge_goals(existing_agent, incoming_agent, *, retention=12):
    by_id = {}
    for raw in [
        *((existing_agent or {}).get("durableGoals") or []),
        (existing_agent or {}).get("activeGoal"),
        *((incoming_agent or {}).get("durableGoals") or []),
        (incoming_agent or {}).get("activeGoal"),
    ]:
        goal = normalize_goal(raw)
        if goal:
            by_id[goal["id"]] = _prefer_goal(by_id.get(goal["id"]), goal)
    goals = sorted(by_id.values(), key=lambda item: _epoch(item.get("updatedAt")))[-max(1, int(retention)):]
    active = [goal for goal in goals if goal.get("status") in ACTIVE_GOAL_STATUSES and goal.get("status") != "paused"]
    active.sort(key=lambda item: (_number(item.get("priority"), 0, maximum=1.5), _epoch(item.get("updatedAt"))), reverse=True)
    return goals, (active[0] if active else None)


def normalize_agent_goals(agent_state, *, retention=12):
    goals, active = merge_goals({}, agent_state, retention=retention)
    agent_state["goalLedgerSchemaVersion"] = LEDGER_SCHEMA_VERSION
    agent_state["durableGoals"] = goals
    if active:
        agent_state["activeGoal"] = active
    else:
        agent_state.pop("activeGoal", None)
    return goals, active


def store_goal(agent_state, raw_goal, *, retention=12):
    goal = normalize_goal(raw_goal)
    if not goal:
        return None
    goals = []
    for raw in agent_state.get("durableGoals") or []:
        current = normalize_goal(raw)
        if current and current.get("id") != goal.get("id"):
            goals.append(current)
    goals.append(goal)
    agent_state["durableGoals"] = goals[-max(1, int(retention)):]
    agent_state["goalLedgerSchemaVersion"] = LEDGER_SCHEMA_VERSION
    if goal.get("status") in ACTIVE_GOAL_STATUSES and goal.get("status") != "paused":
        agent_state["activeGoal"] = goal
    elif (agent_state.get("activeGoal") or {}).get("id") == goal.get("id"):
        agent_state.pop("activeGoal", None)
    normalize_agent_goals(agent_state, retention=retention)
    return next((item for item in agent_state.get("durableGoals") or [] if item.get("id") == goal.get("id")), goal)


def goal_from_planner_turn(agent_id, planner_turn, *, previous_goal=None, chosen_action=None, now_iso=None):
    if not isinstance(planner_turn, dict):
        return None
    now_iso = now_iso or _now_iso()
    raw_goal = planner_turn.get("goal") if isinstance(planner_turn.get("goal"), dict) else {}
    title = _clean(raw_goal.get("title") or planner_turn.get("currentGoal") or planner_turn.get("goal"), 500)
    if not title:
        return None
    explicit_goal_id = _clean(raw_goal.get("id"), 140)
    reusable_goal_id = ""
    if (
        not explicit_goal_id
        and isinstance(previous_goal, dict)
        and _clean(previous_goal.get("title"), 500).lower() == title.lower()
        and previous_goal.get("status") not in TERMINAL_GOAL_STATUSES
    ):
        reusable_goal_id = _clean(previous_goal.get("id"), 140)
    goal_id = explicit_goal_id or reusable_goal_id or _unique_id("goal", agent_id, title.lower())
    raw_tasks = planner_turn.get("tasks") if isinstance(planner_turn.get("tasks"), list) else raw_goal.get("tasks") if isinstance(raw_goal.get("tasks"), list) else []
    if not raw_tasks:
        plan_items = planner_turn.get("plan") if isinstance(planner_turn.get("plan"), list) else []
        raw_tasks = []
        for index, item in enumerate(plan_items[:12]):
            text = _clean(item if isinstance(item, str) else (item.get("title") or item.get("label") or item.get("intent")), 320)
            if text:
                raw_tasks.append({"id": f"{goal_id}.task-{index + 1}-{_slug(text)}", "title": text, "steps": [{"title": text}]})
    next_step = planner_turn.get("nextStep") if isinstance(planner_turn.get("nextStep"), dict) else {}
    if not raw_tasks:
        raw_tasks = [{"id": f"{goal_id}.task-1", "title": title, "steps": [{"id": f"{goal_id}.task-1.step-1", "title": next_step.get("intent") or title}]}]
    raw = {
        **raw_goal,
        "id": goal_id,
        "agentId": agent_id,
        "title": title,
        "status": "active",
        "source": "model-autonomy-v3",
        "tasks": raw_tasks,
        "updatedAt": now_iso,
        "createdAt": (previous_goal or {}).get("createdAt") or now_iso,
        "revision": _integer((previous_goal or {}).get("revision"), 0, maximum=100000) + 1,
        "replanCount": _integer((previous_goal or {}).get("replanCount"), 0, maximum=10000),
        "replanRequired": False,
        "successCriteria": raw_goal.get("successCriteria") or planner_turn.get("successCriteria"),
    }
    incoming = normalize_goal(raw, agent_id=agent_id, now_iso=now_iso)
    if not incoming:
        return None
    previous = normalize_goal(previous_goal, agent_id=agent_id, now_iso=now_iso) if isinstance(previous_goal, dict) else None
    if previous and previous.get("id") == incoming.get("id"):
        previous_tasks = {task.get("id"): task for task in previous.get("tasks") or []}
        for task in incoming.get("tasks") or []:
            previous_task = previous_tasks.get(task.get("id"))
            if not previous_task:
                continue
            previous_steps = {step.get("id"): step for step in previous_task.get("steps") or []}
            for step in task.get("steps") or []:
                old_step = previous_steps.get(step.get("id"))
                if old_step and old_step.get("status") == "completed" and (old_step.get("outcome") or {}).get("verified") is True:
                    step.clear()
                    step.update(copy.deepcopy(old_step))
            if task.get("steps") and all(step.get("status") in {"completed", "skipped"} for step in task.get("steps")):
                task["status"] = "completed"
                task["completedAt"] = previous_task.get("completedAt") or now_iso
                task["outcome"] = copy.deepcopy(previous_task.get("outcome") or {"status": "completed", "verified": True, "at": now_iso})
        incoming["history"] = _history(previous.get("history"), limit=36)
        incoming["history"].append({"at": now_iso, "event": "planner-replanned", "revision": incoming.get("revision")})
        incoming["replanCount"] = _integer(previous.get("replanCount"), 0, maximum=10000) + (1 if previous.get("replanRequired") else 0)
        incoming["worldRevision"] = previous.get("worldRevision", "")
    next_action = _clean(next_step.get("action") or next_step.get("loopActionId") or chosen_action, 120)
    wanted_task = _clean(next_step.get("taskId"), 140)
    wanted_step = _clean(next_step.get("stepId"), 140)
    context = current_context(incoming)
    incoming = context["goal"]
    target_task = next((task for task in incoming.get("tasks") or [] if wanted_task and task.get("id") == wanted_task), None) or context.get("task")
    target_step = next((step for step in (target_task or {}).get("steps") or [] if wanted_step and step.get("id") == wanted_step), None) or context.get("step")
    if target_step and next_action and next_action != "skip":
        target_step["loopActionId"] = next_action
        target_step["actionFamily"] = _clean(next_step.get("actionFamily") or next_action, 120)
        target_step["title"] = _clean(next_step.get("intent"), 320) or target_step.get("title")
        target_step["successCriteria"] = _text_list(next_step.get("successCriteria"), limit=8) or target_step.get("successCriteria") or []
        target_step["failureCriteria"] = _text_list(next_step.get("failureCriteria"), limit=8) or target_step.get("failureCriteria") or []
        target_step["successPostconditions"] = _text_list(next_step.get("successPostconditions") or next_step.get("successCriteria"), limit=8) or target_step.get("successPostconditions") or []
        target_step["failurePostconditions"] = _text_list(next_step.get("failurePostconditions") or next_step.get("failureCriteria"), limit=8) or target_step.get("failurePostconditions") or []
        target_criteria = _clean(next_step.get("targetCriteria"), 420)
        category = _clean(next_step.get("category"), 120)
        if target_criteria:
            target_step["targetCriteria"] = target_criteria
            target_step["targetIdentity"] = _clean(next_step.get("targetIdentity") or target_criteria, 260)
        if category:
            target_step["category"] = category
        target_step["evidenceDomain"] = _clean(next_step.get("evidenceDomain") or category or next_action, 160)
        target_step["status"] = "ready"
        target_step["updatedAt"] = now_iso
    incoming["operatorSummary"] = f"Working durable goal revision {incoming.get('revision')}: {title}."
    incoming.pop("replanReason", None)
    return recompute_goal(incoming, now_iso=now_iso)


def bind_selected_action(goal, loop_action_id, *, target=None, target_key=None, now_iso=None):
    goal = normalize_goal(goal)
    if not goal:
        return None, None
    now_iso = now_iso or _now_iso()
    context = current_context(goal)
    goal = context["goal"]
    step = context.get("step")
    if not step:
        return goal, None
    if step.get("status") in {"retry_wait", "blocked", "failed"}:
        return goal, None
    step["loopActionId"] = _clean(loop_action_id, 120)
    step["actionFamily"] = step.get("actionFamily") or step["loopActionId"]
    if isinstance(target, dict):
        step["target"] = copy.deepcopy(target)
    if _clean(target_key, 260):
        step["targetKey"] = _clean(target_key, 260)
        step["targetIdentity"] = _clean(target_key, 260)
        goal["worldTargetKey"] = _clean(target_key, 260)
    step["updatedAt"] = now_iso
    goal["updatedAt"] = now_iso
    stored = recompute_goal(goal, now_iso=now_iso)
    return stored, current_context(stored).get("step")


def replan_with_action(goal, loop_action_id, *, target=None, target_key=None, reason="planner selected a replacement action", now_iso=None):
    goal = normalize_goal(goal)
    if not goal:
        return None, None
    now_iso = now_iso or _now_iso()
    task = None
    step = None
    for candidate_task in goal.get("tasks") or []:
        if candidate_task.get("status") in {"completed", "cancelled", "skipped"}:
            continue
        for candidate_step in candidate_task.get("steps") or []:
            if candidate_step.get("status") in {"completed", "cancelled", "skipped"}:
                continue
            task, step = candidate_task, candidate_step
            break
        if step:
            break
    if not step:
        return goal, None
    prior_reason = goal.get("replanReason") or step.get("failureReason") or step.get("blockedReason")
    step["status"] = "ready"
    step["loopActionId"] = _clean(loop_action_id, 120)
    step["actionFamily"] = step["loopActionId"]
    step["updatedAt"] = now_iso
    step.pop("actionId", None)
    step.pop("blockedReason", None)
    step.pop("failureReason", None)
    if isinstance(target, dict):
        step["target"] = copy.deepcopy(target)
    if _clean(target_key, 260):
        step["targetKey"] = _clean(target_key, 260)
        step["targetIdentity"] = _clean(target_key, 260)
        goal["worldTargetKey"] = _clean(target_key, 260)
    step.setdefault("history", []).append({"at": now_iso, "event": "step-replanned", "reason": _clean(reason, 500), "previousReason": _clean(prior_reason, 500), "loopActionId": step.get("loopActionId")})
    if task:
        task["status"] = "ready"
        task.pop("blockedReason", None)
        task.pop("failureReason", None)
        task["updatedAt"] = now_iso
    goal["status"] = "active"
    goal["replanRequired"] = False
    goal.pop("blockedReason", None)
    goal.pop("replanReason", None)
    goal["revision"] = _integer(goal.get("revision"), 1, minimum=1, maximum=100000) + 1
    goal["lastReplannedAt"] = now_iso
    goal["updatedAt"] = now_iso
    goal.setdefault("history", []).append({"at": now_iso, "event": "goal-replanned", "reason": _clean(reason, 500), "previousReason": _clean(prior_reason, 500), "taskId": (task or {}).get("id"), "stepId": step.get("id"), "loopActionId": step.get("loopActionId")})
    stored = recompute_goal(goal, now_iso=now_iso)
    return stored, current_context(stored).get("step")


def mark_step_started(goal, *, action_id, loop_action_id=None, now_iso=None):
    goal = normalize_goal(goal)
    if not goal:
        return None, None
    now_iso = now_iso or _now_iso()
    context = current_context(goal)
    goal = context["goal"]
    task = context.get("task")
    step = context.get("step")
    if not step:
        return goal, None
    retry = step.get("retry") if isinstance(step.get("retry"), dict) else _normalize_retry({})
    retry["attempts"] = _integer(retry.get("attempts"), 0, maximum=100) + 1
    retry.pop("nextRetryAt", None)
    step["retry"] = retry
    step["status"] = "active"
    step["actionId"] = _clean(action_id, 180)
    if loop_action_id:
        step["loopActionId"] = _clean(loop_action_id, 120)
    step["startedAt"] = now_iso
    step["updatedAt"] = now_iso
    step.setdefault("history", []).append({"at": now_iso, "event": "attempt-started", "actionId": step.get("actionId"), "attempt": retry["attempts"]})
    if task:
        task["status"] = "active"
        task["startedAt"] = task.get("startedAt") or now_iso
        task["updatedAt"] = now_iso
    goal["status"] = "active"
    goal["activatedAt"] = goal.get("activatedAt") or now_iso
    goal["updatedAt"] = now_iso
    goal.setdefault("history", []).append({"at": now_iso, "event": "step-started", "taskId": (task or {}).get("id"), "stepId": step.get("id"), "actionId": step.get("actionId")})
    stored = recompute_goal(goal, now_iso=now_iso)
    return stored, current_context(stored).get("step")


def record_verified_outcome(goal, verification, *, now_iso=None):
    goal = normalize_goal(goal)
    if not goal or not isinstance(verification, dict):
        return goal, None
    now_iso = now_iso or _now_iso()
    wanted_task = _clean(verification.get("goalTaskId"), 140)
    wanted_step = _clean(verification.get("goalStepId"), 140)
    wanted_action = _clean(verification.get("actionId"), 180)
    task = None
    step = None
    for candidate_task in goal.get("tasks") or []:
        if wanted_task and candidate_task.get("id") != wanted_task:
            continue
        for candidate_step in candidate_task.get("steps") or []:
            if wanted_step and candidate_step.get("id") != wanted_step:
                continue
            if wanted_action and candidate_step.get("actionId") not in {None, "", wanted_action}:
                continue
            task, step = candidate_task, candidate_step
            break
        if step:
            break
    if not step:
        context = current_context(goal)
        goal = context["goal"]
        task, step = context.get("task"), context.get("step")
    if not step:
        return goal, None
    ok = verification.get("ok") is True
    outcome = {
        "status": "completed" if ok else "failed",
        "verified": bool(ok),
        "verificationId": _clean(verification.get("id"), 180),
        "actionId": wanted_action or step.get("actionId"),
        "at": now_iso,
        "reason": _clean(verification.get("reason"), 700),
    }
    if isinstance(verification.get("evidence"), dict):
        outcome["evidence"] = copy.deepcopy(verification["evidence"])
    step["outcome"] = outcome
    step["settledAt"] = now_iso
    step["updatedAt"] = now_iso
    retry = step.get("retry") if isinstance(step.get("retry"), dict) else _normalize_retry({})
    step["retry"] = retry
    if ok:
        step["status"] = "completed"
        step["completedAt"] = now_iso
        step.pop("failureReason", None)
        retry.pop("nextRetryAt", None)
        event = "verified-outcome"
    else:
        reason = outcome.get("reason") or "verification failed"
        step["failureReason"] = reason
        retry["lastFailureReason"] = reason
        attempts = _integer(retry.get("attempts"), 0, maximum=100)
        max_retries = _integer(retry.get("maxRetries"), 2, maximum=10)
        if attempts <= max_retries:
            delay = _integer(retry.get("retryDelaySec"), 30, maximum=3600)
            retry_at = _datetime.datetime.fromtimestamp((_epoch(now_iso) or time.time()) + delay, tz=_datetime.timezone.utc)
            retry["nextRetryAt"] = retry_at.isoformat().replace("+00:00", "Z")
            step["status"] = "retry_wait"
            event = "retry-scheduled"
        else:
            step["status"] = "failed"
            step["failedAt"] = now_iso
            goal["replanRequired"] = True
            goal["replanReason"] = f"step retries exhausted: {reason}"
            event = "retries-exhausted"
    step.setdefault("history", []).append({"at": now_iso, "event": event, "verificationId": outcome.get("verificationId"), "attempts": retry.get("attempts"), "maxRetries": retry.get("maxRetries")})
    goal["updatedAt"] = now_iso
    goal.setdefault("history", []).append({"at": now_iso, "event": event, "taskId": (task or {}).get("id"), "stepId": step.get("id"), "verificationId": outcome.get("verificationId")})
    stored = recompute_goal(goal, now_iso=now_iso)
    return stored, outcome


def reconcile_world(goal, *, world_revision, available_actions=None, target_keys=None, now_iso=None):
    goal = normalize_goal(goal)
    if not goal:
        return None, None
    now_iso = now_iso or _now_iso()
    revision = _clean(world_revision, 100)
    prior_revision = goal.get("worldRevision")
    goal["worldRevision"] = revision
    goal["lastWorldCheckAt"] = now_iso
    if goal.get("status") in TERMINAL_GOAL_STATUSES:
        return recompute_goal(goal, now_iso=now_iso), None
    context = current_context(goal)
    goal = context["goal"]
    step = context.get("step")
    if not step:
        return recompute_goal(goal, now_iso=now_iso), None
    available_actions = set(available_actions or [])
    target_keys = target_keys if isinstance(target_keys, dict) else {}
    loop_action_id = step.get("loopActionId")
    previous_target_key = step.get("targetKey") or goal.get("worldTargetKey")
    current_target_key = target_keys.get(loop_action_id) if loop_action_id else None
    reason = None
    # Once an attempt has started, the action ledger—not the next perception
    # frame's affordance list—owns its outcome. Acquisition actions commonly
    # disappear while their terminal result is being settled (for example,
    # getCoffee is suppressed after coffee is acquired). Treating that normal
    # disappearance as a world change can overwrite verified completion and
    # make the resident repeat an action it already performed.
    if step.get("status") == "active" and step.get("actionId"):
        return recompute_goal(goal, now_iso=now_iso), None
    if loop_action_id and loop_action_id not in available_actions:
        reason = f"planned action {loop_action_id} is no longer available"
    elif previous_target_key and current_target_key and previous_target_key != current_target_key:
        reason = f"planned target changed from {previous_target_key} to {current_target_key}"
    if not reason:
        return recompute_goal(goal, now_iso=now_iso), None
    if goal.get("replanRequired") and goal.get("replanReason") == reason:
        return recompute_goal(goal, now_iso=now_iso), None
    step["status"] = "blocked"
    step["blockedReason"] = reason
    step["updatedAt"] = now_iso
    step.pop("actionId", None)
    goal["status"] = "blocked"
    goal["blockedReason"] = reason
    goal["replanRequired"] = True
    goal["replanReason"] = reason
    goal["replanCount"] = _integer(goal.get("replanCount"), 0, maximum=10000) + 1
    goal["revision"] = _integer(goal.get("revision"), 1, minimum=1, maximum=100000) + 1
    goal["lastReplannedAt"] = now_iso
    goal["updatedAt"] = now_iso
    goal.setdefault("history", []).append({"at": now_iso, "event": "world-change-replan-required" if prior_revision and prior_revision != revision else "planned-action-validation-failed", "reason": reason, "worldRevision": revision, "taskId": (context.get("task") or {}).get("id"), "stepId": step.get("id")})
    return recompute_goal(goal, now_iso=now_iso), reason


def world_revision(affordances):
    rows = []
    for item in affordances or []:
        if not isinstance(item, dict):
            continue
        target = item.get("target") if isinstance(item.get("target"), dict) else {}
        rows.append({
            "id": item.get("id"),
            "available": bool(item.get("available")),
            "target": target.get("objectInstanceId") or target.get("buildingId") or target.get("catalogId") or target.get("kind"),
        })
    encoded = json.dumps(sorted(rows, key=lambda item: str(item.get("id") or "")), sort_keys=True, separators=(",", ":"), default=str)
    return "world-" + hashlib.sha256(encoded.encode("utf-8", errors="ignore")).hexdigest()[:20]


def validate_goal_payload(raw):
    errors = []
    if not isinstance(raw, dict):
        return ["goal must be an object"]
    if not _clean(raw.get("title") or raw.get("currentGoal") or raw.get("goal"), 500):
        errors.append("goal title is required")
    tasks = raw.get("tasks")
    if tasks is not None and not isinstance(tasks, list):
        errors.append("tasks must be an array")
    if isinstance(tasks, list):
        task_ids = []
        for index, task in enumerate(tasks):
            if not isinstance(task, dict):
                errors.append(f"tasks[{index}] must be an object")
                continue
            task_id = _clean(task.get("id"), 120) or f"task-{index + 1}"
            if task_id in task_ids:
                errors.append(f"duplicate task id: {task_id}")
            task_ids.append(task_id)
            steps = task.get("steps")
            if steps is not None and not isinstance(steps, list):
                errors.append(f"task {task_id} steps must be an array")
            if isinstance(steps, list):
                step_ids = []
                for step_index, step in enumerate(steps):
                    if not isinstance(step, dict):
                        errors.append(f"task {task_id} steps[{step_index}] must be an object")
                        continue
                    step_id = _clean(step.get("id"), 120) or f"step-{step_index + 1}"
                    if step_id in step_ids:
                        errors.append(f"duplicate step id in {task_id}: {step_id}")
                    step_ids.append(step_id)
    return errors[:24]
