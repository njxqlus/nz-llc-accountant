#!/bin/sh
set -eu

psql -v ON_ERROR_STOP=1 --username "$POSTGRES_USER" <<'SQL'
CREATE DATABASE media_assets;
SQL
