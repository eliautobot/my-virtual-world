# Copyright (c) 2026 My Virtual World. Licensed under the PolyForm Noncommercial License 1.0.0 (see LICENSE).
# Shared helpers for tools/deploy/*.sh. Sourced by the scripts, never run directly.
# Configuration: ${MVW_DEPLOY_ENV:-~/.config/mvw-next/deploy.env} (start from deploy.env.example next to this file).
set -euo pipefail
shopt -s nullglob inherit_errexit   # errors inside $(...) stop the script too

DEPLOY_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
TOOLS="$(dirname "$DEPLOY_DIR")"
DEPLOY_ENV="${MVW_DEPLOY_ENV:-$HOME/.config/mvw-next/deploy.env}"
if [ ! -r "$DEPLOY_ENV" ]; then
  echo "deploy config not found: $DEPLOY_ENV (start from $DEPLOY_DIR/deploy.env.example)" >&2
  exit 2
fi
# shellcheck source=/dev/null
. "$DEPLOY_ENV"
: "${MVW_REPO:?MVW_REPO is not set in $DEPLOY_ENV}"
: "${MVW_LIVE_ROOT:?MVW_LIVE_ROOT is not set in $DEPLOY_ENV}"
: "${MVW_LIVE_UNIT:?MVW_LIVE_UNIT is not set in $DEPLOY_ENV}"
: "${MVW_LIVE_URL:?MVW_LIVE_URL is not set in $DEPLOY_ENV}"
MVW_SYSTEMCTL="${MVW_SYSTEMCTL:-systemctl --user}"
MVW_KEEP_RELEASES="${MVW_KEEP_RELEASES:-5}"
MVW_KEEP_BACKUPS="${MVW_KEEP_BACKUPS:-30}"
MVW_PROMOTE_UITEST="${MVW_PROMOTE_UITEST:-0}"                        # 1 = promotions also need the real-browser UI test
MVW_TEST_NODE_PATH="${MVW_TEST_NODE_PATH:-$MVW_REPO/node_modules}"  # where the UI test finds playwright-core
MVW_SMOKE_TIMEOUT="${MVW_SMOKE_TIMEOUT:-90}"
RELEASES="$MVW_LIVE_ROOT/releases"
DATA="$MVW_LIVE_ROOT/data"
BACKUPS="$MVW_LIVE_ROOT/backups"

say() { printf '%s  %s\n' "$(date '+%H:%M:%S')" "$*" >&2; }
die() { say "ERROR: $*"; exit 1; }
# MVW_SYSTEMCTL may hold several words ("sudo systemctl"), so it is split on purpose.
# shellcheck disable=SC2086
svc() { $MVW_SYSTEMCTL "$@"; }
stamp() { date '+%Y%m%d-%H%M%S'; }

take_lock() {     # one deploy at a time per installation
  mkdir -p "$MVW_LIVE_ROOT"
  exec 9>"$MVW_LIVE_ROOT/.deploy.lock"
  flock -n 9 || die "another deploy is running (lock: $MVW_LIVE_ROOT/.deploy.lock)"
}

link_tag() {      # link_tag <current|previous>: the release tag the link points at, or nothing
  local l="$MVW_LIVE_ROOT/$1"
  if [ -L "$l" ]; then basename "$(readlink "$l")"; fi
}

set_link() {      # set_link <current|previous> <tag|nothing>, replaced atomically; no tag removes the link
  if [ -z "${2:-}" ]; then rm -f "$MVW_LIVE_ROOT/$1"; return; fi
  ln -sfn "releases/$2" "$MVW_LIVE_ROOT/.$1.new"
  mv -Tf "$MVW_LIVE_ROOT/.$1.new" "$MVW_LIVE_ROOT/$1"
}

switch_to() {     # switch_to <tag>: the tag becomes current, the old current becomes previous
  local from
  from="$(link_tag current)"
  set_link current "$1"
  if [ -n "$from" ] && [ "$from" != "$1" ]; then set_link previous "$from"; fi
}

start_live() {    # a failed start is caught by the checks that follow, which then roll back
  svc reset-failed "$MVW_LIVE_UNIT" 2>/dev/null || true   # a crash loop must never block the next start
  svc start "$MVW_LIVE_UNIT" || say "systemctl start reported an error"
}

# backup_data and restore_data check every step themselves: callers use them inside "if" and "||",
# where bash ignores set -e.

new_backup_dir() {  # new_backup_dir <reason>: creates and prints a fresh folder under $BACKUPS
  local dir
  dir="$BACKUPS/$(stamp)-$1"
  if [ -e "$dir" ]; then dir="$dir-$$"; fi
  mkdir -p "$dir" || return 1
  printf '%s\n' "$dir"
}

accounts_backup_for_rollback() {   # the accounts database from the backup taken before the current release was promoted
  local cur b
  cur="$(link_tag current)"
  b="$(awk -F'\t' -v cur="$cur" '($2 == "promote" || $2 == "rollback") && $3 ~ ("-> " cur "$") && $4 == "OK" { b = $5 } END { print b }' "$MVW_LIVE_ROOT/promotions.log" 2>/dev/null)"
  [ -n "$b" ] && [ -f "$MVW_LIVE_ROOT/backups/$b/data/next.db" ] || return 1
  printf '%s\n' "$MVW_LIVE_ROOT/backups/$b/data/next.db"
}
# prepare_accounts_db <tag>: the accounts database must suit the release about to start (DECISIONS C84). A release that
# knows an older schema gets the schema number lowered when every newer migration only added things (nothing is lost);
# otherwise the accounts database is restored from the backup taken before the current release was promoted, which
# loses account changes since then, and only with MVW_RESTORE_ACCOUNTS=1 (promote.sh / rollback.sh --restore-accounts).
prepare_accounts_db() {
  local db="$DATA/next.db" want have src
  [ -f "$db" ] || return 0
  want="$(node "$DEPLOY_DIR/dbschema.mjs" release-schema "$RELEASES/$1")" || return 1
  [ "$want" -gt 0 ] || return 0              # that release has no accounts database and ignores next.db
  have="$(node "$DEPLOY_DIR/dbschema.mjs" version "$db")" || return 1
  [ "$have" -gt "$want" ] || return 0         # the release migrates forward itself when it starts
  if node "$DEPLOY_DIR/dbschema.mjs" downgrade "$db" "$want" >&2; then
    say "accounts database: schema $have -> $want for $1 (only additive changes, nothing lost)"
    return 0
  fi
  if [ "${MVW_RESTORE_ACCOUNTS:-0}" != 1 ]; then
    say "$1 cannot read the accounts database (schema $have, it knows $want). To go back anyway, restore the accounts"
    say "database from the backup taken before the current release was promoted (account changes since then are lost):"
    say "rerun with --restore-accounts"
    return 1
  fi
  src="$(accounts_backup_for_rollback)" || { say "no pre-promotion backup of the accounts database was found"; return 1; }
  node "$DEPLOY_DIR/dbcopy.mjs" "$src" "$db.restore" >&2 || return 1
  rm -f "$db-wal" "$db-shm"
  mv "$db.restore" "$db" || return 1
  say "accounts database restored from $src"
}

backup_data() {   # backup_data <reason>: copies the live data folder, prints the backup folder
  local dir
  dir="$(new_backup_dir "$1")" || return 1
  cp -a "$DATA" "$dir/data" || return 1
  find "$dir/data" -maxdepth 1 -name '*.tmp' -delete || return 1
  # The accounts database may be written while this runs: replace the plain copy with SQLite's online backup.
  rm -f "$dir/data/next.db" "$dir/data/next.db-wal" "$dir/data/next.db-shm"
  if [ -f "$DATA/next.db" ]; then node "$DEPLOY_DIR/dbcopy.mjs" "$DATA/next.db" "$dir/data/next.db" >&2 || return 1; fi
  node "$DEPLOY_DIR/manifest.mjs" "$dir/data" > "$dir/manifest.json" || return 1
  printf '%s\n' "$dir"
}

restore_data() {  # restore_data <backup folder>: the server must be stopped; the replaced data is kept as a backup
  local src="$1" aside="" tmp="$DATA.restoring"
  if [ ! -d "$src/data" ] || [ ! -f "$src/manifest.json" ]; then say "not a backup folder: $src"; return 1; fi
  rm -rf "$tmp"
  if ! cp -a "$src/data" "$tmp"; then rm -rf "$tmp"; return 1; fi   # copy first: a failed copy changes nothing
  if [ -d "$DATA" ]; then
    aside="$(new_backup_dir replaced-by-restore)" || return 1
    mv "$DATA" "$aside/data" || return 1
    node "$DEPLOY_DIR/manifest.mjs" "$aside/data" > "$aside/manifest.json" || say "WARNING: no manifest for $aside"
  fi
  if ! mv "$tmp" "$DATA"; then
    if [ -n "$aside" ]; then mv "$aside/data" "$DATA"; fi   # put the replaced data back rather than leave none
    return 1
  fi
  say "data restored from $(basename "$src")${aside:+; the replaced data is kept in $(basename "$aside")}"
}

have_world() {    # a server started on an empty data folder generates a new city, so deploys never start one
  [ -f "$DATA/world.json" ] || die "no world.json in $DATA; set up the live data folder first"
}

unit_dir() {      # the folder the running live process works in
  local pid
  pid="$(svc show -p MainPID --value "$MVW_LIVE_UNIT")"
  if [ "${pid:-0}" -gt 0 ]; then readlink -f "/proc/$pid/cwd"; fi
}

wait_live() {     # waits until live answers /api/health; gives up early when the service keeps crashing
  local deadline restarts state
  deadline=$(( $(date +%s) + MVW_SMOKE_TIMEOUT ))
  while [ "$(date +%s)" -lt "$deadline" ]; do
    if node -e 'fetch(process.argv[1] + "/api/health", { signal: AbortSignal.timeout(2000) }).then(r => r.json()).then(h => process.exit(h && h.ok === true ? 0 : 1), () => process.exit(1))' "$MVW_LIVE_URL"; then
      return 0
    fi
    restarts="$(svc show -p NRestarts --value "$MVW_LIVE_UNIT" 2>/dev/null || true)"
    state="$(svc show -p ActiveState --value "$MVW_LIVE_UNIT" 2>/dev/null || true)"
    if [ "${restarts:-0}" -ge 2 ] || [ "$state" = failed ]; then
      say "$MVW_LIVE_UNIT keeps crashing (state ${state:-unknown}, ${restarts:-0} automatic restarts)"
      return 1
    fi
    sleep 1
  done
  say "no healthy answer from $MVW_LIVE_URL within $MVW_SMOKE_TIMEOUT s"
  return 1
}

verify_live() {   # verify_live <tag> [<backup folder>]: smoke test, and the live process must run the tag's folder
  local tag="$1" want got
  local base=()
  if [ -n "${2:-}" ]; then base=(--baseline "$2/manifest.json"); fi
  wait_live || return 1
  node "$TOOLS/smoke.mjs" --url "$MVW_LIVE_URL" --expect-tag "$tag" "${base[@]}" --timeout 30 >&2 || return 1
  want="$(readlink -f "$RELEASES/$tag")"
  got="$(unit_dir)"
  if [ "$got" != "$want" ]; then
    say "the live process runs in ${got:-nothing}, expected $want"
    return 1
  fi
  say "the live process runs $want"
}

log_event() {     # one tab-separated line per promotion, rollback or restore: time, kind, what, result, backup
  local IFS=$'\t'
  printf '%s\t%s\n' "$(date '+%Y-%m-%dT%H:%M:%S%z')" "$*" >> "$MVW_LIVE_ROOT/promotions.log"
}

prune() {         # keeps current, previous, the newest $MVW_KEEP_RELEASES releases and $MVW_KEEP_BACKUPS backups
  local cur prev d t i
  cur="$(link_tag current)"
  prev="$(link_tag previous)"
  i=0
  while IFS= read -r d; do
    i=$((i + 1))
    t="$(basename "$d")"
    if [ "$i" -le "$MVW_KEEP_RELEASES" ] || [ "$t" = "$cur" ] || [ "$t" = "$prev" ]; then continue; fi
    chmod -R u+w "$d" && rm -rf "$d" && say "pruned release $t"
  done < <(find "$RELEASES" -mindepth 1 -maxdepth 1 -type d ! -name '.*' -printf '%T@ %p\n' 2>/dev/null | sort -rn | cut -d' ' -f2-)
  i=0
  while IFS= read -r d; do
    i=$((i + 1))
    if [ "$i" -le "$MVW_KEEP_BACKUPS" ]; then continue; fi
    rm -rf "$d" && say "pruned backup $(basename "$d")"
  done < <(find "$BACKUPS" -mindepth 1 -maxdepth 1 -type d -printf '%T@ %p\n' 2>/dev/null | sort -rn | cut -d' ' -f2-)
}
