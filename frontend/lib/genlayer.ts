"use client";

import { createClient } from "genlayer-js";
import { studionet } from "genlayer-js/chains";

// The published genlayer-js types don't export the TransactionStatus /
// ExecutionResult enums at the package root (they're only used internally
// in the GenLayerClient method signatures), but their runtime string values
// are documented and stable, so we reference them as literals here.
const STATUS_ACCEPTED = "ACCEPTED";
const STATUS_FINALIZED = "FINALIZED";
const EXECUTION_FAILED = "FINISHED_WITH_ERROR";

export const CONTRACT_ADDRESS = (process.env.NEXT_PUBLIC_MILESTONE_FORGE_CONTRACT_ADDRESS ??
  "") as `0x${string}`;

export type TxLifecycleStatus =
  | "idle"
  | "awaiting_signature"
  | "submitted"
  | "accepted"
  | "finalized"
  | "timeout"
  | "failed";

export interface TxLifecycleState {
  status: TxLifecycleStatus;
  txId?: string;
  error?: string;
}

/**
 * Read-only GenLayer client — no wallet required. Used for every page that
 * only needs to display contract state (Explore, Validator Consensus,
 * Challenge Hub listings, grant workspace, history, profile). These calls
 * hit GenLayer StudioNet directly from the browser and do NOT go through
 * our backend, so they are not subject to the backend's shared 30/min
 * budget at all.
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
 * Determines whether a finalized transaction actually succeeded.
 *
 * This is more subtle than it looks, and got it wrong once already: the
 * object `waitForTransactionReceipt` resolves to has already been through
 * `simplifyTransactionReceipt`, which RENAMES `statusName` to `status_name`
 * (snake_case) in its output — so checking `tx.statusName` here is always
 * `undefined` and silently reports every successful transaction as failed.
 * Separately, for `studionet` (what this app targets — `chain.isStudio` is
 * true for it), the SDK's `getTransaction` never populates
 * `txExecutionResult`/`txExecutionResultName` at all; the real per-run
 * outcome instead lives at `consensus_data.leader_receipt[].execution_result`
 * (a string GenVM sets directly, e.g. what the Studio explorer UI shows as
 * "Execution Result: SUCCESS" / "ERROR").
 *
 * This checks both fields defensively (old/new SDK shapes) and only
 * declares failure when there's a positive error signal — absence of a
 * result is treated as "finalized, no error observed", never as failure,
 * since a false failure report tells the user their GEN is gone when it
 * isn't (the same class of bug as the tx-timeout issue fixed alongside
 * this).
 */
function isTxSuccessful(tx: any): boolean {
  const statusName = tx?.status_name ?? tx?.statusName;
  if (statusName !== STATUS_FINALIZED) return false;

  if (tx?.txExecutionResultName === EXECUTION_FAILED) return false;

  const leaderReceipts: any[] = Array.isArray(tx?.consensus_data?.leader_receipt)
    ? tx.consensus_data.leader_receipt
    : tx?.consensus_data?.leader_receipt
      ? [tx.consensus_data.leader_receipt]
      : [];
  const hasExecutionError = leaderReceipts.some((r) => {
    const result = String(r?.execution_result ?? "").toUpperCase();
    return result.includes("ERROR") || result === "FAILED";
  });

  return !hasExecutionError;
}

// genlayer-js's own default poll budget is interval:3000ms, retries:10 —
// only 30 seconds total. That's nowhere near enough for a real MilestoneForge
// write: milestone claim submission and challenge resolution both trigger
// live multi-validator web/GitHub/RPC fetches plus a full commit-reveal
// consensus round, which routinely takes well over a minute on StudioNet.
// Using the SDK default caused the frontend to report a transaction as
// "failed" purely because OUR poll gave up — while the write kept running
// and could still finalize on-chain afterward. Give each stage a generous,
// explicit budget instead of trusting the SDK default.
const ACCEPTED_WAIT = { interval: 3000, retries: 60 }; // ~3 min
const FINALIZED_WAIT = { interval: 5000, retries: 120 }; // ~10 min

/**
 * Executes a write against MilestoneForge, tracking the REAL transaction
 * lifecycle via the GenLayer SDK's own status enum
 * (submitted -> ACCEPTED -> FINALIZED, via two real
 * `waitForTransactionReceipt` polls), never a client-side timer and never a
 * string-matched RPC field. `onUpdate` fires at each real lifecycle
 * transition so the UI renders truthful submitted/accepted/finalized states.
 */
export async function executeContractWrite(
  walletAddress: `0x${string}`,
  functionName: string,
  args: unknown[],
  valueWei: bigint | undefined,
  onUpdate: (state: TxLifecycleState) => void
): Promise<{ txId: string; success: boolean }> {
  onUpdate({ status: "awaiting_signature" });
  const client = await getWriteClient(walletAddress);

  let txId: string;
  try {
    txId = (await client.writeContract({
      address: CONTRACT_ADDRESS,
      functionName,
      args: args as any[],
      value: valueWei ?? 0n,
    })) as string;
  } catch (err) {
    const message = err instanceof Error ? err.message : "Wallet rejected or transaction failed to submit";
    onUpdate({ status: "failed", error: message });
    throw err;
  }

  onUpdate({ status: "submitted", txId });

  // Responsive UI checkpoint: validator consensus has produced a decision
  // (ACCEPTED), which is not yet durably settled.
  try {
    await client.waitForTransactionReceipt({
      hash: txId as any,
      status: STATUS_ACCEPTED as any,
      ...ACCEPTED_WAIT,
    });
    onUpdate({ status: "accepted", txId });
  } catch {
    // Either it skipped straight to a terminal status, or our ACCEPTED
    // poll budget ran out while consensus was still forming — fall
    // through to the (longer) finalization wait regardless; that one is
    // authoritative.
  }

  let finalTx;
  try {
    finalTx = await client.waitForTransactionReceipt({
      hash: txId as any,
      status: STATUS_FINALIZED as any,
      ...FINALIZED_WAIT,
    });
  } catch (err) {
    // This means OUR polling gave up — it does NOT mean the transaction
    // failed. GenLayer consensus (especially for claim/challenge
    // evaluation, which does live web fetches) can legitimately take
    // longer than even our generous budget. The write may still finalize
    // on-chain after we stop watching, so this must never be reported as
    // "failed" — that would tell the user their GEN is gone when it isn't.
    const message =
      err instanceof Error
        ? err.message
        : "Still waiting on GenLayer validator consensus — this can take several minutes for claims/challenges";
    onUpdate({ status: "timeout", txId, error: message });
    return { txId, success: false };
  }

  const success = isTxSuccessful(finalTx);
  const leaderReceipt = (finalTx as any)?.consensus_data?.leader_receipt;
  const executionResult = Array.isArray(leaderReceipt)
    ? leaderReceipt[0]?.execution_result
    : leaderReceipt?.execution_result;
  onUpdate({
    status: success ? "finalized" : "failed",
    txId,
    error: success ? undefined : String((finalTx as any)?.txExecutionResultName ?? executionResult ?? "Execution failed"),
  });

  return { txId, success };
}
