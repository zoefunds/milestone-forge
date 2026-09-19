"use client";

const API_BASE = process.env.NEXT_PUBLIC_API_BASE_URL ?? "http://localhost:8080";

export interface CachedGrant {
  grant_id: string;
  funder_address: string;
  grantee_address: string;
  title: string;
  total_reward_wei: string;
  status: string;
  created_at: string;
}

export interface CachedMilestone {
  milestone_id: string;
  grant_id: string;
  idx: number;
  title: string;
  reward_wei: string;
  status: string;
  challenge_window_seconds: number;
  verdict: string | null;
  recommended_payout_bps: number | null;
  active_challenge_id: string | null;
}

/** Fast cached list — backed by the backend's event indexer, not a live read. */
export async function fetchCachedGrants(): Promise<CachedGrant[]> {
  const res = await fetch(`${API_BASE}/grants`, { credentials: "include" });
  if (!res.ok) throw new Error("Failed to load grants");
  const body = await res.json();
  return body.grants;
}

export async function fetchCachedGrant(grantId: string): Promise<{ grant: CachedGrant; milestones: CachedMilestone[] }> {
  const res = await fetch(`${API_BASE}/grants/${grantId}`, { credentials: "include" });
  if (!res.ok) throw new Error("Grant not found");
  return res.json();
}

export async function previewUrlSafety(url: string): Promise<boolean> {
  const res = await fetch(`${API_BASE}/grants/preview-url`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ url }),
  });
  if (!res.ok) return false;
  const body = await res.json();
  return Boolean(body.safe);
}
