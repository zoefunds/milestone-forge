import type { TxLifecycleState } from "@/lib/genlayer";

const STEPS: { key: string; label: string }[] = [
  { key: "estimating", label: "Estimating fees" },
  { key: "awaiting_signature", label: "Awaiting wallet signature" },
  { key: "submitted", label: "Submitted" },
  { key: "accepted", label: "Validator consensus reached" },
  { key: "finalized", label: "Finalized" },
];

/**
 * Renders the REAL transaction lifecycle reported by the GenLayer SDK
 * (sign -> submit -> waitForTransactionReceipt(ACCEPTED) ->
 * waitForTransactionReceipt(FINALIZED)). Never a client-side countdown
 * standing in for actual status.
 */
export function TxLifecycle({ state }: { state: TxLifecycleState }) {
  if (state.status === "idle") return null;

  const currentIndex = STEPS.findIndex((s) => s.key === state.status);

  if (state.status === "failed") {
    return (
      <div className="rounded-lg bg-error-container/20 p-3 text-sm text-error">
        Transaction failed{state.error ? `: ${state.error}` : ""}
      </div>
    );
  }

  if (state.status === "timeout") {
    return (
      <div className="rounded-lg bg-tertiary/10 p-3 text-sm text-tertiary flex flex-col gap-1">
        <span className="font-semibold">Still processing on-chain</span>
        <span className="text-on-surface-variant">
          The frontend stopped waiting, but this does not mean it failed — GenLayer consensus (especially for a
          milestone claim or challenge, which involve live validator web fetches) can take longer than a few
          minutes. Your GEN has not been lost. Refresh this page shortly, or check the grant workspace for the
          updated status.
        </span>
        {state.txId && <span className="font-mono text-outline pt-1">tx: {state.txId}</span>}
      </div>
    );
  }

  return (
    <div className="rounded-lg bg-surface-container-lowest p-3 flex flex-col gap-2 font-mono text-xs">
      {STEPS.map((step, i) => (
        <div key={step.key} className="flex items-center gap-2">
          <span
            className={`h-2 w-2 rounded-full ${
              i < currentIndex ? "bg-secondary" : i === currentIndex ? "bg-primary animate-pulse" : "bg-surface-container-high"
            }`}
          />
          <span className={i <= currentIndex ? "text-on-surface" : "text-outline"}>{step.label}</span>
        </div>
      ))}
      {state.status === "accepted" && (
        <div className="text-tertiary pt-1">
          Waiting for final settlement — this can take a few minutes for claims/challenges involving live validator
          web fetches.
        </div>
      )}
      {state.txId && <div className="text-outline pt-1">tx: {state.txId.slice(0, 18)}...</div>}
    </div>
  );
}
