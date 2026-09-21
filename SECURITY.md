# Security Policy

Milestone Forge holds and moves real GEN through escrow on GenLayer StudioNet. Treat any issue that could affect fund safety, consensus integrity, or wallet security as high priority.

## Reporting a vulnerability

**Do not open a public GitHub issue for a security vulnerability.** Instead, contact the maintainer directly: **preciousmofeoluwa@gmail.com**.

Include:
- A description of the issue and its impact (which invariant breaks, and how).
- Steps to reproduce, ideally against `contracts/milestone_forge.py` in GenLayer Studio or a local StudioNet-equivalent environment.
- Whether it's exploitable against the currently deployed contract (`0x8Bbb6c4508D83d7bd0e3a4db555c92B3A1CB1DFb`) or only against future/local versions.

You should get an acknowledgment within a few days. Please give us a reasonable window to ship a fix before any public disclosure — the deployed contract cannot be silently patched (it's immutable once deployed; a fix means a new deployment and migration).

## Scope

In scope:
- `contracts/milestone_forge.py` — escrow custody/emission logic, Equivalence Principle validator logic, challenge/dispute resolution, access control on every `@gl.public.write` method.
- `backend/` — SIWE authentication flow, SSRF guard on artifact URL previews, the GenLayer rate limiter (Redis-backed shared counter), and anything that could let the backend misrepresent contract state.
- `frontend/` — wallet connection flow, transaction construction (correct function name, args, value sent to the contract), and anything that could trick a user into signing something other than what's displayed.

Out of scope:
- The underlying GenLayer protocol, GenVM runtime, or validator network itself — report those upstream to GenLayer.
- The `video/` demo-film subproject (no funds or user data flow through it).
- Third-party services this project depends on but doesn't control (Upstash Redis, Fly.io, Vercel, Reown/WalletConnect infrastructure).

## Known, accepted risk boundaries (not vulnerabilities)

These are documented design decisions, not bugs — see [`docs/PROTOCOL.md`](docs/PROTOCOL.md) for the reasoning:

- A milestone stuck at `INCONCLUSIVE` holds funds until someone calls `retry_inconclusive_milestone` — there is no automatic timeout that forfeits or reassigns the escrow.
- A `FAILED` milestone does not automatically unlock the next milestone in the grant; the grant's remaining tranches stay `LOCKED` unless the funder acts.
- The contract's `_assert_safe_public_url` SSRF guard is deterministic string-pattern matching, not a full DNS-resolution-time check — it cannot catch a hostname that resolves to a private IP only at request time (DNS rebinding). This is a known limitation of running inside GenVM's nondeterministic web-fetch model.
- Challenge bond and slashing percentages (`default_dispute_bond_wei`, `frivolous_slash_bps`, `upheld_bounty_bps`) are admin-adjustable via `update_protocol_params`. The admin key is the deploying wallet; treat it with the same custody standard as any other key controlling protocol parameters.

## Supported versions

Only the currently deployed contract address and the `main` branch of this repository are supported. There is no versioned release history yet.
