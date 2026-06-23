# NZ LLC GST Expense Tracker

Local-only GST expense tracker for a New Zealand LLC, built with Bun, React, Postgres, Docker Compose, and `@njxqlus/jean-claude-bun-dam-sdk`.

## Features

- Drag-and-drop multi-file upload
- One uploaded file creates one draft expense
- Filed/unfiled GST period tracking
- Copyable GST return values for IRD-style filing

## Environment

Copy `.env.example` to `.env` and fill in the required S3-compatible storage credentials.

Important values:

- `S3_*`: live media storage for `jean-claude-bun-dam`
- `BACKUP_S3_*`: separate backup repository location
- `RESTIC_PASSWORD`: encryption password for backups

Examples:

- Cloudflare R2:
  `S3_ENDPOINT=https://<account_id>.r2.cloudflarestorage.com`
  `S3_REGION=auto`
  `S3_PATH_STYLE=false`
- AWS S3:
  `S3_ENDPOINT=https://s3.amazonaws.com`
  `S3_REGION=us-east-1`
  `S3_PATH_STYLE=false`
- MinIO:
  `S3_ENDPOINT=http://minio:9000`
  `S3_REGION=us-east-1`
  `S3_PATH_STYLE=true`

The app and DAM containers use internal service names in Docker, so you do not need to point `JEAN_CLAUDE_BUN_DAM_SERVER_URL` at localhost for Compose.

## Run with Docker Compose

Start the full stack:

```bash
docker compose up --build
```

Services:

- App: `http://127.0.0.1:3401`
- DAM API: internal-only on the Docker network
- Postgres: internal-only on the Docker network

What Compose does for you:

- creates the `nz_llc_accountant` and `media_assets` databases on first boot
- waits on healthchecks before starting dependent services
- builds the DAM service directly from `https://github.com/njxqlus/jean-claude-bun-dam`
- runs daily backups at `22:00 Pacific/Auckland`

## Backups

The `backup` service performs:

- `pg_dump` of `nz_llc_accountant`
- `pg_dump` of `media_assets`
- sync of DAM media from the live S3-compatible bucket/prefix
- encrypted upload to a separate restic repository in S3-compatible storage
- pruning to keep only the latest snapshot by default

Run an immediate manual backup:

```bash
docker compose run --rm backup run-backup
```

Restore the latest backup:

```bash
./scripts/restore-latest-backup.sh
```

The restore process:

- restores the latest restic snapshot
- recreates both local Postgres databases
- restores both database dumps
- syncs media back into the live S3-compatible bucket/prefix

Warning: restore overwrites the current local databases and the current contents of the configured live media prefix in the configured object storage.

## Run without Docker

Install dependencies:

```bash
bun install
```

Start the app:

```bash
bun run dev
```

Open `http://127.0.0.1:3000`.

## Validation and checks

```bash
bun run check
bun run build
docker compose config
```
