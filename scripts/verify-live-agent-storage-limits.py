#!/usr/bin/env python3
"""Stress bounded Live Agent storage and semantic memory consolidation."""

import importlib.util
import json
import os
from pathlib import Path
import tempfile
import time


ROOT = Path(__file__).resolve().parents[1]
SERVER_PATH = ROOT / "src" / "server" / "server.py"
CHECKS = []


def check(name, condition, detail=""):
    CHECKS.append((name, bool(condition), detail))
    print(f"[{'PASS' if condition else 'FAIL'}] {name}" + (f" — {detail}" if detail and not condition else ""))


def json_bytes(value):
    return len(json.dumps(value, separators=(",", ":"), ensure_ascii=False).encode("utf-8"))


def load_server(tmpdir):
    data_dir = tmpdir / "data"
    openclaw_dir = tmpdir / "openclaw"
    (data_dir / "buildings").mkdir(parents=True, exist_ok=True)
    (data_dir / "chunks").mkdir(parents=True, exist_ok=True)
    openclaw_dir.mkdir(parents=True, exist_ok=True)
    os.environ.update({
        "VW_DATA_DIR": str(data_dir),
        "VW_OPENCLAW_PATH": str(openclaw_dir),
        "VW_OPENCLAW_HOST_PATH": str(openclaw_dir),
        "VW_CODEX_INCLUDE_NATIVE_AGENTS": "0",
        "VW_CLAUDE_CODE_INCLUDE_NATIVE_AGENTS": "0",
        "VW_MOVE_INTENT_HISTORY_MAX_BYTES": str(64 * 1024),
        "VW_MOVE_INTENT_HISTORY_RECORD_MAX_BYTES": str(2048),
        "VW_MOVE_INTENT_ACTIVE_RECORD_MAX_BYTES": str(16 * 1024),
        "VW_WORLD_ACTION_EVENTS_MAX_BYTES": str(64 * 1024),
        "VW_WORLD_ACTION_EVENT_RECORD_MAX_BYTES": str(2048),
        "VW_LIVE_AGENT_INTERNAL_NOTES_MAX_BYTES": str(128 * 1024),
        "VW_LIVE_AGENT_INTERNAL_NOTE_DETAILS_MAX_BYTES": str(4096),
        "VW_LIVE_AGENT_INTERNAL_NOTE_RECORD_MAX_BYTES": str(8192),
        "VW_LIVE_AGENT_PLANNER_TRANSCRIPTS_MAX_BYTES": str(256 * 1024),
        "VW_LIVE_AGENT_PLANNER_TRANSCRIPT_RECORD_MAX_BYTES": str(8192),
        "VW_LIVE_AGENT_PLANNER_FULL_TURNS_PER_AGENT": "4",
    })
    spec = importlib.util.spec_from_file_location("mvw_server_storage_test", SERVER_PATH)
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    module._agent_roster = [
        {"id": "alpha", "statusKey": "alpha", "name": "Alpha", "providerKind": "openclaw", "providerAgentId": "alpha"},
        {"id": "quiet", "statusKey": "quiet", "name": "Quiet", "providerKind": "openclaw", "providerAgentId": "quiet"},
    ]
    module._roster_time = time.time()
    module.save_world_meta(module._default_world_meta())
    return module


def iso(index):
    return f"2026-07-{1 + (index // 24):02d}T{index % 24:02d}:00:00Z"


def move_record(index, agent_id="alpha"):
    status = "failed" if index % 7 == 0 else "arrived"
    target = {
        "kind": "object-instance",
        "objectInstanceId": f"object-{index}",
        "catalogId": "coffeeMachine",
        "interactionSpotId": "use",
        "buildingId": "office-1",
        "floor": 1,
        "actionId": f"action-{index}",
        "worldActionId": f"action-{index}",
    }
    metadata = {
        **target,
        "routingPlan": "object-action-spot-to-setAgentTarget",
        "availability": {"diagnostic": "x" * 12000},
        "behavior": {"plannerFrame": "x" * 12000},
    }
    return {
        "id": f"move-{index}",
        "schemaVersion": "agent-life-move-intent/v1",
        "agentId": agent_id,
        "actionId": f"action-{index}",
        "worldActionId": f"action-{index}",
        "status": status,
        "routeStatus": status,
        "failureReason": "route_unreachable" if status == "failed" else None,
        "target": target,
        "targetMetadata": metadata,
        "route": {
            "id": f"route-{index}",
            "state": status,
            "status": status,
            "target": target,
            "targetMetadata": metadata,
            "planner": {"kind": "interior", "diagnostic": "y" * 12000},
            "worldActionId": f"action-{index}",
        },
        "source": {"kind": "agent-live-mode", "behaviorSourceKind": "agent-live-mode"},
        "behaviorSourceKind": "agent-live-mode",
        "createdAt": iso(index),
        "updatedAt": iso(index),
        "audit": {"plannerFrame": "z" * 12000},
    }


def event_record(index, agent_id="alpha"):
    return {
        "schemaVersion": "agent-life-world-action-event-hooks/v1",
        "name": "failed" if index % 5 == 0 else "completed",
        "type": "failed" if index % 5 == 0 else "completed",
        "id": f"event-{index}",
        "at": iso(index),
        "timestamp": iso(index),
        "sequence": index + 1,
        "cursor": index + 1,
        "actionId": f"action-{index}",
        "agentId": agent_id,
        "status": "failed" if index % 5 == 0 else "completed",
        "target": {"kind": "object-instance", "objectInstanceId": f"object-{index}", "debug": "x" * 10000},
        "behavior": {"plannerFrame": "y" * 10000},
        "result": {"status": "done", "diagnostic": "z" * 10000},
    }


def main():
    with tempfile.TemporaryDirectory(prefix="mvw-live-storage-") as raw:
        server = load_server(Path(raw))

        active = move_record(9999)
        active["status"] = active["routeStatus"] = "routing"
        active["targetMetadata"].pop("availability", None)
        active["targetMetadata"].pop("behavior", None)
        active["route"].pop("targetMetadata", None)
        active["route"]["planner"] = {"kind": "interior"}
        active.pop("audit", None)
        active_before = json.loads(json.dumps(active))
        history = [move_record(index, "quiet" if index == 3 else "alpha") for index in range(240)]
        ok, moves = server.save_move_intents_store({"active": [active], "history": history})
        check("move-intent store saves", ok)
        check("active move intent is preserved byte-for-byte", moves.get("active") == [active_before])
        check("move history stays under byte ceiling", json_bytes(moves.get("history")) <= server.MOVE_INTENT_HISTORY_MAX_BYTES, str(json_bytes(moves.get("history"))))
        check("each terminal move record stays under its ceiling", all(json_bytes(item) <= server.MOVE_INTENT_HISTORY_RECORD_MAX_BYTES for item in moves.get("history") or []))
        check("quiet resident keeps a fair-share move record", any(item.get("agentId") == "quiet" for item in moves.get("history") or []))
        check("terminal move records remove duplicated route payloads", all("targetMetadata" not in (item.get("route") or {}) for item in moves.get("history") or []))

        oversized_active = {**active, "id": "oversized-active", "diagnostic": "x" * (server.MOVE_INTENT_ACTIVE_RECORD_MAX_BYTES + 1000)}
        rejected, detail = server.save_move_intents_store({"active": [oversized_active], "history": moves.get("history")})
        check("oversized active move intent is rejected", not rejected and detail.get("error") == "move_intent_active_record_too_large")

        events = [event_record(index, "quiet" if index == 2 else "alpha") for index in range(320)]
        saved_events = server.save_world_action_events_store({"nextSequence": 321, "events": events})
        check("world-action events stay under byte ceiling", json_bytes(saved_events.get("events")) <= server.WORLD_ACTION_EVENTS_MAX_BYTES)
        check("each world-action event stays under its ceiling", all(json_bytes(item) <= server.WORLD_ACTION_EVENT_RECORD_MAX_BYTES for item in saved_events.get("events") or []))
        check("event cursor remains monotonic after pruning", saved_events.get("nextSequence") == 321)
        check("quiet resident keeps a fair-share event", any(item.get("agentId") == "quiet" for item in saved_events.get("events") or []))

        notes_data = server._live_agent_internal_notes_default()
        notes_data["agents"] = {"alpha": {"notes": []}, "quiet": {"notes": []}}
        for index in range(30):
            notes_data["agents"]["alpha"]["notes"].append({
                "id": f"note-{index}",
                "agentId": "alpha",
                "type": "lesson",
                "title": "Remember the elevator lesson",
                "text": "The elevator route needs the correct floor before movement.",
                "createdAt": iso(index),
                "updatedAt": iso(index),
                "details": {"actionId": f"action-{index}", "plannerFrame": {"prompt": "x" * 20000, "candidates": ["y" * 10000]}},
            })
        notes_data["agents"]["quiet"]["notes"] = [{
            "id": "quiet-note",
            "agentId": "quiet",
            "type": "lesson",
            "title": "Quiet lesson",
            "text": "Keep this semantic lesson.",
            "createdAt": iso(1),
            "updatedAt": iso(1),
            "details": {"prompt": "x" * 20000},
        }]
        saved_notes = server._save_live_agent_internal_notes(notes_data)
        all_notes = [item for row in (saved_notes.get("agents") or {}).values() for item in (row.get("notes") or [])]
        check("internal notes stay under global byte ceiling", json_bytes(saved_notes) <= server.LIVE_AGENT_INTERNAL_NOTES_MAX_BYTES)
        check("duplicate semantic notes collapse into counted memory", any(int(item.get("repeatCount") or 0) >= 30 for item in all_notes))
        check("legacy planner frames are removed from notes", all("plannerFrame" not in json.dumps(item.get("details") or {}) for item in all_notes))
        check("quiet resident semantic note survives", any(item.get("agentId") == "quiet" and item.get("text") == "Keep this semantic lesson." for item in all_notes))

        transcripts = server._live_agent_planner_transcript_default()
        transcripts["agents"] = {"alpha": {"turns": []}, "quiet": {"turns": []}}
        for agent_id in ("alpha", "quiet"):
            for index in range(24):
                transcripts["agents"][agent_id]["turns"].append({
                    "id": f"{agent_id}-turn-{index}",
                    "agentId": agent_id,
                    "startedAt": iso(index),
                    "completedAt": iso(index),
                    "status": "complete",
                    "mode": "model-autonomy-v3",
                    "prompt": "LIVE MODE PLANNER FRAME\n" + ("scaffolding " * 1700),
                    "reply": json.dumps({
                        "reflection": f"I learned route lesson {index}.",
                        "currentGoal": "Reach the office safely.",
                        "plan": ["Check floor", "Use elevator", "Reach office"],
                        "nextStep": {"action": "use-elevator", "intent": "Change floors"},
                        "memoryUpdate": {"lesson": "Check the destination floor before routing."},
                    }),
                    "candidateIds": [f"candidate-{n}" for n in range(40)],
                })
        saved_transcripts = server._save_live_agent_planner_transcripts(transcripts)
        all_turns = [item for row in (saved_transcripts.get("agents") or {}).values() for item in (row.get("turns") or [])]
        check("planner transcripts stay under global byte ceiling", json_bytes(saved_transcripts) <= server.LIVE_AGENT_PLANNER_TRANSCRIPTS_MAX_BYTES)
        check("old planner frames become semantic summaries", any((item.get("storageCompaction") or {}).get("olderTurnSummarized") and (item.get("semanticSummary") or {}).get("lesson") for item in all_turns))
        check("newest full planner turns remain available", all(sum(1 for item in row.get("turns") or [] if not (item.get("storageCompaction") or {}).get("olderTurnSummarized")) >= 1 for row in (saved_transcripts.get("agents") or {}).values()))
        check("each planner turn stays under its record ceiling", all(json_bytes(item) <= server.LIVE_AGENT_PLANNER_TRANSCRIPT_RECORD_MAX_BYTES for item in all_turns))

        short_term = ["A legacy text-only memory about the first day in the world."]
        for index in range(55):
            short_term.append({
                "at": iso(index),
                "actionId": f"coffee-{index}",
                "settledActionKey": f"coffee-{index}:completed",
                "loopActionId": "hydrate-coffee-machine",
                "actionType": "life.drinkCoffee",
                "status": "completed",
                "text": "Successfully made coffee.",
                "targetKey": "object:coffee-machine-1",
                "source": "live-agent-loop",
            })
        short_term.append({
            "at": iso(56),
            "actionId": "elevator-failure",
            "settledActionKey": "elevator-failure:failed",
            "loopActionId": "work-on-active-goal",
            "actionType": "life.useElevator",
            "status": "failed",
            "text": "The elevator route failed because the destination floor was unavailable.",
            "failure": {"status": "failed", "reason": "route_unreachable", "reportable": True, "lesson": "Verify the floor first."},
            "source": "live-agent-loop",
        })
        memory = {
            "summary": "Alpha values reliable work.",
            "shortTerm": short_term,
            "longTerm": ["The user prefers honest progress reports."],
            "relationships": {},
            "reflections": [],
        }
        consolidated = server._consolidate_resident_memory(memory)
        check("short-term resident memory remains bounded", len(consolidated.get("shortTerm") or []) <= server.RESIDENT_PROFILE_LIST_LIMIT)
        check("routine experiences aggregate instead of disappearing", any(item.get("loopActionId") == "hydrate-coffee-machine" and int(item.get("count") or 0) > 1 for item in consolidated.get("longTerm") or [] if isinstance(item, dict)))
        check("important failure is promoted immediately", any(item.get("actionType") == "life.useElevator" and item.get("unresolved") for item in consolidated.get("longTerm") or [] if isinstance(item, dict)))
        check("existing durable memory is preserved", any((item.get("text") if isinstance(item, dict) else item) == "The user prefers honest progress reports." for item in consolidated.get("longTerm") or []))
        check("legacy text-only short-term memory is preserved", any(item.get("text") == "A legacy text-only memory about the first day in the world." for item in [*(consolidated.get("shortTerm") or []), *(consolidated.get("longTerm") or [])] if isinstance(item, dict)))
        check("resident summary preserves identity and adds experience capsule", consolidated.get("summary", "").startswith("Alpha values reliable work.") and "[Consolidated Live Agent experiences]" in consolidated.get("summary", ""))
        check("resident consolidation is idempotent", server._consolidate_resident_memory(consolidated) == consolidated)

        # Repeated writes must converge at the same ceilings after reloads.
        for cycle in range(5):
            current = server.get_move_intents_store()
            more = [move_record(300 + cycle * 80 + index) for index in range(80)]
            ok, _ = server.save_move_intents_store({"active": current.get("active"), "history": [*(current.get("history") or []), *more]})
            if not ok:
                break
            current_events = server.get_world_action_events_store()
            more_events = [event_record(400 + cycle * 80 + index) for index in range(80)]
            server.save_world_action_events_store({**current_events, "events": [*(current_events.get("events") or []), *more_events], "nextSequence": 1000 + cycle})
        reloaded_moves = server.get_move_intents_store()
        reloaded_events = server.get_world_action_events_store()
        check("repeated move writes converge below ceiling", ok and json_bytes(reloaded_moves.get("history")) <= server.MOVE_INTENT_HISTORY_MAX_BYTES)
        check("repeated event writes converge below ceiling", json_bytes(reloaded_events.get("events")) <= server.WORLD_ACTION_EVENTS_MAX_BYTES)
        check("no abandoned migration temp files remain", not list(Path(server.DATA_DIR).glob("*.migration-*")))

    failures = [name for name, passed, _ in CHECKS if not passed]
    if failures:
        raise SystemExit(f"{len(failures)} storage verification check(s) failed: {', '.join(failures)}")
    print(f"Live Agent storage verifier passed ({len(CHECKS)}/{len(CHECKS)}).")


if __name__ == "__main__":
    main()
