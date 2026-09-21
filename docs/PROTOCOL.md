# Protocol Specification

This document describes what the deployed [`contracts/milestone_forge.py`](../contracts/milestone_forge.py) actually does. It is written from the code, not from a design intent — if this ever disagrees with the contract, the contract is right and this file is stale.

## 1. Actors

- **Funder** — creates a grant, deposits the full GEN reward across all milestones up front.
- **Grantee** — the sole address that can submit milestone claims for a grant.
- **Validators** — GenLayer's decentralized validator set; not a role any user picks. Every claim/challenge triggers independent inspection by multiple validators via GenVM's nondeterministic execution + Equivalence Principle.
- **Challenger** — any address (funder, grantee, or a third-party watchdog) that stakes a dispute bond to contest a passing verdict during the challenge window.

## 2. Grant and milestone lifecycle

```
create_grant (funder, payable)
       │
       ▼
Milestone[0] = CLAIMABLE, Milestone[1..n] = LOCKED
       │
       ▼ (grantee)
submit_milestone_claim
       │  → pins claim_submitted_at, claimed_artifact_hash
       │  → status = EVALUATING
       │  → triggers _evaluate_milestone (nondeterministic step, same tx)
       ▼
verdict computed: PASSED | PARTIAL_PASS | FAILED | INCONCLUSIVE
       │
       ├─ PASSED / PARTIAL_PASS → status = CHALLENGE_WINDOW (opens now, closes now + window)
       ├─ FAILED               → status = FAILED (funder can claim_failed_milestone_refund)
       └─ INCONCLUSIVE         → status = INCONCLUSIVE (anyone can retry_inconclusive_milestone)

During CHALLENGE_WINDOW:
       │
       ├─ anyone stakes the dispute bond → file_challenge → status = DISPUTED
       │        │
       │        ▼ (anyone)
       │  resolve_challenge → re-runs the SAME pinned criteria + checks additive evidence
       │        │
       │        ├─ UPHELD   → milestone → FAILED, challenger refunded + bounty from escrow
       │        └─ REJECTED → milestone → back to CHALLENGE_WINDOW, challenger's bond
       │                      partially/fully slashed to the grantee
       │
       └─ window elapses with no active challenge → anyone calls release_milestone
                │
                ▼
        reward split by recommended_payout_bps (deterministic, computed at evaluation time)
        grantee_share = reward * bps / 10000, funder_refund = reward - grantee_share
        next milestone unlocked (LOCKED → CLAIMABLE)
```

A grant completes (`GRANT_STATUS_COMPLETED`) once every milestone reaches a terminal state (`RELEASED`, `FAILED`, or `CANCELLED`). A `FAILED` milestone does **not** automatically unlock the next tranche — a failed milestone stops the pipeline rather than silently skipping ahead.

## 3. Criteria — precommitted, machine-checkable, immutable after genesis

Every milestone is created with one or more `Criterion` records, each with a `weight_bps` that must sum to exactly `10000` (100%) per milestone. Criterion descriptions are rejected at creation time if they're too short (<12 chars) or contain a denylisted vague phrase ("good progress", "best effort", "TBD", etc.) — this is enforced in `_create_criterion`, not left to convention.

Three supported types:

| Type | Fields | What the validator checks |
|---|---|---|
| `HTTP_ENDPOINT` | `target_url`, `expected_status_min/max`, `expected_body_contains` | Fetches the URL via `gl.nondet.web.get`; passes if the status code is in range and (if set) the body contains the expected substring. |
| `GIT_REPO_STATE` | `repo_url`, `repo_ref`, `repo_path_expected` | Queries the GitHub REST API (`/repos/{owner}/{repo}/commits/{ref}`) for the ref's existence, and optionally `/contents/{path}?ref={ref}` for a specific file. |
| `ONCHAIN_STATE` | `onchain_rpc_url`, `onchain_contract_address`, `onchain_min_block`, `onchain_event_topic0` | Calls `eth_getLogs` against the target contract/topic/block range via the given JSON-RPC endpoint; passes if at least one matching log exists. |

All three go through `_assert_safe_public_url` at creation time, which rejects loopback/link-local/private-network hosts (`localhost`, `127.*`, `10.*`, `192.168.*`, `169.254.*`/cloud metadata, etc.) as an SSRF guard baked into the contract itself, not just the frontend/backend convenience layer.

## 4. Nondeterministic evaluation and the Equivalence Principle

`_evaluate_milestone` runs a leader function (`_inspect_all_criteria`) that independently fetches every pinned artifact and returns a structured result: a list of `{criterion_id, passed, unreachable, detail}` entries.

Consensus (`gl.vm.run_nondet_unsafe` with a custom `validator_fn`) compares:
- **Exactly**: the `passed` boolean per criterion — this is the substantive decision field, and it must match exactly between leader and every validator.
- **With tolerance**: non-decision numeric fields like `latency_ms` — drift here never flips the consensus outcome, it only exists for observability.

This is deliberately *not*:
- `strict_eq` (which would fail on any HTTP timing/GitHub API caching drift)
- a JSON-schema-only check (which would let a leader emit any plausible-looking payload without a validator ever re-deriving the answer)
- a free-text / LLM-comparative judgment (there's no LLM in this contract's evaluation path at all — every check is a structured, code-level fetch-and-compare)

Any unreachable artifact anywhere in the criteria set forces the whole milestone to `INCONCLUSIVE`, never a partial silent pass.

## 5. Deterministic payout — the required separation

`_compute_deterministic_payout_bps(verdict, passed_weight, total_weight)` is a pure function: no web access, no LLM call, no randomness. It's called once, immediately after the nondeterministic step produces its structured result, and its only inputs are that already-agreed result. This is the hard boundary the spec requires: validators and any nondeterministic logic decide *what happened*; this function alone decides *how much money moves*, and it's auditable independent of any AI/web behavior.

| Verdict | Payout to grantee |
|---|---|
| `PASSED` | 100% (10000 bps) |
| `FAILED` | 0% |
| `PARTIAL_PASS` | `passed_weight / total_weight` — proportional to which weighted criteria passed |
| `INCONCLUSIVE` | 0% (no release until re-evaluated) |

## 6. Challenge window — additive evidence only

Default 48 hours, configurable 24–168 hours **per milestone at genesis** (`create_grant` time), never changeable afterward. A challenge:

1. Requires staking exactly `default_dispute_bond_wei` (a protocol-wide parameter, admin-adjustable, currently 2,500 GEN) — see `get_protocol_params`.
2. Supplies a `category` tag and an `evidence_url` (additive evidence — an independent uptime log, an archival snapshot, etc.) that must also pass the SSRF host guard.
3. Triggers `resolve_challenge`, which re-runs the *exact same pinned criteria* (never new criteria) plus an additional check of the evidence URL for corroborating failure-signal keywords (`down`, `unreachable`, `timeout`, `error`, `outage`, `failed`, `offline`) in its own reachable content.
4. Resolves `UPHELD` if the re-inspection no longer fully passes, **or** the additive evidence independently corroborates a failure the base re-check might still be masking (e.g. the target came back up between the original evaluation and the challenge, but an independent archival log shows it was down during the actual window).
5. Resolves `REJECTED` otherwise.

Outcomes:
- **UPHELD** — milestone → `FAILED`; challenger gets their bond back plus `upheld_bounty_bps` (currently 20%) of the milestone's remaining escrowed reward.
- **REJECTED** — milestone returns to `CHALLENGE_WINDOW`; `frivolous_slash_bps` (currently 100%) of the challenger's bond is slashed to the grantee, the remainder refunded to the challenger.

Funds are structurally unwithdrawable while `active_challenge_id` is set — `release_milestone` explicitly checks this.

## 7. Escrow custody pattern

Every GEN transfer in the contract funnels through one function:

```python
def _send_gen(to_address: Address, amount: u256) -> None:
    if amount <= u256(0):
        raise gl.vm.UserError(...)
    _Recipient(to_address).emit_transfer(value=amount)
```

The invariant enforced at every call site: read the ledger field into a local, **zero the ledger field, persist state**, and only *then* call `_send_gen`. This ordering means a milestone or challenge cannot be paid out twice — the balance it would be paid from is already zero in storage before the external transfer happens, so there's no reentrancy window.

Two ledger fields exist per milestone/challenge, deliberately separate from the agreed terms:
- `reward_wei` (term) vs. `reward_deposited` (actual escrow ledger — the only field payout logic reads)
- `bond_wei` (term) vs. `bond_deposited` (actual escrow ledger)

## 8. What the frontend/backend do NOT do

- The backend never determines a milestone's verdict. It only mirrors already-settled contract state into Postgres for fast list views (`backend/src/indexer.ts`).
- The backend never holds a key capable of writing to the contract. All writes are signed client-side by the connected wallet (`frontend/lib/genlayer.ts`).
- The frontend's own SSRF check (`frontend/lib/api.ts` → `backend/src/ssrfGuard.ts`) is a UX convenience for form validation before a user spends gas — it is not the authoritative enforcement point. The contract's own `_assert_safe_public_url` is.
