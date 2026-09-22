import { pool } from "./db.js";
import { readContract, GenLayerRateLimitedError } from "./genlayerClient.js";
import { getRedisClient } from "./genlayerRateLimiter.js";
import { config } from "./config.js";
import { logger } from "./logger.js";

/**
 * Background poller that mirrors contract state into Postgres so the
 * frontend's list/history views are fast without hammering GenLayer on
 * every page load.
 *
 * This backend runs multiple Fly.io machines, and each one used to run its
 * own independent poller — doubling every GenLayer RPC call for zero
 * benefit, since they all write to the same shared Postgres. That was a
 * real contributor to exhausting GenLayer's hourly/daily rate budget (see
 * genlayerRateLimiter.ts). Only ONE machine now actually polls at a time,
 * via a short-lived Redis lock (see acquireIndexerLeaderLock) that any
 * machine can pick up if the current leader goes away.
 *
 * Terminal grants (COMPLETED/CANCELLED) and terminal milestones
 * (RELEASED/FAILED/CANCELLED) can never change again once mirrored, so
 * they're skipped on every poll after the first successful sync — this
 * keeps steady-state RPC cost roughly proportional to *active* grants
 * only, instead of growing forever with total history.
 */

const POLL_INTERVAL_MS = Number(process.env.INDEXER_POLL_INTERVAL_MS ?? 120_000);
const LEADER_LOCK_KEY = "mf:indexer-leader";
const LEADER_LOCK_TTL_SECONDS = Math.ceil((POLL_INTERVAL_MS / 1000) * 2); // survives one missed tick

const GRANT_TERMINAL_STATUSES = new Set(["COMPLETED", "CANCELLED"]);
const MILESTONE_TERMINAL_STATUSES = new Set(["RELEASED", "FAILED", "CANCELLED"]);

let running = false;

export function startIndexer(): void {
  if (!config.contractAddress) {
    logger.warn("MILESTONE_FORGE_CONTRACT_ADDRESS not set — indexer idle until it is configured");
  }
  setInterval(() => {
    if (running) return;
    running = true;
    pollOnce()
      .catch((err) => logger.error({ err }, "indexer poll failed"))
      .finally(() => {
        running = false;
      });
  }, POLL_INTERVAL_MS).unref();
}

/**
 * Best-effort leader election: SET NX with a TTL. If this machine already
 * holds the lock, renew it (a plain SET with NX still succeeds because we
 * check ownership via GET first — simpler than a Lua CAS script for a
 * lock that only needs to prevent double-polling, not hard mutual
 * exclusion). No Redis configured => every machine polls independently
 * (same as before this fix, just without the option to do otherwise).
 */
async function acquireIndexerLeaderLock(): Promise<boolean> {
  const redis = getRedisClient();
  if (!redis) return true;

  const machineId = process.env.FLY_MACHINE_ID ?? `pid-${process.pid}`;
  try {
    const current = await redis.get(LEADER_LOCK_KEY);
    if (current === machineId) {
      await redis.expire(LEADER_LOCK_KEY, LEADER_LOCK_TTL_SECONDS);
      return true;
    }
    const acquired = await redis.set(LEADER_LOCK_KEY, machineId, "EX", LEADER_LOCK_TTL_SECONDS, "NX");
    return acquired === "OK";
  } catch (err) {
    logger.warn({ err }, "indexer leader lock check failed — polling anyway (Redis unavailable)");
    return true;
  }
}

async function pollOnce(): Promise<void> {
  if (!config.contractAddress) return;
  if (!(await acquireIndexerLeaderLock())) {
    logger.debug("not the indexer leader this tick — skipping poll");
    return;
  }

  let grantIds: string[];
  try {
    grantIds = await readContract<string[]>("list_grants");
  } catch (err) {
    if (err instanceof GenLayerRateLimitedError) {
      logger.debug("indexer skipped this tick — rate budget exhausted");
      return;
    }
    throw err;
  }

  const cachedStatuses = await loadCachedGrantStatuses(grantIds);

  for (const grantId of grantIds) {
    if (GRANT_TERMINAL_STATUSES.has(cachedStatuses.get(grantId) ?? "")) continue;
    await syncGrant(grantId);
  }
}

/** One query for all cached statuses instead of one row-lookup per grant. */
async function loadCachedGrantStatuses(grantIds: string[]): Promise<Map<string, string>> {
  if (grantIds.length === 0) return new Map();
  const { rows } = await pool.query<{ grant_id: string; status: string }>(
    `SELECT grant_id, status FROM grants WHERE contract_address = $1 AND grant_id = ANY($2)`,
    [config.contractAddress, grantIds]
  );
  return new Map(rows.map((r) => [r.grant_id, r.status]));
}

async function syncGrant(grantId: string): Promise<void> {
  let grant: any;
  try {
    grant = await readContract("get_grant", [grantId]);
  } catch (err) {
    if (err instanceof GenLayerRateLimitedError) return;
    logger.warn({ err, grantId }, "failed to sync grant");
    return;
  }

  await pool.query(
    `INSERT INTO grants (contract_address, grant_id, funder_address, grantee_address, title, total_reward_wei, status, updated_at)
     VALUES ($1, $2, $3, $4, $5, $6, $7, now())
     ON CONFLICT (contract_address, grant_id) DO UPDATE SET
       status = EXCLUDED.status, total_reward_wei = EXCLUDED.total_reward_wei, updated_at = now()`,
    [config.contractAddress, grant.grant_id, grant.funder, grant.grantee, grant.title, grant.total_reward_wei, grant.status]
  );

  const milestoneIds: string[] = grant.milestone_ids ?? [];
  const cachedMilestoneStatuses = await loadCachedMilestoneStatuses(milestoneIds);

  for (const milestoneId of milestoneIds) {
    if (MILESTONE_TERMINAL_STATUSES.has(cachedMilestoneStatuses.get(milestoneId) ?? "")) continue;
    await syncMilestone(grantId, milestoneId);
  }
}

async function loadCachedMilestoneStatuses(milestoneIds: string[]): Promise<Map<string, string>> {
  if (milestoneIds.length === 0) return new Map();
  const { rows } = await pool.query<{ milestone_id: string; status: string }>(
    `SELECT milestone_id, status FROM milestones WHERE contract_address = $1 AND milestone_id = ANY($2)`,
    [config.contractAddress, milestoneIds]
  );
  return new Map(rows.map((r) => [r.milestone_id, r.status]));
}

async function syncMilestone(grantId: string, milestoneId: string): Promise<void> {
  let m: any;
  try {
    m = await readContract("get_milestone", [milestoneId]);
  } catch (err) {
    if (err instanceof GenLayerRateLimitedError) return;
    logger.warn({ err, milestoneId }, "failed to sync milestone");
    return;
  }

  await pool.query(
    `INSERT INTO milestones (
       contract_address, milestone_id, grant_id, idx, title, reward_wei, status, challenge_window_seconds,
       verdict, recommended_payout_bps, active_challenge_id, updated_at
     ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, now())
     ON CONFLICT (contract_address, milestone_id) DO UPDATE SET
       status = EXCLUDED.status, verdict = EXCLUDED.verdict,
       recommended_payout_bps = EXCLUDED.recommended_payout_bps,
       active_challenge_id = EXCLUDED.active_challenge_id, updated_at = now()`,
    [
      config.contractAddress,
      m.milestone_id,
      grantId,
      m.index,
      m.title,
      m.reward_wei,
      m.status,
      m.challenge_window_seconds,
      m.verdict || null,
      m.recommended_payout_bps ?? null,
      m.active_challenge_id || null,
    ]
  );
}
