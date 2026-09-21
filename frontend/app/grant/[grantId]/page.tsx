"use client";

import { useEffect, useState, useCallback } from "react";
import { useParams } from "next/navigation";
import { useAccount } from "wagmi";
import { AppShell } from "@/components/AppShell";
import { StatusBadge } from "@/components/StatusBadge";
import { TxLifecycle } from "@/components/TxLifecycle";
import {
  readGrant,
  readMilestone,
  readCriterion,
  readCriterionResult,
  readProtocolParams,
  useSubmitMilestoneClaim,
  useReleaseMilestone,
  useFileChallenge,
  useRetryInconclusive,
  useCancelMilestone,
  useClaimFailedRefund,
} from "@/lib/useMilestoneForge";
import { formatGen, truncateAddress, formatTimestamp, secondsToHuman } from "@/lib/format";

interface MilestoneView {
  milestone_id: string;
  title: string;
  reward_wei: string;
  reward_deposited: string;
  status: string;
  challenge_window_seconds: number;
  criteria_ids: string[];
  verdict: string;
  result_ids: string[];
  recommended_payout_bps: number;
  challenge_window_closes_at: number;
  active_challenge_id: string;
  claim_note: string;
  claimed_artifact_hash: string;
}

export default function GrantWorkspacePage() {
  const params = useParams<{ grantId: string }>();
  const { address, isConnected } = useAccount();

  const [grant, setGrant] = useState<any>(null);
  const [milestones, setMilestones] = useState<MilestoneView[]>([]);
  const [criteria, setCriteria] = useState<Record<string, any>>({});
  const [results, setResults] = useState<Record<string, any>>({});
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);

  const submitClaim = useSubmitMilestoneClaim();
  const release = useReleaseMilestone();
  const fileChallenge = useFileChallenge();
  const retryInconclusive = useRetryInconclusive();
  const cancelMilestone = useCancelMilestone();
  const claimRefund = useClaimFailedRefund();

  const [claimNote, setClaimNote] = useState("");
  const [challengeForm, setChallengeForm] = useState({
    milestoneId: "",
    criterionId: "",
    category: "downtime",
    evidenceUrl: "",
    note: "",
  });
  // Live from get_protocol_params — never hardcoded. The dispute bond is an
  // admin-adjustable protocol parameter, so a stale hardcoded amount would
  // either overpay (locking excess GEN with no refund path for the
  // difference) or revert the challenge outright if the admin has since
  // raised it.
  const [protocolParams, setProtocolParams] = useState<any>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setLoadError(null);
    try {
      const [g, params_]: [any, any] = await Promise.all([readGrant(params.grantId), readProtocolParams()]);
      setGrant(g);
      setProtocolParams(params_);
      const ms = await Promise.all((g.milestone_ids ?? []).map((id: string) => readMilestone(id) as Promise<MilestoneView>));
      setMilestones(ms);

      const critIds = ms.flatMap((m) => m.criteria_ids);
      const critEntries = await Promise.all(critIds.map(async (id) => [id, await readCriterion(id)] as const));
      setCriteria(Object.fromEntries(critEntries));

      const resultIds = ms.flatMap((m) => m.result_ids);
      if (resultIds.length > 0) {
        const resultEntries = await Promise.all(
          resultIds.map(async (id) => [id, await readCriterionResult(id)] as const)
        );
        setResults(Object.fromEntries(resultEntries));
      }
    } catch (err) {
      setLoadError(err instanceof Error ? err.message : "Failed to load grant from chain");
    } finally {
      setLoading(false);
    }
  }, [params.grantId]);

  useEffect(() => {
    load();
  }, [load]);

  const isGrantee = grant && address && grant.grantee?.toLowerCase() === address.toLowerCase();
  const isFunder = grant && address && grant.funder?.toLowerCase() === address.toLowerCase();

  async function handleClaim(milestoneId: string) {
    const result = await submitClaim.run([milestoneId, claimNote]);
    if (result.success) await load();
  }
  async function handleRelease(milestoneId: string) {
    const result = await release.run([milestoneId]);
    if (result.success) await load();
  }
  async function handleRetry(milestoneId: string) {
    const result = await retryInconclusive.run([milestoneId]);
    if (result.success) await load();
  }
  async function handleCancel(milestoneId: string) {
    const result = await cancelMilestone.run([milestoneId]);
    if (result.success) await load();
  }
  async function handleRefund(milestoneId: string) {
    const result = await claimRefund.run([milestoneId]);
    if (result.success) await load();
  }
  async function handleFileChallenge() {
    if (!challengeForm.milestoneId || !challengeForm.criterionId) return;
    if (!protocolParams) {
      setLoadError("Protocol parameters not loaded yet — try again in a moment");
      return;
    }
    const bondAtto = BigInt(protocolParams.default_dispute_bond_wei);
    const result = await fileChallenge.run(
      [
        challengeForm.milestoneId,
        challengeForm.criterionId,
        challengeForm.category,
        challengeForm.evidenceUrl,
        challengeForm.note,
      ],
      bondAtto
    );
    if (result.success) await load();
  }

  if (loading) {
    return (
      <AppShell>
        <div className="text-on-surface-variant">Loading grant from GenLayer StudioNet...</div>
      </AppShell>
    );
  }
  if (loadError || !grant) {
    return (
      <AppShell>
        <div className="rounded-lg bg-error-container/20 p-4 text-error">{loadError ?? "Grant not found"}</div>
      </AppShell>
    );
  }

  return (
    <AppShell>
      <div className="flex flex-col gap-6">
        <section className="rounded-xl bg-surface-container-low p-6 flex flex-col gap-3">
          <div className="flex items-center gap-2 flex-wrap">
            <span className="font-mono text-xs text-primary font-bold">{grant.grant_id}</span>
            <StatusBadge status={grant.status} />
          </div>
          <h1 className="font-headline text-2xl font-bold">{grant.title}</h1>
          <div className="flex flex-wrap gap-x-6 gap-y-1 text-sm text-on-surface-variant font-mono">
            <span>Funder: {truncateAddress(grant.funder)}</span>
            <span>Grantee: {truncateAddress(grant.grantee)}</span>
            <span className="text-primary">Total: {formatGen(grant.total_reward_wei)} GEN</span>
          </div>
        </section>

        <div className="flex flex-col gap-4">
          {milestones.map((m) => (
            <section key={m.milestone_id} className="rounded-xl bg-surface-container-low p-6 flex flex-col gap-4">
              <div className="flex items-center justify-between flex-wrap gap-2">
                <div className="flex items-center gap-2">
                  <span className="font-mono text-xs text-primary font-bold">{m.milestone_id}</span>
                  <StatusBadge status={m.status} />
                  {m.verdict && <StatusBadge status={m.verdict} />}
                </div>
                <span className="font-mono text-sm text-on-surface-variant">
                  {formatGen(m.reward_deposited)} / {formatGen(m.reward_wei)} GEN deposited
                </span>
              </div>
              <h3 className="font-headline font-semibold text-lg">{m.title}</h3>

              <div className="flex flex-col gap-2">
                <span className="text-xs uppercase text-outline">Precommitted criteria</span>
                {m.criteria_ids.map((cid) => {
                  const c = criteria[cid];
                  const resultId = m.result_ids?.find((rid) => results[rid]?.criterion_id === cid);
                  const result = resultId ? results[resultId] : null;
                  return (
                    <div key={cid} className="rounded-lg bg-surface-container p-3 flex items-start justify-between gap-3">
                      <div>
                        <div className="font-mono text-xs text-outline">{c?.criterion_type ?? cid}</div>
                        <div className="text-sm">{c?.description}</div>
                      </div>
                      {result && (
                        <span className={`shrink-0 font-mono text-xs font-bold ${result.passed ? "text-secondary" : "text-error"}`}>
                          {result.passed ? "PASS" : "FAIL"}
                        </span>
                      )}
                    </div>
                  );
                })}
              </div>

              {m.status === "CHALLENGE_WINDOW" && (
                <div className="rounded-lg bg-tertiary/10 p-3 text-sm text-tertiary flex items-center justify-between flex-wrap gap-2">
                  <span>Challenge window closes {formatTimestamp(m.challenge_window_closes_at)}</span>
                  <span className="font-mono">{secondsToHuman(m.challenge_window_seconds)} window</span>
                </div>
              )}

              <div className="flex flex-wrap gap-2 pt-2">
                {isGrantee && m.status === "CLAIMABLE" && (
                  <div className="flex flex-col gap-2 w-full">
                    <div className="flex items-center gap-2">
                      <input
                        value={claimNote}
                        onChange={(e) => setClaimNote(e.target.value)}
                        placeholder="Optional pointer note (IPFS/Arweave CID) — never trusted as evidence"
                        className="flex-1 px-3 py-2 rounded-lg bg-surface-container-lowest text-sm"
                      />
                      <button
                        onClick={() =>
                          setClaimNote("ipfs://bafybeigdyrzt5sfp7udm7hu76uh7y26nf3efuylqabf3oclgtqy55fbzdi")
                        }
                        className="shrink-0 px-2.5 py-2 rounded-lg bg-surface-container-high text-primary text-xs font-mono hover:bg-surface-bright"
                        title="Fills a real, dereferenceable IPFS CID for testing"
                      >
                        ⚡ Sample
                      </button>
                    </div>
                    <button
                      onClick={() => handleClaim(m.milestone_id)}
                      className="px-4 py-2.5 rounded-lg bg-primary text-on-primary font-semibold hover:opacity-90"
                    >
                      Submit Milestone Claim
                    </button>
                  </div>
                )}
                {m.status === "CHALLENGE_WINDOW" && (
                  <button
                    onClick={() => handleRelease(m.milestone_id)}
                    className="px-4 py-2.5 rounded-lg bg-secondary text-on-secondary font-semibold hover:opacity-90"
                  >
                    Release Tranche (if window elapsed)
                  </button>
                )}
                {m.status === "CHALLENGE_WINDOW" && (
                  <button
                    onClick={() => setChallengeForm((prev) => ({ ...prev, milestoneId: m.milestone_id }))}
                    className="px-4 py-2.5 rounded-lg bg-surface-container-high text-tertiary font-semibold hover:bg-surface-bright"
                  >
                    File Additive Challenge
                  </button>
                )}
                {m.status === "INCONCLUSIVE" && (
                  <button
                    onClick={() => handleRetry(m.milestone_id)}
                    className="px-4 py-2.5 rounded-lg bg-surface-container-high text-primary font-semibold hover:bg-surface-bright"
                  >
                    Retry Evaluation
                  </button>
                )}
                {isFunder && m.status === "FAILED" && (
                  <button
                    onClick={() => handleRefund(m.milestone_id)}
                    className="px-4 py-2.5 rounded-lg bg-surface-container-high text-on-surface font-semibold hover:bg-surface-bright"
                  >
                    Claim Refund
                  </button>
                )}
                {isFunder && (m.status === "LOCKED" || m.status === "CLAIMABLE") && (
                  <button
                    onClick={() => handleCancel(m.milestone_id)}
                    className="px-4 py-2.5 rounded-lg bg-surface-container-high text-error font-semibold hover:bg-surface-bright"
                  >
                    Cancel Milestone
                  </button>
                )}
              </div>

              {challengeForm.milestoneId === m.milestone_id && (
                <div className="rounded-lg bg-surface-container p-4 flex flex-col gap-3">
                  <button
                    onClick={() =>
                      setChallengeForm((prev) => ({
                        ...prev,
                        criterionId: m.criteria_ids[0] ?? "",
                        category: "downtime",
                        evidenceUrl: "https://httpbin.org/status/500",
                        note: "Testing the additive-evidence challenge flow",
                      }))
                    }
                    className="self-start px-2.5 py-1.5 rounded-lg bg-surface-container-high text-primary text-xs font-mono hover:bg-surface-bright"
                    title="Fills a test challenge — good for exercising the bond/revert paths, not a genuine UPHELD result (the sample evidence URL isn't bound to the selected criterion's own artifact, so it won't corroborate a real dispute)"
                  >
                    ⚡ Fill Sample Data
                  </button>
                  <div className="flex flex-col gap-1">
                    <label className="text-xs uppercase text-outline">
                      Disputed criterion — evidence must reference this criterion&apos;s own URL/repo/contract to
                      count as bound
                    </label>
                    <select
                      value={challengeForm.criterionId}
                      onChange={(e) => setChallengeForm((prev) => ({ ...prev, criterionId: e.target.value }))}
                      className="px-3 py-2 rounded bg-surface-container-lowest text-sm"
                    >
                      <option value="">Select the criterion being disputed...</option>
                      {m.criteria_ids.map((cid) => (
                        <option key={cid} value={cid}>
                          {criteria[cid]?.description ?? cid}
                        </option>
                      ))}
                    </select>
                  </div>
                  <select
                    value={challengeForm.category}
                    onChange={(e) => setChallengeForm((prev) => ({ ...prev, category: e.target.value }))}
                    className="px-3 py-2 rounded bg-surface-container-lowest text-sm"
                  >
                    <option value="downtime">Unreachable Artifact Downtime</option>
                    <option value="git_rewrite">Git History Alteration</option>
                    <option value="synthetic_data">Synthetic Mock Data</option>
                    <option value="reproducibility">Non-Reproducibility</option>
                  </select>
                  <input
                    value={challengeForm.evidenceUrl}
                    onChange={(e) => setChallengeForm((prev) => ({ ...prev, evidenceUrl: e.target.value }))}
                    placeholder="Public additive evidence URL — must reference the disputed criterion's own artifact"
                    className="px-3 py-2 rounded bg-surface-container-lowest font-mono text-sm"
                  />
                  <textarea
                    value={challengeForm.note}
                    onChange={(e) => setChallengeForm((prev) => ({ ...prev, note: e.target.value }))}
                    placeholder="Evidence note"
                    className="px-3 py-2 rounded bg-surface-container-lowest text-sm"
                    rows={2}
                  />
                  <div className="text-xs text-error">
                    Bond:{" "}
                    {protocolParams
                      ? `${formatGen(protocolParams.default_dispute_bond_wei)} GEN`
                      : "loading live bond amount..."}
                    , slashed{" "}
                    {protocolParams ? `${Number(protocolParams.frivolous_slash_bps) / 100}%` : "..."} to the
                    grantee if this challenge is rejected as frivolous (read live from{" "}
                    <code className="font-mono">get_protocol_params</code>, not hardcoded).
                  </div>
                  <button
                    onClick={handleFileChallenge}
                    disabled={!challengeForm.criterionId || !protocolParams}
                    className="px-4 py-2 rounded bg-tertiary text-on-tertiary font-semibold disabled:opacity-50"
                  >
                    Stake Bond & Dispatch Challenge
                  </button>
                </div>
              )}
            </section>
          ))}
        </div>

        <TxLifecycle
          state={
            submitClaim.state.status !== "idle"
              ? submitClaim.state
              : release.state.status !== "idle"
              ? release.state
              : fileChallenge.state.status !== "idle"
              ? fileChallenge.state
              : retryInconclusive.state.status !== "idle"
              ? retryInconclusive.state
              : cancelMilestone.state.status !== "idle"
              ? cancelMilestone.state
              : claimRefund.state
          }
        />
      </div>
    </AppShell>
  );
}
