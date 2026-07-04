# Docker — build and run guide

## Overview

The Dockerfile uses a three-stage build (deps → build → runtime).
It targets plain `next start` — not the standalone output mode — so the
full `node_modules` is copied to the runtime stage.

Docker is the **non-Vercel escape hatch** for self-hosted or on-prem
deployments.  For the primary Vercel path no Docker image is needed;
Vercel builds and deploys the Next.js app directly from the repository.

---

## Build

```bash
# From webapp/
docker build \
  --build-arg DATABASE_URL=postgresql://placeholder:p@placeholder/placeholder \
  -t outreach-ai-webapp:latest .
```

The `DATABASE_URL` build-arg is only needed because Next.js resolves
module imports at build time and `@prisma/adapter-pg` is imported at
module load.  `lib/db.ts` creates the Prisma client lazily — no actual
database connection is opened during `next build`.  A syntactically
valid but non-routable URL (`postgresql://placeholder:p@placeholder/db`)
is sufficient; do **not** use a real credential here.

`prisma generate` runs in the deps stage (schema only, no DB) so the
generated client is available to the builder.

---

## Run

Supply all runtime secrets via environment variables — never bake them
into the image.

```bash
docker run -d \
  -p 3009:3009 \
  -e DATABASE_URL="postgresql://user:pass@host/dbname?sslmode=require" \
  -e NEXTAUTH_SECRET="<32-byte random string>" \
  -e NEXTAUTH_URL="https://your-domain.com" \
  -e TOKEN_ENCRYPTION_KEY="<base64-encoded 32-byte key>" \
  -e CRON_SECRET="<random secret>" \
  --name outreach-ai \
  outreach-ai-webapp:latest
```

The container listens on `PORT` (default **3009**).  Override with
`-e PORT=<n> -p <n>:<n>`.

---

## Required runtime environment variables

| Variable | Purpose |
|---|---|
| `DATABASE_URL` | PostgreSQL connection string (Neon or any Postgres) |
| `NEXTAUTH_SECRET` | NextAuth session signing secret |
| `NEXTAUTH_URL` | Canonical app URL (e.g. `https://your-domain.com`) |
| `TOKEN_ENCRYPTION_KEY` | Base64-encoded 32-byte key for credential encryption |
| `CRON_SECRET` | Bearer token for `/api/cron/*` routes |

Optional:

| Variable | Purpose | Default |
|---|---|---|
| `PORT` | HTTP listen port | `3009` |
| `LOG_LEVEL` | Structured logger verbosity (`debug`/`info`/`warn`/`error`) | `info` |
| `SYNC_BUDGET_YOUTUBE` | Per-run sync cap for YouTube posts | `100` |
| `SYNC_BUDGET_TIKTOK` | Per-run sync cap for TikTok posts | `100` |
| `SYNC_BUDGET_INSTAGRAM` | Per-run sync cap for Instagram posts | `100` |

---

## Health check

The image declares a Docker health check against `/login`:

```
GET http://localhost:<PORT>/login
```

Interval 30 s · Timeout 5 s · Start period 15 s · Retries 3.

---

## Vercel vs Docker

| Concern | Vercel | Docker |
|---|---|---|
| Build | Vercel CI builds from git push | `docker build` locally or in CI |
| Secrets | Vercel environment variables UI | `-e` flags or a secrets manager |
| Scaling | Automatic (serverless) | Manual / orchestrator (K8s, ECS…) |
| Cron jobs | Vercel Cron (vercel.json) | External scheduler hitting `/api/cron/*` |
| Database | Same Neon branch | Same Neon branch |

There is no functional difference in the app itself between the two
paths — the same `npm start` command runs in both cases.
