"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { AppShell } from "@/components/AppShell";
import { StatusBadge } from "@/components/StatusBadge";
import {
  listGrants,
  readGrant,
  readMilestone,
  readCriterion,
  readCriterionResult,
  readProtocolParams,
} from "@/lib/useMilestoneForge";
import { formatTimestamp } from "@/lib/format";

interface EvaluatedMilestone {
  grantId: string;
  grantTitle: string;
  milestoneId: string;
  milestoneTitle: string;
  verdict: string;
  evaluatedAt: number;
  criteria: { description: string; type: string; passed: boolean; detail: string }[];
}

export default function ValidatorConsensusPage() {
  const [params, setParams] = useState<any>(null);
  const [evaluated, setEvaluated] = useState<EvaluatedMilestone[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    (async () => {
      try {
        const p = await readProtocolParams();
        setParams(p);

        const grantIds = (await listGrants()) as string[];
        const rows: EvaluatedMilestone[] = [];
        for (const grantId of grantIds.slice(-15).reverse()) {
          const grant: any = await readGrant(grantId);
          for (const milestoneId of grant.milestone_ids ?? []) {
            const m: any = await readMilestone(milestoneId);
            if (!m.verdict) continue;

            const criteria = await Promise.all(
              m.criteria_ids.map(async (cid: string) => {
                const c: any = await readCriterion(cid);
                return { cid, c };
              })
            );

            const results = await Promise.all(m.result_ids.map((rid: string) => readCriterionResult(rid)));

            const criteriaView = criteria.map(({ cid, c }) => {
              const result: any = results.find((r: any) => r.criterion_id === cid);
              return {
                description: c.description,
                type: c.criterion_type,
                passed: Boolean(result?.passed),
                detail: result?.detail ?? "",
              };
            });

            rows.push({
              grantId,
              grantTitle: grant.title,
              milestoneId,
              milestoneTitle: m.title,
              verdict: m.verdict,
              evaluatedAt: m.evaluated_at,
              criteria: criteriaView,
            });
          }
        }
        rows.sort((a, b) => b.evaluatedAt - a.evaluatedAt);
        setEvaluated(rows);
      } catch (err) {
        setError(err instanceof Error ? err.message : "Failed to load validator consensus data");
      }
    })();
  }, []);

  return (
    <AppShell active="/validators">
      <div className="flex flex-col gap-8">
        <div>
          <span className="text-xs uppercase tracking-widest text-primary">StudioNet Equivalence Engine</span>
          <h1 className="font-headline text-3xl font-bold mt-1">Validator Consensus & Inspection Network</h1>
          <p className="text-on-surface-variant mt-1">
            Every result below reflects the contract&apos;s recorded Equivalence Principle outcome — GenLayer
            validators independently fetched each pinned artifact and compared the structured per-criterion booleans.
            No result here is backend-computed or simulated.
          </p>
        </div>

        {error && <div className="rounded-lg bg-error-container/20 p-4 text-error text-sm">{error}</div>}

        {params && (
          <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
            <ParamCard label="Default Dispute Bond" value={`${Number(params.default_dispute_bond_wei) / 1e18} GEN`} />
            <ParamCard label="Frivolous Slash" value={`${params.frivolous_slash_bps / 100}%`} />
            <ParamCard label="Upheld Bounty" value={`${params.upheld_bounty_bps / 100}%`} />
            <ParamCard
              label="Challenge Window Range"
              value={`${params.min_challenge_window_seconds / 3600}h–${params.max_challenge_window_seconds / 3600}h`}
            />
          </div>
        )}

        <section className="flex flex-col gap-3">
          <h2 className="font-headline font-semibold text-lg">Recent Equivalence Consensus Results</h2>
          {!evaluated && !error && <div className="text-on-surface-variant">Reading contract state from StudioNet...</div>}
          {evaluated && evaluated.length === 0 && (
            <div className="rounded-lg bg-surface-container-low p-6 text-on-surface-variant text-sm text-center">
              No milestones have been evaluated yet.
            </div>
          )}
          {evaluated?.map((m) => (
            <Link
              key={m.milestoneId}
              href={`/grant/${m.grantId}`}
              className="rounded-xl bg-surface-container-low p-5 flex flex-col gap-3 hover:bg-surface-container transition-colors"
            >
              <div className="flex items-center justify-between flex-wrap gap-2">
                <div>
                  <div className="text-xs text-outline font-mono">{m.grantTitle}</div>
                  <div className="font-headline font-semibold">{m.milestoneTitle}</div>
                </div>
                <div className="flex items-center gap-2">
                  <StatusBadge status={m.verdict} />
                  <span className="text-xs text-outline">{formatTimestamp(m.evaluatedAt)}</span>
                </div>
              </div>
              <div className="flex flex-col gap-1.5 font-mono text-xs">
                {m.criteria.map((c, i) => (
                  <div key={i} className="flex items-center justify-between bg-surface-container p-2 rounded">
                    <span className="text-on-surface-variant truncate max-w-md">{c.description}</span>
                    <span className={c.passed ? "text-secondary font-bold" : "text-error font-bold"}>
                      {c.passed ? "PASS" : "FAIL"}
                    </span>
                  </div>
                ))}
              </div>
            </Link>
          ))}
        </section>
      </div>
    </AppShell>
  );
}

function ParamCard({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-xl bg-surface-container-low p-4 flex flex-col gap-1">
      <span className="text-xs uppercase text-outline">{label}</span>
      <span className="font-headline text-lg font-bold text-primary">{value}</span>
    </div>
  );
}
