"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { useAccount } from "wagmi";
import { AppShell } from "@/components/AppShell";
import { TxLifecycle } from "@/components/TxLifecycle";
import { useCreateGrant } from "@/lib/useMilestoneForge";
import { genToAtto } from "@/lib/format";

type CriterionType = "HTTP_ENDPOINT" | "GIT_REPO_STATE" | "ONCHAIN_STATE";

interface CriterionDraft {
  criterion_type: CriterionType;
  description: string;
  weight_pct: number;
  target_url: string;
  expected_status_min: number;
  expected_status_max: number;
  expected_body_contains: string;
  repo_url: string;
  repo_ref: string;
  repo_path_expected: string;
  onchain_rpc_url: string;
  onchain_contract_address: string;
  onchain_min_block: number;
  onchain_event_topic0: string;
}

interface MilestoneDraft {
  title: string;
  reward_gen: string;
  challenge_window_hours: number;
  criteria: CriterionDraft[];
}

function newCriterion(): CriterionDraft {
  return {
    criterion_type: "HTTP_ENDPOINT",
    description: "",
    weight_pct: 100,
    target_url: "",
    expected_status_min: 200,
    expected_status_max: 299,
    expected_body_contains: "",
    repo_url: "",
    repo_ref: "",
    repo_path_expected: "",
    onchain_rpc_url: "",
    onchain_contract_address: "",
    onchain_min_block: 0,
    onchain_event_topic0: "",
  };
}

function newMilestone(): MilestoneDraft {
  return { title: "", reward_gen: "", challenge_window_hours: 48, criteria: [newCriterion()] };
}

export default function CreateGrantPage() {
  const router = useRouter();
  const { isConnected } = useAccount();
  const { run, state } = useCreateGrant();

  const [grantTitle, setGrantTitle] = useState("");
  const [granteeAddress, setGranteeAddress] = useState("");
  const [milestones, setMilestones] = useState<MilestoneDraft[]>([newMilestone()]);
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [resultGrantId, setResultGrantId] = useState<string | null>(null);

  function updateMilestone(i: number, patch: Partial<MilestoneDraft>) {
    setMilestones((prev) => prev.map((m, idx) => (idx === i ? { ...m, ...patch } : m)));
  }
  function updateCriterion(mi: number, ci: number, patch: Partial<CriterionDraft>) {
    setMilestones((prev) =>
      prev.map((m, idx) =>
        idx === mi ? { ...m, criteria: m.criteria.map((c, cidx) => (cidx === ci ? { ...c, ...patch } : c)) } : m
      )
    );
  }

  const totalRewardGen = milestones.reduce((sum, m) => sum + (Number(m.reward_gen) || 0), 0);

  async function handleSubmit() {
    setSubmitError(null);
    setResultGrantId(null);

    if (!granteeAddress.startsWith("0x") || granteeAddress.length !== 42) {
      setSubmitError("Grantee address must be a valid 0x address");
      return;
    }
    for (const m of milestones) {
      const weightSum = m.criteria.reduce((s, c) => s + c.weight_pct, 0);
      if (Math.round(weightSum) !== 100) {
        setSubmitError(`Milestone "${m.title || "(untitled)"}" criteria weights must sum to 100%, currently ${weightSum}%`);
        return;
      }
      if (!m.title || !m.reward_gen || Number(m.reward_gen) <= 0) {
        setSubmitError("Every milestone needs a title and a positive GEN reward");
        return;
      }
    }

    const spec = milestones.map((m) => ({
      title: m.title,
      reward_wei: genToAtto(m.reward_gen).toString(),
      challenge_window_seconds: m.challenge_window_hours * 3600,
      claimable_after: 0,
      criteria: m.criteria.map((c) => {
        const weight_bps = Math.round(c.weight_pct * 100);
        const base = { criterion_type: c.criterion_type, description: c.description, weight_bps };
        if (c.criterion_type === "HTTP_ENDPOINT") {
          return {
            ...base,
            target_url: c.target_url,
            expected_status_min: c.expected_status_min,
            expected_status_max: c.expected_status_max,
            expected_body_contains: c.expected_body_contains,
          };
        }
        if (c.criterion_type === "GIT_REPO_STATE") {
          return { ...base, repo_url: c.repo_url, repo_ref: c.repo_ref, repo_path_expected: c.repo_path_expected };
        }
        return {
          ...base,
          onchain_rpc_url: c.onchain_rpc_url,
          onchain_contract_address: c.onchain_contract_address,
          onchain_min_block: c.onchain_min_block,
          onchain_event_topic0: c.onchain_event_topic0,
        };
      }),
    }));

    const totalValueWei = genToAtto(String(totalRewardGen));

    try {
      const result = await run([granteeAddress, grantTitle, JSON.stringify(spec)], totalValueWei);
      if (result.success) {
        // grant_id is returned as the write's return value on finalization in
        // some SDK versions; fall back to redirecting to Explore if unknown.
        setResultGrantId((result as any).returnValue ?? null);
        setTimeout(() => router.push("/explore"), 1500);
      }
    } catch (err) {
      setSubmitError(err instanceof Error ? err.message : "Transaction failed");
    }
  }

  return (
    <AppShell active="/create">
      <div className="max-w-3xl mx-auto flex flex-col gap-6">
        <div>
          <span className="text-xs uppercase tracking-widest text-primary">GenLayer Intelligent Contract Escrow</span>
          <h1 className="font-headline text-3xl font-bold mt-1">Create Autonomous Grant Escrow</h1>
          <p className="text-on-surface-variant mt-1">
            Define immutable tranches and precommitted, machine-checkable artifact criteria. Goalposts cannot be
            moved once deposited on-chain.
          </p>
        </div>

        <section className="rounded-xl bg-surface-container-low p-6 flex flex-col gap-4">
          <h2 className="font-headline font-semibold">Grant Overview</h2>
          <input
            value={grantTitle}
            onChange={(e) => setGrantTitle(e.target.value)}
            placeholder="Grant title, e.g. Decentralized ZK Identity Bridge"
            className="w-full px-3.5 py-2.5 rounded-lg bg-surface-container-lowest focus:outline-none focus:ring-1 focus:ring-primary"
          />
          <input
            value={granteeAddress}
            onChange={(e) => setGranteeAddress(e.target.value)}
            placeholder="Grantee wallet address (0x...)"
            className="w-full px-3.5 py-2.5 rounded-lg bg-surface-container-lowest font-mono text-sm focus:outline-none focus:ring-1 focus:ring-primary"
          />
        </section>

        {milestones.map((m, mi) => (
          <section key={mi} className="rounded-xl bg-surface-container-low p-6 flex flex-col gap-4">
            <div className="flex items-center justify-between">
              <h2 className="font-headline font-semibold">Milestone {mi + 1}</h2>
              {milestones.length > 1 && (
                <button
                  onClick={() => setMilestones((prev) => prev.filter((_, i) => i !== mi))}
                  className="text-error text-xs hover:underline"
                >
                  Remove
                </button>
              )}
            </div>
            <input
              value={m.title}
              onChange={(e) => updateMilestone(mi, { title: e.target.value })}
              placeholder="Milestone title"
              className="w-full px-3.5 py-2.5 rounded-lg bg-surface-container-lowest focus:outline-none focus:ring-1 focus:ring-primary"
            />
            <div className="grid grid-cols-2 gap-3">
              <label className="flex flex-col gap-1 text-xs text-on-surface-variant uppercase">
                Reward (GEN)
                <input
                  type="number"
                  min={0}
                  value={m.reward_gen}
                  onChange={(e) => updateMilestone(mi, { reward_gen: e.target.value })}
                  className="px-3 py-2 rounded-lg bg-surface-container-lowest font-mono focus:outline-none focus:ring-1 focus:ring-primary"
                />
              </label>
              <label className="flex flex-col gap-1 text-xs text-on-surface-variant uppercase">
                Challenge window (hours, 24–168)
                <input
                  type="number"
                  min={24}
                  max={168}
                  value={m.challenge_window_hours}
                  onChange={(e) => updateMilestone(mi, { challenge_window_hours: Number(e.target.value) })}
                  className="px-3 py-2 rounded-lg bg-surface-container-lowest font-mono focus:outline-none focus:ring-1 focus:ring-primary"
                />
              </label>
            </div>

            <div className="flex flex-col gap-3">
              <span className="text-xs uppercase text-outline">Machine-checkable criteria (weights must total 100%)</span>
              {m.criteria.map((c, ci) => (
                <div key={ci} className="rounded-lg bg-surface-container p-3 flex flex-col gap-2">
                  <div className="flex items-center gap-2">
                    <select
                      value={c.criterion_type}
                      onChange={(e) => updateCriterion(mi, ci, { criterion_type: e.target.value as CriterionType })}
                      className="px-2 py-1.5 rounded bg-surface-container-lowest text-xs font-mono"
                    >
                      <option value="HTTP_ENDPOINT">Live HTTP Endpoint</option>
                      <option value="GIT_REPO_STATE">GitHub Repo State</option>
                      <option value="ONCHAIN_STATE">Onchain Contract Event</option>
                    </select>
                    <input
                      type="number"
                      value={c.weight_pct}
                      onChange={(e) => updateCriterion(mi, ci, { weight_pct: Number(e.target.value) })}
                      className="w-20 px-2 py-1.5 rounded bg-surface-container-lowest text-xs font-mono"
                    />
                    <span className="text-xs text-outline">% weight</span>
                    {m.criteria.length > 1 && (
                      <button
                        onClick={() =>
                          updateMilestone(mi, { criteria: m.criteria.filter((_, i) => i !== ci) })
                        }
                        className="ml-auto text-error text-xs hover:underline"
                      >
                        Remove
                      </button>
                    )}
                  </div>
                  <textarea
                    value={c.description}
                    onChange={(e) => updateCriterion(mi, ci, { description: e.target.value })}
                    placeholder="Specific, machine-checkable claim — e.g. 'the live URL returns HTTP 200 and body contains operational'"
                    className="w-full px-3 py-2 rounded bg-surface-container-lowest text-sm focus:outline-none focus:ring-1 focus:ring-primary"
                    rows={2}
                  />
                  {c.criterion_type === "HTTP_ENDPOINT" && (
                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                      <input
                        value={c.target_url}
                        onChange={(e) => updateCriterion(mi, ci, { target_url: e.target.value })}
                        placeholder="https://your-live-endpoint/health"
                        className="px-3 py-2 rounded bg-surface-container-lowest font-mono text-xs sm:col-span-2"
                      />
                      <input
                        value={c.expected_body_contains}
                        onChange={(e) => updateCriterion(mi, ci, { expected_body_contains: e.target.value })}
                        placeholder="Expected body substring (optional)"
                        className="px-3 py-2 rounded bg-surface-container-lowest font-mono text-xs sm:col-span-2"
                      />
                    </div>
                  )}
                  {c.criterion_type === "GIT_REPO_STATE" && (
                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                      <input
                        value={c.repo_url}
                        onChange={(e) => updateCriterion(mi, ci, { repo_url: e.target.value })}
                        placeholder="https://github.com/org/repo"
                        className="px-3 py-2 rounded bg-surface-container-lowest font-mono text-xs sm:col-span-2"
                      />
                      <input
                        value={c.repo_ref}
                        onChange={(e) => updateCriterion(mi, ci, { repo_ref: e.target.value })}
                        placeholder="Branch / tag / commit ref"
                        className="px-3 py-2 rounded bg-surface-container-lowest font-mono text-xs"
                      />
                      <input
                        value={c.repo_path_expected}
                        onChange={(e) => updateCriterion(mi, ci, { repo_path_expected: e.target.value })}
                        placeholder="Expected file path (optional)"
                        className="px-3 py-2 rounded bg-surface-container-lowest font-mono text-xs"
                      />
                    </div>
                  )}
                  {c.criterion_type === "ONCHAIN_STATE" && (
                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                      <input
                        value={c.onchain_rpc_url}
                        onChange={(e) => updateCriterion(mi, ci, { onchain_rpc_url: e.target.value })}
                        placeholder="JSON-RPC URL"
                        className="px-3 py-2 rounded bg-surface-container-lowest font-mono text-xs sm:col-span-2"
                      />
                      <input
                        value={c.onchain_contract_address}
                        onChange={(e) => updateCriterion(mi, ci, { onchain_contract_address: e.target.value })}
                        placeholder="Target contract address"
                        className="px-3 py-2 rounded bg-surface-container-lowest font-mono text-xs"
                      />
                      <input
                        value={c.onchain_event_topic0}
                        onChange={(e) => updateCriterion(mi, ci, { onchain_event_topic0: e.target.value })}
                        placeholder="Event topic0 (keccak hash)"
                        className="px-3 py-2 rounded bg-surface-container-lowest font-mono text-xs"
                      />
                    </div>
                  )}
                </div>
              ))}
              <button
                onClick={() => updateMilestone(mi, { criteria: [...m.criteria, newCriterion()] })}
                className="self-start text-primary text-xs hover:underline"
              >
                + Add criterion
              </button>
            </div>
          </section>
        ))}

        <button
          onClick={() => setMilestones((prev) => [...prev, newMilestone()])}
          className="self-start px-4 py-2 rounded-lg bg-surface-container-high text-on-surface hover:bg-surface-bright text-sm"
        >
          + Add milestone
        </button>

        <section className="rounded-xl bg-surface-container p-6 flex flex-col gap-4 sticky bottom-4">
          <div className="flex items-center justify-between">
            <span className="text-on-surface-variant">Total escrow deposit</span>
            <span className="font-headline text-xl font-bold text-primary">{totalRewardGen || 0} GEN</span>
          </div>
          {submitError && <div className="rounded-lg bg-error-container/20 p-3 text-error text-sm">{submitError}</div>}
          {resultGrantId && (
            <div className="rounded-lg bg-secondary/10 p-3 text-secondary text-sm">
              Grant created: {resultGrantId}. Redirecting...
            </div>
          )}
          <TxLifecycle state={state} />
          <button
            onClick={handleSubmit}
            disabled={!isConnected || state.status !== "idle" && state.status !== "failed"}
            className="w-full py-3.5 rounded-lg bg-primary text-on-primary font-bold hover:opacity-90 transition-opacity disabled:opacity-50"
          >
            {isConnected ? "Lock Escrow & Deploy Grant" : "Connect wallet to continue"}
          </button>
        </section>
      </div>
    </AppShell>
  );
}
