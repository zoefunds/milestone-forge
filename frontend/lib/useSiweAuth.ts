"use client";

import { useCallback, useState } from "react";
import { useAccount, useSignMessage, useChainId } from "wagmi";
import { SiweMessage } from "siwe";

const API_BASE = process.env.NEXT_PUBLIC_API_BASE_URL ?? "http://localhost:8080";

/**
 * Real SIWE authentication flow — connecting a wallet is never by itself
 * treated as proof of identity. The user must sign a challenge message
 * containing a server-issued one-time nonce, and the backend verifies that
 * signature before issuing a session.
 */
export function useSiweAuth() {
  const { address, isConnected } = useAccount();
  const chainId = useChainId();
  const { signMessageAsync } = useSignMessage();
  const [authenticating, setAuthenticating] = useState(false);
  const [authedAddress, setAuthedAddress] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const signIn = useCallback(async () => {
    if (!address || !isConnected) {
      setError("Connect a wallet first");
      return;
    }
    setAuthenticating(true);
    setError(null);
    try {
      const nonceRes = await fetch(`${API_BASE}/auth/nonce`, { credentials: "include" });
      if (!nonceRes.ok) throw new Error("Could not fetch nonce");
      const { nonce } = await nonceRes.json();

      const siweMessage = new SiweMessage({
        domain: window.location.host,
        address,
        statement: "Sign in to Milestone Forge.",
        uri: window.location.origin,
        version: "1",
        chainId,
        nonce,
      });
      const message = siweMessage.prepareMessage();
      const signature = await signMessageAsync({ message });

      const verifyRes = await fetch(`${API_BASE}/auth/verify`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({ message, signature }),
      });
      if (!verifyRes.ok) {
        const body = await verifyRes.json().catch(() => ({}));
        throw new Error(body.error ?? "Sign-in verification failed");
      }
      const { address: verifiedAddress } = await verifyRes.json();
      setAuthedAddress(verifiedAddress);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Sign-in failed");
    } finally {
      setAuthenticating(false);
    }
  }, [address, isConnected, chainId, signMessageAsync]);

  const signOut = useCallback(async () => {
    await fetch(`${API_BASE}/auth/logout`, { method: "POST", credentials: "include" });
    setAuthedAddress(null);
  }, []);

  return { signIn, signOut, authenticating, authedAddress, error };
}
