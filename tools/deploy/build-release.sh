#!/usr/bin/env bash
# Copyright (c) 2026 My Virtual World. Licensed under the PolyForm Noncommercial License 1.0.0 (see LICENSE).
# Builds a release folder from a git tag: $MVW_LIVE_ROOT/releases/<tag>, with production dependencies and a
# release.json (tag, commit, build time), made read-only. Building the same tag again is a no-op.
# Usage: tools/deploy/build-release.sh <tag>
. "$(dirname "$0")/lib.sh"

tag="${1:-}"
[ -n "$tag" ] || die "usage: build-release.sh <tag>"
case "$tag" in *[!A-Za-z0-9._-]* | .*) die "unsupported tag name: $tag" ;; esac
commit="$(git -C "$MVW_REPO" rev-parse -q --verify "refs/tags/$tag^{commit}")" || die "no tag $tag in $MVW_REPO"
dest="$RELEASES/$tag"

if [ -d "$dest" ]; then
  have="$(node -e 'try { console.log(JSON.parse(require("fs").readFileSync(process.argv[1], "utf8")).commit) } catch {}' "$dest/release.json")"
  [ "$have" = "$commit" ] || die "$dest exists but was built from ${have:-an unknown commit}, not $commit"
  say "release $tag is already built ($commit)"
  exit 0
fi

mkdir -p "$RELEASES"
tmp="$RELEASES/.build-$tag-$$"
trap 'if [ -d "$tmp" ]; then chmod -R u+w "$tmp"; rm -rf "$tmp"; fi' EXIT
mkdir "$tmp"
git -C "$MVW_REPO" archive --format=tar "$commit" | tar -x -C "$tmp"
say "installing the production dependencies of $tag"
(cd "$tmp" && npm ci --omit=dev --ignore-scripts --no-audit --no-fund --loglevel=error >&2)
TAG="$tag" COMMIT="$commit" node -e 'console.log(JSON.stringify({ tag: process.env.TAG, commit: process.env.COMMIT, builtAt: new Date().toISOString(), node: process.version }, null, 2))' > "$tmp/release.json"
mv "$tmp" "$dest"
chmod -R a-w "$dest"
trap - EXIT
say "built $dest ($commit)"
