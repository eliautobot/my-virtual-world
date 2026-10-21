#!/usr/bin/env bash
# My Virtual World — Copyright (c) 2026 My Virtual World. Licensed under the PolyForm Noncommercial License 1.0.0 (see LICENSE).
# Promotes a tagged release to live: build → test → stop → back up → switch → start → smoke test.
# If the new release fails its checks, the data backup and the previous release are restored automatically.
# Usage: tools/deploy/promote.sh <tag> [--skip-tests] [--redistribute-population]
# Population redistribution is explicit opt-in, requires full gates, and runs only after the stopped-data backup.
#        (tools/deploy/rollback.sh calls it with --rollback)
. "$(dirname "$0")/lib.sh"

tag=""
kind=promote
run_tests=1
redistribute_population=0
while [ $# -gt 0 ]; do
  case "$1" in
    --skip-tests) run_tests=0 ;;
    --rollback) kind=rollback; run_tests=0 ;;
    --restore-accounts) export MVW_RESTORE_ACCOUNTS=1 ;;
    --redistribute-population) redistribute_population=1 ;;
    -*) die "unknown option: $1" ;;
    *) [ -z "$tag" ] || die "give one tag only"; tag="$1" ;;
  esac
  shift
done
[ -n "$tag" ] || die "usage: promote.sh <tag> [--skip-tests] [--redistribute-population]"
[ "$redistribute_population" = 0 ] || [ "$kind" = promote ] || die "population redistribution is not allowed during rollback"

take_lock
"$DEPLOY_DIR/build-release.sh" "$tag"
from="$(link_tag current)"
prev_before="$(link_tag previous)"
[ "$from" != "$tag" ] || die "$tag is already live"
have_world
ui_population_args=()
if [ "$redistribute_population" = 1 ]; then
  [ "$run_tests" = 1 ] && [ "$MVW_PROMOTE_UITEST" = 1 ] || die "population redistribution requires the full test and browser gates"
  [ -f "$RELEASES/$tag/tools/population-roster.mjs" ] || die "$tag has no population redistribution tool"
  node "$RELEASES/$tag/tools/population-roster.mjs" --data "$DATA" \
    > "$MVW_LIVE_ROOT/logs/population-preview-$tag.json" \
    || die "population redistribution preview failed; live was not touched"
  ui_population_args=(--redistribute-population)
fi

if [ "$run_tests" = 1 ]; then
  say "running the tests of $tag"
  (cd "$RELEASES/$tag" && npm test --silent >&2) || die "the tests of $tag failed; live was not touched"
  if [ "$MVW_PROMOTE_UITEST" = 1 ]; then
    [ -f "$RELEASES/$tag/tools/lib/browser.cjs" ] || die "$tag has no browser test harness; promote it with --skip-tests or set MVW_PROMOTE_UITEST=0"
    [ -d "$MVW_TEST_NODE_PATH/playwright-core" ] || die "playwright-core not found in $MVW_TEST_NODE_PATH (run npm ci in $MVW_REPO, or set MVW_TEST_NODE_PATH)"
    say "running the UI test of $tag in a real browser, on a throwaway server with a copy of the live data"
    # A release has no dev dependencies; playwright-core comes from MVW_TEST_NODE_PATH (the repository checkout).
    (cd "$RELEASES/$tag" && NODE_PATH="$MVW_TEST_NODE_PATH" node tools/uitest.cjs --data "$DATA" "${ui_population_args[@]}" \
      --out "$MVW_LIVE_ROOT/logs/uitest-$tag" --report "$MVW_LIVE_ROOT/logs/uitest-$tag.json" >&2) \
      || die "the UI test of $tag failed (report: $MVW_LIVE_ROOT/logs/uitest-$tag.json); live was not touched"
  fi
fi

# The key for stored secrets must work before live is stopped (DECISIONS C98): a server that cannot open its secrets
# refuses to start, and so would the release a failed promotion rolls back to.
node "$DEPLOY_DIR/keycheck.mjs" --data "$DATA" --unit "$MVW_LIVE_UNIT" --systemctl "$MVW_SYSTEMCTL" >&2 \
  || die "the key for stored secrets does not work (see above); live was not touched"
# The new release must accept the live configuration before live is stopped (PLAN WP1.6): a setting it rejects would
# stop it at start. Releases before 2.0.0-alpha.1 have no configcheck.mjs.
if [ -f "$RELEASES/$tag/tools/deploy/configcheck.mjs" ]; then
  node "$RELEASES/$tag/tools/deploy/configcheck.mjs" --unit "$MVW_LIVE_UNIT" --systemctl "$MVW_SYSTEMCTL" >&2 \
    || die "$tag does not accept the configuration of $MVW_LIVE_UNIT (see above); live was not touched"
fi
say "$kind: ${from:-(nothing)} -> $tag"
say "stopping $MVW_LIVE_UNIT (the server saves on stop)"
svc stop "$MVW_LIVE_UNIT"
if ! bk="$(backup_data "pre-$kind-$tag")"; then
  start_live
  die "the data backup failed; live was started again on ${from:-its current release} and nothing changed"
fi
say "backup: $bk"
if ! prepare_accounts_db "$tag"; then
  start_live
  die "the accounts database does not suit $tag; live was started again on ${from:-its current release} and nothing changed"
fi
# Explicit opt-in only: mutate resident model IDs after the service is stopped
# and its full data backup exists. Any failure restores that exact backup.
if [ "$redistribute_population" = 1 ]; then
  if ! node "$RELEASES/$tag/tools/population-roster.mjs" --data "$DATA" --apply --offline \
      --backup "$bk/data" --report "$MVW_LIVE_ROOT/logs/population-redistribution-$tag.json" >&2; then
    restore_data "$bk" || die "population redistribution and backup restore failed; service remains stopped; recover from $bk"
    start_live
    die "population redistribution failed; prior release/data restored"
  fi
fi
switch_to "$tag"
start_live
if verify_live "$tag" "$bk"; then
  log_event "$kind" "${from:-none} -> $tag" OK "$(basename "$bk")"
  say "live is now $tag"
  prune || say "WARNING: pruning old releases or backups failed"
  exit 0
fi

say "$tag failed its checks: restoring the backup and ${from:-(no previous release)}"
svc stop "$MVW_LIVE_UNIT" || true
restore_data "$bk" || say "WARNING: the data restore failed; the backup is still in $bk"
set_link current "$from"       # both links go back to exactly what they were, so rollback.sh never picks $tag
set_link previous "$prev_before"
if [ -n "$from" ]; then
  start_live
  if verify_live "$from" "$bk"; then
    say "live is back on $from"
  else
    say "WARNING: $from did not pass its checks either; read the live log"
  fi
fi
log_event "$kind" "${from:-none} -> $tag" "FAILED, back on ${from:-none}" "$(basename "$bk")"
exit 1
