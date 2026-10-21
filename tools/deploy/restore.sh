#!/usr/bin/env bash
# My Virtual World — Copyright (c) 2026 My Virtual World. Licensed under the PolyForm Noncommercial License 1.0.0 (see LICENSE).
# Restores the live data folder from a backup: stop → keep the current data as a backup → copy the backup in →
# start → smoke test against the backup's counts.
# Usage: tools/deploy/restore.sh <backup folder>        (backups are in $MVW_LIVE_ROOT/backups)
. "$(dirname "$0")/lib.sh"

src="${1:-}"
[ -n "$src" ] || die "usage: restore.sh <backup folder> (see $BACKUPS)"
src="$(cd "$src" && pwd)"
take_lock
tag="$(link_tag current)"
[ -n "$tag" ] || die "live has no current release link ($MVW_LIVE_ROOT/current)"
# The backup's stored secrets must open with live's key, or the server would refuse to start (DECISIONS C88). Backups up
# to one key rotation old open with the previous key that the key file keeps.
node "$DEPLOY_DIR/keycheck.mjs" --data "$src/data" --unit "$MVW_LIVE_UNIT" --systemctl "$MVW_SYSTEMCTL" >&2 \
  || die "live's key cannot open the secrets in this backup (see above); nothing was changed. To restore it without them: copy the backup folder, run node tools/admin.mjs forget-secrets --unreadable --data <copy>/data --key-file <live's key file>, then restore the copy"
active=0
if svc is-active --quiet "$MVW_LIVE_UNIT"; then active=1; fi
svc stop "$MVW_LIVE_UNIT"
if ! restore_data "$src"; then
  if [ "$active" = 1 ]; then have_world; start_live; fi
  die "the restore failed; live data was left as it was"
fi
log_event restore "$(basename "$src")" "on $tag"
if [ "$active" = 1 ]; then
  start_live
  verify_live "$tag" "$src" || die "the server did not pass its checks after the restore"
fi
say "restore done"
