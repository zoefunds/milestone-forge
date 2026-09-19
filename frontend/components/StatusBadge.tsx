const STATUS_STYLES: Record<string, string> = {
  LOCKED: "bg-surface-container-high text-outline",
  CLAIMABLE: "bg-primary/10 text-primary",
  EVALUATING: "bg-tertiary/10 text-tertiary",
  CHALLENGE_WINDOW: "bg-tertiary/10 text-tertiary",
  DISPUTED: "bg-error/10 text-error",
  RELEASED: "bg-secondary/15 text-secondary",
  FAILED: "bg-error/10 text-error",
  INCONCLUSIVE: "bg-surface-container-high text-outline",
  CANCELLED: "bg-surface-container-high text-outline",
  ACTIVE: "bg-primary/10 text-primary",
  COMPLETED: "bg-secondary/15 text-secondary",
  PENDING: "bg-tertiary/10 text-tertiary",
  UPHELD: "bg-secondary/15 text-secondary",
  REJECTED: "bg-error/10 text-error",
  PASSED: "bg-secondary/15 text-secondary",
  PARTIAL_PASS: "bg-tertiary/10 text-tertiary",
};

export function StatusBadge({ status }: { status: string }) {
  const style = STATUS_STYLES[status] ?? "bg-surface-container-high text-outline";
  return (
    <span className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded font-mono text-[10px] uppercase tracking-wider font-semibold ${style}`}>
      {status.replace(/_/g, " ")}
    </span>
  );
}
