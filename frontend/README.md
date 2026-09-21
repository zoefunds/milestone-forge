# Milestone Forge — Frontend

Next.js 14 (App Router) site. Deployed at **https://milestone-forge.vercel.app** (Vercel project `milestone-forge`, scope `adebiyi2002gmailcoms-projects`).

Every page reads contract state **directly from GenLayer StudioNet in the browser** — not through the backend — and every write (create grant, submit claim, file/resolve challenge, release tranche) is signed by the user's own connected wallet and submitted directly to the contract. The backend is only used for SIWE session auth and fast cached list views (Explore Grants).

## Pages

| Route | Purpose |
|---|---|
| `/` | Landing page |
| `/explore` | Browse grants (backed by the backend's Postgres cache for speed) |
| `/create` | Funder flow: define milestones + weighted machine-checkable criteria, deposit GEN |
| `/grant/[grantId]` | Grant workspace — the main hub: claim, release, file/resolve challenges (all live contract reads) |
| `/claim` | Grantee's dashboard of claimable/in-progress/settled milestones across their grants |
| `/validators` | Recent Equivalence Principle consensus results, read live from chain, per-criterion pass/fail |
| `/challenges` | Challenge Hub — pending disputes + historical resolutions, live from chain |
| `/docs` | In-app protocol writeup (shorter version of `../docs/PROTOCOL.md`) |
| `/profile` | Connected wallet's grants, as funder and as grantee |
| `/settings` | Session info, read-only protocol parameters |
| `/history` | Full audit trail assembled live from on-chain state (claims, verdicts, challenges) |

## Wallet connection and auth

- **Reown AppKit** (`lib/reown.ts`) provides the wallet-connect modal (MetaMask, WalletConnect-compatible wallets, etc.) via `wagmi`.
- Connecting a wallet is **not** treated as authentication by itself. `lib/useSiweAuth.ts` implements the real flow: fetch a one-time nonce from the backend, have the wallet sign a SIWE message containing it, POST the signed message back for verification, receive a session cookie.
- **Important implementation detail**: `createAppKit()` in `lib/reown.ts` is called unconditionally at module scope, *not* gated behind a `typeof window` check. Gating it broke every direct/hard page load in production with a 500 (`useAppKit()` runs during SSR too, since Next.js renders `"use client"` components server-side for the initial HTML, and it throws if `createAppKit` hasn't registered yet). `createAppKit()`'s config registration itself is SSR-safe; only the actual modal UI needs a real browser. Don't reintroduce that guard.

## Reading and writing the contract

`lib/genlayer.ts` wraps the real, published `genlayer-js` (v1.1.8+) SDK surface — **not** what the hosted GenLayer docs describe, which appear to document a newer/pre-release API. The actual client:

```ts
client.writeContract({ address, functionName, args, value }) // → tx hash, string
client.waitForTransactionReceipt({ hash, status: "ACCEPTED" | "FINALIZED" | ... })
```

There is no `estimateTransactionFeesForWrite`, `waitForDecision`, `waitForFinalization`, or `isSuccessful` export in this version — if you see those names in the hosted docs, verify against `node_modules/genlayer-js/dist/index.d.ts` before using them; they don't exist in what's actually installed. `executeContractWrite()` in `lib/genlayer.ts` tracks the real lifecycle (submitted → ACCEPTED → FINALIZED) via two real `waitForTransactionReceipt` polls, with generous explicit wait budgets (~3 min for ACCEPTED, ~10 min for FINALIZED — StudioNet consensus on a claim/challenge write routinely takes well over a minute) and a distinct non-alarming `"timeout"` lifecycle state for when our poll gives up without the write itself having failed. Success is determined by `isTxSuccessful()`, which reads `tx.status_name` (**not** `tx.statusName` — `simplifyTransactionReceipt` renames it to snake_case, and checking the camelCase field silently reports every successful transaction as failed) and checks `consensus_data.leader_receipt[].execution_result` for an actual error signal (`studionet`'s `getTransaction` never populates `txExecutionResultName` at all). Absence of an error signal is treated as success, never failure — a false "failed" report is worse than a missed true failure, since it tells the user their GEN is gone when it isn't. Full incident writeup: `memory/MEMORY.md`.

`lib/useMilestoneForge.ts` exposes one hook per contract write (`useCreateGrant`, `useSubmitMilestoneClaim`, `useFileChallenge`, `useResolveChallenge`, `useReleaseMilestone`, `useRetryInconclusive`, `useCancelMilestone`, `useClaimFailedRefund`) plus plain async read functions (`readGrant`, `readMilestone`, `readCriterion`, `readCriterionResult`, `readChallenge`, `listGrants`, `listChallenges`, `listGrantsByFunder`, `listGrantsByGrantee`, `readProtocolParams`).

`components/TxLifecycle.tsx` renders the real lifecycle state from any of those write hooks — estimating → awaiting signature → submitted → accepted → finalized/failed.

## Local development

```bash
cp .env.example .env.local
```

Fill in:
- `NEXT_PUBLIC_REOWN_PROJECT_ID` — Reown/WalletConnect project id (public, safe to expose client-side).
- `NEXT_PUBLIC_API_BASE_URL` — `http://localhost:8080` for local dev against a local backend, or the deployed backend URL.
- `NEXT_PUBLIC_GENLAYER_CHAIN_ID` — `61999` for StudioNet.
- `NEXT_PUBLIC_MILESTONE_FORGE_CONTRACT_ADDRESS` — the deployed contract address.

```bash
npm install
npm run dev
```

## Dependency version notes (don't "helpfully" bump these without checking)

- `@reown/appkit` / `@reown/appkit-adapter-wagmi` are **pinned to exact `1.7.8`**, not a caret range. The latest `^1.x` resolves to a version whose bundled `@wagmi/connectors` requires `@wagmi/core@3.x`, which conflicts with `wagmi@2.x`'s own `@wagmi/core@2.x` dependency — this produces duplicate-type errors and missing-module webpack errors that look unrelated to version pinning at first glance.
- `package.json` has an `"overrides"` block forcing a single deduped `@wagmi/core@2.22.1` across the whole dependency tree. Removing it reintroduces the duplicate-copy problem.
- `next.config.mjs` stubs out `@coinbase/cdp-sdk`, `@base-org/account`, and `@metamask/connect-evm` via webpack aliases — these are optional Base Pay / x402 payment / newer MetaMask SDK connector features pulled in transitively by Reown's wagmi adapter that this project does not use (Milestone Forge settles exclusively in GEN through the Intelligent Contract).
- `app/layout.tsx` sets `export const dynamic = "force-dynamic"` — every page depends on the browser-only wallet client, so build-time static prerendering isn't viable here.

If you hit a `Module not found` or duplicate-type error after touching wallet/wagmi dependencies, check this list before assuming it's a new problem — it has happened before for these exact reasons.

## Deployment

See [`../docs/DEPLOYMENT.md`](../docs/DEPLOYMENT.md). To redeploy after a code change:
```bash
vercel deploy --prod --yes
```

**If the change is (or touches) a `NEXT_PUBLIC_*` env var** — most commonly `NEXT_PUBLIC_MILESTONE_FORGE_CONTRACT_ADDRESS` after a redeploy — use `--force` instead:
```bash
vercel deploy --prod --yes --force
```
Vercel restores the previous build's cache by default, and that cache does not invalidate on an env var change alone (the var gets inlined into JS at build time, but the build step can consider the source file "unchanged" and skip recompiling it). A plain `--yes` deploy can report success while silently shipping a bundle with the *old* value still baked in — this happened for real during the fourth contract redeploy (see `memory/MEMORY.md`) and produced no error anywhere, just wrong live data. `--force` (without also passing `--with-cache`) discards the cache and forces a clean rebuild.
