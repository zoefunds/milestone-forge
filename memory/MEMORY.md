# Milestone Forge — Project Memory

This file is the persistent index for this project. It survives across sessions.
Read this before doing anything else in this repo.

## What this project is

MILESTONE FORGE — an onchain grant/milestone-release protocol. Funders lock GEN
escrow per milestone; grantees claim completion against precommitted,
machine-checkable criteria (live URL, GitHub repo state, onchain contract
state); GenLayer validators independently fetch and inspect the pinned
artifacts; a deterministic function (separate from the nondeterministic
evaluation) releases the tranche. Additive-evidence-only challenge window
before funds are pull-withdrawable. Full spec: see the original master prompt
the user supplied (not stored here — ask the user if it's needed again).

## Non-negotiable architecture facts (do not re-derive, do not contradict)

- **Contract deployment**: the USER deploys the Intelligent Contract themselves
  via GenLayer Studio/CLI. Claude must never attempt to deploy it or handle a
  private key for it. Once deployed, the user provides `DEPLOYED_CONTRACT_ADDRESS`
  and Claude wires it into env config.
- **Auth**: wallet-based, SIWE-style message signing. No email/password, no
  custodial private keys stored anywhere.
- **Escrow token**: GEN for everything (reward + dispute bonds), via
  `gl.message.value` / `@gl.public.write.payable`, matching the reference
  ShipBond escrow pattern (zero-then-transfer ordering, single `_send_gen`
  choke point, `reward_deposited`/`bond_deposited` ledger fields separate from
  `reward_wei`/`bond_wei` terms).
- **Backend**: PostgreSQL via Docker, hosted on Fly.io, always-on (2+ machines,
  health checks, restart policies). Backend is a read-cache/indexer and
  SSRF-guarded artifact-snapshot fetcher ONLY — it must never determine
  milestone completion itself. That determination is exclusively the
  Intelligent Contract's validator quorum.
- **Frontend**: Next.js + React + Tailwind, deployed to Vercel. Design system
  ported (not copy-pasted) from the user's Stitch dark-theme HTML mockups in
  `~/Documents/stitch_dark_theme_interface_design/` — cyan/emerald/amber dark
  palette, JetBrains Mono for hashes/code, Plus Jakarta Sans headlines, Inter
  body. Favicon/logo: the anvil-shield emblem SVG from that folder.
- **Socials**: explicitly skipped for v1 per user decision.
- **Challenge window**: 48h default, configurable 24h–168h per milestone,
  locked at genesis (cannot be changed after milestone creation).
- **Artifact types v1**: all three — HTTP/live URL, GitHub repo state
  (commit/tag), onchain contract state/event.

## GenLayer contract technical facts (verified against current docs, 2026-09-19)

- Runner version pinned in contract header: `py-genlayer:1jb45aa8ynh2a9c9xn3b7qqh8sm5q93hwfp7jqmwsfhh8jpz09h6`.
  Never use `py-genlayer:test` or `:latest` — networks reject both.
- Equivalence approach used: **custom validator function** (`gl.vm.run_nondet_unsafe`)
  with **partial field matching + numeric tolerance** (not `strict_eq`, not
  `prompt_non_comparative` schema-only checks) — this is what keeps consensus
  from stalling into `INCONCLUSIVE`/leader-rotation storms while still being
  substantive per the JUDGE.md rubric (format-only validation caps Contract
  Quality at 1/5 in that rubric).
- Nondeterministic step outputs ONLY a structured per-criterion result
  (dict of booleans + stable derived fields). A fully separate deterministic
  function computes the tranche payout from that structured result — the
  LLM/validators never touch money transfer directly.
- Error prefixes used for validator agreement: `[EXPECTED]`, `[EXTERNAL]`,
  `[TRANSIENT]`, `[LLM_ERROR]` (see `genlayer-dev:write-contract` skill).

## File locations

- `contracts/milestone_forge.py` — the single production Intelligent Contract.
- `contracts/tests/` — direct-mode + integration tests for the contract.
- `backend/` — Node/Express indexer + SSRF-guarded artifact fetcher (Fly.io).
- `frontend/` — Next.js app (Vercel).
- `docs/` — architecture notes, deployment runbook.

## Outstanding / waiting on user

- Contract address: NOT YET DEPLOYED. User will deploy and provide it.
- Fly.io app names / Vercel project not yet created.
