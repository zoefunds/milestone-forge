# Milestone Forge — Backend

Express/TypeScript API. **Not authoritative for anything on-chain** — it's a read-cache indexer, a SIWE session issuer, and a rate-limited GenLayer read proxy. It never holds a private key capable of writing to the contract; every write happens client-side in the frontend, signed by the user's wallet.

Deployed at: **https://milestone-forge-backend.fly.dev** (Fly.io app `milestone-forge-backend`, 2 always-on machines, region `iad`).

## What it actually does

| Responsibility | File |
|---|---|
| SIWE nonce issuance + signature verification → session JWT cookie | `src/auth.ts`, `src/routes/auth.ts` |
| Mirrors `grants`/`milestones` contract state into Postgres for fast list views | `src/indexer.ts` (polls every 120s by default, one leader machine at a time, skips terminal grants/milestones) |
| Serves the cached lists to the frontend | `src/routes/grants.ts` |
| Keeps all GenLayer read traffic under GenLayer's per-minute/hour/day limits, shared across all running machines | `src/genlayerRateLimiter.ts` |
| Ordinary per-IP HTTP rate limiting for this API's own routes (separate, in-memory, no Redis) | `src/rateLimiter.ts` |
| SSRF guard used to preview whether a criterion URL looks safe before a user spends gas on it | `src/ssrfGuard.ts` |
| 24/7 uptime: graceful shutdown, health check, Fly auto-restart | `src/index.ts`, `fly.toml` |

## Why Redis is used for exactly two things

**GenLayer StudioNet enforces per-minute, per-hour, AND per-day caps** (roughly 30/min, 500/hour, 5000/day — the exact hourly/daily numbers come from the RPC's own error messages, not published docs). `genlayerRateLimiter.ts` used to guard only the per-minute window, which is a real bug: 28/min sustained is ~1,680/hour and ~40,000/day, both far past the actual hourly/daily caps — this caused real production outages where GenLayer itself started rejecting every read with `"Rate limit exceeded: 500 requests per hour"` well before the old limiter ever said no. Fixed (2026-09-22): a single atomic Lua `EVAL` now increments and checks all three windows (`glrl:m:<minute>`, `glrl:h:<hour>`, `glrl:d:<day>`) in one Redis round trip per GenLayer call attempt, and ALL three must pass.

**Indexer leader election.** This app runs multiple Fly.io machines, and each one used to run its own independent 30-second poller — silently doubling every GenLayer RPC call the indexer made, for zero benefit, since both write to the same shared Postgres. Fixed (2026-09-22): `src/indexer.ts` now uses a short-lived Redis lock (`mf:indexer-leader`, `SET NX` with a TTL) so only one machine polls at a time; if that machine goes away, the lock expires and another picks it up automatically.

If Redis is unreachable, both mechanisms fail open (rate limiter → a more conservative per-instance in-memory fallback; leader election → every machine polls independently, same as before this fix) rather than blocking all reads. This is a deliberate choice to minimize Upstash command usage (the account is on a metered/free tier) while still guarding the account against GenLayer's real caps.

**Further indexer cost reduction (2026-09-22)**: the poll interval default went from 30s to 120s (`INDEXER_POLL_INTERVAL_MS` env var to override), and grants/milestones that have reached a terminal state (`COMPLETED`/`CANCELLED` for grants, `RELEASED`/`FAILED`/`CANCELLED` for milestones) are skipped on every poll after their first sync, since they can never change again — steady-state RPC cost now tracks *active* grants only, not total history. Combined, these changes cut indexer RPC volume roughly 8x versus the pre-fix baseline (2 machines × 30s → 1 machine × 120s), with further reduction over time as more grants/milestones terminalize.

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

**Fixed (2026-09-21)**: every table is keyed by `(contract_address, <id>)`, not `<id>` alone. `grant_id`/`milestone_id`/`challenge_id` are sequential counters assigned by the contract *starting fresh on every new deployment*, not globally unique — before this fix, redeploying to a new `MILESTONE_FORGE_CONTRACT_ADDRESS` could leave cached rows from the previous deployment colliding by primary key with the new deployment's own IDs (e.g. both deployments independently producing a `grant-3`), and the indexer would serve stale data under the new grant's own ID with no error. This caused a real, confusing bug during the fourth deploy's live testing — see `memory/MEMORY.md`. `indexer.ts` now writes `contract_address` (from `config.contractAddress`) on every insert, and every read in `routes/grants.ts` filters by it, so a redeploy no longer requires manually truncating these tables — just run the normal migration (`node dist/db/migrate.js`), which upgrades an existing pre-fix database in place (see the migration block at the bottom of `src/db/schema.sql`). Rows from a superseded deployment stay in the table under their own `contract_address` rather than being deleted, but are never served as if they belonged to the current one.
