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
5. **Status: done.** Deployed at `0xc7aA666C8EF4fab7e7bc94A277eCD06161787314`
   on StudioNet — this is the fourth deploy. The first three fixed runtime
   bugs (`DynArray` construction, `gl.emit_event`, `gl.block`/`gl.hash` —
   see `memory/MEMORY.md` and `contracts/README.md` §"Things genvm-lint
   check does NOT catch") and are superseded. This deploy adds the
   challenge-resolution fix: `file_challenge` now takes a required
   `criterion_id` (breaking ABI change from the third deploy), additive
   evidence must be verifiably bound to the disputed criterion's own
   artifact anchor, and UPHELD/REJECTED is decided on that criterion alone
   rather than the milestone's full pass rate — see `docs/PROTOCOL.md` §6.
   Verified locally beforehand with `pytest contracts/tests/direct/ -v`
   (11/11 passing).

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
- [x] Wallet connects via Reown, SIWE sign-in succeeds
- [x] Create a test grant (small GEN amount) end-to-end — succeeded on the
      second deploy attempt (`0xD09e...155a1`, since superseded) after
      fixing a `DynArray` construction bug found on the first attempt
      (`0x8Bbb...B1DFb`). That second address's `update_protocol_params`
      then hit a `gl.emit_event` bug; a further `gl.block`/`gl.hash` bug
      was also found via local testing before it could hit a live
      transaction. All three fixed and verified with
      `pytest contracts/tests/direct/ -v` (6/6), then redeployed a third
      time. A fourth deploy followed to fix a challenge-resolution
      correctness bug (unbound generic evidence could auto-uphold a
      challenge against a partial-pass milestone's still-passing
      criterion) — verified with 11/11 direct-mode tests, redeployed to
      the current live address. See `memory/MEMORY.md` for the full
      incident history.
- [x] Confirmed live: `/settings` on the production frontend reads
      protocol params (admin, dispute bond, slash/bounty bps, challenge
      window range) correctly from the current address
      `0xc7aA666C8EF4fab7e7bc94A277eCD06161787314`.
- [x] Live e2e test against the current address: `create_grant` →
      `submit_milestone_claim` → `file_challenge` → `resolve_challenge`,
      run directly against real GenVM multi-validator consensus (not
      direct-mode). A two-criterion `PARTIAL_PASS` milestone was created,
      claimed, and a challenge against the still-passing criterion with
      unbound generic evidence correctly resolved `REJECTED` — the exact
      scenario that used to auto-UPHOLD under the old bug. Confirmed
      rendering correctly on the live frontend (`/grant/<id>` and
      `/challenges`) afterward. Full incident writeup (including two real
      bugs found along the way — a stale cached Vercel build and a
      backend indexer schema gap) in `memory/MEMORY.md`.
- [ ] Confirm the GenLayer rate limiter's Redis key appears in Upstash
      (`glrl:<minute>`) and disappears after ~70s (TTL working)

**Important — Vercel build cache does not invalidate on a
`NEXT_PUBLIC_*` env var change alone.** A normal `vercel deploy --prod
--yes` after updating `NEXT_PUBLIC_MILESTONE_FORGE_CONTRACT_ADDRESS` can
silently restore the previous build's cache and ship a bundle with the
OLD address still inlined, with no error anywhere. Always use `vercel
deploy --prod --yes --force` (which discards cache unless `--with-cache`
is also passed) after any env var change that affects build output. See
`memory/MEMORY.md` for the live incident this caused.

**Fixed (2026-09-21)**: `grants`/`milestones`/`challenges`/`contract_events`
are now all keyed by `(contract_address, <id>)` instead of `<id>` alone —
see `backend/src/db/schema.sql`. Redeploying to a new
`MILESTONE_FORGE_CONTRACT_ADDRESS` no longer needs a manual table
truncate: old rows stay in place under their own `contract_address` (kept
for audit/history) and every route/indexer query is scoped to the
currently configured address, so they can never be served as if they
belonged to the new deployment. Just run the normal migration after
deploying the backend:
```bash
flyctl ssh console -a milestone-forge-backend -C "node dist/db/migrate.js"
```
`schema.sql` includes an idempotent in-place migration for a database
that already had these tables from before this column existed — see the
comment block in that file. See `memory/MEMORY.md` for the incident this
fixes and `backend/README.md` for the schema rationale.
