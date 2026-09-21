# Milestone Forge

**Fund the milestone, not the promise. Let the public record decide when it's actually done.**

Milestone Forge is an onchain grant / milestone-release protocol for DAOs, public-goods funders, and grant committees paying builders in tranches. A funder and a grantee agree on a grant with multiple milestones. At grant creation, each milestone's release criteria are locked as specific, machine-checkable claims tied to specific public artifact locations — a live URL and expected behavior, a GitHub repo and an expected commit/tag/file, or an onchain contract and an expected event. When the grantee claims a milestone is complete, independent [GenLayer](https://www.genlayer.com/) validators fetch and inspect those exact artifact locations themselves, and a deterministic function releases the milestone's GEN tranche from escrow. Either party (or a third-party watchdog) can challenge a result with additional evidence before release finalizes.

It is deliberately **not**:
- a traditional crowdfunding platform
- a simple escrow-and-release app with a human approver
- a generic "AI reviews your work" tool
- a governance/voting platform

The central loop:

```
GRANT + PRECOMMITTED MILESTONE CRITERIA
       ↓
LOCKED ESCROW (PER-MILESTONE TRANCHES, GEN)
       ↓
MILESTONE CLAIM (PINNED ARTIFACT SNAPSHOT HASH)
       ↓
INDEPENDENT MULTI-VALIDATOR ARTIFACT INSPECTION
       ↓
EQUIVALENCE ON STRUCTURED PER-CRITERION RESULT
       ↓
DETERMINISTIC TRANCHE RELEASE (separate function, no web/LLM access)
       ↓
CHALLENGE WINDOW (additive evidence only)
       ↓
FINALIZED PULL-BASED WITHDRAWAL
```

## Live deployment

| Component | URL / Address |
|---|---|
| Frontend | https://milestone-forge.vercel.app |
| Backend API | https://milestone-forge-backend.fly.dev |
| Intelligent Contract | [`0x565E9013F85fa91491ecDD87E095201E0AEd1b84`](https://studio.genlayer.com) on GenLayer StudioNet |

Backend health check: `GET /health/healthz` → `{"status":"ok"}`.

## Why GenLayer

A milestone claim is never "the grantee says it's done." The Intelligent Contract:

1. Pins the exact artifact snapshot being evaluated *before* any validator looks at it (a claim can't be evaluated against evidence chosen after the fact).
2. Has every validator independently fetch the pinned HTTP endpoint, query the GitHub API for the pinned ref, or read onchain logs itself — never trusting a grantee-supplied screenshot or self-reported hash.
3. Reaches consensus (the Equivalence Principle) by comparing a **structured per-criterion boolean result** with numeric tolerance on non-decision fields (like latency) — never a free-text comparison and never a JSON-schema-only check that would let one leader decide unilaterally.
4. Computes the payout with a fully separate, pure **deterministic** function that only reads the already-agreed structured result — no web access, no LLM call, no randomness touches the money transfer.
5. Resolves an unreachable or ambiguous artifact to an explicit `INCONCLUSIVE` state — never a silently-picked default, never a default "release funds."
6. Opens an **additive-evidence-only** challenge window after every passing result — a challenge can add counter-evidence but can never replace or rewrite the pinned genesis criteria.

Full technical writeup: [`docs/PROTOCOL.md`](docs/PROTOCOL.md). Also rendered as an in-app page at `/docs` on the live frontend.

## Repository layout

```
contracts/     The single production GenLayer Intelligent Contract (Python)
backend/       Express/TypeScript API — read-cache indexer + SIWE auth + rate-limited GenLayer proxy
frontend/      Next.js 14 App Router site — Reown AppKit wallet connect, all writes signed client-side
docs/          Protocol writeup, architecture, deployment runbook
memory/        Session continuity notes for AI-assisted development on this repo
```

Each of `contracts/`, `backend/`, and `frontend/` has its own README with setup instructions specific to that package.

## Architecture at a glance

```
┌─────────────────────────┐
│  Next.js Frontend         │  Vercel — milestone-forge.vercel.app
│  Reown AppKit wallet connect│
│  SIWE auth · all reads AND  │
│  writes go straight to      │
│  GenLayer from the browser  │
└──────────┬─────────────────┘
           │ REST (auth + cached lists only)
┌──────────▼─────────────────┐
│  Express Backend             │  Fly.io — milestone-forge-backend.fly.dev
│  - SIWE session issuance     │  2 always-on machines
│  - Postgres read-cache/indexer│
│  - GenLayer-rate-limited     │
│    read client (30 req/min)  │
└──────────┬─────────────────┘
           │ genlayer-js (reads only, backend never writes)
┌──────────▼─────────────────┐
│  MilestoneForge.py            │  GenLayer StudioNet
│  Intelligent Contract          │  0x565E...d1b84
│  - grant/escrow/tranches       │
│  - pinned criteria + artifacts │
│  - validator web-fetch         │
│  - Equivalence Principle       │
│  - deterministic release       │
│  - challenge window            │
└─────────────────────────────┘
           │
┌──────────▼─────────────────┐
│  Postgres (Fly)               │  milestone-forge-db
│  read-cache mirror only —      │
│  never authoritative for       │
│  escrow balances or verdicts   │
└─────────────────────────────┘
```

**Trust boundary, stated plainly:** the backend is a convenience layer only. Every page in the frontend reads contract state directly from GenLayer StudioNet in the browser (not through the backend), and every write (create grant, submit claim, file challenge, release tranche) is signed by the user's own connected wallet and submitted directly to the contract. The backend cannot fabricate a milestone verdict, cannot move funds, and never holds a private key capable of writing to the contract. Its only jobs are: issue SIWE sessions, mirror contract events into Postgres for fast list views, and keep the whole app's GenLayer read traffic under GenLayer's 30 requests/minute limit.

## The Intelligent Contract

[`contracts/milestone_forge.py`](contracts/milestone_forge.py) — a single production contract (~1,600 lines), pinned to a fixed GenVM runner version, lint- and schema-verified with `genvm-lint`.

Supports three artifact/criterion types per milestone, weighted toward the milestone's payout:
- **`HTTP_ENDPOINT`** — a live URL, expected HTTP status range, optional expected body substring
- **`GIT_REPO_STATE`** — a GitHub repo, a ref (branch/tag/commit), optional expected file path
- **`ONCHAIN_STATE`** — a JSON-RPC endpoint, a target contract address, an expected event topic and minimum block

Escrow custody follows a single-choke-point pattern: every GEN payout goes through one `_send_gen` function, the ledger fields (`reward_deposited`, `bond_deposited`) are zeroed and persisted *before* any transfer, so a milestone or challenge can never be paid out twice.

## Local development

Each package has its own setup instructions:
- [`contracts/README.md`](contracts/README.md)
- [`backend/README.md`](backend/README.md)
- [`frontend/README.md`](frontend/README.md)

Quick start (assumes the contract is already deployed — see [`docs/DEPLOYMENT.md`](docs/DEPLOYMENT.md) if not):

```bash
# Backend
cd backend
cp .env.example .env   # fill in DATABASE_URL, REDIS_URL, SESSION_JWT_SECRET, etc.
npm install
npm run build && npm run migrate
npm run dev

# Frontend (separate terminal)
cd frontend
cp .env.example .env.local   # fill in NEXT_PUBLIC_REOWN_PROJECT_ID, contract address, etc.
npm install
npm run dev
```

## Trying it out

Want to click through the live app without figuring out what to type into
each field yourself? [`docs/TESTING_SAMPLES.md`](docs/TESTING_SAMPLES.md)
has copy-paste sample values for every form (Create Grant, Claim Milestone,
File Challenge) plus a suggested end-to-end test sequence.

## Current status / known gaps

This is an honest snapshot, not a marketing page:

- Both `backend` and `frontend` build and typecheck clean and are deployed and health-checked live (see above).
- **No automated test suite yet** — `contracts/tests/` is scaffolded but empty. The contract has been verified with `genvm-lint check` (lint + SDK-semantic validation + ABI schema extraction) but not yet exercised with GenLayer's direct-mode or integration test tooling.
- **No live end-to-end wallet transaction has been run against the deployed contract yet** (create grant → claim → consensus → release, with real testnet GEN). The write paths are implemented and typecheck against the real `genlayer-js` SDK surface, but haven't been exercised by an actual signed transaction as of this writing.
- Socials/OAuth-linked profiles are explicitly out of scope for v1.

## License

[MIT](LICENSE).

## Security

See [`SECURITY.md`](SECURITY.md) for how to report a vulnerability — this project moves real GEN.
