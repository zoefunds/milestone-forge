# Milestone Forge — Backend

Express/TypeScript API. **Not authoritative for anything on-chain** — it's a read-cache indexer, a SIWE session issuer, and a rate-limited GenLayer read proxy. It never holds a private key capable of writing to the contract; every write happens client-side in the frontend, signed by the user's wallet.

Deployed at: **https://milestone-forge-backend.fly.dev** (Fly.io app `milestone-forge-backend`, 2 always-on machines, region `iad`).

## What it actually does

| Responsibility | File |
|---|---|
| SIWE nonce issuance + signature verification → session JWT cookie | `src/auth.ts`, `src/routes/auth.ts` |
| Mirrors `grants`/`milestones` contract state into Postgres for fast list views | `src/indexer.ts` (polls every 30s) |
| Serves the cached lists to the frontend | `src/routes/grants.ts` |
| Keeps all GenLayer read traffic under GenLayer's 30 req/min limit, shared across all running machines | `src/genlayerRateLimiter.ts` |
| Ordinary per-IP HTTP rate limiting for this API's own routes (separate, in-memory, no Redis) | `src/rateLimiter.ts` |
| SSRF guard used to preview whether a criterion URL looks safe before a user spends gas on it | `src/ssrfGuard.ts` |
| 24/7 uptime: graceful shutdown, health check, Fly auto-restart | `src/index.ts`, `fly.toml` |

## Why Redis is used for exactly one thing

GenLayer StudioNet enforces a 30 requests/minute cap on RPC calls. This app runs multiple Fly.io machines, so a per-process in-memory counter can't see what the other machine is doing. Redis (Upstash) is used *only* to hold a single shared counter (`glrl:<minute-bucket>`), incremented via one atomic Lua `EVAL` call per GenLayer read attempt — nothing else in this backend touches Redis. If Redis is unreachable, the limiter fails open to a more conservative per-instance in-memory fallback rather than blocking all reads. This is a deliberate choice to minimize Upstash command usage (the account is on a metered/free tier).

Every other rate limit in this app (protecting the backend's own HTTP routes from abuse) is a separate, purely in-memory token-bucket implementation — see `src/rateLimiter.ts`.

## Local development

```bash
cp .env.example .env
```

Fill in:
- `DATABASE_URL` — a Postgres connection string (Docker: `docker run -e POSTGRES_PASSWORD=... -p 5432:5432 postgres:16`, or point at the Fly Postgres cluster).
- `GENLAYER_RPC_URL` — `https://studio.genlayer.com/api` for StudioNet.
- `MILESTONE_FORGE_CONTRACT_ADDRESS` — the deployed contract address.
- `REDIS_URL` — an Upstash (or any) Redis connection string. Optional in dev; the limiter falls back to in-memory if unset.
- `SESSION_JWT_SECRET` — any long random string (`openssl rand -hex 32`).
- `REOWN_PROJECT_ID` — the same Reown/WalletConnect project id the frontend uses.
- `FRONTEND_ORIGIN` — `http://localhost:3000` for local dev, the deployed frontend origin in production (used for CORS).

```bash
npm install
npm run build
npm run migrate    # applies src/db/schema.sql — idempotent, safe to rerun
npm run dev         # tsx watch, hot reload
```

Health check: `curl localhost:8080/health/healthz` → `{"status":"ok"}`.

## Scripts

| Command | What it does |
|---|---|
| `npm run dev` | `tsx watch src/index.ts` — hot-reloading dev server |
| `npm run build` | `tsc -p tsconfig.json` → `dist/` |
| `npm start` | Runs the built `dist/index.js` (what the Docker image runs in production) |
| `npm run migrate` | Runs `dist/db/migrate.js`, applying `src/db/schema.sql` |

## Deployment

See [`../docs/DEPLOYMENT.md`](../docs/DEPLOYMENT.md) for the full Fly.io runbook (app creation, Postgres provisioning/attachment, secrets, IP allocation — an app created via `flyctl apps create` does *not* get public IPs automatically the way `flyctl launch` does, which bit us once; see that doc).

To redeploy after a code change:
```bash
flyctl deploy --remote-only
```

## Database

`src/db/schema.sql` defines four tables, all populated by the indexer and read by `src/routes/grants.ts`:
- `grants`, `milestones`, `challenges` — denormalized mirrors of contract state for list/search views.
- `contract_events` — append-only raw event log, currently defined but not yet written to by the indexer (reserved for a future full audit-trail feature; the frontend's History page currently assembles its timeline directly from live contract reads instead, see `frontend/app/history/page.tsx`).

None of these tables are consulted for anything money-related — every action that moves funds re-reads directly from the contract at the moment it matters.
