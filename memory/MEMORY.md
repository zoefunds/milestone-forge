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
- **`genlayer-js`'s default `waitForTransactionReceipt` poll budget is only
  `interval: 3000ms, retries: 10` — 30 seconds total.** Real MilestoneForge
  writes (claim submission, challenge resolution) trigger live
  multi-validator web/GitHub/RPC fetches plus a full commit-reveal
  consensus round and routinely take well over a minute. Using the SDK
  default made the frontend report transactions as "failed" purely because
  our poll gave up — while GEN could still move on-chain afterward, which
  is a genuinely dangerous UX bug (tells the user their money is gone when
  it isn't). Fixed in `frontend/lib/genlayer.ts` with explicit generous
  budgets (`ACCEPTED_WAIT`/`FINALIZED_WAIT`, ~3min/~10min) and a distinct
  `"timeout"` lifecycle status (never reported as `"failed"`) that tells
  the user to check back rather than assume loss. If you see "transaction
  failed" reports that don't match what actually happened on StudioNet,
  check whether this distinction has regressed.
- **`simplifyTransactionReceipt` (called internally by `waitForTransactionReceipt`)
  RENAMES `statusName` to `status_name` (snake_case) in the object it
  actually returns.** Checking `tx.statusName` on the result is always
  `undefined` — this made `isTxSuccessful()` report EVERY successful
  finalized transaction as failed (users saw "Transaction failed: Execution
  failed" immediately after a grant that had, in fact, been created — visible
  on Explore Grants). Separately, for `studionet` (`chain.isStudio === true`
  — this is the chain this app uses), the SDK's `getTransaction` never
  populates `txExecutionResult`/`txExecutionResultName` at all; the real
  per-run outcome lives at `consensus_data.leader_receipt[].execution_result`
  (a plain string GenVM sets, matching what the Studio explorer UI shows as
  "Execution Result: SUCCESS"/"ERROR"). Fixed in `frontend/lib/genlayer.ts`'s
  `isTxSuccessful()` to read `status_name` (with an `statusName` fallback for
  safety) and check `leader_receipt[].execution_result` for an actual error
  signal, defaulting to success (not failure) when no result is present —
  same reasoning as the timeout fix above: a false "failed" report is worse
  than a missed true failure, because it makes the user think their GEN is
  gone. **Lesson for future debugging of this SDK**: never trust a field
  name by reading the TypeScript `.d.ts` alone — `simplifyTransactionReceipt`
  and `decodeTransaction` in `node_modules/genlayer-js/dist/index.js` (plain
  JS, not typed) rename/reshape fields in ways the type definitions don't
  fully capture. Read the actual `.js` implementation when a status check
  doesn't behave as the types suggest it should.

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

Third deploy (`0x565E9013F85fa91491ecDD87E095201E0AEd1b84`) shipped these
three fixes and was, at the time, unconfirmed live. It has since been
**superseded by the fourth deploy** (`0xc7aA666C8EF4fab7e7bc94A277eCD06161787314`
— see "Challenge resolution fix" section below), which carries the same
three fixes plus the challenge-resolution correctness fix, and **has been
confirmed working live**: a full `create_grant` → `submit_milestone_claim`
→ `file_challenge` → `resolve_challenge` run completed successfully under
real GenVM consensus (see "Live e2e test" section below). If a future
session finds any write failing with `TypeError`/`AttributeError` from
GenVM again, check `git log -- contracts/milestone_forge.py` for whether
these three fixes are present in the currently-deployed source — don't
assume they regressed without checking.

## Challenge resolution fix — redeploy #4 shipped and confirmed live (2026-09-21)

External review flagged real weaknesses in `file_challenge`/`resolve_challenge`:
additive evidence wasn't bound to any specific criterion (a generic page
containing the word "error" could corroborate ANY dispute), and the UPHELD
decision required the milestone's *entire* re-check to reach 100% pass —
which meant a challenge against a `PARTIAL_PASS` milestone (which by
definition has a failing criterion) would upheld almost automatically
regardless of evidence relevance.

Fixed in `contracts/milestone_forge.py`:
- **`file_challenge` signature changed**: now
  `file_challenge(milestone_id, criterion_id, category, evidence_url, evidence_note)`
  — `criterion_id` is a new required positional arg, validated against the
  milestone's own `criteria_ids`. **This is a breaking ABI change** —
  frontend, any external caller, and the currently-deployed contract (still
  on the old 4-arg signature) are now out of sync.
- Evidence is only treated as corroborating when it's verifiably bound: the
  evidence page must be reachable, reference the disputed criterion's own
  artifact anchor (`target_url`/`repo_url`/`onchain_contract_address`)
  verbatim, AND contain a failure keyword — all three, not just one.
- UPHELD now keys off the disputed criterion specifically (either its own
  re-check flips to failing, or bound evidence corroborates), never the
  milestone's overall pass rate. Unrelated criteria no longer affect the
  decision either way.
- New test file `contracts/tests/direct/test_challenge_resolution.py` (5
  tests) directly proves the old bug is fixed: unbound generic evidence
  against a partial-pass milestone's still-passing criterion is correctly
  REJECTED (this exact scenario used to auto-UPHOLD); properly bound
  evidence correctly UPHOLDS; an honest re-check flip UPHOLDS without
  needing evidence; bond slashing still works.

Frontend (`frontend/app/grant/[grantId]/page.tsx`) updated to match: the
challenge form now has a required criterion picker, and the dispute bond
amount is read live from `get_protocol_params` (`readProtocolParams()`)
instead of a hardcoded `"2500"` — this was also explicitly called out in
the same review.

**Status: fixed in source, verified locally (11/11 direct-mode tests
passing), deployed as the fourth contract address:
`0xc7aA666C8EF4fab7e7bc94A277eCD06161787314`.** Wired into `backend/.env`,
the Fly.io secret, `frontend/.env.local`, and the Vercel production env
var; both apps redeployed. Live-verified by loading `/settings` on
`https://milestone-forge.vercel.app`, which correctly read protocol
params (admin address, 2500 GEN dispute bond, 100% frivolous slash, 20%
upheld bounty, 24h–168h challenge window) from the new address — confirms
the frontend/contract wiring works, though this only exercises a read
call, not the challenge write path itself.

## Live e2e test of the challenge-resolution fix — passed, and two real bugs found/fixed (2026-09-21)

Ran a full live end-to-end test against the fourth deploy
(`0xc7aA666C8EF4fab7e7bc94A277eCD06161787314`), not direct-mode: two fresh
StudioNet accounts (funder/challenger and grantee, funded with test GEN by
the user), driven via a one-off Node script using `genlayer-js`'s
`createAccount(privateKey)` (no browser wallet needed) to call
`create_grant` → `submit_milestone_claim` → `file_challenge` →
`resolve_challenge` directly against the deployed contract, waiting out
real multi-validator consensus at each step (each write took several
minutes, consistent with the documented timeout-budget fix above).

**Result: the fix works under real consensus.** A two-criterion milestone
(A passes, B fails) correctly evaluated to `PARTIAL_PASS`. A challenge was
filed against the *still-passing* criterion A with evidence that was
reachable but did NOT reference A's own `target_url` — exactly the bug
scenario. `resolve_challenge` correctly returned `REJECTED`, with
`resolution_detail: "Criterion crit-5 still passes on re-check and no
bound evidence corroborated a failure"` — under the pre-fix logic this
exact scenario used to auto-UPHOLD. The milestone returned to
`CHALLENGE_WINDOW` with `PARTIAL_PASS`/5000 bps untouched, and the
challenger's bond was correctly zeroed (100% frivolous slash).

Along the way, found and fixed two **real bugs, unrelated to the contract
fix itself**:

1. **The Vercel production frontend was silently serving a stale build**
   with the OLD (third-deploy) contract address baked in, despite the env
   var being correctly updated and `vercel deploy --prod` reporting
   success — twice. Root cause: Vercel restored the previous build's
   webpack/Next.js cache (`Restored build cache from previous
   deployment`), and that cache does not invalidate on a `NEXT_PUBLIC_*`
   env var change alone — the env var is inlined into JS at build time,
   but the build step considered the source "unchanged" and skipped
   recompiling the chunk that embeds `CONTRACT_ADDRESS`. This means the
   frontend was reading a grant (`grant-3`) that actually belonged to the
   *old* contract instance and rendering it as if it were current —
   `funder`/`grantee`/title were all real but from the wrong deployment,
   a genuinely confusing failure mode since nothing errored. **Fix: use
   `vercel deploy --prod --yes --force`** (without `--with-cache`) to
   force a clean, uncached build whenever a build-time env var changes,
   not just `vercel deploy --prod --yes`. Verified by confirming the
   rebuilt bundle no longer contains the old address string and that
   `/grant/grant-3` now renders the correct live data.
2. **The backend Postgres indexer schema (`backend/src/db/schema.sql`)
   had no `contract_address` column** — `grant_id`/`milestone_id`/
   `challenge_id` primary keys are only unique *within* one contract
   deployment (they're sequential counters the contract assigns from
   scratch on each fresh deploy), so cached rows from a prior deployment
   silently collided by primary key with the new deployment's own IDs
   after a redeploy. This compounded bug #1's confusion. First worked
   around with a one-off manual truncate, then **fixed properly the same
   day**: every table (`grants`/`milestones`/`challenges`/
   `contract_events`) is now keyed by `(contract_address, <id>)`, every
   `indexer.ts` insert writes `contract_address` from `config
   .contractAddress`, and every `routes/grants.ts` query filters by it.
   `schema.sql` includes an idempotent in-place migration (`DO $$ ... $$`
   blocks, careful about FK drop/add ordering across the
   challenges→milestones→grants chain) for a database that already had
   these tables from before the column existed — tested against a local
   Postgres instance for both the fresh-install path and the
   legacy-data-migration path before touching production. Deployed and
   migrated live via `flyctl ssh console -C "node dist/db/migrate.js"`.
   Redeploys no longer need a manual truncate: old rows just stay under
   their own `contract_address`, never served as the current deployment's
   data.

**Practical rule for future redeploys**: after updating
`MILESTONE_FORGE_CONTRACT_ADDRESS` and redeploying, (a) force-rebuild the
frontend (`vercel deploy --prod --yes --force`), and (b) redeploy the
backend and run the migration (`node dist/db/migrate.js`) — no manual
table truncation needed any more.

## Outstanding / not yet done

- Only direct-mode tests exist for CI/local verification (fast, in-process,
  no full validator consensus exercised). No automated integration-mode
  (real consensus) test suite yet — the live e2e run above was manual/
  one-off, not a repeatable test in the repo.
