#!/bin/bash
set -euo pipefail

mkdir -p /var/lib/backup "$RESTORE_ROOT"

if [[ "${1:-}" == "run-backup" ]]; then
  exec run-backup
fi

if [[ "${1:-}" == "restore-latest" ]]; then
  exec restore-latest
fi

last_run_file=/var/lib/backup/last-run-date.txt
schedule_hour="${BACKUP_SCHEDULE_HOUR:-22}"
schedule_minute="${BACKUP_SCHEDULE_MINUTE:-00}"

while true; do
  today="$(TZ="${TZ:-UTC}" date +%F)"
  current_hour="$(TZ="${TZ:-UTC}" date +%H)"
  current_minute="$(TZ="${TZ:-UTC}" date +%M)"
  last_run=""

  if [[ -f "$last_run_file" ]]; then
    last_run="$(cat "$last_run_file")"
  fi

  if [[ "$current_hour" == "$schedule_hour" && "$current_minute" == "$schedule_minute" && "$last_run" != "$today" ]]; then
    run-backup
    printf '%s' "$today" > "$last_run_file"
  fi

  sleep 30
done
