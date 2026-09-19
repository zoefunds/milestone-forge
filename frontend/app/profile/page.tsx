"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useAccount } from "wagmi";
import { AppShell } from "@/components/AppShell";
import { StatusBadge } from "@/components/StatusBadge";
import { listGrantsByFunder, listGrantsByGrantee, readGrant } from "@/lib/useMilestoneForge";
import { formatGen, truncateAddress } from "@/lib/format";

interface GrantRow {
  grant_id: string;
  title: string;
  status: string;
  total_reward_wei: string;
}

export default function ProfilePage() {
  const { address, isConnected } = useAccount();
  const [asFunder, setAsFunder] = useState<GrantRow[]>([]);
  const [asGrantee, setAsGrantee] = useState<GrantRow[]>([]);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (!address) return;
    setLoading(true);
    (async () => {
      const [funderIds, granteeIds] = await Promise.all([
        listGrantsByFunder(address) as Promise<string[]>,
        listGrantsByGrantee(address) as Promise<string[]>,
      ]);
      const [funderGrants, granteeGrants] = await Promise.all([
        Promise.all(funderIds.map((id) => readGrant(id) as Promise<GrantRow>)),
        Promise.all(granteeIds.map((id) => readGrant(id) as Promise<GrantRow>)),
      ]);
      setAsFunder(funderGrants);
      setAsGrantee(granteeGrants);
      setLoading(false);
    })();
  }, [address]);

  return (
    <AppShell>
      <div className="flex flex-col gap-8">
        <div>
          <h1 className="font-headline text-3xl font-bold">Profile</h1>
          {isConnected && address ? (
            <p className="text-on-surface-variant mt-1 font-mono text-sm">{truncateAddress(address)}</p>
          ) : (
            <p className="text-on-surface-variant mt-1">Connect your wallet to view your grants.</p>
          )}
        </div>

        {isConnected && (
          <>
            <GrantList title="Grants you funded" rows={asFunder} loading={loading} />
            <GrantList title="Grants you received" rows={asGrantee} loading={loading} />
          </>
        )}
      </div>
    </AppShell>
  );
}

function GrantList({ title, rows, loading }: { title: string; rows: GrantRow[]; loading: boolean }) {
  return (
    <section className="flex flex-col gap-3">
      <h2 className="font-headline font-semibold text-lg">{title}</h2>
      {loading && <div className="text-on-surface-variant text-sm">Loading...</div>}
      {!loading && rows.length === 0 && (
        <div className="rounded-lg bg-surface-container-low p-4 text-on-surface-variant text-sm">None yet.</div>
      )}
      {rows.map((g) => (
        <Link
          key={g.grant_id}
          href={`/grant/${g.grant_id}`}
          className="flex items-center justify-between rounded-lg bg-surface-container-low p-4 hover:bg-surface-container transition-colors"
        >
          <span className="font-medium">{g.title}</span>
          <div className="flex items-center gap-3">
            <span className="font-mono text-sm text-primary">{formatGen(g.total_reward_wei)} GEN</span>
            <StatusBadge status={g.status} />
          </div>
        </Link>
      ))}
    </section>
  );
}
