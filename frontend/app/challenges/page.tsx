"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { AppShell } from "@/components/AppShell";
import { StatusBadge } from "@/components/StatusBadge";
import { TxLifecycle } from "@/components/TxLifecycle";
import { listChallenges, readChallenge, readMilestone, useResolveChallenge } from "@/lib/useMilestoneForge";
import { formatGen, truncateAddress, formatTimestamp } from "@/lib/format";

interface ChallengeView {
  challenge_id: string;
  milestone_id: string;
  challenger: string;
  bond_wei: string;
  category: string;
  evidence_url: string;
  status: string;
  filed_at: number;
  resolved_at: number;
  resolution_detail: string;
}

export default function ChallengeHubPage() {
  const [challenges, setChallenges] = useState<ChallengeView[] | null>(null);
  const [milestoneTitles, setMilestoneTitles] = useState<Record<string, string>>({});
  const [milestoneGrantIds, setMilestoneGrantIds] = useState<Record<string, string>>({});
  const [error, setError] = useState<string | null>(null);
  const resolveChallenge = useResolveChallenge();

  async function load() {
    try {
      const ids = (await listChallenges()) as string[];
      const rows = await Promise.all(ids.map((id) => readChallenge(id) as Promise<ChallengeView>));
      rows.sort((a, b) => b.filed_at - a.filed_at);
      setChallenges(rows);

      const titles: Record<string, string> = {};
      const grantIds: Record<string, string> = {};
      for (const c of rows) {
        if (!titles[c.milestone_id]) {
          const m: any = await readMilestone(c.milestone_id);
          titles[c.milestone_id] = m.title;
          grantIds[c.milestone_id] = m.grant_id;
        }
      }
      setMilestoneTitles(titles);
      setMilestoneGrantIds(grantIds);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load challenges");
    }
  }

  useEffect(() => {
    load();
  }, []);

  const pending = (challenges ?? []).filter((c) => c.status === "PENDING");
  const resolved = (challenges ?? []).filter((c) => c.status !== "PENDING");

  async function handleResolve(challengeId: string) {
    const result = await resolveChallenge.run([challengeId]);
    if (result.success) await load();
  }

  return (
    <AppShell active="/challenges">
      <div className="flex flex-col gap-8">
        <div>
          <span className="text-xs uppercase tracking-widest text-primary">Section 7 Protocol Enforcement</span>
          <h1 className="font-headline text-3xl font-bold mt-1">Challenge & Dispute Hub</h1>
          <p className="text-on-surface-variant mt-1">
            Additive-evidence-only disputes. Resolving a challenge re-runs the exact same pinned genesis criteria
            through independent GenLayer validators — it can never replace or rewrite them.
          </p>
        </div>

        {error && <div className="rounded-lg bg-error-container/20 p-4 text-error text-sm">{error}</div>}
        <TxLifecycle state={resolveChallenge.state} />

        <section className="flex flex-col gap-3">
          <h2 className="font-headline font-semibold text-lg">Pending — awaiting re-evaluation</h2>
          {pending.length === 0 && (
            <div className="rounded-lg bg-surface-container-low p-4 text-on-surface-variant text-sm">
              No pending disputes.
            </div>
          )}
          {pending.map((c) => (
            <div key={c.challenge_id} className="rounded-xl bg-surface-container-low p-5 flex flex-col gap-3">
              <div className="flex items-center justify-between flex-wrap gap-2">
                <div>
                  <span className="font-mono text-xs text-tertiary font-bold">{c.challenge_id}</span>
                  <div className="font-headline font-semibold">{milestoneTitles[c.milestone_id] ?? c.milestone_id}</div>
                </div>
                <StatusBadge status={c.status} />
              </div>
              <div className="text-sm text-on-surface-variant">
                Category: <span className="text-on-surface">{c.category}</span> · Challenger:{" "}
                <span className="font-mono">{truncateAddress(c.challenger)}</span> · Bond:{" "}
                <span className="font-mono text-tertiary">{formatGen(c.bond_wei)} GEN</span>
              </div>
              <a href={c.evidence_url} target="_blank" rel="noreferrer" className="text-primary text-xs hover:underline break-all">
                {c.evidence_url}
              </a>
              <div className="flex items-center justify-between">
                <Link
                  href={`/grant/${milestoneGrantIds[c.milestone_id] ?? ""}`}
                  className="text-xs text-outline hover:text-on-surface"
                >
                  View milestone
                </Link>
                <button
                  onClick={() => handleResolve(c.challenge_id)}
                  className="px-4 py-2 rounded-lg bg-tertiary text-on-tertiary font-semibold hover:opacity-90"
                >
                  Re-run Validator Inspection & Resolve
                </button>
              </div>
            </div>
          ))}
        </section>

        <section className="flex flex-col gap-3">
          <h2 className="font-headline font-semibold text-lg">Historical Resolutions</h2>
          <div className="rounded-xl bg-surface-container-low overflow-hidden">
            <table className="w-full text-left text-sm">
              <thead className="bg-surface-container-high text-outline text-xs uppercase">
                <tr>
                  <th className="py-3 px-4">Challenge</th>
                  <th className="py-3 px-4">Milestone</th>
                  <th className="py-3 px-4">Outcome</th>
                  <th className="py-3 px-4">Resolved</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-surface-container">
                {resolved.map((c) => (
                  <tr key={c.challenge_id}>
                    <td className="py-3 px-4 font-mono text-primary text-xs">{c.challenge_id}</td>
                    <td className="py-3 px-4">{milestoneTitles[c.milestone_id] ?? c.milestone_id}</td>
                    <td className="py-3 px-4">
                      <StatusBadge status={c.status} />
                    </td>
                    <td className="py-3 px-4 text-outline text-xs">{formatTimestamp(c.resolved_at)}</td>
                  </tr>
                ))}
                {resolved.length === 0 && (
                  <tr>
                    <td colSpan={4} className="py-6 text-center text-on-surface-variant">
                      No resolved disputes yet.
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </section>
      </div>
    </AppShell>
  );
}
