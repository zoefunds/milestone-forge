# Milestone Forge — Intelligent Contract

The single production [GenLayer](https://docs.genlayer.com/) Intelligent Contract for the protocol. See [`../docs/PROTOCOL.md`](../docs/PROTOCOL.md) for the full behavioral spec.

- **File**: `milestone_forge.py` (~1,600 lines)
- **Deployed at**: `0xc7aA666C8EF4fab7e7bc94A277eCD06161787314` on GenLayer StudioNet (fourth deploy — adds the criterion-bound challenge resolution fix; see `docs/PROTOCOL.md` §6 and `memory/MEMORY.md`)
- **Runner**: pinned to `py-genlayer:1jb45aa8ynh2a9c9xn3b7qqh8sm5q93hwfp7jqmwsfhh8jpz09h6` in the file's first-line `Depends` comment. Never change this to `:test` or `:latest` — those are local-development-only aliases that GenLayer networks reject.

## Constructor arguments (as deployed)

```
default_dispute_bond_wei: "2500000000000000000000"   # 2,500 GEN
frivolous_slash_bps:      10000                        # 100%
upheld_bounty_bps:        2000                          # 20%
```

These are admin-adjustable post-deploy via `update_protocol_params` (see `get_protocol_params` for current live values).

## Deploying (or redeploying)

**Deployment is a manual, deliberate action — do this yourself via GenLayer Studio, never automate it.** Genlayer contracts are immutable once deployed; there is no "hot fix," only a new address.

1. Open [GenLayer Studio](https://studio.genlayer.com), load `milestone_forge.py`.
2. Supply the constructor args above (or your own values if intentionally changing protocol parameters at genesis).
3. Deploy, copy the resulting address.
4. Update `MILESTONE_FORGE_CONTRACT_ADDRESS` in:
   - `backend/.env` (local) and the Fly.io secret (`flyctl secrets set -a milestone-forge-backend MILESTONE_FORGE_CONTRACT_ADDRESS=...`)
   - `frontend/.env.local` (local) and the Vercel env var (`NEXT_PUBLIC_MILESTONE_FORGE_CONTRACT_ADDRESS`, `vercel env add`)
5. Redeploy backend and frontend so they pick up the new address.

Full step-by-step: [`../docs/DEPLOYMENT.md`](../docs/DEPLOYMENT.md).

## Linting and schema validation

```bash
pip install genvm-linter
genvm-lint check milestone_forge.py
genvm-lint schema milestone_forge.py --output ../docs/contract_abi.json
```

`check` runs both AST-level lint (forbidden imports, non-determinism outside nondet blocks, etc.) and SDK-semantic validation (decorator correctness, storage type validity, method signatures). `schema` extracts the ABI that `genlayer-js`'s `readContract`/`writeContract` calls are validated against — if this fails to extract, something is structurally wrong with the contract and it will fail to load in Studio too.

## Testing

`tests/direct/` has direct-mode tests (fast, in-process, no server — exercises business logic, state transitions, and access control, but not full validator consensus):

```bash
pip install genlayer-test
pytest contracts/tests/direct/ -v
```

These tests are what caught three real runtime bugs the first deployment shipped with (see "Things `genvm-lint` does not catch" below) — **run them before every redeploy**, not just lint. There is no integration-mode (full consensus) test suite yet.

## Things `genvm-lint check` does NOT catch

Lint passing is a necessary but not sufficient check — it does purely static AST/SDK-semantic validation, never executes the contract. The first three real bugs found in this contract all passed lint cleanly and only surfaced on an actual transaction (two of them via a failed live `create_grant`/`update_protocol_params` on StudioNet, the third via local direct-mode tests written afterward):

1. **`DynArray[T]()` / `TreeMap[K, V]()` can never be constructed directly** — not even via `gl.storage.inmem_allocate`, which is for generic `@allow_storage` dataclasses only. `DynArray.__init__` unconditionally raises `TypeError: this class can't be instantiated by user`. For a local temporary collection, just use a plain Python `list`/`dict` — the storage descriptor (`_DynArrayDesc.set`, etc.) accepts any `Sequence`/`Mapping` on assignment and converts it.
2. **There is no flat `gl.emit_event(name, dict)` function.** Define event classes as `class MyEvent(gl.Event): def __init__(self, /, **blob): ...` and emit via `MyEvent(**fields).emit()`. See the `Events` section near the top of `milestone_forge.py` for the working pattern.
3. **There is no `gl.block.timestamp` or `gl.hash`.** The only timestamp available is the ISO-8601 string at `gl.message_raw["datetime"]` (part of the signed transaction input, so it's deterministic across validators) — see `_current_timestamp()`. Hashing uses `Keccak256(...).hexdigest()` (exported directly from `genlayer`, i.e. `from genlayer import *` already gives you `Keccak256`), not `gl.hash.sha3_256`.

If you're adding new contract logic and unsure whether an API exists, grep the actual installed SDK source before trusting hosted docs or memory of similar projects — `~/.cache/gltest-direct/extracted/<version>/py-lib-genlayer-std/*/genlayer/` has the real, current implementation. The hosted docs at docs.genlayer.com describe a noticeably different (likely newer/pre-release) API surface for several of these — see `frontend/README.md` for the same problem on the JS SDK side.

## Key design points worth knowing before you touch this file

- **Every GEN transfer goes through `_send_gen`.** Any new payout path must zero the relevant ledger field(s) (`reward_deposited`/`bond_deposited`) and persist state *before* calling it — see `docs/PROTOCOL.md` §7 for why.
- **The nondeterministic evaluation (`_evaluate_milestone`) and the deterministic payout calculation (`_compute_deterministic_payout_bps`) are intentionally separate functions.** Don't let web/LLM logic creep into the payout math, and don't let the payout math perform any nondeterministic call.
- **Equivalence comparison is on the `passed` boolean per criterion, exactly** — not on free text, not on a JSON-schema-only check. If you add a new criterion type, its validator function must independently re-derive the same boolean, not just check that the leader's output is well-formed.
- **Criteria and artifact locations are immutable after `create_grant`.** A challenge can only add evidence via `file_challenge`/`resolve_challenge`; there is no method that lets anyone edit a `Criterion` after creation.
- **Never construct a local `DynArray[T]()` or `TreeMap[K, V]()` directly, and don't use `gl.storage.inmem_allocate` for them either** — see "Things `genvm-lint check` does NOT catch" below for the actual fix (plain Python `list`/`dict`).
