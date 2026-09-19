"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useAccount } from "wagmi";
import { AppShell } from "@/components/AppShell";
import { StatusBadge } from "@/components/StatusBadge";
import { listGrantsByGrantee, readGrant, readMilestone } from "@/lib/useMilestoneForge";
import { formatGen } from "@/lib/format";

interface Row {
  grantId: string;
  grantTitle: string;
  milestoneId: string;
  milestoneTitle: string;
  status: string;
  rewardWei: string;
}

export default function ClaimMilestonePage() {
  const { address, isConnected } = useAccount();
  const [rows, setRows] = useState<Row[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!address) {
      setRows([]);
      return;
    }
    (async () => {
      try {
        const grantIds = (await listGrantsByGrantee(address)) as string[];
        const out: Row[] = [];
        for (const grantId of grantIds) {
          const grant: any = await readGrant(grantId);
          for (const milestoneId of grant.milestone_ids ?? []) {
            const m: any = await readMilestone(milestoneId);
            out.push({
              grantId,
              grantTitle: grant.title,
              milestoneId,
              milestoneTitle: m.title,
              status: m.status,
              rewardWei: m.reward_wei,
            });
          }
        }
        setRows(out);
      } catch (err) {
        setError(err instanceof Error ? err.message : "Failed to load your milestones");
      }
    })();
  }, [address]);

  const claimable = (rows ?? []).filter((r) => r.status === "CLAIMABLE");
  const inFlight = (rows ?? []).filter((r) => ["EVALUATING", "CHALLENGE_WINDOW", "DISPUTED", "INCONCLUSIVE"].includes(r.status));
  const settled = (rows ?? []).filter((r) => ["RELEASED", "FAILED"].includes(r.status));

  return (
    <AppShell active="/claim">
      <div className="flex flex-col gap-8">
        <div>
          <span className="text-xs uppercase tracking-widest text-primary">Section 7 Trust Boundary</span>
          <h1 className="font-headline text-3xl font-bold mt-1">Claim Milestone</h1>
          <p className="text-on-surface-variant mt-1">
            Milestones across grants where you are the grantee. Submitting a claim pins your artifact snapshot and
            triggers independent GenLayer validator inspection — never trust-me evidence.
          </p>
        </div>

        {!isConnected && (
          <div className="rounded-xl bg-surface-container-low p-8 text-center text-on-surface-variant">
            Connect your wallet to see your claimable milestones.
          </div>
        )}
        {error && <div className="rounded-lg bg-error-container/20 p-4 text-error text-sm">{error}</div>}

        {isConnected && rows && (
          <>
            <Section title="Ready to Claim" rows={claimable} emptyText="No claimable milestones right now." highlight />
            <Section title="In Progress" rows={inFlight} emptyText="Nothing currently under evaluation or dispute." />
            <Section title="Settled" rows={settled} emptyText="No settled milestones yet." />
          </>
        )}
      </div>
    </AppShell>
  );
}

function Section({ title, rows, emptyText, highlight }: { title: string; rows: Row[]; emptyText: string; highlight?: boolean }) {
  return (
    <section className="flex flex-col gap-3">
      <h2 className="font-headline font-semibold text-lg">{title}</h2>
      {rows.length === 0 ? (
        <div className="rounded-lg bg-surface-container-low p-4 text-on-surface-variant text-sm">{emptyText}</div>
      ) : (
        <div className="flex flex-col gap-2">
          {rows.map((r) => (
            <Link
              key={r.milestoneId}
              href={`/grant/${r.grantId}`}
              className={`flex items-center justify-between gap-3 rounded-lg p-4 transition-colors ${
                highlight ? "bg-primary/10 hover:bg-primary/20" : "bg-surface-container-low hover:bg-surface-container"
              }`}
            >
              <div>
                <div className="text-xs text-outline font-mono">{r.grantTitle}</div>
                <div className="font-semibold">{r.milestoneTitle}</div>
              </div>
              <div className="flex items-center gap-3">
                <span className="font-mono text-sm text-primary">{formatGen(r.rewardWei)} GEN</span>
                <StatusBadge status={r.status} />
              </div>
            </Link>
          ))}
        </div>
      )}
    </section>
  );
}
