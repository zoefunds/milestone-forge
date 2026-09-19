"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { AppShell } from "@/components/AppShell";
import { StatusBadge } from "@/components/StatusBadge";
import { fetchCachedGrants, type CachedGrant } from "@/lib/api";
import { formatGen, truncateAddress } from "@/lib/format";

export default function ExploreGrantsPage() {
  const [grants, setGrants] = useState<CachedGrant[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [query, setQuery] = useState("");

  useEffect(() => {
    fetchCachedGrants()
      .then(setGrants)
      .catch((err) => setError(err instanceof Error ? err.message : "Failed to load grants"));
  }, []);

  const filtered = (grants ?? []).filter(
    (g) =>
      g.title.toLowerCase().includes(query.toLowerCase()) ||
      g.grant_id.includes(query) ||
      g.funder_address.toLowerCase().includes(query.toLowerCase())
  );

  return (
    <AppShell active="/explore">
      <div className="flex flex-col gap-6">
        <div>
          <span className="text-xs uppercase tracking-widest text-primary">GenLayer Intelligent Contracts</span>
          <h1 className="font-headline text-3xl font-bold mt-1">Autonomous Grant Directory</h1>
          <p className="text-on-surface-variant mt-1">
            Live onchain grants with machine-verifiable criteria, locked escrow tranches, and decentralized
            validator consensus.
          </p>
        </div>

        <input
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Search by grant title or funder address..."
          className="w-full px-4 py-3 rounded-lg bg-surface-container-low text-on-surface placeholder:text-outline focus:outline-none focus:ring-1 focus:ring-primary"
        />

        {error && (
          <div className="rounded-lg bg-error-container/20 p-4 text-error text-sm">
            {error}. Is the backend running at {process.env.NEXT_PUBLIC_API_BASE_URL}?
          </div>
        )}

        {!grants && !error && <div className="text-on-surface-variant">Loading grants...</div>}

        {grants && filtered.length === 0 && (
          <div className="rounded-xl bg-surface-container-low p-8 text-center text-on-surface-variant">
            No grants yet.{" "}
            <Link href="/create" className="text-primary hover:underline">
              Create the first one
            </Link>
            .
          </div>
        )}

        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
          {filtered.map((grant) => (
            <Link
              key={grant.grant_id}
              href={`/grant/${grant.grant_id}`}
              className="flex flex-col gap-3 rounded-xl bg-surface-container-low p-5 hover:bg-surface-container transition-colors"
            >
              <div className="flex items-center justify-between">
                <span className="font-mono text-xs text-primary font-bold">{grant.grant_id}</span>
                <StatusBadge status={grant.status} />
              </div>
              <h3 className="font-headline font-semibold">{grant.title}</h3>
              <div className="text-xs text-on-surface-variant flex items-center gap-1">
                <span>Funder</span>
                <span className="font-mono">{truncateAddress(grant.funder_address)}</span>
              </div>
              <div className="mt-auto pt-2 flex items-center justify-between text-sm">
                <span className="text-outline">Escrow</span>
                <span className="font-mono font-semibold text-primary">{formatGen(grant.total_reward_wei)} GEN</span>
              </div>
            </Link>
          ))}
        </div>
      </div>
    </AppShell>
  );
}
