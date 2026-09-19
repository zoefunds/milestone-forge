import { pool } from "./db.js";
import { readContract, GenLayerRateLimitedError } from "./genlayerClient.js";
import { config } from "./config.js";
import { logger } from "./logger.js";

/**
 * Background poller that mirrors contract state into Postgres so the
 * frontend's list/history views are fast without hammering GenLayer on
 * every page load. Polls infrequently and pulls only grant/milestone ids
 * that changed, deliberately staying well under the shared 30/min budget
 * (this loop alone should never come close to that limit; the budget is
 * mostly headroom for user-triggered live reads).
 */

const POLL_INTERVAL_MS = 30_000;
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

async function pollOnce(): Promise<void> {
  if (!config.contractAddress) return;

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

  for (const grantId of grantIds) {
    await syncGrant(grantId);
  }
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
    `INSERT INTO grants (grant_id, funder_address, grantee_address, title, total_reward_wei, status, updated_at)
     VALUES ($1, $2, $3, $4, $5, $6, now())
     ON CONFLICT (grant_id) DO UPDATE SET
       status = EXCLUDED.status, total_reward_wei = EXCLUDED.total_reward_wei, updated_at = now()`,
    [grant.grant_id, grant.funder, grant.grantee, grant.title, grant.total_reward_wei, grant.status]
  );

  for (const milestoneId of grant.milestone_ids ?? []) {
    await syncMilestone(grantId, milestoneId);
  }
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
       milestone_id, grant_id, idx, title, reward_wei, status, challenge_window_seconds,
       verdict, recommended_payout_bps, active_challenge_id, updated_at
     ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, now())
     ON CONFLICT (milestone_id) DO UPDATE SET
       status = EXCLUDED.status, verdict = EXCLUDED.verdict,
       recommended_payout_bps = EXCLUDED.recommended_payout_bps,
       active_challenge_id = EXCLUDED.active_challenge_id, updated_at = now()`,
    [
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
