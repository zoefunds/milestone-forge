# Milestone Forge — Project Memory

This file is the persistent index for this project. It survives across sessions.
Read this before doing anything else in this repo.

## What this project is

MILESTONE FORGE — an onchain grant/milestone-release protocol. Funders lock GEN
escrow per milestone; grantees claim completion against precommitted,
machine-checkable criteria (live URL, GitHub repo state, onchain contract
state); GenLayer validators independently fetch and inspect the pinned
artifacts; a deterministic function (separate from the nondeterministic
evaluation) releases the tranche. Additive-evidence-only challenge window
before funds are pull-withdrawable. Full spec: see the original master prompt
the user supplied (not stored here — ask the user if it's needed again).

## Non-negotiable architecture facts (do not re-derive, do not contradict)

- **Contract deployment**: the USER deploys the Intelligent Contract themselves
  via GenLayer Studio/CLI. Claude must never attempt to deploy it or handle a
  private key for it. Once deployed, the user provides `DEPLOYED_CONTRACT_ADDRESS`
  and Claude wires it into env config.
- **Auth**: wallet-based, SIWE-style message signing. No email/password, no
  custodial private keys stored anywhere.
- **Escrow token**: GEN for everything (reward + dispute bonds), via
  `gl.message.value` / `@gl.public.write.payable`, matching the reference
  ShipBond escrow pattern (zero-then-transfer ordering, single `_send_gen`
  choke point, `reward_deposited`/`bond_deposited` ledger fields separate from
  `reward_wei`/`bond_wei` terms).
- **Backend**: PostgreSQL via Docker, hosted on Fly.io, always-on (2+ machines,
  health checks, restart policies). Backend is a read-cache/indexer and
  SSRF-guarded artifact-snapshot fetcher ONLY — it must never determine
  milestone completion itself. That determination is exclusively the
  Intelligent Contract's validator quorum.
- **Frontend**: Next.js + React + Tailwind, deployed to Vercel. Design system
  ported (not copy-pasted) from the user's Stitch dark-theme HTML mockups in
  `~/Documents/stitch_dark_theme_interface_design/` — cyan/emerald/amber dark
  palette, JetBrains Mono for hashes/code, Plus Jakarta Sans headlines, Inter
  body. Favicon/logo: the anvil-shield emblem SVG from that folder.
- **Socials**: explicitly skipped for v1 per user decision.
- **Challenge window**: 48h default, configurable 24h–168h per milestone,
  locked at genesis (cannot be changed after milestone creation).
- **Artifact types v1**: all three — HTTP/live URL, GitHub repo state
  (commit/tag), onchain contract state/event.

## GenLayer contract technical facts (verified against current docs, 2026-09-19)

- Runner version pinned in contract header: `py-genlayer:1jb45aa8ynh2a9c9xn3b7qqh8sm5q93hwfp7jqmwsfhh8jpz09h6`.
  Never use `py-genlayer:test` or `:latest` — networks reject both.
- Equivalence approach used: **custom validator function** (`gl.vm.run_nondet_unsafe`)
  with **partial field matching + numeric tolerance** (not `strict_eq`, not
  `prompt_non_comparative` schema-only checks) — this is what keeps consensus
  from stalling into `INCONCLUSIVE`/leader-rotation storms while still being
  substantive per the JUDGE.md rubric (format-only validation caps Contract
  Quality at 1/5 in that rubric).
- Nondeterministic step outputs ONLY a structured per-criterion result
  (dict of booleans + stable derived fields). A fully separate deterministic
  function computes the tranche payout from that structured result — the
  LLM/validators never touch money transfer directly.
- Error prefixes used for validator agreement: `[EXPECTED]`, `[EXTERNAL]`,
  `[TRANSIENT]`, `[LLM_ERROR]` (see `genlayer-dev:write-contract` skill).

## File locations

- `contracts/milestone_forge.py` — the single production Intelligent Contract.
- `contracts/tests/` — direct-mode + integration tests for the contract.
- `backend/` — Node/Express indexer + SSRF-guarded artifact fetcher (Fly.io).
- `frontend/` — Next.js app (Vercel).
- `docs/` — architecture notes, deployment runbook.

## Deployed contract

- **Address**: `0x8Bbb6c4508D83d7bd0e3a4db555c92B3A1CB1DFb`
- **Network**: GenLayer StudioNet
- Constructor args used: `default_dispute_bond_wei="2500000000000000000000"` (2,500 GEN),
  `frivolous_slash_bps=10000` (100%), `upheld_bounty_bps=2000` (20%) — matches
  the values shown in the user's design mockups.
- Wired into `backend/.env` (`MILESTONE_FORGE_CONTRACT_ADDRESS`) and
  `frontend/.env.local` (`NEXT_PUBLIC_MILESTONE_FORGE_CONTRACT_ADDRESS`).
  These `.env`/`.env.local` files are gitignored — never committed.

## Third-party services wired in (2026-09-19)

- **Reown (WalletConnect) AppKit**: project id `4443f771b58e245d54961b49199dcb27`,
  used for wallet connect + SIWE auth. `frontend/lib/reown.ts`.
- **Redis (Upstash)**: `REDIS_URL` in `backend/.env`. Used for EXACTLY ONE
  purpose — a shared cross-instance counter so the backend's multiple Fly.io
  machines collectively stay under GenLayer's 30 requests/minute RPC limit
  (`backend/src/genlayerRateLimiter.ts`, one atomic Lua EVAL per GenLayer
  call, fails open to a conservative in-memory fallback if Redis is
  unreachable). Ordinary per-IP HTTP API rate limiting uses a separate,
  purely in-memory limiter (`backend/src/rateLimiter.ts`) and never touches
  Redis — this was a deliberate choice to cut Upstash command usage.

## Build verification (2026-09-19)

Both `backend` (`npx tsc --noEmit`, `npm run build`) and `frontend`
(`npx tsc --noEmit`, `npm run build`) were installed and built clean in this
environment — not just written, actually compiled. Notable real-world SDK
gotchas discovered and fixed during this pass (future sessions should NOT
re-introduce these):

- **genlayer-js real API (v1.1.8, what's actually published) differs from
  what the hosted docs describe** (which appear to document a newer/
  pre-release API). The real client uses `client.writeContract({address,
  functionName, args, value})` returning a tx hash directly (no separate
  `estimateTransactionFeesForWrite`/`fees` step), and
  `client.waitForTransactionReceipt({hash, status})` with a `TransactionStatus`
  string enum (`"ACCEPTED"`, `"FINALIZED"`, etc.) — there is no
  `waitForDecision`/`waitForFinalization`/`isSuccessful` export in this
  version. Success is determined by `statusName === "FINALIZED" &&
  txExecutionResultName !== "FINISHED_WITH_ERROR"`. See
  `frontend/lib/genlayer.ts`.
- `@reown/appkit`/`@reown/appkit-adapter-wagmi` must be pinned to an exact
  compatible version (`1.7.8` here) with `wagmi@^2.19.5` — the latest
  `^1.x` range resolves to a version whose bundled `@wagmi/connectors`
  needs `@wagmi/core@3.x`, causing duplicate-type and missing-module
  webpack errors. A `"overrides": {"@wagmi/core": "2.22.1"}` in
  `frontend/package.json` forces a single deduped copy.
- `next.config.mjs` stubs `@coinbase/cdp-sdk`, `@base-org/account`,
  `@metamask/connect-evm` to `false` — optional Base Pay/x402/MetaMask-SDK
  connector features this project doesn't use, pulled in transitively.
- The whole frontend needs `export const dynamic = "force-dynamic"` in
  `app/layout.tsx` — every page depends on the browser-only Reown AppKit
  client, so build-time static prerendering fails without it.
- `ioredis`/`pino-http` need **named** imports (`import { Redis } from
  "ioredis"`, `import { pinoHttp } from "pino-http"`) under this project's
  `NodeNext` TS module resolution — default imports resolve to the wrong
  shape and fail to typecheck/call.

## Git / deployment

- Repo: https://github.com/zoefunds/milestone-forge.git, `main` branch.
- All commits authored as `zoefunds <preciousmofeoluwa@gmail.com>` — no
  Claude/AI attribution in this repo's history (explicit user instruction,
  overrides the default Claude Code attribution convention).
- **Fly.io: deployed.** App `milestone-forge-backend` (org: personal /
  Priscilla George), region `iad`, 2 machines, Postgres cluster
  `milestone-forge-db` attached, schema migrated, secrets set, public IPs
  allocated. Live at https://milestone-forge-backend.fly.dev — verified
  `/health/healthz` returns 200.
- **Vercel: deployed.** Project `milestone-forge` (scope
  `adebiyi2002gmailcoms-projects`). Live at the requested domain
  **https://milestone-forge.vercel.app** (production alias). Env vars set.
- Full runbook with exact commands: `docs/DEPLOYMENT.md`.
- **Verified live and working (2026-09-19):** fresh direct load of
  https://milestone-forge.vercel.app/ returns HTTP 200 (confirmed via
  network inspection, not just visual/hydrated appearance) and
  https://milestone-forge-backend.fly.dev/health/healthz returns
  `{"status":"ok"}`.
- **Real bug found and fixed post-deploy:** `frontend/lib/reown.ts` gated
  `createAppKit(...)` behind `typeof window !== "undefined"`, so it never
  ran during SSR. But `ConnectWalletButton`'s `useAppKit()` hook always
  runs during SSR too (Next renders "use client" components server-side for
  the initial HTML), and throws `"Please call createAppKit before using
  useAppKit"` if registration hasn't happened — causing every direct/hard
  page load (not client-side navigations, which don't re-run root layout)
  to 500. Fix: call `createAppKit()` unconditionally at module scope —
  it's SSR-safe by design, only the actual modal UI needs a real browser.
  This is the documented Reown Next.js App Router pattern; don't
  reintroduce the window guard around the `createAppKit()` call itself.
- Not yet done: a live end-to-end wallet transaction test (create grant →
  claim → consensus → release) against the deployed contract — needs a
  real wallet with testnet GEN, best done by the user or in a follow-up
  session with browser tools.
