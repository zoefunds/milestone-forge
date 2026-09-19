import Redis from "ioredis";
import { config } from "./config.js";
import { logger } from "./logger.js";

/**
 * GenLayer StudioNet enforces a 30 requests/minute cap on RPC calls. The
 * backend can run multiple Fly.io machines (that's the whole point of "must
 * never die"), so a per-process in-memory counter isn't enough — a shared,
 * cross-instance counter is required. That is the ONLY reason this project
 * uses Redis at all.
 *
 * Deliberately minimal Redis usage (per explicit instruction to cut Redis
 * exhaustion on the Upstash free tier):
 *   - ONE Redis round-trip per GenLayer call attempt (a single EVAL of the
 *     Lua script below — atomic INCR + conditional EXPIRE in one command).
 *   - No Redis usage anywhere else in the backend: ordinary HTTP API rate
 *     limiting for our own routes uses an in-memory token bucket
 *     (see rateLimiter.ts), never Redis.
 *   - If Redis is unreachable or REDIS_URL is unset, this fails OPEN to a
 *     local in-memory fallback rather than blocking all GenLayer traffic —
 *     with a more conservative local limit, since we can no longer see other
 *     instances' usage.
 */

const WINDOW_SECONDS = 60;
const GLOBAL_LIMIT_PER_MINUTE = 28; // stay under GenLayer's 30/min with headroom
const LOCAL_FALLBACK_LIMIT_PER_MINUTE = 10; // conservative per-instance cap if Redis is down

// Atomic: increment the current-minute bucket, set a TTL only on first
// increment (so we never re-extend the window), return the new count.
// One round trip, one Redis command server-side.
const INCR_SCRIPT = `
local key = KEYS[1]
local count = redis.call("INCR", key)
if count == 1 then
  redis.call("EXPIRE", key, ARGV[1])
end
return count
`;

let redis: Redis | null = null;
if (config.redisUrl) {
  redis = new Redis(config.redisUrl, {
    maxRetriesPerRequest: 1,
    connectTimeout: 3000,
    lazyConnect: true,
  });
  redis.on("error", (err) => {
    logger.warn({ err: err.message }, "redis error (genlayer rate limiter) — falling back to local limiter");
  });
}

let localWindowStart = Math.floor(Date.now() / 1000 / WINDOW_SECONDS);
let localCount = 0;

function checkLocalFallback(): boolean {
  const currentWindow = Math.floor(Date.now() / 1000 / WINDOW_SECONDS);
  if (currentWindow !== localWindowStart) {
    localWindowStart = currentWindow;
    localCount = 0;
  }
  localCount += 1;
  return localCount <= LOCAL_FALLBACK_LIMIT_PER_MINUTE;
}

/**
 * Call before every genlayer-js read/write. Returns true if the call may
 * proceed, false if the GenLayer rate budget for this minute is exhausted
 * (caller should queue/retry with backoff, never busy-loop).
 */
export async function tryAcquireGenLayerSlot(): Promise<boolean> {
  if (!redis) {
    return checkLocalFallback();
  }
  try {
    const windowKey = `glrl:${Math.floor(Date.now() / 1000 / WINDOW_SECONDS)}`;
    const count = (await redis.eval(INCR_SCRIPT, 1, windowKey, WINDOW_SECONDS)) as number;
    return count <= GLOBAL_LIMIT_PER_MINUTE;
  } catch (err) {
    logger.warn({ err }, "redis eval failed for genlayer rate limiter — using local fallback for this call");
    return checkLocalFallback();
  }
}

export async function closeRateLimiterRedis(): Promise<void> {
  if (redis) await redis.quit().catch(() => undefined);
}
