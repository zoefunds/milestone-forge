# Contributing

## Before you start

This repo has three independently-versioned packages that must stay consistent with each other:

- `contracts/milestone_forge.py` — the deployed source of truth. Changing it does **not** change the live contract at `0xc7aA666C8EF4fab7e7bc94A277eCD06161787314` — GenLayer contracts are immutable once deployed. A contract change means: update the file, redeploy via GenLayer Studio to get a new address, then update `MILESTONE_FORGE_CONTRACT_ADDRESS` in both `backend/.env` and `NEXT_PUBLIC_MILESTONE_FORGE_CONTRACT_ADDRESS` in `frontend/.env.local` (and the corresponding Fly/Vercel secrets — see `docs/DEPLOYMENT.md`). **After any redeploy, force an uncached frontend rebuild** (`vercel deploy --prod --yes --force`, not a plain `--yes`) and clear the backend indexer tables — see the "Vercel build cache" and indexer-schema notes in `docs/DEPLOYMENT.md` and `memory/MEMORY.md` for why both steps are required, not optional.
- `backend/` — must stay compatible with whatever the currently-deployed contract's ABI actually is. If you rename or change the signature of a contract method, update `backend/src/genlayerClient.ts` / `backend/src/indexer.ts` and `frontend/lib/useMilestoneForge.ts` together.
- `frontend/` — every write path in `frontend/lib/useMilestoneForge.ts` calls a specific contract function name and argument order. Keep those in sync with the contract source, not with docs — the contract is authoritative.

## Workflow

1. Make your change in the relevant package.
2. Lint/typecheck/build before opening a PR:
   ```bash
   # Contract
   cd contracts && genvm-lint check milestone_forge.py

   # Backend
   cd backend && npx tsc --noEmit -p tsconfig.json && npm run build

   # Frontend
   cd frontend && npx tsc --noEmit -p tsconfig.json && npm run build
   ```
3. If you touched the contract, note in your PR description whether the change requires a redeploy and address migration (it almost always does).
4. If you touched escrow logic (anything that calls `_send_gen`, or the ledger fields `reward_deposited`/`bond_deposited`), explicitly call out in your PR how you verified the zero-then-transfer ordering still holds — see `docs/PROTOCOL.md` §7.

## Code style

- **Contract**: follow the patterns already in `milestone_forge.py` — error prefixes (`[EXPECTED]`, `[EXTERNAL]`, `[TRANSIENT]`, `[LLM_ERROR]`), `gl.vm.UserError` never bare `Exception`, `TreeMap`/`DynArray` not `dict`/`list` for storage, structured (not free-text) comparison in any new Equivalence Principle logic.
- **Backend/Frontend**: TypeScript strict mode is on in both `tsconfig.json`s — don't loosen it. Prefer explicit types over `any`; where a third-party SDK's published types are wrong or incomplete (see the `genlayer-js` note in `memory/MEMORY.md`), cast narrowly and comment why.
- No commented-out code, no `TODO` left in place of actual error handling.

## Testing

`contracts/tests/direct/` has a direct-mode suite (11 tests, fast, in-process — see `contracts/README.md`) covering grant creation, claim/evaluation, access control, and the criterion-bound challenge resolution logic. Run it before every contract change and every redeploy:

```bash
pip install genlayer-test
pytest contracts/tests/direct/ -v
```

There is no automated integration-mode (full validator consensus) suite yet — the one live end-to-end run against a deployed contract so far (create_grant → claim → file_challenge → resolve_challenge under real consensus) was a manual, one-off script, not a repeatable test in the repo. If you're adding meaningful new contract logic, extending the direct-mode suite alongside it is expected; adding a repeatable integration-mode test using GenLayer's own test tooling is welcome too.

## Reporting bugs vs. security issues

Regular bugs: open a GitHub issue with steps to reproduce.

Anything touching fund safety, consensus manipulation, or wallet/key security: **do not** open a public issue — see [`SECURITY.md`](SECURITY.md).
