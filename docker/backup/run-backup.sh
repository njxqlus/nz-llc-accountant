#!/bin/bash
set -euo pipefail

required_vars=(
  POSTGRES_HOST
  POSTGRES_PORT
  POSTGRES_USER
  POSTGRES_PASSWORD
  APP_DB_NAME
  DAM_DB_NAME
  RESTIC_PASSWORD
  BACKUP_S3_ENDPOINT
  BACKUP_S3_BUCKET
  AWS_ACCESS_KEY_ID
  AWS_SECRET_ACCESS_KEY
  DAM_S3_BUCKET
)

for var_name in "${required_vars[@]}"; do
  if [[ -z "${!var_name:-}" ]]; then
    echo "Missing required environment variable: ${var_name}" >&2
    exit 1
  fi
done

backup_set="${RESTIC_BACKUP_SET-nz-llc-accountant}"
keep_last="${RESTIC_KEEP_LAST-1}"
if [[ ! "$backup_set" =~ ^[a-zA-Z0-9][a-zA-Z0-9_.-]*$ ]]; then
  echo "RESTIC_BACKUP_SET must be a non-empty identifier using letters, digits, dots, underscores or hyphens." >&2
  exit 1
fi
if [[ ! "$keep_last" =~ ^[1-9][0-9]*$ ]]; then
  echo "RESTIC_KEEP_LAST must be a positive integer." >&2
  exit 1
fi
backup_tag="backup-set:${backup_set}"

export PGPASSWORD="$POSTGRES_PASSWORD"
export RESTIC_REPOSITORY="s3:${BACKUP_S3_ENDPOINT}/${BACKUP_S3_BUCKET}/${BACKUP_S3_PREFIX:-nz-llc-accountant}"

timestamp="$(TZ="${TZ:-UTC}" date +%Y-%m-%dT%H-%M-%S)"
workspace="/tmp/backup-${timestamp}"
snapshot_root="${workspace}/snapshot"
postgres_dir="${snapshot_root}/postgres"
media_dir="${snapshot_root}/media"

mkdir -p "$postgres_dir" "$media_dir"

if ! restic snapshots >/dev/null 2>&1; then
  restic init
fi

pg_dump \
  --host="$POSTGRES_HOST" \
  --port="$POSTGRES_PORT" \
  --username="$POSTGRES_USER" \
  --format=custom \
  --file="${postgres_dir}/${APP_DB_NAME}.dump" \
  "$APP_DB_NAME"

pg_dump \
  --host="$POSTGRES_HOST" \
  --port="$POSTGRES_PORT" \
  --username="$POSTGRES_USER" \
  --format=custom \
  --file="${postgres_dir}/${DAM_DB_NAME}.dump" \
  "$DAM_DB_NAME"

media_source="media:${DAM_S3_BUCKET}"
if [[ -n "${DAM_S3_PREFIX:-}" ]]; then
  media_source="${media_source}/${DAM_S3_PREFIX}"
fi

rclone sync "$media_source" "$media_dir"

cat > "${snapshot_root}/manifest.txt" <<EOF
created_at=${timestamp}
app_db=${APP_DB_NAME}
dam_db=${DAM_DB_NAME}
media_bucket=${DAM_S3_BUCKET}
media_prefix=${DAM_S3_PREFIX:-}
EOF

restic backup "$snapshot_root" --tag daily --tag "$backup_tag"
# Paths contain timestamps and container hostnames can change between runs.
# Only this explicitly named set participates; legacy daily-only snapshots stay intact.
restic forget --tag "$backup_tag" --group-by '' --keep-last "$keep_last" --prune

printf '%s\n' "$timestamp" > /var/lib/backup/last-success.txt
rm -rf "$workspace"
