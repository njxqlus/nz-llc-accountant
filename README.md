# NZ LLC GST Expense Tracker

Local-only GST expense tracker for a New Zealand LLC, built with Bun, React, shadcn/ui, Postgres, Docker Compose, and `@njxqlus/jean-claude-bun-dam-sdk`.

## Features

- Drag-and-drop multi-file upload
- One uploaded file creates one draft expense
- Temporary DAM assets with a 24-hour TTL
- Manual draft expenses without attached files
- Draft publishing that finalizes temporary assets
- GST period generation from 2025-07-07 onward
- Filed/unfiled GST period tracking
- Copyable GST return values for IRD-style filing

## Required environment

Copy `.env.example` to `.env` and set:

```bash
DATABASE_URL=postgresql://postgres:postgres@127.0.0.1:5432/nz_llc_accountant
JEAN_CLAUDE_BUN_DAM_SERVER_URL=http://127.0.0.1:3200
HOST=127.0.0.1
PORT=3000
```

The DAM service is external to this repository and must already be running.

## Run locally

Install dependencies:

```bash
bun install
```

Start the app:

```bash
bun run dev
```

Open `http://127.0.0.1:3000`.

## Run with Docker Compose

Set `JEAN_CLAUDE_BUN_DAM_SERVER_URL` in your shell or `.env`, then run:

```bash
docker compose up --build
```

The app is published on `http://127.0.0.1:3000`.

## Validation and checks

```bash
bun run check
bun run build
```
