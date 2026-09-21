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

## Three real runtime bugs found and fixed across three deploys (2026-09-21)

Two failed live transactions on StudioNet, then local direct-mode testing
(`contracts/tests/direct/`, added this session), surfaced three bugs that
`genvm-lint check` cannot catch (it's static-only, never executes the
contract). Full technical detail: `contracts/README.md` §"Things
genvm-lint check does NOT catch". History, oldest to newest:

1. **`DynArray[T]()` can never be constructed directly — not even via
   `gl.storage.inmem_allocate`** (that's for generic `@allow_storage`
   dataclasses only; `DynArray.__init__` unconditionally raises). The
   actual fix is a plain Python `list` for any local temporary collection.
   First deploy (`0x8Bbb6c4508D83d7bd0e3a4db555c92B3A1CB1DFb`, superseded)
   hit this on `create_grant`. An earlier fix attempt using
   `inmem_allocate` was itself wrong and would have failed too — confirmed
   by local execution, not assumption.
2. **There is no flat `gl.emit_event(name, dict)` function.** Second
   deploy (`0xD09e8EE4C23E3900bdcC581859A3c658713155a1`, superseded) hit
   this on `update_protocol_params`. Fixed by defining `gl.Event`
   subclasses and calling `.emit()`.
3. **There is no `gl.block.timestamp` or `gl.hash`.** Found via local
   direct-mode tests before it could hit a live transaction. Fixed with
   `_current_timestamp()` (reads `gl.message_raw["datetime"]`) and
   `Keccak256(...).hexdigest()`.

All three fixed in `contracts/milestone_forge.py`, verified by
`genvm-lint check` (clean) AND `pytest contracts/tests/direct/ -v` locally
(6/6 passing, covering create_grant, claim submission through a real
mocked-web evaluation to a PASSED verdict, access control, and challenge
bond validation) — this was the first point in the project where the
contract had been proven to execute, not just parse.

**Current live address (third deploy): `0x565E9013F85fa91491ecDD87E095201E0AEd1b84`**
— wired into `backend/.env`, the Fly.io secret, `frontend/.env.local`, and
the Vercel env var, both apps redeployed. Constructor args unchanged
(2,500 GEN bond, 100% frivolous slash, 20% upheld bounty). **Not yet
confirmed working live** — `create_grant`/`update_protocol_params` should
be retried against this address before assuming the fixes hold in
production and not just in direct-mode tests. If a future session finds
any write failing with `TypeError`/`AttributeError` from GenVM again,
check `git log -- contracts/milestone_forge.py` for whether these three
fixes are present in the currently-deployed source — don't assume they
regressed without checking.

## Outstanding / not yet done

- Live retest of `create_grant` (and ideally `update_protocol_params`)
  against the third deploy address, to confirm all three bug fixes hold
  in production and not just in direct-mode tests.
- Only direct-mode tests exist (fast, in-process, no full validator
  consensus exercised). No integration-mode (real consensus) test suite yet.
- No live claim → consensus → release flow has been tried yet against any
  deployed contract — only in direct-mode tests so far.
