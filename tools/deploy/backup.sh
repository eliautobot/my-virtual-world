#!/usr/bin/env bash
# My Virtual World — Copyright (c) 2026 My Virtual World. Licensed under the PolyForm Noncommercial License 1.0.0 (see LICENSE).
# Backs up the live data folder while the server runs. Every data file is written atomically (temporary file +
# rename), so each copied file is complete. Promotions and restores take their own backups with the server stopped.
# Usage: tools/deploy/backup.sh [<reason>]      prints the backup folder
. "$(dirname "$0")/lib.sh"

reason="${1:-manual}"
case "$reason" in *[!A-Za-z0-9._-]*) die "the reason may use letters, digits, dots, dashes and underscores" ;; esac
[ -d "$DATA" ] || die "no data folder: $DATA"
take_lock
bk="$(backup_data "$reason")" || die "the backup failed"
say "backup: $bk"
printf '%s\n' "$bk"
