#!/usr/bin/env python3
"""Dry-run or apply the bounded Live Agent storage migration.

The migration only touches My Virtual World-owned persistence. Provider-owned
agent workspaces, chat transcripts, and framework memory are never opened.
"""

import argparse
import copy
import datetime as dt
import importlib.util
import json
import os
from pathlib import Path
import sys
import tarfile
import tempfile


MIGRATION_ID = "live-agent-storage-v2"


def compact_bytes(value):
    return json.dumps(value, ensure_ascii=False, separators=(",", ":"), sort_keys=False).encode("utf-8")


def load_json(path, default):
    try:
        with path.open("r", encoding="utf-8") as handle:
            value = json.load(handle)
        return value if isinstance(value, dict) else copy.deepcopy(default)
    except (FileNotFoundError, json.JSONDecodeError, OSError):
        return copy.deepcopy(default)


def load_server(project_root, data_dir):
    os.environ["VW_DATA_DIR"] = str(data_dir)
    candidates = [
        project_root / "src" / "server" / "server.py",
        project_root / "server" / "server.py",
    ]
    module_path = next((path for path in candidates if path.is_file()), candidates[0])
    spec = importlib.util.spec_from_file_location("vw_storage_migration_server", module_path)
    if not spec or not spec.loader:
        raise RuntimeError(f"Unable to load server module from {module_path}")
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


def collection_metrics(meta, notes, transcripts):
    life = meta.get("agentLife") if isinstance(meta.get("agentLife"), dict) else {}
    moves = life.get("moveIntents") if isinstance(life.get("moveIntents"), dict) else {}
    events = life.get("worldActionEvents") if isinstance(life.get("worldActionEvents"), dict) else {}
    profiles = meta.get("agentProfiles") if isinstance(meta.get("agentProfiles"), dict) else {}
    resident_counts = {"profiles": 0, "shortTerm": 0, "longTerm": 0, "reflections": 0}
    for profile in profiles.values():
        resident = profile.get("residentProfile") if isinstance(profile, dict) and isinstance(profile.get("residentProfile"), dict) else {}
        memory = resident.get("memory") if isinstance(resident.get("memory"), dict) else {}
        if resident:
            resident_counts["profiles"] += 1
        for key in ("shortTerm", "longTerm", "reflections"):
            resident_counts[key] += len(memory.get(key) or []) if isinstance(memory.get(key), list) else 0
    note_agents = notes.get("agents") if isinstance(notes.get("agents"), dict) else {}
    transcript_agents = transcripts.get("agents") if isinstance(transcripts.get("agents"), dict) else {}
    return {
        "worldMetaBytes": len(compact_bytes(meta)),
        "moveIntents": {
            "active": len(moves.get("active") or []),
            "history": len(moves.get("history") or []),
            "historyBytes": len(compact_bytes(moves.get("history") or [])),
            "maxRecordBytes": max((len(compact_bytes(item)) for item in (moves.get("history") or []) if isinstance(item, dict)), default=0),
        },
        "worldActionEvents": {
            "records": len(events.get("events") or []),
            "bytes": len(compact_bytes(events.get("events") or [])),
            "maxRecordBytes": max((len(compact_bytes(item)) for item in (events.get("events") or []) if isinstance(item, dict)), default=0),
        },
        "internalNotes": {
            "bytes": len(compact_bytes(notes)),
            "records": sum(len((row or {}).get("notes") or []) for row in note_agents.values() if isinstance(row, dict)),
            "agents": len(note_agents),
        },
        "plannerTranscripts": {
            "bytes": len(compact_bytes(transcripts)),
            "records": sum(len((row or {}).get("turns") or []) for row in transcript_agents.values() if isinstance(row, dict)),
            "agents": len(transcript_agents),
        },
        "residentMemory": resident_counts,
    }


def compact_internal_notes(server, data):
    compacted = server._compact_live_agent_internal_notes_document(data)
    compacted["schemaVersion"] = server.LIVE_AGENT_INTERNAL_NOTE_SCHEMA_VERSION
    compacted = server._trim_agent_document_records(
        compacted,
        "notes",
        max_records_per_agent=server.LIVE_AGENT_LOOP_DEFAULTS["memoryRetention"] * 2,
        max_bytes=server.LIVE_AGENT_INTERNAL_NOTES_MAX_BYTES,
    )
    compacted["schemaVersion"] = server.LIVE_AGENT_INTERNAL_NOTE_SCHEMA_VERSION
    return compacted


def compact_planner_transcripts(server, data):
    compacted = server._compact_live_agent_planner_transcripts_document(data)
    compacted["schemaVersion"] = server.LIVE_AGENT_PLANNER_TRANSCRIPT_SCHEMA_VERSION
    compacted = server._trim_agent_document_records(
        compacted,
        "turns",
        max_records_per_agent=server.LIVE_AGENT_PLANNER_TRANSCRIPT_RETENTION,
        max_bytes=server.LIVE_AGENT_PLANNER_TRANSCRIPTS_MAX_BYTES,
    )
    compacted["schemaVersion"] = server.LIVE_AGENT_PLANNER_TRANSCRIPT_SCHEMA_VERSION
    return compacted


def build_targets(server, raw_meta, raw_notes, raw_transcripts):
    meta = copy.deepcopy(raw_meta)
    life = meta.get("agentLife") if isinstance(meta.get("agentLife"), dict) else {}
    life["moveIntents"] = server._normalize_move_intents_store(life.get("moveIntents"))
    life["worldActionEvents"] = server._normalize_world_action_events_store(life.get("worldActionEvents"))
    meta["agentLife"] = life

    profiles = meta.get("agentProfiles") if isinstance(meta.get("agentProfiles"), dict) else {}
    for agent_id, raw_profile in list(profiles.items()):
        if not isinstance(raw_profile, dict):
            continue
        profile = copy.deepcopy(raw_profile)
        resident = profile.get("residentProfile") if isinstance(profile.get("residentProfile"), dict) else None
        if not resident:
            continue
        memory = resident.get("memory") if isinstance(resident.get("memory"), dict) else {}
        resident["memory"] = server._consolidate_resident_memory(memory)
        profile["residentProfile"] = resident
        profiles[agent_id] = profile
    meta["agentProfiles"] = profiles
    return meta, compact_internal_notes(server, raw_notes), compact_planner_transcripts(server, raw_transcripts)


def atomic_write(path, payload):
    path.parent.mkdir(parents=True, exist_ok=True)
    fd, temp_name = tempfile.mkstemp(prefix=f".{path.name}.migration-", dir=str(path.parent))
    try:
        with os.fdopen(fd, "wb") as handle:
            handle.write(payload)
            handle.flush()
            os.fsync(handle.fileno())
        os.replace(temp_name, path)
        directory_fd = os.open(str(path.parent), os.O_DIRECTORY)
        try:
            os.fsync(directory_fd)
        finally:
            os.close(directory_fd)
    finally:
        if os.path.exists(temp_name):
            os.unlink(temp_name)


def create_backup(data_dir, paths, backup_path):
    backup_path.parent.mkdir(parents=True, exist_ok=True)
    temp_path = backup_path.with_suffix(backup_path.suffix + ".tmp")
    with tarfile.open(temp_path, "w:gz") as archive:
        for path in paths:
            if path.exists():
                archive.add(path, arcname=path.name, recursive=False)
    os.replace(temp_path, backup_path)


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--data-dir", default=os.environ.get("VW_DATA_DIR", "/data"))
    parser.add_argument("--apply", action="store_true", help="Write compacted files. The default is a read-only dry run.")
    parser.add_argument("--json", action="store_true", help="Emit machine-readable JSON.")
    args = parser.parse_args()

    project_root = Path(__file__).resolve().parents[1]
    data_dir = Path(args.data_dir).resolve()
    meta_path = data_dir / "world-meta.json"
    notes_path = data_dir / "agent-internal-notes.json"
    transcripts_path = data_dir / "live-agent-planner-transcripts.json"
    if not meta_path.is_file():
        raise SystemExit(f"world metadata not found: {meta_path}")

    server = load_server(project_root, data_dir)
    raw_meta = load_json(meta_path, {})
    raw_notes = load_json(notes_path, server._live_agent_internal_notes_default())
    raw_transcripts = load_json(transcripts_path, server._live_agent_planner_transcript_default())
    target_meta, target_notes, target_transcripts = build_targets(server, raw_meta, raw_notes, raw_transcripts)

    existing_migrations = ((raw_meta.get("agentLife") or {}).get("storageMigrations") or {}) if isinstance(raw_meta.get("agentLife"), dict) else {}
    existing_marker = existing_migrations.get(MIGRATION_ID) if isinstance(existing_migrations, dict) and isinstance(existing_migrations.get(MIGRATION_ID), dict) else None
    changed_without_marker = any(
        compact_bytes(before) != compact_bytes(after)
        for before, after in (
            (raw_meta, target_meta),
            (raw_notes, target_notes),
            (raw_transcripts, target_transcripts),
        )
    )
    applied_at = (existing_marker or {}).get("appliedAt") or dt.datetime.now(dt.timezone.utc).replace(microsecond=0).isoformat().replace("+00:00", "Z")
    backup_name = (existing_marker or {}).get("backupFile")
    if not backup_name:
        stamp = applied_at.replace("-", "").replace(":", "").replace("T", "-").replace("Z", "")
        backup_name = f"live-agent-storage-v2-{stamp}.tar.gz"
    marker = {
        "schemaVersion": "live-agent-storage-migration/v1",
        "appliedAt": applied_at,
        "backupFile": backup_name,
        "noModelCalls": True,
        "providerOwnedMemoryTouched": False,
    }
    if args.apply and (changed_without_marker or not existing_marker):
        life = target_meta.get("agentLife") if isinstance(target_meta.get("agentLife"), dict) else {}
        migrations = life.get("storageMigrations") if isinstance(life.get("storageMigrations"), dict) else {}
        migrations[MIGRATION_ID] = marker
        life["storageMigrations"] = migrations
        target_meta["agentLife"] = life

    before_metrics = collection_metrics(raw_meta, raw_notes, raw_transcripts)
    after_metrics = collection_metrics(target_meta, target_notes, target_transcripts)
    file_changes = {
        "world-meta.json": compact_bytes(raw_meta) != compact_bytes(target_meta),
        "agent-internal-notes.json": compact_bytes(raw_notes) != compact_bytes(target_notes),
        "live-agent-planner-transcripts.json": compact_bytes(raw_transcripts) != compact_bytes(target_transcripts),
    }
    backup_created = False
    if args.apply and any(file_changes.values()):
        if not existing_marker:
            backup_path = data_dir / "storage-migration-backups" / backup_name
            create_backup(data_dir, [meta_path, data_dir / "world-meta.json.bak", notes_path, transcripts_path], backup_path)
            backup_created = True
        if file_changes["agent-internal-notes.json"]:
            atomic_write(notes_path, compact_bytes(target_notes))
        if file_changes["live-agent-planner-transcripts.json"]:
            atomic_write(transcripts_path, compact_bytes(target_transcripts))
        if file_changes["world-meta.json"]:
            encoded_meta = compact_bytes(target_meta)
            atomic_write(meta_path, encoded_meta)
            atomic_write(data_dir / "world-meta.json.bak", encoded_meta)

    check_meta, check_notes, check_transcripts = build_targets(server, target_meta, target_notes, target_transcripts)
    idempotence = {
        "world-meta.json": compact_bytes(target_meta) == compact_bytes(check_meta),
        "agent-internal-notes.json": compact_bytes(target_notes) == compact_bytes(check_notes),
        "live-agent-planner-transcripts.json": compact_bytes(target_transcripts) == compact_bytes(check_transcripts),
    }
    idempotent = all(idempotence.values())
    result = {
        "ok": True,
        "mode": "apply" if args.apply else "dry-run",
        "dataDir": str(data_dir),
        "migrationId": MIGRATION_ID,
        "changed": any(file_changes.values()),
        "filesChanged": file_changes,
        "backupCreated": backup_created,
        "backupFile": str(data_dir / "storage-migration-backups" / backup_name) if args.apply else None,
        "idempotent": idempotent,
        "idempotence": idempotence,
        "before": before_metrics,
        "after": after_metrics,
        "providerOwnedMemoryTouched": False,
    }
    if args.json:
        print(json.dumps(result, indent=2, sort_keys=True))
    else:
        print(f"Live Agent storage migration {result['mode']}: {'changes found' if result['changed'] else 'already compact'}")
        print(json.dumps(result, indent=2, sort_keys=True))
    return 0 if idempotent else 2


if __name__ == "__main__":
    sys.exit(main())
