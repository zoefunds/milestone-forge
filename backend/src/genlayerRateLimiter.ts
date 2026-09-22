import { Redis } from "ioredis";
import { config } from "./config.js";
import { logger } from "./logger.js";

/**
 * GenLayer StudioNet enforces THREE separate caps, not just one: roughly
 * 30 requests/minute, 500/hour, and 5000/day (the exact hourly/daily
 * numbers come from the RPC's own error messages, not published docs).
 * Guarding only the per-minute window is not sufficient — 28/min sustained
 * is ~1,680/hour and ~40,000/day, both far past the real hourly/daily caps.
 * This surfaced as a real production issue: the indexer kept getting
 * "Rate limit exceeded: 500 requests per hour" / "...5000 requests per
 * day" from GenLayer itself, well before this limiter's old minute-only
 * check ever said no. All three windows are now tracked and ALL must pass
 * for a call to proceed.
 *
 * The backend can run multiple Fly.io machines, so a per-process in-memory
 * counter isn't enough — a shared, cross-instance counter is required.
 * That is the ONLY reason this project uses Redis at all.
 *
 * Deliberately minimal Redis usage (per explicit instruction to cut Redis
 * exhaustion on the Upstash free tier): ONE Redis round-trip per GenLayer
 * call attempt — a single EVAL that atomically increments and reads all
 * three windows' counters in one Lua script, not three separate round
 * trips. No Redis usage anywhere else in the backend for this purpose;
 * ordinary HTTP API rate limiting for our own routes uses an in-memory
 * token bucket (see rateLimiter.ts), never Redis.
 *
 * If Redis is unreachable or REDIS_URL is unset, this fails OPEN to a
 * local in-memory fallback rather than blocking all GenLayer traffic —
 * with a more conservative local limit, since we can no longer see other
 * instances' usage.
 */

const MINUTE_SECONDS = 60;
const HOUR_SECONDS = 3600;
const DAY_SECONDS = 86400;

const MINUTE_LIMIT = 28; // stay under GenLayer's ~30/min with headroom
const HOUR_LIMIT = 450; // stay under GenLayer's ~500/hour with headroom
const DAY_LIMIT = 4500; // stay under GenLayer's ~5000/day with headroom

const LOCAL_FALLBACK_LIMIT_PER_MINUTE = 10; // conservative per-instance cap if Redis is down

// Atomic: increment all three window buckets in one round trip, setting a
// TTL only on first increment for each (so we never re-extend a window),
// and return all three new counts so the caller can enforce all three
// limits from a single Redis call.
const INCR_SCRIPT = `
local minuteKey = KEYS[1]
local hourKey = KEYS[2]
local dayKey = KEYS[3]

local minuteCount = redis.call("INCR", minuteKey)
if minuteCount == 1 then
  redis.call("EXPIRE", minuteKey, ARGV[1])
end

local hourCount = redis.call("INCR", hourKey)
if hourCount == 1 then
  redis.call("EXPIRE", hourKey, ARGV[2])
end

local dayCount = redis.call("INCR", dayKey)
if dayCount == 1 then
  redis.call("EXPIRE", dayKey, ARGV[3])
end

return {minuteCount, hourCount, dayCount}
`;

let redis: Redis | null = null;
if (config.redisUrl) {
  redis = new Redis(config.redisUrl, {
    maxRetriesPerRequest: 1,
    connectTimeout: 3000,
    lazyConnect: true,
  });
  redis.on("error", (err: Error) => {
    logger.warn({ err: err.message }, "redis error (genlayer rate limiter) — falling back to local limiter");
  });
}

let localWindowStart = Math.floor(Date.now() / 1000 / MINUTE_SECONDS);
let localCount = 0;

function checkLocalFallback(): boolean {
  const currentWindow = Math.floor(Date.now() / 1000 / MINUTE_SECONDS);
  if (currentWindow !== localWindowStart) {
    localWindowStart = currentWindow;
    localCount = 0;
  }
  localCount += 1;
  return localCount <= LOCAL_FALLBACK_LIMIT_PER_MINUTE;
}

/**
 * Call before every genlayer-js read/write. Returns true if the call may
 * proceed, false if any of the minute/hour/day GenLayer budgets is
 * exhausted (caller should queue/retry with backoff, never busy-loop).
 */
export async function tryAcquireGenLayerSlot(): Promise<boolean> {
  if (!redis) {
    return checkLocalFallback();
  }
  try {
    const now = Math.floor(Date.now() / 1000);
    const minuteKey = `glrl:m:${Math.floor(now / MINUTE_SECONDS)}`;
    const hourKey = `glrl:h:${Math.floor(now / HOUR_SECONDS)}`;
    const dayKey = `glrl:d:${Math.floor(now / DAY_SECONDS)}`;
    const [minuteCount, hourCount, dayCount] = (await redis.eval(
      INCR_SCRIPT,
      3,
      minuteKey,
      hourKey,
      dayKey,
      MINUTE_SECONDS,
      HOUR_SECONDS,
      DAY_SECONDS
    )) as [number, number, number];
    return minuteCount <= MINUTE_LIMIT && hourCount <= HOUR_LIMIT && dayCount <= DAY_LIMIT;
  } catch (err) {
    logger.warn({ err }, "redis eval failed for genlayer rate limiter — using local fallback for this call");
    return checkLocalFallback();
  }
}

export async function closeRateLimiterRedis(): Promise<void> {
  if (redis) await redis.quit().catch(() => undefined);
}

/**
 * Exposed so indexer.ts can reuse this SAME Redis connection for its
 * leader-election lock (see acquireIndexerLeaderLock there) instead of
 * opening a second connection to Upstash — connection count also counts
 * against the free-tier budget, not just command count. Returns null when
 * Redis isn't configured; callers must handle that (single-instance
 * behavior, no cross-instance coordination possible).
 */
export function getRedisClient(): Redis | null {
  return redis;
}
