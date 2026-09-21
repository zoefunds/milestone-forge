# Milestone Forge — Project Memory

This file is the persistent index for this project. It survives across sessions.
Read this before doing anything else in this repo.

**As of 2026-09-21, this repo has proper documentation — read that first, not
just this file:**
- [`README.md`](../README.md) — what the project is, architecture, live URLs, repo layout, current status/known gaps.
- [`docs/PROTOCOL.md`](../docs/PROTOCOL.md) — full contract behavior spec (lifecycle, criteria types, Equivalence Principle, escrow custody pattern).
- [`docs/DEPLOYMENT.md`](../docs/DEPLOYMENT.md) — exact deploy/redeploy commands for contract, backend, frontend.
- [`contracts/README.md`](../contracts/README.md), [`backend/README.md`](../backend/README.md), [`frontend/README.md`](../frontend/README.md) — package-specific setup and gotchas.
- [`SECURITY.md`](../SECURITY.md), [`CONTRIBUTING.md`](../CONTRIBUTING.md) — reporting/contribution policy.

This file should stay short from now on — record only things that would
mislead a future session if assumed stale, not facts already correctly
documented above. Don't let this drift back into duplicating README/docs
content; update those files instead and link from here.

## Non-negotiable decisions (do not re-derive, do not contradict)

- **Contract deployment**: the USER deploys the Intelligent Contract
  themselves via GenLayer Studio/CLI. Claude must never attempt to deploy it
  or handle a private key for it.
- **Auth**: wallet-based, SIWE-style message signing. No email/password, no
  custodial private keys stored anywhere.
- **Escrow token**: GEN for everything (reward + dispute bonds).
- **Socials**: explicitly out of scope for v1 per user decision.
- **Challenge window**: 48h default, configurable 24h–168h per milestone,
  locked at genesis.
- Full rationale for all of the above is in `README.md` / `docs/PROTOCOL.md`
  now — don't re-litigate these, they're settled.

## Git / attribution

- Repo: https://github.com/zoefunds/milestone-forge.git, `main` branch.
- All commits authored as `zoefunds <preciousmofeoluwa@gmail.com>` — **no
  Claude/AI attribution in this repo's history.** This explicit user
  instruction overrides the default Claude Code attribution convention for
  every future commit in this repo, not just the ones already made.

## Things that will bite you if you don't already know them

These are real gotchas discovered the hard way; full detail is in the linked
files, but the summary so future sessions don't re-discover them from
scratch:

- **`genlayer-js`'s real published API (v1.1.8+) differs from the hosted
  GenLayer docs**, which appear to describe a newer/pre-release SDK. Always
  verify against `frontend/node_modules/genlayer-js/dist/index.d.ts` before
  trusting a docs code sample for this package. Details: `frontend/README.md`.
- Reown/wagmi/`@wagmi/core` version pinning is load-bearing in
  `frontend/package.json` (exact `1.7.8` for `@reown/appkit*`, an
  `overrides` block forcing a single `@wagmi/core`). Don't "helpfully"
  bump these without reading `frontend/README.md`'s dependency notes first.
- `frontend/lib/reown.ts`'s `createAppKit()` call must NOT be gated behind
  `typeof window` — this caused a real production 500 on every direct page
  load. See `frontend/README.md`.

## Contract redeploy required (2026-09-21)

The **first live transaction against the deployed contract failed** at
`create_grant` with `TypeError: this class can't be instantiated by user`
from GenVM's `DynArray.__init__`. Root cause: the contract built local
temporary collections with `DynArray[str]()` directly (e.g.
`milestone_ids: DynArray[str] = DynArray[str]()`) — GenVM does not allow
that. The correct pattern, confirmed against the docs, is
`gl.storage.inmem_allocate(DynArray[str])`. `genvm-lint check` does NOT
catch this — it's a runtime-only failure, so lint passing is not sufficient
proof a contract will actually execute.

Fixed in `contracts/milestone_forge.py` (all 7 occurrences). **This means
the deployed contract at `0x8Bbb6c4508D83d7bd0e3a4db555c92B3A1CB1DFb` is
stale/broken and must be redeployed** — the fix only exists in source until
the user redeploys via GenLayer Studio and provides the new address (same
process as `contracts/README.md`). Do not assume that address is still
current without checking whether a redeploy has happened since this note
was written.

## Outstanding / not yet done

- No automated test suite (`contracts/tests/` is scaffolded, empty).
- No live end-to-end wallet transaction has been run against the deployed
  contract yet (create grant → claim → consensus → release, with real
  testnet GEN) — needs a real wallet with funds, best done by the user or
  in a follow-up session with browser tools.
