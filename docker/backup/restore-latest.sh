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

export PGPASSWORD="$POSTGRES_PASSWORD"
export RESTIC_REPOSITORY="s3:${BACKUP_S3_ENDPOINT}/${BACKUP_S3_BUCKET}/${BACKUP_S3_PREFIX:-nz-llc-accountant}"

rm -rf "${RESTORE_ROOT:?}/latest"
mkdir -p "${RESTORE_ROOT}/latest"

restic restore latest --target "${RESTORE_ROOT}/latest"

restored_root="${RESTORE_ROOT}/latest/tmp"
snapshot_dir="$(find "$restored_root" -maxdepth 2 -type d -name snapshot | head -n 1)"

if [[ -z "${snapshot_dir}" ]]; then
  echo "Could not find restored snapshot directory." >&2
  exit 1
fi

app_dump="${snapshot_dir}/postgres/${APP_DB_NAME}.dump"
dam_dump="${snapshot_dir}/postgres/${DAM_DB_NAME}.dump"
media_dir="${snapshot_dir}/media"

for dump_file in "$app_dump" "$dam_dump"; do
  if [[ ! -f "$dump_file" ]]; then
    echo "Missing dump file: ${dump_file}" >&2
    exit 1
  fi
done

psql --host="$POSTGRES_HOST" --port="$POSTGRES_PORT" --username="$POSTGRES_USER" --dbname=postgres \
  -c "SELECT pg_terminate_backend(pid) FROM pg_stat_activity WHERE datname IN ('${APP_DB_NAME}', '${DAM_DB_NAME}') AND pid <> pg_backend_pid();"
psql --host="$POSTGRES_HOST" --port="$POSTGRES_PORT" --username="$POSTGRES_USER" --dbname=postgres \
  -c "DROP DATABASE IF EXISTS \"${APP_DB_NAME}\";"
psql --host="$POSTGRES_HOST" --port="$POSTGRES_PORT" --username="$POSTGRES_USER" --dbname=postgres \
  -c "DROP DATABASE IF EXISTS \"${DAM_DB_NAME}\";"
psql --host="$POSTGRES_HOST" --port="$POSTGRES_PORT" --username="$POSTGRES_USER" --dbname=postgres \
  -c "CREATE DATABASE \"${APP_DB_NAME}\";"
psql --host="$POSTGRES_HOST" --port="$POSTGRES_PORT" --username="$POSTGRES_USER" --dbname=postgres \
  -c "CREATE DATABASE \"${DAM_DB_NAME}\";"

pg_restore --host="$POSTGRES_HOST" --port="$POSTGRES_PORT" --username="$POSTGRES_USER" --dbname="$APP_DB_NAME" --clean --if-exists "$app_dump"
pg_restore --host="$POSTGRES_HOST" --port="$POSTGRES_PORT" --username="$POSTGRES_USER" --dbname="$DAM_DB_NAME" --clean --if-exists "$dam_dump"

if [[ -d "$media_dir" ]]; then
  media_target="media:${DAM_S3_BUCKET}"
  if [[ -n "${DAM_S3_PREFIX:-}" ]]; then
    media_target="${media_target}/${DAM_S3_PREFIX}"
  fi

  rclone sync "$media_dir" "$media_target"
fi

printf '%s\n' "restore completed from latest snapshot into ${RESTORE_ROOT}/latest"
