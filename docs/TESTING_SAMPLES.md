# Sample Test Data

Copy-paste values for exercising every form in the live app at
**https://milestone-forge.vercel.app**. These are safe, public, always-reachable
test targets — no real project commitments implied. Use tiny GEN amounts.

Every write below needs a wallet connected + signed in (top-right **Connect
Wallet**, then **Sign In** once connected) and testnet GEN in that wallet.

---

## 1. Create Grant (`/create`)

The only form with real complexity. Fields map directly to the deployed
contract's `create_grant` — see [`docs/PROTOCOL.md`](PROTOCOL.md) for what
each criterion type actually checks.

### Grant Overview
| Field | Sample value |
|---|---|
| Grant title | `Test Grant — HTTP Check` |
| Grantee wallet address | A **second** wallet address you control (must differ from the funder — the contract rejects funder == grantee). If you only have one wallet, use a friend's address or a second account; you won't be able to submit the claim yourself without switching wallets. |

### Milestone 1
| Field | Sample value |
|---|---|
| Milestone title | `Health check test` |
| Reward (GEN) | `0.01` — keep test grants tiny |
| Challenge window (hours) | `24` (minimum allowed; `48` is the recommended default for real grants) |

### Criterion — pick one per milestone type you want to exercise

**HTTP Endpoint** (simplest, always reachable):
| Field | Sample value |
|---|---|
| Description | `The live URL returns HTTP 200` |
| URL | `https://httpbin.org/status/200` |
| Expected body substring | *(leave blank)* |
| Weight | `100` |

To test a **failing** criterion (verdict `FAILED`), swap the URL for:
`https://httpbin.org/status/500` — same description works, or change it to
`"The live URL returns HTTP 200"` (it will correctly report FAIL since the
endpoint returns 500).

**GitHub Repo State**:
| Field | Sample value |
|---|---|
| Description | `The main branch of a public repo exists and is reachable` |
| Repo URL | `https://github.com/genlayerlabs/genlayer-project-boilerplate` |
| Ref | `main` |
| Expected file path | *(leave blank, or try `README.md`)* |
| Weight | `100` |

**Onchain Contract Event** (needs a real RPC + a contract that has actually
emitted the target event — hardest to get a guaranteed-passing example for
without a fixed reference deployment, so this one is best tested against
your own already-deployed Milestone Forge contract):
| Field | Sample value |
|---|---|
| Description | `A GrantCreated event has been emitted since block 0` |
| RPC URL | `https://studio.genlayer.com/api` |
| Contract address | `0x565E9013F85fa91491ecDD87E095201E0AEd1b84` (the live Milestone Forge contract itself) |
| Event topic0 | Leave blank to match any log from that address, or compute the keccak of `GrantCreated()` if you want an exact filter |
| Weight | `100` |

**Splitting weight across multiple criteria** (to test `PARTIAL_PASS`): add
a second criterion, set both to `50` weight, and make one point at a
passing URL (`httpbin.org/status/200`) and the other at a failing one
(`httpbin.org/status/500`). Weights on one milestone must always sum to
`100`.

Click **Lock Escrow & Deploy Grant** — your wallet will prompt for a
transaction sending the reward amount + gas.

---

## 2. Claim Milestone (`/claim` and `/grant/[grantId]`)

No form of its own — `/claim` is a read-only dashboard that links into the
grant workspace. In the workspace, as the **grantee**, the claim form is:

| Field | Sample value |
|---|---|
| Optional pointer note | `ipfs://bafybeigdyrzt5sfp7udm7hu76uh7y26nf3efuylqabf3oclgtqy55fbzdi` (a real, dereferenceable IPFS CID — or just leave blank; it's never used as evidence, only a human-readable pointer) |

Click **Submit Milestone Claim** — this triggers real GenLayer validator
inspection of the pinned criteria; expect the transaction lifecycle
(submitted → accepted → finalized) to take a bit longer than a normal write
since real consensus is happening.

---

## 3. Challenge Hub (`/challenges` and the grant workspace's challenge form)

Only appears once a milestone is in `CHALLENGE_WINDOW` status (i.e. after a
claim has passed evaluation).

| Field | Sample value |
|---|---|
| Category | `downtime` (or `git_rewrite`, `synthetic_data`, `reproducibility`) |
| Evidence URL | `https://httpbin.org/status/500` (a URL whose content plausibly corroborates a failure — the contract looks for failure-signal keywords like "down"/"error"/"timeout" in the evidence page, so a real downtime-log page works best; httpbin's own status pages don't contain those keywords, so use this only to test the **bond-mismatch-reverts** path, not a genuine UPHELD result) |
| Evidence note | `Testing the additive-evidence challenge flow` |

Bond is fixed at whatever `default_dispute_bond_wei` currently is (2,500
GEN as of this writing — check the live value on `/settings` before
testing, since it's admin-adjustable). The button shows the exact amount
before you submit.

---

## 4. Read-only pages — nothing to fill

`/explore`, `/validators`, `/history`, `/docs`, `/profile`, `/settings` have
no forms; they read live/cached contract state. `/profile` and parts of
`/settings` need a connected + signed-in wallet to show anything
account-specific.

---

## Suggested test sequence for a new tester

1. Connect wallet, sign in (SIWE) — confirms auth end-to-end.
2. Create a grant per §1 (HTTP Endpoint, passing URL) — confirms escrow lock + wallet write flow.
3. Switch to the grantee wallet, submit the claim per §2 — confirms the full nondeterministic evaluation + consensus path, watch it land on `CHALLENGE_WINDOW`.
4. Check `/validators` — the per-criterion PASS should be visible there, read live from chain.
5. Wait for the challenge window to elapse (or create a grant with the minimum 24h window to shorten the wait), then release the tranche from the grant workspace.
6. Optionally: create a second grant with a failing criterion to see the `FAILED` path and the funder's refund flow.
