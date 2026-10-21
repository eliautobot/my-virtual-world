#!/usr/bin/env bash
# Copyright (c) 2026 My Virtual World. Licensed under the PolyForm Noncommercial License 1.0.0 (see LICENSE).
# Refreshes the staging copy's data from live: back up live (hot copy) → stop staging → swap its data → start → check.
# The staging data it replaces is kept as data.previous. Accounts come along (the same people can sign in on staging),
# but every session is cleared, so no live session token works on staging. Staging must use its own session cookie
# name (MVW_COOKIE_NAME in its unit) when it shares a host name with live. Staging keeps a key of its own for stored
# secrets (DECISIONS C99): two-factor secrets and the recovery-code key are sealed again with it, every other stored
# secret is deleted from the copy, and live's key never goes to staging.
# Usage: tools/deploy/staging-refresh.sh
. "$(dirname "$0")/lib.sh"
: "${MVW_STAGING_ROOT:?MVW_STAGING_ROOT is not set in $DEPLOY_ENV}"
: "${MVW_STAGING_UNIT:?MVW_STAGING_UNIT is not set in $DEPLOY_ENV}"
: "${MVW_STAGING_URL:?MVW_STAGING_URL is not set in $DEPLOY_ENV}"

take_lock
bk="$(backup_data for-staging)"
say "live data copied: $bk"
svc stop "$MVW_STAGING_UNIT" || true
mkdir -p "$MVW_STAGING_ROOT/logs"
if [ -d "$MVW_STAGING_ROOT/data" ]; then
  rm -rf "$MVW_STAGING_ROOT/data.previous"
  mv "$MVW_STAGING_ROOT/data" "$MVW_STAGING_ROOT/data.previous"
fi
cp -a "$bk/data" "$MVW_STAGING_ROOT/data"
if [ -f "$MVW_STAGING_ROOT/data/next.db" ]; then node "$TOOLS/admin.mjs" sessions-clear --data "$MVW_STAGING_ROOT/data" >&2 || die "could not clear the copied sessions"; fi
if [ -f "$MVW_STAGING_ROOT/data/next.db" ]; then
  node "$DEPLOY_DIR/reseal-copy.mjs" --data "$MVW_STAGING_ROOT/data" --from-unit "$MVW_LIVE_UNIT" --to-unit "$MVW_STAGING_UNIT" \
    --systemctl "$MVW_SYSTEMCTL" >&2 || die "could not prepare the copied secrets for staging"
fi
svc reset-failed "$MVW_STAGING_UNIT" 2>/dev/null || true
svc start "$MVW_STAGING_UNIT"
node "$TOOLS/smoke.mjs" --url "$MVW_STAGING_URL" --baseline "$bk/manifest.json" --timeout 90 >&2 || die "staging did not pass its checks"
say "staging refreshed from live"
