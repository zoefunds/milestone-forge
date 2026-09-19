export function formatGen(attoWei: string | number | bigint | null | undefined): string {
  if (attoWei === null || attoWei === undefined) return "0";
  try {
    const value = typeof attoWei === "bigint" ? attoWei : BigInt(attoWei);
    const whole = value / 10n ** 18n;
    const frac = value % 10n ** 18n;
    const fracStr = frac.toString().padStart(18, "0").slice(0, 2);
    return fracStr === "00" ? whole.toString() : `${whole}.${fracStr}`;
  } catch {
    return String(attoWei);
  }
}

export function genToAtto(gen: string | number): bigint {
  const [whole, frac = ""] = String(gen).split(".");
  const fracPadded = (frac + "0".repeat(18)).slice(0, 18);
  return BigInt(whole || "0") * 10n ** 18n + BigInt(fracPadded || "0");
}

export function truncateAddress(address: string): string {
  if (!address || address.length < 10) return address;
  return `${address.slice(0, 6)}...${address.slice(-4)}`;
}

export function formatTimestamp(unixSeconds: number): string {
  if (!unixSeconds) return "—";
  return new Date(unixSeconds * 1000).toLocaleString();
}

export function secondsToHuman(seconds: number): string {
  const h = Math.floor(seconds / 3600);
  const d = Math.floor(h / 24);
  if (d > 0) return `${d}d ${h % 24}h`;
  return `${h}h`;
}
