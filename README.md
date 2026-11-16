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
- pruning to keep the latest `RESTIC_KEEP_LAST` snapshots (default: `1`) of this backup set

New snapshots carry `daily` and `backup-set:${RESTIC_BACKUP_SET}` tags. Retention
selects only that backup-set tag and uses `--group-by ''`, so timestamped source
paths and changing container hostnames do not create separate retention groups.
`RESTIC_KEEP_LAST` must be a positive integer. `RESTIC_BACKUP_SET` defaults to
`nz-llc-accountant` and must start with a letter or digit, followed by letters,
digits, dots, underscores or hyphens. Reserve a unique, stable value for each
deployment sharing a repository. Reusing a value merges their retention sets;
changing it starts a new set and leaves the previous set untouched. Additional
tags do not split the selected set. Tags identify ownership by convention, not
by access control. `prune` reclaims unreferenced data repository-wide, but keeps
data referenced by surviving snapshots, including other backup sets.

### Applying the retention fix and inspecting older snapshots

Older versions used only `daily` and grouped retention by host and source path.
Each `/tmp/backup-<timestamp>/snapshot` path created a separate group. Existing
daily-only snapshots are deliberately excluded from the new policy; upgrading
does **not** migrate, retag or delete them. Total repository snapshot count can
therefore exceed `RESTIC_KEEP_LAST` after upgrading.

Before starting the updated backup service, choose the set identifier and inspect
the repository inventory in an explicitly configured operator environment. These
are review commands, not automatic upgrade steps (replace the placeholder with
the verified repository; use its credentials deliberately):

```bash
restic -r '<verified-repository>' snapshots --json
restic -r '<verified-repository>' snapshots --tag 'backup-set:nz-llc-accountant'
restic -r '<verified-repository>' forget --tag 'backup-set:nz-llc-accountant' --group-by '' --keep-last 1 --dry-run
```

Use your chosen tag and count in the preview. Confirm that every selected snapshot
belongs to this deployment and that the keep/remove list is expected. An empty
new set before its first backup is normal. Build the updated backup image, then
recreate the backup service during your planned rollout; a successful backup
immediately applies retention to the new set. Keep the same identifier for later
runs. After initial runs, repeat the inventory and dry-run to review the result.

Leave legacy snapshots intact until a separate, explicitly approved cleanup.
Before any such cleanup, record full snapshot IDs, hosts, paths, tags and times;
verify the intended database dumps and media can be restored into isolated test
targets with live databases and media disconnected. A `daily` tag or timestamped
path alone does not prove ownership in a shared repository. Do not run an
unfiltered `forget --group-by ''`, use `daily` as the ownership filter, or bulk
retag old snapshots. Any later cleanup must select only individually verified
legacy snapshots and review a dry-run before deletion. This change does not
automate that cleanup. The existing restore-latest helper selects the latest
snapshot repository-wide; use a dedicated repository or an explicitly verified
snapshot and isolated restore workflow when a repository is shared.

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
python3 -m unittest discover -s tests -v
```

Retention tests require `restic` on `PATH` (or `RESTIC_TEST_BINARY` pointing to the
binary). They create fresh local repositories and synthetic dumps/media in a
temporary directory, start subprocesses with a clean environment, and never read
`.env`. The harness relocates the script's workspace/state paths into that
directory and replaces database/media clients with synthetic fixtures. Real
restic backup/forget/prune/check/restore commands are restricted to those local
test repositories; no production services or storage are used.
