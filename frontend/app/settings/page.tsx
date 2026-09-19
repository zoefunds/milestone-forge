"use client";

import { useEffect, useState } from "react";
import { useAccount, useDisconnect } from "wagmi";
import { AppShell } from "@/components/AppShell";
import { readProtocolParams } from "@/lib/useMilestoneForge";
import { useSiweAuth } from "@/lib/useSiweAuth";
import { truncateAddress, formatGen } from "@/lib/format";

export default function SettingsPage() {
  const { address, isConnected } = useAccount();
  const { disconnect } = useDisconnect();
  const { authedAddress, signOut } = useSiweAuth();
  const [params, setParams] = useState<any>(null);

  useEffect(() => {
    readProtocolParams()
      .then(setParams)
      .catch(() => undefined);
  }, []);

  return (
    <AppShell>
      <div className="max-w-2xl flex flex-col gap-8">
        <h1 className="font-headline text-3xl font-bold">Settings</h1>

        <section className="rounded-xl bg-surface-container-low p-6 flex flex-col gap-3">
          <h2 className="font-headline font-semibold">Session</h2>
          <div className="flex items-center justify-between text-sm">
            <span className="text-on-surface-variant">Connected wallet</span>
            <span className="font-mono">{isConnected && address ? truncateAddress(address) : "Not connected"}</span>
          </div>
          <div className="flex items-center justify-between text-sm">
            <span className="text-on-surface-variant">Signed-in session (SIWE)</span>
            <span className="font-mono">{authedAddress ? truncateAddress(authedAddress) : "Not signed in"}</span>
          </div>
          <button
            onClick={async () => {
              await signOut();
              disconnect();
            }}
            className="self-start px-4 py-2 rounded-lg bg-surface-container-high text-error text-sm hover:bg-surface-bright"
          >
            Disconnect & sign out
          </button>
        </section>

        <section className="rounded-xl bg-surface-container-low p-6 flex flex-col gap-3">
          <h2 className="font-headline font-semibold">Protocol Parameters (read-only)</h2>
          <p className="text-xs text-on-surface-variant">
            Only the protocol admin (the wallet that deployed the contract) can change these, via{" "}
            <code className="text-primary">update_protocol_params</code> in GenLayer Studio.
          </p>
          {params ? (
            <div className="flex flex-col gap-2 text-sm font-mono">
              <Row label="Protocol admin" value={truncateAddress(params.protocol_admin)} />
              <Row label="Default dispute bond" value={`${formatGen(params.default_dispute_bond_wei)} GEN`} />
              <Row label="Frivolous slash" value={`${params.frivolous_slash_bps / 100}%`} />
              <Row label="Upheld bounty" value={`${params.upheld_bounty_bps / 100}%`} />
              <Row
                label="Challenge window range"
                value={`${params.min_challenge_window_seconds / 3600}h – ${params.max_challenge_window_seconds / 3600}h`}
              />
            </div>
          ) : (
            <span className="text-on-surface-variant text-sm">Loading from chain...</span>
          )}
        </section>
      </div>
    </AppShell>
  );
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-center justify-between">
      <span className="text-on-surface-variant">{label}</span>
      <span className="text-primary">{value}</span>
    </div>
  );
}
