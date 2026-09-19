# Deployment Runbook

## 1. Intelligent Contract (you deploy this — Claude never does)

1. Open GenLayer Studio, load `contracts/milestone_forge.py`.
2. Constructor args:
   - `default_dispute_bond_wei`: `"2500000000000000000000"` (2,500 GEN)
   - `frivolous_slash_bps`: `10000` (100%)
   - `upheld_bounty_bps`: `2000` (20%)
3. Deploy. Copy the resulting contract address.
4. Set it in `backend/.env` (`MILESTONE_FORGE_CONTRACT_ADDRESS`) and
   `frontend/.env.local` (`NEXT_PUBLIC_MILESTONE_FORGE_CONTRACT_ADDRESS`).
5. **Status: done.** Deployed at `0x8Bbb6c4508D83d7bd0e3a4db555c92B3A1CB1DFb` on
   StudioNet (see `memory/MEMORY.md`).

## 2. Backend on Fly.io — **Status: done**

App: `milestone-forge-backend` (org: personal / Priscilla George), region `iad`,
2 always-on machines, health check on `/health/healthz`.

Postgres: `milestone-forge-db` (unmanaged Fly Postgres, 1 node, 3GB volume),
attached via `flyctl postgres attach`. Schema migration applied.

Secrets set: `DATABASE_URL` (auto, from attach), `REDIS_URL`,
`SESSION_JWT_SECRET`, `REOWN_PROJECT_ID`, `MILESTONE_FORGE_CONTRACT_ADDRESS`,
`FRONTEND_ORIGIN=https://milestone-forge.vercel.app`, `GENLAYER_RPC_URL`,
`GENLAYER_CHAIN_ID`.

Public IPs allocated (shared v4 + dedicated v6) after the initial deploy —
`flyctl launch`-created apps get these automatically, but an app created via
`flyctl apps create` + `flyctl deploy` does not, so this step is required
once per app:

```bash
flyctl ips allocate-v4 --shared -a milestone-forge-backend
flyctl ips allocate-v6 -a milestone-forge-backend
```

Live at: `https://milestone-forge-backend.fly.dev`

To redeploy after code changes:
```bash
cd backend
flyctl deploy --remote-only
```

To rerun the migration (idempotent, uses `CREATE TABLE IF NOT EXISTS`):
```bash
flyctl ssh console -a milestone-forge-backend -C "node dist/db/migrate.js"
```

## 3. Frontend on Vercel — **Status: done**

Project: `milestone-forge` (scope: `adebiyi2002gmailcoms-projects`).
Production domain: **https://milestone-forge.vercel.app**

Env vars set (production): `NEXT_PUBLIC_REOWN_PROJECT_ID`,
`NEXT_PUBLIC_API_BASE_URL=https://milestone-forge-backend.fly.dev`,
`NEXT_PUBLIC_GENLAYER_CHAIN_ID`, `NEXT_PUBLIC_MILESTONE_FORGE_CONTRACT_ADDRESS`.

To redeploy after code changes:
```bash
cd frontend
vercel deploy --prod --yes
```

## 4. Post-deploy verification checklist

- [x] `curl https://milestone-forge-backend.fly.dev/health/healthz` → `{"status":"ok"}` (verified)
- [x] Database schema migrated
- [x] Frontend live at https://milestone-forge.vercel.app, fresh direct
      load confirmed HTTP 200 (fixed a `createAppKit` SSR crash found
      post-deploy — see MEMORY.md)
- [ ] Wallet connects via Reown, SIWE sign-in succeeds (manual check —
      needs a real wallet + testnet GEN)
- [ ] Create a test grant (small GEN amount) end-to-end
- [ ] Submit a milestone claim, watch the real tx lifecycle (submitted →
      accepted → finalized) render in the UI
- [ ] Confirm the GenLayer rate limiter's Redis key appears in Upstash
      (`glrl:<minute>`) and disappears after ~70s (TTL working)
- [ ] File and resolve a test challenge

The remaining checklist items require an actual wallet transaction against
StudioNet and are best done by the user (or in a follow-up session using
the browser tools against the live site).
