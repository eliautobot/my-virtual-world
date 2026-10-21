#!/usr/bin/env bash
# My Virtual World — Copyright (c) 2026 My Virtual World. Licensed under the PolyForm Noncommercial License 1.0.0 (see LICENSE).
# Rehearses the whole release flow on a throwaway systemd user unit, with a copy of a data folder. Live is never touched.
#   first release → promote → rollback → promote again
#   → a release that crashes on start (rolled back)
#   → a release that damages the data (rolled back, data restored from the pre-promotion backup)
#   → a release whose tests fail (stopped before anything changes)
#   → (with --uitest) a release whose client is broken: the server and the unit tests are fine, only the
#     real-browser UI test notices (stopped before anything changes)
#   → hot backup → restore → rollback with pruning
# Usage: tools/deploy/rehearse.sh --data <data folder to copy> --port <free local port> --from <tag> --to <tag>
#                                 [--repo <git checkout with the tags>] [--keep] [--uitest]
# --uitest turns on the UI-test gate (MVW_PROMOTE_UITEST=1); --to must then contain tools/lib/browser.cjs.
# The unit is named mvw-rehearsal-<port>.service; it and the temporary folder are removed at the end (--keep keeps
# the folder). Exit code 0 = every check passed.
set -euo pipefail
shopt -s inherit_errexit nullglob

DEPLOY_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
TOOLS="$(dirname "$DEPLOY_DIR")"
repo_src="" data="" port="" from="" to="" keep=0 uitest=0
while [ $# -gt 0 ]; do
  case "$1" in
    --data) data="${2:-}"; shift ;;
    --port) port="${2:-}"; shift ;;
    --from) from="${2:-}"; shift ;;
    --to) to="${2:-}"; shift ;;
    --repo) repo_src="${2:-}"; shift ;;
    --keep) keep=1 ;;
    --uitest) uitest=1 ;;
    *) echo "unknown argument: $1" >&2; exit 2 ;;
  esac
  shift
done
if [ -z "$data" ] || [ -z "$port" ] || [ -z "$from" ] || [ -z "$to" ]; then
  echo "usage: rehearse.sh --data <folder> --port <port> --from <tag> --to <tag> [--repo <checkout>] [--keep] [--uitest]" >&2
  exit 2
fi
repo_src="${repo_src:-$(git -C "$DEPLOY_DIR" rev-parse --show-toplevel)}"
[ -f "$data/world.json" ] && [ -f "$data/people.json" ] || { echo "no world.json and people.json in $data" >&2; exit 2; }
case "$port" in '' | *[!0-9]*) echo "not a port: $port" >&2; exit 2 ;; esac
if ss -ltnH "sport = :$port" | grep -q .; then echo "port $port is in use" >&2; exit 2; fi
unit="mvw-rehearsal-$port.service"
unit_file="$HOME/.config/systemd/user/$unit"
[ ! -e "$unit_file" ] || { echo "$unit_file already exists" >&2; exit 2; }

work="$(mktemp -d /tmp/mvw-rehearsal-XXXXXX)"
root="$work/live"
url="http://127.0.0.1:$port"
export MVW_DEPLOY_ENV="$work/deploy.env"
cleanup() {
  systemctl --user stop "$unit" 2>/dev/null || true
  rm -f "$unit_file"
  systemctl --user daemon-reload || true
  systemctl --user reset-failed "$unit" 2>/dev/null || true
  if [ "$keep" = 0 ]; then chmod -R u+w "$work" 2>/dev/null || true; rm -rf "$work"; else echo "kept: $work"; fi
}
trap cleanup EXIT

say() { printf '%s  %s\n' "$(date '+%H:%M:%S')" "$*"; }
step=0 fails=0 last_log=""
ok() { printf 'PASS  %s\n' "$*"; }
bad() { printf 'FAIL  %s\n' "$*"; fails=$((fails + 1)); }
is() { if [ "$2" = "$3" ]; then ok "$1: $2"; else bad "$1: $2, expected $3"; fi; }
expect_rc() {     # expect_rc <expected exit code> <title> <command...>
  local want="$1" title="$2" rc
  shift 2
  step=$((step + 1))
  last_log="$work/steps/$(printf '%02d' "$step").log"
  if "$@" > "$last_log" 2>&1; then rc=0; else rc=$?; fi
  if [ "$rc" = "$want" ]; then
    ok "$title (exit $rc)"
  else
    bad "$title: exit $rc, expected $want (log: $last_log)"
    tail -n 20 "$last_log" | sed 's/^/        /'
  fi
}
tag_of() { if [ -L "$root/$1" ]; then basename "$(readlink "$root/$1")"; else echo none; fi; }
health_tag() {
  curl -s -m 5 "$url/api/health" | node -e 'let s="";process.stdin.on("data",d=>s+=d).on("end",()=>{try{const h=JSON.parse(s);console.log(h.release?.tag||"none")}catch{console.log("no answer")}})'
}
reported() { if git -C "$work/repo" cat-file -e "$1:server/release.js" 2>/dev/null; then echo "$1"; else echo none; fi; }
main_pid() { systemctl --user show -p MainPID --value "$unit"; }
people_in() { node -e 'console.log(JSON.parse(require("fs").readFileSync(process.argv[1], "utf8")).length)' "$1/people.json"; }
newest_backup() { local d; d="$(find "$root/backups" -mindepth 1 -maxdepth 1 -type d -name "*$1*" -printf '%T@ %p\n' | sort -rn | head -n1 | cut -d' ' -f2-)"; printf '%s\n' "$d"; }
last_event() { tail -n1 "$root/promotions.log" | cut -f2-; }

mkdir -p "$work/steps" "$root/data" "$root/logs"
say "rehearsal folder $work, unit $unit on $url"

# A private clone of the repository, with three deliberately broken releases on top of $to.
git clone -q --no-hardlinks "$repo_src" "$work/repo"
git -C "$work/repo" rev-parse -q --verify "refs/tags/$from^{commit}" > /dev/null || { echo "no tag $from" >&2; exit 2; }
git -C "$work/repo" rev-parse -q --verify "refs/tags/$to^{commit}" > /dev/null || { echo "no tag $to" >&2; exit 2; }
broken() {        # broken <tag> <description> <shell command run in the clone>
  git -C "$work/repo" checkout -q --detach "$to"
  (cd "$work/repo" && eval "$3")
  git -C "$work/repo" add -A
  git -C "$work/repo" -c user.name=rehearsal -c user.email=rehearsal@localhost commit -q -m "rehearsal: $2"
  git -C "$work/repo" tag "$1"
}
grep -q "^let people = store.load('people');$" "$work/repo/server/index.mjs" || { echo "$to: cannot place the data-damage change" >&2; exit 2; }
broken rehearsal-crash "crashes on start" \
  "sed -i '1i throw new Error(\"rehearsal: this release crashes on start\");' server/index.mjs"
broken rehearsal-damage "drops half of the residents at start" \
  "sed -i \"s|^let people = store.load('people');\$|&\\nif (Array.isArray(people)) people.length = Math.floor(people.length / 2); // rehearsal|\" server/index.mjs"
broken rehearsal-failtests "a failing test" \
  "mkdir -p tests && printf '%s\n' \"import test from 'node:test';\" \"import assert from 'node:assert/strict';\" \"test('rehearsal', () => assert.fail('this release fails its tests'));\" > tests/rehearsal.test.mjs"
newest=rehearsal-failtests
if [ "$uitest" = 1 ]; then
  git -C "$work/repo" cat-file -e "$to:tools/lib/browser.cjs" 2>/dev/null || { echo "$to has no browser test harness; --uitest needs a newer --to" >&2; exit 2; }
  [ -d "$repo_src/node_modules/playwright-core" ] || { echo "playwright-core is not installed in $repo_src (npm ci)" >&2; exit 2; }
  git -C "$work/repo" show "$to:client/js/player/player.js" | grep -q 'ux = ix / n, uz = iz / n' || { echo "$to: cannot place the broken-client change" >&2; exit 2; }
  broken rehearsal-client "the player walks backwards (only the browser test notices)" \
    "sed -i 's|ux = ix / n, uz = iz / n|ux = -ix / n, uz = -iz / n|' client/js/player/player.js"
  newest=rehearsal-client
fi

cat > "$MVW_DEPLOY_ENV" <<EOF
MVW_REPO=$work/repo
MVW_LIVE_ROOT=$root
MVW_LIVE_UNIT=$unit
MVW_LIVE_URL=$url
MVW_SYSTEMCTL="systemctl --user"
MVW_SMOKE_TIMEOUT=25
MVW_KEEP_RELEASES=3
MVW_KEEP_BACKUPS=30
MVW_PROMOTE_UITEST=$uitest
MVW_TEST_NODE_PATH=$repo_src/node_modules
EOF

for f in world.json people.json meta.json; do if [ -f "$data/$f" ]; then cp "$data/$f" "$root/data/"; fi; done
# The copy gets a new accounts database, so it must not keep the world id of the database it came from (DECISIONS
# C104): releases before 2.0.0-alpha.1 do not take the id over, and a later release would refuse the pair.
node -e 'const fs = require("fs"), path = require("path"); for (const f of ["world.json", "meta.json"]) { const p = path.join(process.argv[1], f); if (!fs.existsSync(p)) continue; const j = JSON.parse(fs.readFileSync(p, "utf8")); if (j && typeof j === "object" && !Array.isArray(j) && "worldId" in j) { delete j.worldId; fs.writeFileSync(p, JSON.stringify(j)); } }' "$root/data"
node "$DEPLOY_DIR/manifest.mjs" "$root/data" > "$work/initial.json"
initial_people="$(people_in "$root/data")"
say "data copied: $(node -e 'const m=require(process.argv[1]).counts;console.log(`${m.buildings} buildings, ${m.people} residents, world version ${m.worldVersion}`)' "$work/initial.json")"

cat > "$unit_file" <<EOF
[Unit]
Description=My Virtual World Next: release-flow rehearsal on port $port (throwaway, removed by rehearse.sh)

[Service]
Type=simple
WorkingDirectory=$root/current
Environment=PORT=$port
Environment=HOST=127.0.0.1
Environment=MVW_DATA=$root/data
Environment=MVW_KEY_FILE=$work/secret.key
Environment=MVW_POPULATION=4000
Environment=NODE_ENV=production
ExecStart=$(command -v node) server/index.mjs
Restart=on-failure
RestartSec=2
TimeoutStopSec=25
KillSignal=SIGTERM
StandardOutput=append:$root/logs/server.log
StandardError=append:$root/logs/server.log
EOF
systemctl --user daemon-reload

say "1. first release"
expect_rc 0 "build $from" "$DEPLOY_DIR/build-release.sh" "$from"
ln -s "releases/$from" "$root/current"
systemctl --user start "$unit"
expect_rc 0 "$from passes the smoke test against the copied data" node "$TOOLS/smoke.mjs" --url "$url" --expect-tag "$from" --baseline "$work/initial.json" --timeout 60

say "2. promote, roll back, promote again"
expect_rc 0 "promote $from -> $to" "$DEPLOY_DIR/promote.sh" "$to"
is "current" "$(tag_of current)" "$to"
is "previous" "$(tag_of previous)" "$from"
is "the server reports release" "$(health_tag)" "$(reported "$to")"
expect_rc 0 "roll back to $from" "$DEPLOY_DIR/rollback.sh"
is "current" "$(tag_of current)" "$from"
is "previous" "$(tag_of previous)" "$to"
is "the server reports release" "$(health_tag)" "$(reported "$from")"
schema_of() { node "$DEPLOY_DIR/dbschema.mjs" "$@"; }
if [ -f "$root/data/next.db" ] && [ "$(schema_of release-schema "$root/releases/$from")" -gt 0 ]; then
  is "accounts schema after the rollback (C84)" "$(schema_of version "$root/data/next.db")" "$(schema_of release-schema "$root/releases/$from")"
fi
expect_rc 0 "promote $to again (already built)" "$DEPLOY_DIR/promote.sh" "$to"
is "current" "$(tag_of current)" "$to"
is "previous" "$(tag_of previous)" "$from"
if [ -f "$root/data/next.db" ] && [ "$(schema_of release-schema "$root/releases/$to")" -gt 0 ]; then
  is "accounts schema after promoting again" "$(schema_of version "$root/data/next.db")" "$(schema_of release-schema "$root/releases/$to")"
fi

say "3. a release that crashes on start"
expect_rc 1 "promote rehearsal-crash (tests skipped, as if they had missed the bug)" "$DEPLOY_DIR/promote.sh" rehearsal-crash --skip-tests
is "current" "$(tag_of current)" "$to"
is "previous" "$(tag_of previous)" "$from"
is "the server reports release" "$(health_tag)" "$(reported "$to")"
is "promotions.log" "$(last_event)" "promote	$to -> rehearsal-crash	FAILED, back on $to	$(basename "$(newest_backup pre-promote-rehearsal-crash)")"
bk="$(newest_backup pre-promote-rehearsal-crash)"
expect_rc 0 "live passes the smoke test against the pre-promotion backup" node "$TOOLS/smoke.mjs" --url "$url" --expect-tag "$to" --baseline "$bk/manifest.json" --timeout 30

say "4. a release that damages the data"
expect_rc 1 "promote rehearsal-damage (tests skipped)" "$DEPLOY_DIR/promote.sh" rehearsal-damage --skip-tests
bk="$(newest_backup pre-promote-rehearsal-damage)"
damaged="$(newest_backup replaced-by-restore)"
is "current" "$(tag_of current)" "$to"
is "the damaged data kept aside had residents" "$(people_in "$damaged/data")" "$(( $(people_in "$bk/data") / 2 ))"
is "residents in the restored data" "$(people_in "$root/data")" "$(people_in "$bk/data")"
expect_rc 0 "live passes the smoke test against the pre-promotion backup" node "$TOOLS/smoke.mjs" --url "$url" --expect-tag "$to" --baseline "$bk/manifest.json" --timeout 30

say "5. a release whose tests fail"
pid_before="$(main_pid)"
backups_before="$(find "$root/backups" -mindepth 1 -maxdepth 1 -type d | wc -l)"
expect_rc 1 "promote rehearsal-failtests" "$DEPLOY_DIR/promote.sh" rehearsal-failtests
is "live process id (not restarted)" "$(main_pid)" "$pid_before"
is "backups (none taken)" "$(find "$root/backups" -mindepth 1 -maxdepth 1 -type d | wc -l)" "$backups_before"
is "current" "$(tag_of current)" "$to"

if [ "$uitest" = 1 ]; then
  say "5b. a release whose client is broken (server and unit tests fine; only the browser test notices)"
  pid_before="$(main_pid)"
  backups_before="$(find "$root/backups" -mindepth 1 -maxdepth 1 -type d | wc -l)"
  expect_rc 1 "promote rehearsal-client" "$DEPLOY_DIR/promote.sh" rehearsal-client
  is "live process id (not restarted)" "$(main_pid)" "$pid_before"
  is "backups (none taken)" "$(find "$root/backups" -mindepth 1 -maxdepth 1 -type d | wc -l)" "$backups_before"
  is "current" "$(tag_of current)" "$to"
  is "UI test report: W walks forward" "$(node -e 'try { const r = require(process.argv[1]); const x = r.results.find(t => t.name === "W walks forward"); console.log(x ? (x.ok ? "PASS" : "FAIL") : "missing") } catch { console.log("no report") }' "$root/logs/uitest-rehearsal-client.json")" FAIL
fi

say "6. hot backup and restore"
expect_rc 0 "hot backup" "$DEPLOY_DIR/backup.sh" rehearsal
hot="$(tail -n1 "$last_log")"
is "backup manifest residents" "$(node -e 'console.log(require(process.argv[1]).counts.people)' "$hot/manifest.json")" "$(people_in "$hot/data")"
expect_rc 0 "restore the hot backup" "$DEPLOY_DIR/restore.sh" "$hot"
is "residents after the restore" "$(people_in "$root/data")" "$(people_in "$hot/data")"
is "residents compared with the copied data" "$(people_in "$root/data")" "$initial_people"

say "7. roll back with pruning (keep the newest release plus current and previous)"
sed -i 's/^MVW_KEEP_RELEASES=.*/MVW_KEEP_RELEASES=1/' "$MVW_DEPLOY_ENV"
expect_rc 0 "roll back to $from" "$DEPLOY_DIR/rollback.sh"
is "current" "$(tag_of current)" "$from"
is "releases left" "$(find "$root/releases" -mindepth 1 -maxdepth 1 -type d ! -name '.*' -printf '%f\n' | sort | tr '\n' ' ')" "$(printf '%s\n' "$newest" "$from" "$to" | sort | tr '\n' ' ')"

echo
echo "promotions.log:"
sed 's/^/  /' "$root/promotions.log"
echo "server log: $(grep -c 'listening on' "$root/logs/server.log") starts, $(grep -c 'rehearsal: this release crashes' "$root/logs/server.log") crash lines"
echo
if [ "$fails" = 0 ]; then echo "REHEARSAL PASSED ($step commands, every check green)"; else echo "REHEARSAL FAILED: $fails check(s)"; fi
[ "$fails" = 0 ]
