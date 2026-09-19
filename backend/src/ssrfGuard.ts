/**
 * SSRF guard for the backend's own preview/validation fetches (e.g. "check
 * this URL looks reachable" during grant-creation form UX). Mirrors the
 * deterministic host denylist enforced on-chain in
 * contracts/milestone_forge.py::_assert_safe_public_url, so the UI can give
 * fast feedback before a user ever pays gas — but the CONTRACT remains the
 * authoritative enforcement point, not this function.
 */

const FORBIDDEN_HOST_PREFIXES = [
  "localhost",
  "127.",
  "0.0.0.0",
  "169.254.", // link-local / cloud metadata (AWS/GCP/Azure IMDS)
  "10.",
  "192.168.",
  "::1",
  "metadata.google.internal",
];

const FORBIDDEN_HOST_PATTERNS = [/^172\.(1[6-9]|2\d|3[0-1])\./]; // 172.16.0.0/12

export function isSafePublicUrl(rawUrl: string): boolean {
  let parsed: URL;
  try {
    parsed = new URL(rawUrl);
  } catch {
    return false;
  }
  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") return false;

  const host = parsed.hostname.toLowerCase();
  if (FORBIDDEN_HOST_PREFIXES.some((prefix) => host === prefix || host.startsWith(prefix))) return false;
  if (FORBIDDEN_HOST_PATTERNS.some((pattern) => pattern.test(host))) return false;

  return true;
}
