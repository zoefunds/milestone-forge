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

## 2. Backend on Fly.io

```bash
cd backend
flyctl launch --no-deploy   # confirms app name "milestone-forge-backend", region, uses existing fly.toml
flyctl postgres create --name milestone-forge-db --region iad
flyctl postgres attach milestone-forge-db -a milestone-forge-backend   # sets DATABASE_URL secret automatically

flyctl secrets set \
  REDIS_URL="rediss://..." \
  SESSION_JWT_SECRET="$(openssl rand -hex 32)" \
  REOWN_PROJECT_ID="4443f771b58e245d54961b49199dcb27" \
  MILESTONE_FORGE_CONTRACT_ADDRESS="0x8Bbb6c4508D83d7bd0e3a4db555c92B3A1CB1DFb" \
  FRONTEND_ORIGIN="https://<your-vercel-domain>" \
  GENLAYER_RPC_URL="https://studio.genlayer.com/api"

flyctl deploy

# Run the schema migration once, against the deployed machine:
flyctl ssh console -C "node dist/db/migrate.js"
```

`fly.toml` is already configured for 24/7 uptime: `min_machines_running = 2`,
`auto_stop_machines = false`, and an HTTP health check against
`/health/healthz` that triggers automatic restarts on failure.

## 3. Frontend on Vercel

```bash
cd frontend
vercel link
vercel env add NEXT_PUBLIC_REOWN_PROJECT_ID production
vercel env add NEXT_PUBLIC_API_BASE_URL production        # https://milestone-forge-backend.fly.dev
vercel env add NEXT_PUBLIC_GENLAYER_CHAIN_ID production
vercel env add NEXT_PUBLIC_MILESTONE_FORGE_CONTRACT_ADDRESS production
vercel deploy --prod
```

## 4. Post-deploy verification checklist

- [ ] `curl https://milestone-forge-backend.fly.dev/health/healthz` → `{"status":"ok"}`
- [ ] Frontend loads, wallet connects via Reown, SIWE sign-in succeeds
- [ ] Create a test grant (small GEN amount) end-to-end
- [ ] Submit a milestone claim, watch the real tx lifecycle (submitted →
      accepted → finalized) render in the UI
- [ ] Confirm the GenLayer rate limiter's Redis key appears in Upstash
      (`glrl:<minute>`) and disappears after ~70s (TTL working)
- [ ] File and resolve a test challenge
