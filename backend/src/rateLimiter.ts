import type { Request, Response, NextFunction } from "express";

/**
 * Ordinary per-IP HTTP rate limiting for our own API surface. Deliberately
 * in-memory (NOT Redis) — this project uses Redis for exactly one thing
 * (the shared GenLayer 30/min budget, see genlayerRateLimiter.ts) to avoid
 * burning through the Upstash free-tier command quota. A single Fly.io
 * region with a couple of machines tolerates per-instance in-memory limits
 * fine for general API abuse protection; it doesn't need to be perfectly
 * globally consistent the way the GenLayer budget does.
 */

interface Bucket {
  count: number;
  windowStart: number;
}

const buckets = new Map<string, Bucket>();

// Periodic sweep so the Map never grows unbounded under sustained traffic.
setInterval(() => {
  const now = Date.now();
  for (const [key, bucket] of buckets) {
    if (now - bucket.windowStart > 5 * 60_000) buckets.delete(key);
  }
}, 60_000).unref();

export function httpRateLimit(limitPerMinute: number) {
  return (req: Request, res: Response, next: NextFunction) => {
    const key = req.ip ?? "unknown";
    const now = Date.now();
    const windowMs = 60_000;

    let bucket = buckets.get(key);
    if (!bucket || now - bucket.windowStart >= windowMs) {
      bucket = { count: 0, windowStart: now };
      buckets.set(key, bucket);
    }
    bucket.count += 1;

    if (bucket.count > limitPerMinute) {
      res.status(429).json({ error: "Rate limit exceeded, try again shortly" });
      return;
    }
    next();
  };
}
