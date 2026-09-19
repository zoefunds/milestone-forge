"use client";

import { createClient } from "genlayer-js";
import { studionet } from "genlayer-js/chains";

export const CONTRACT_ADDRESS = (process.env.NEXT_PUBLIC_MILESTONE_FORGE_CONTRACT_ADDRESS ??
  "") as `0x${string}`;

export type TxLifecycleStatus =
  | "idle"
  | "estimating"
  | "awaiting_signature"
  | "submitted"
  | "accepted"
  | "finalized"
  | "failed";

export interface TxLifecycleState {
  status: TxLifecycleStatus;
  txId?: string;
  error?: string;
}

/**
 * Read-only GenLayer client — no wallet required. Used for every page that
 * only needs to display contract state (Explore, Validator Consensus,
 * Challenge Hub listings, grant workspace). These calls hit GenLayer
 * StudioNet directly from the browser; they do NOT go through our backend,
 * so they are not subject to the backend's shared 30/min budget at all.
 */
export function getReadClient() {
  return createClient({ chain: studionet });
}

/**
 * Write client — requires an EIP-1193 provider (the connected wallet via
 * Reown/wagmi) and the connected address. Every write is signed by the
 * user's own wallet in the browser; the backend never sees or holds a
 * private key capable of writing to this contract.
 */
export async function getWriteClient(walletAddress: `0x${string}`) {
  if (typeof window === "undefined" || !(window as any).ethereum) {
    throw new Error("No injected wallet provider found");
  }
  const client = createClient({
    chain: studionet,
    account: walletAddress,
    provider: (window as any).ethereum,
  });
  await client.connect("studionet");
  return client;
}

/**
 * Executes a payable or non-payable write against MilestoneForge, tracking
 * the REAL transaction lifecycle via the SDK (estimate -> sign -> submit ->
 * waitForDecision -> waitForFinalization), never a client-side timer and
 * never a string-matched RPC field. `onUpdate` is called at each real
 * lifecycle transition so the UI can render submitted/accepted/finalized
 * states truthfully.
 */
export async function executeContractWrite(
  walletAddress: `0x${string}`,
  functionName: string,
  args: unknown[],
  valueWei: bigint | undefined,
  onUpdate: (state: TxLifecycleState) => void
): Promise<{ txId: string; success: boolean }> {
  onUpdate({ status: "estimating" });
  const client = await getWriteClient(walletAddress);

  const write: Record<string, unknown> = {
    address: CONTRACT_ADDRESS,
    functionName,
    args,
  };
  if (valueWei !== undefined) write.value = valueWei;

  let estimate;
  try {
    estimate = await client.estimateTransactionFeesForWrite(write as any);
  } catch (err) {
    const message = err instanceof Error ? err.message : "Fee estimation failed";
    onUpdate({ status: "failed", error: message });
    throw err;
  }

  onUpdate({ status: "awaiting_signature" });

  let txId: string;
  try {
    txId = (await client.writeContract({
      ...(write as any),
      fees: { distribution: estimate.distribution, feeValue: estimate.feeValue },
    })) as string;
  } catch (err) {
    const message = err instanceof Error ? err.message : "Wallet rejected or transaction failed to submit";
    onUpdate({ status: "failed", error: message });
    throw err;
  }

  onUpdate({ status: "submitted", txId });

  // Responsive UI checkpoint: a decision has materialized (leader/validator
  // consensus reached), but fees/refunds are not yet durably settled.
  try {
    const decided = await client.waitForDecision({ hash: txId as `0x${string}` });
    onUpdate({ status: "accepted", txId });
    void decided; // decision payload available for callers who need it
  } catch {
    // fall through to finalization wait regardless — some paths only emit
    // a single terminal transition
  }

  const finalized = await client.waitForFinalization({ hash: txId as `0x${string}` });
  const { isSuccessful } = await import("genlayer-js");
  const success = isSuccessful(finalized as any);

  onUpdate({ status: success ? "finalized" : "failed", txId, error: success ? undefined : (finalized as any).statusName });

  return { txId, success };
}
