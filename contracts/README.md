# Milestone Forge — Intelligent Contract

The single production [GenLayer](https://docs.genlayer.com/) Intelligent Contract for the protocol. See [`../docs/PROTOCOL.md`](../docs/PROTOCOL.md) for the full behavioral spec.

- **File**: `milestone_forge.py` (~1,600 lines)
- **Deployed at**: `0x8Bbb6c4508D83d7bd0e3a4db555c92B3A1CB1DFb` on GenLayer StudioNet
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

There is no automated test suite committed yet — `tests/` is scaffolded but empty. If you add tests, use GenLayer's own direct-mode (fast, no server, exercises business logic and validation but not validator consensus) and integration-mode (slower, full consensus, exercises real web/LLM/onchain fetches and validator agreement) testing rather than inventing a new harness.

## Key design points worth knowing before you touch this file

- **Every GEN transfer goes through `_send_gen`.** Any new payout path must zero the relevant ledger field(s) (`reward_deposited`/`bond_deposited`) and persist state *before* calling it — see `docs/PROTOCOL.md` §7 for why.
- **The nondeterministic evaluation (`_evaluate_milestone`) and the deterministic payout calculation (`_compute_deterministic_payout_bps`) are intentionally separate functions.** Don't let web/LLM logic creep into the payout math, and don't let the payout math perform any nondeterministic call.
- **Equivalence comparison is on the `passed` boolean per criterion, exactly** — not on free text, not on a JSON-schema-only check. If you add a new criterion type, its validator function must independently re-derive the same boolean, not just check that the leader's output is well-formed.
- **Criteria and artifact locations are immutable after `create_grant`.** A challenge can only add evidence via `file_challenge`/`resolve_challenge`; there is no method that lets anyone edit a `Criterion` after creation.
