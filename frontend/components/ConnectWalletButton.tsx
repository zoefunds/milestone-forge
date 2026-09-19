"use client";

import { useAccount, useDisconnect } from "wagmi";
import { useAppKit } from "@reown/appkit/react";
import { useSiweAuth } from "@/lib/useSiweAuth";

function truncate(address: string): string {
  return `${address.slice(0, 6)}...${address.slice(-4)}`;
}

export function ConnectWalletButton() {
  const { open } = useAppKit();
  const { address, isConnected } = useAccount();
  const { disconnect } = useDisconnect();
  const { signIn, signOut, authenticating, authedAddress, error } = useSiweAuth();

  if (!isConnected) {
    return (
      <button
        onClick={() => open()}
        className="px-4 py-2 rounded-lg bg-primary text-on-primary font-semibold hover:opacity-90 transition-opacity"
      >
        Connect Wallet
      </button>
    );
  }

  if (isConnected && (!authedAddress || authedAddress.toLowerCase() !== address?.toLowerCase())) {
    return (
      <div className="flex items-center gap-2">
        <button
          onClick={signIn}
          disabled={authenticating}
          className="px-4 py-2 rounded-lg bg-surface-container-high text-primary font-semibold hover:bg-surface-bright transition-colors disabled:opacity-50"
        >
          {authenticating ? "Signing..." : `Sign In as ${truncate(address ?? "")}`}
        </button>
        {error && <span className="text-error text-xs">{error}</span>}
      </div>
    );
  }

  return (
    <div className="flex items-center gap-2 px-3 py-1.5 rounded-lg bg-surface-container-high text-on-surface">
      <span className="h-2 w-2 rounded-full bg-secondary" />
      <span className="font-code text-sm">{truncate(address ?? "")}</span>
      <button
        onClick={async () => {
          await signOut();
          disconnect();
        }}
        className="text-outline hover:text-on-surface text-xs ml-2"
      >
        Disconnect
      </button>
    </div>
  );
}
