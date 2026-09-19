"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { AppShell } from "@/components/AppShell";
import { listGrants, readGrant, readMilestone, listChallenges, readChallenge } from "@/lib/useMilestoneForge";
import { formatTimestamp, formatGen } from "@/lib/format";

interface HistoryEvent {
  timestamp: number;
  label: string;
  detail: string;
  grantId: string;
}

export default function HistoryPage() {
  const [events, setEvents] = useState<HistoryEvent[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    (async () => {
      try {
        const grantIds = (await listGrants()) as string[];
        const out: HistoryEvent[] = [];

        for (const grantId of grantIds) {
          const grant: any = await readGrant(grantId);
          for (const milestoneId of grant.milestone_ids ?? []) {
            const m: any = await readMilestone(milestoneId);
            if (m.claim_submitted_at > 0) {
              out.push({
                timestamp: m.claim_submitted_at,
                label: "Milestone claim submitted",
                detail: `${grant.title} — ${m.title}`,
                grantId,
              });
            }
            if (m.evaluated_at > 0) {
              out.push({
                timestamp: m.evaluated_at,
                label: `Validator consensus: ${m.verdict}`,
                detail: `${grant.title} — ${m.title}`,
                grantId,
              });
            }
          }
        }

        const challengeIds = (await listChallenges()) as string[];
        for (const cid of challengeIds) {
          const c: any = await readChallenge(cid);
          out.push({
            timestamp: c.filed_at,
            label: "Challenge filed",
            detail: `${cid} — ${formatGen(c.bond_wei)} GEN bond`,
            grantId: "",
          });
          if (c.resolved_at > 0) {
            out.push({
              timestamp: c.resolved_at,
              label: `Challenge ${c.status.toLowerCase()}`,
              detail: cid,
              grantId: "",
            });
          }
        }

        out.sort((a, b) => b.timestamp - a.timestamp);
        setEvents(out);
      } catch (err) {
        setError(err instanceof Error ? err.message : "Failed to load history");
      }
    })();
  }, []);

  return (
    <AppShell active="/history">
      <div className="flex flex-col gap-6">
        <div>
          <h1 className="font-headline text-3xl font-bold">Protocol History</h1>
          <p className="text-on-surface-variant mt-1">
            Full audit trail assembled live from on-chain contract state — claims, consensus results, and
            challenges across every grant.
          </p>
        </div>

        {error && <div className="rounded-lg bg-error-container/20 p-4 text-error text-sm">{error}</div>}
        {!events && !error && <div className="text-on-surface-variant">Reading history from StudioNet...</div>}
        {events && events.length === 0 && (
          <div className="rounded-lg bg-surface-container-low p-6 text-on-surface-variant text-sm text-center">
            No activity yet.
          </div>
        )}

        <div className="relative pl-6 flex flex-col gap-4">
          {events && events.length > 0 && (
            <div className="absolute left-2 top-2 bottom-2 w-0.5 bg-surface-container-high" />
          )}
          {events?.map((e, i) => (
            <div key={i} className="relative flex flex-col gap-0.5">
              <span className="absolute -left-6 top-1 w-3 h-3 rounded-full bg-primary" />
              <div className="flex items-center justify-between">
                <span className="font-mono text-sm font-semibold text-on-surface">{e.label}</span>
                <span className="text-xs text-outline">{formatTimestamp(e.timestamp)}</span>
              </div>
              {e.grantId ? (
                <Link href={`/grant/${e.grantId}`} className="text-sm text-on-surface-variant hover:text-primary">
                  {e.detail}
                </Link>
              ) : (
                <span className="text-sm text-on-surface-variant">{e.detail}</span>
              )}
            </div>
          ))}
        </div>
      </div>
    </AppShell>
  );
}
