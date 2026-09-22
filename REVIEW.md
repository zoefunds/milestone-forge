# Team Review Response

This document tracks what the team's review flagged and exactly what changed in response — file by file, commit by commit. It is a point-in-time record of a review cycle, not living documentation; for current system behavior see [`README.md`](README.md), [`docs/PROTOCOL.md`](docs/PROTOCOL.md), and [`memory/MEMORY.md`](memory/MEMORY.md).

## The review feedback

The team's "more info needed" request, verbatim:

> Please update challenge resolution so additive evidence is authenticated or verifiably bound to the disputed milestone criterion and cannot overturn a passing re-check merely because an unrelated page contains a generic failure word. Also ensure partial-pass challenges require relevant corroboration rather than an automatic full-pass standard, make the frontend read the live challenge bond from `get_protocol_params` instead of hardcoding it, and add repository tests covering these corrected challenge and settlement paths.

Four distinct asks: (1) bind evidence to the specific disputed criterion, (2) fix the partial-pass auto-uphold standard, (3) read the dispute bond live on the frontend, (4) add tests for the corrected paths.

## 1. Evidence binding (`contracts/milestone_forge.py`)

**Before**: `file_challenge` took no `criterion_id` — a challenge disputed "the milestone" in general. `_inspect_evidence_url` treated any reachable page containing a failure keyword (`down`, `error`, `timeout`, etc.) as corroborating, regardless of whether it had anything to do with the disputed claim.

**After**:
- `file_challenge(milestone_id, criterion_id, category, evidence_url, evidence_note)` — `criterion_id` is now a required argument, validated against the milestone's own `criteria_ids` (`raise gl.vm.UserError` if it isn't one of them). This is a breaking ABI change from the third deploy.
- `_get_criterion_anchor(criterion)` returns the criterion's own artifact anchor (`target_url` / `repo_url` / `onchain_contract_address` depending on type).
- `_inspect_bound_evidence(evidence_url, criterion)` replaces the old generic-keyword check. Evidence now only corroborates when **all three** hold: the URL is reachable, its body contains the criterion's own anchor **verbatim**, and it contains a failure-signal keyword. A page that's generically about failure but never mentions the disputed artifact fails the `anchor_referenced` check and never corroborates anything.

## 2. Partial-pass auto-uphold bug (`contracts/milestone_forge.py`)

**Before**: `resolve_challenge` compared the re-check's *total weighted pass rate* against 100%. Since a `PARTIAL_PASS` milestone by definition already has a failing criterion, any challenge against it — including one disputing an already-*passing* criterion, with evidence that had nothing to do with that criterion — would upheld almost automatically.

**After**: `_find_result_for_criterion(milestone, criterion_id)` looks up the original `CriterionResult` for the *specific disputed criterion only*. `_settle_challenge` now keys `UPHELD` off `criterion_flipped = original_passed and (not disputed_unreachable) and (not disputed_now_passed)` **OR** `evidence_corroborates` — both scoped to the one disputed criterion. Other criteria's pass/fail state no longer affects the decision either way. `resolve_challenge`'s validator function also compares `anchor_referenced` between leader and validators, so the binding check itself is part of consensus, not just the leader's say-so.

## 3. Live dispute bond on the frontend (`frontend/app/grant/[grantId]/page.tsx`)

**Before**: the challenge form hardcoded a bond amount ("2,500 GEN") as display text and sent a fixed value with the transaction.

**After**: `protocolParams` is fetched via `readProtocolParams()` (`get_protocol_params` on the contract) alongside the grant data on page load. `handleFileChallenge` reads `protocolParams.default_dispute_bond_wei` live and uses it as the transaction value; the displayed bond amount is derived from the same live value. If params haven't loaded yet, the challenge button is disabled rather than falling back to a stale constant. The bond is admin-adjustable via `update_protocol_params`, so this closes a real correctness gap, not just a cosmetic one.

## 4. Tests for the corrected paths (`contracts/tests/direct/test_challenge_resolution.py`)

Five new direct-mode tests, added in commit `a903101` and strengthened in `9197527` to assert actual settlement math (not just the UPHELD/REJECTED label):

- `test_challenge_must_reference_a_real_criterion_of_the_milestone` — filing against a nonexistent `criterion_id` reverts.
- `test_partial_pass_milestone_unrelated_generic_evidence_does_not_uphold` — the exact bug scenario: a challenge against a still-passing criterion of a `PARTIAL_PASS` milestone, with evidence that's reachable and contains a failure word but never references the criterion's own URL, correctly resolves `REJECTED`. Under the pre-fix logic this used to auto-`UPHELD`.
- `test_bound_evidence_referencing_the_disputed_criterion_upholds` — evidence that *does* verbatim-reference the disputed criterion's anchor and contains a failure keyword correctly `UPHOLD`s, with numeric assertions on `reward_deposited` (post-bounty remainder) and `bond_deposited` (zeroed), plus a follow-up `claim_failed_milestone_refund` call proving the funder can actually pull back what's left.
- `test_criterion_that_now_fails_on_recheck_upholds_without_needing_evidence` — an honest re-check flip upholds on its own, no evidence required.
- `test_rejected_challenger_bond_is_slashed_to_grantee` — a frivolous rejection correctly slashes the full bond (100% `frivolous_slash_bps` as configured).

Current count: 11 direct-mode tests total, all passing (`pytest contracts/tests/direct/ -v`).

## What happened after the fix landed

The four items above answered the review's specific request, but two more steps were needed before the fix could be called *done* rather than just *written*:

### Redeploy and live wiring (commits `ff9990f`, `d74f874`)

The `file_challenge` signature change is a breaking ABI change — the third-deploy contract (`0x565E9013F85fa91491ecDD87E095201E0AEd1b84`) still had the old 4-arg signature and the old resolution logic. A fourth contract was deployed by the user (`0xc7aA666C8EF4fab7e7bc94A277eCD06161787314`), wired into `backend/.env` + the Fly.io secret + `frontend/.env.local` + the Vercel env var, and both apps redeployed.

### Live end-to-end verification (commit `d74f874`)

Direct-mode tests prove the logic is correct in isolation; they don't prove it holds under real GenVM multi-validator consensus, or that the fix is actually the code running at the live address. So a full live run was executed against the deployed contract — `create_grant` → `submit_milestone_claim` → `file_challenge` → `resolve_challenge` — using two funded StudioNet accounts and `genlayer-js`'s `createAccount(privateKey)` (no browser wallet needed), waiting out real consensus at each step.

Result: a two-criterion `PARTIAL_PASS` milestone was created and claimed; a challenge was filed against the still-passing criterion with evidence that was reachable but did not reference that criterion's own URL — exactly the bug scenario from the review. `resolve_challenge` correctly returned `REJECTED`, with the contract's own `resolution_detail` stating *"Criterion crit-5 still passes on re-check and no bound evidence corroborated a failure."* Verified rendering correctly on the live frontend afterward (`/grant/grant-3`, `/challenges`).

### Two unrelated bugs found during that verification (commit `d74f874`, `7eb1c22`)

Running the live check surfaced two real bugs that had nothing to do with the challenge-resolution logic itself, both now fixed:

1. **Stale Vercel build cache.** A normal `vercel deploy --prod --yes` after updating the contract-address env var silently restored the previous build's cache and shipped a bundle with the *old* address still inlined — no error anywhere, just wrong live data. Fixed by using `vercel deploy --prod --yes --force` (which discards cache) for any deploy that follows a build-time env var change; documented in `frontend/README.md` and `docs/DEPLOYMENT.md`.
2. **Backend indexer schema had no `contract_address` column.** `grant_id`/`milestone_id`/`challenge_id` are sequential counters the contract assigns fresh on every new deployment, not globally unique — so cached rows from the third deploy collided by primary key with the fourth deploy's own reused IDs, and the indexer briefly served the wrong grant's data under the right ID with no error. Fixed properly (commit `7eb1c22`): every table now keyed by `(contract_address, <id>)`, `indexer.ts` writes the current `contract_address` on every insert, `routes/grants.ts` filters every read by it, and `schema.sql` carries an idempotent in-place migration for the already-live database — tested against a disposable local Postgres for both the fresh-install and legacy-data-migration paths before touching production, then applied live via `flyctl ssh console -C "node dist/db/migrate.js"`. Verified afterward: `grant-1`, `grant-2`, and `grant-3` (three separate live e2e test runs) are now all indexed correctly, each under its own `contract_address`, with no collision.

### Documentation cleanup (commit `68368dc`)

A separate pass removed stale references across the repo that had drifted from actual state: three files (`SECURITY.md`, `CONTRIBUTING.md`, root `README.md`) still pointed at the *first* deployed contract address; `frontend/README.md` documented the pre-fix (buggy) `isTxSuccessful()` logic instead of the actual fixed implementation; the root README's "Current status / known gaps" section still claimed no test suite and no live transaction existed, both false by that point.

## Current state, as of this review response

- All four review items are implemented, tested (11/11 direct-mode), and confirmed live under real consensus on the deployed contract — not just fixed in source.
- The two bugs found during verification (Vercel cache, indexer schema) are both fixed and verified, not just documented as known issues.
- Full technical detail for all of the above lives in `memory/MEMORY.md` (the running incident log) and `docs/PROTOCOL.md` §6 (the corrected challenge-window spec).

## Still open

- No automated integration-mode (real consensus) test suite exists yet — the live e2e run described above was a manual, one-off script, not a repeatable test in the repo.
- Socials/OAuth-linked profiles remain explicitly out of scope for v1 (unrelated to this review).
