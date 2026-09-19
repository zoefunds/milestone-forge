import { AppShell } from "@/components/AppShell";

const CONTRACT_ADDRESS = process.env.NEXT_PUBLIC_MILESTONE_FORGE_CONTRACT_ADDRESS ?? "(not configured)";

export default function DocsPage() {
  return (
    <AppShell active="/docs">
      <div className="max-w-3xl mx-auto flex flex-col gap-10">
        <div>
          <span className="text-xs uppercase tracking-widest text-primary">Formal Specification</span>
          <h1 className="font-headline text-3xl font-bold mt-1">
            The Trust Boundary Primitive: Deterministic Verification of Real-World Work
          </h1>
        </div>

        <div className="rounded-xl bg-surface-container-low p-5 flex items-center justify-between font-mono text-sm">
          <span className="text-outline">Deployed contract (StudioNet)</span>
          <span className="text-primary">{CONTRACT_ADDRESS}</span>
        </div>

        <section id="core-concept" className="flex flex-col gap-3">
          <h2 className="font-headline text-xl font-semibold">1. Core Protocol Concept</h2>
          <p className="text-on-surface-variant leading-relaxed">
            Milestone Forge is an onchain grant/milestone-release protocol. A funder and grantee agree on a grant
            with multiple milestones. At grant creation, each milestone&apos;s release criteria are locked as
            specific, checkable claims tied to specific public artifact locations — a live URL and expected
            behavior, a GitHub repo and an expected commit/tag/file, or an onchain contract and an expected
            event. Never vague criteria like &quot;make good progress&quot; — the contract rejects those outright.
          </p>
        </section>

        <section id="pipeline" className="flex flex-col gap-3">
          <h2 className="font-headline text-xl font-semibold">2. The Pipeline</h2>
          <div className="rounded-xl bg-surface-container-low p-5 font-mono text-xs text-on-surface-variant leading-loose whitespace-pre-wrap">
{`GRANT + PRECOMMITTED MILESTONE CRITERIA
       ↓
LOCKED ESCROW (PER-MILESTONE TRANCHES, GEN)
       ↓
MILESTONE CLAIM (PINNED ARTIFACT SNAPSHOT HASH)
       ↓
INDEPENDENT MULTI-VALIDATOR ARTIFACT INSPECTION
       ↓
EQUIVALENCE ON STRUCTURED PER-CRITERION RESULT
       ↓
DETERMINISTIC TRANCHE RELEASE (separate function, no web/LLM access)
       ↓
CHALLENGE WINDOW (additive evidence only)
       ↓
FINALIZED PULL-BASED WITHDRAWAL`}
          </div>
        </section>

        <section id="equivalence" className="flex flex-col gap-3">
          <h2 className="font-headline text-xl font-semibold">3. Equivalence Principle</h2>
          <p className="text-on-surface-variant leading-relaxed">
            When a claim is submitted, every GenLayer validator independently fetches the pinned HTTP endpoint,
            queries the GitHub API for the pinned commit ref, and/or reads onchain logs via <code className="text-primary">eth_getLogs</code>.
            The leader and each validator compute a structured result — a boolean <code className="text-primary">passed</code> field
            per criterion, plus a small derived detail string. Consensus compares only the <code className="text-primary">passed</code> boolean
            fields exactly, with numeric tolerance applied only to non-decision fields like latency. This is
            partial field matching, not a JSON-schema-only check and not free-text comparison — the specific
            combination that keeps consensus from stalling into false disagreement while still verifying the
            substance of the claim.
          </p>
        </section>

        <section id="separation" className="flex flex-col gap-3">
          <h2 className="font-headline text-xl font-semibold">4. Deterministic / Nondeterministic Separation</h2>
          <p className="text-on-surface-variant leading-relaxed">
            The nondeterministic step (<code className="text-primary">_evaluate_milestone</code>) outputs only the
            structured per-criterion result. A completely separate, pure function (
            <code className="text-primary">_compute_deterministic_payout_bps</code>) — no web access, no LLM call,
            no randomness — takes that already-agreed result and computes the payout share. Validators and any
            LLM/web logic never touch the money transfer directly.
          </p>
        </section>

        <section id="challenge" className="flex flex-col gap-3">
          <h2 className="font-headline text-xl font-semibold">5. Challenge Window</h2>
          <p className="text-on-surface-variant leading-relaxed">
            48-hour default window (configurable 24h–168h per milestone at genesis, never after). Challenges can
            only add public counter-evidence — they can never replace or remove the pinned genesis criteria or
            artifact locations. A challenge requires staking a GEN bond; if the re-inspection (re-running the
            exact same pinned criteria plus checking the additive evidence) confirms the original verdict, the
            bond is slashed to the grantee. If it&apos;s upheld, the challenger gets their bond back plus a bounty
            carved from the escrow.
          </p>
        </section>

        <section id="inconclusive" className="flex flex-col gap-3">
          <h2 className="font-headline text-xl font-semibold">6. Inconclusive States</h2>
          <p className="text-on-surface-variant leading-relaxed">
            If any pinned artifact is unreachable during evaluation, the milestone resolves to an explicit{" "}
            <code className="text-primary">INCONCLUSIVE</code> state — never a silently-picked default and never a
            default release of funds. Anyone can trigger{" "}
            <code className="text-primary">retry_inconclusive_milestone</code> to re-run the exact same pinned
            criteria later.
          </p>
        </section>

        <section id="escrow" className="flex flex-col gap-3">
          <h2 className="font-headline text-xl font-semibold">7. Escrow Custody</h2>
          <p className="text-on-surface-variant leading-relaxed">
            Every GEN payout funnels through a single <code className="text-primary">_send_gen</code> function.
            <code className="text-primary">reward_wei</code> is the agreed term; <code className="text-primary">reward_deposited</code> is
            the actual escrow ledger the payout logic reads from. Every payout path zeroes the ledger field(s)
            before persisting state, and only then transfers — funds cannot be released twice.
          </p>
        </section>
      </div>
    </AppShell>
  );
}
