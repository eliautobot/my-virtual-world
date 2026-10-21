#!/usr/bin/env bash
# Copyright (c) 2026 My Virtual World. Licensed under the PolyForm Noncommercial License 1.0.0 (see LICENSE).
# Rolls live back to the previous release (or a named one), with the same backup and checks as a promotion.
# Code only: the world data stays. The accounts database is made to suit the older release (DECISIONS C84): when
# every newer schema change only added things, its schema number is lowered and nothing is lost; otherwise the
# rollback stops, and --restore-accounts restores the accounts database from the backup taken before the current
# release was promoted (account changes since then are lost). To go back to older world data as well, run restore.sh.
# Usage: tools/deploy/rollback.sh [<tag>] [--restore-accounts]
. "$(dirname "$0")/lib.sh"

tag=""
for arg in "$@"; do
  case "$arg" in
    --restore-accounts) export MVW_RESTORE_ACCOUNTS=1 ;;
    -*) die "unknown option: $arg" ;;
    *) [ -z "$tag" ] || die "give one tag only"; tag="$arg" ;;
  esac
done
tag="${tag:-$(link_tag previous)}"
[ -n "$tag" ] || die "no previous release is recorded; name the tag to roll back to"
exec "$DEPLOY_DIR/promote.sh" "$tag" --rollback
