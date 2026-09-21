import { Router } from "express";
import { pool } from "../db.js";
import { readContract, GenLayerRateLimitedError } from "../genlayerClient.js";
import { assertContractConfigured, config } from "../config.js";
import { isSafePublicUrl } from "../ssrfGuard.js";
import { logger } from "../logger.js";

export const grantsRouter = Router();

/**
 * Fast reads from the Postgres index (populated by the event-indexer job,
 * see indexer.ts). These endpoints never determine milestone completion —
 * they only mirror what the contract has already settled.
 *
 * Every query is scoped to the currently configured contract_address.
 * grant_id/milestone_id are sequential counters the contract assigns fresh
 * on every new deployment, so they collide across deployments — scoping by
 * contract_address is what makes it safe for rows from a superseded
 * deployment to remain in the table (for audit/history) without ever being
 * served as if they belonged to the current one. See memory/MEMORY.md.
 */

grantsRouter.get("/", async (_req, res) => {
  const { rows } = await pool.query(
    `SELECT grant_id, funder_address, grantee_address, title, total_reward_wei, status, created_at
     FROM grants WHERE contract_address = $1 ORDER BY created_at DESC LIMIT 100`,
    [config.contractAddress]
  );
  res.json({ grants: rows });
});

grantsRouter.get("/:grantId", async (req, res) => {
  const { rows: grantRows } = await pool.query(
    `SELECT * FROM grants WHERE contract_address = $1 AND grant_id = $2`,
    [config.contractAddress, req.params.grantId]
  );
  if (grantRows.length === 0) {
    res.status(404).json({ error: "Grant not found" });
    return;
  }
  const { rows: milestoneRows } = await pool.query(
    `SELECT * FROM milestones WHERE contract_address = $1 AND grant_id = $2 ORDER BY idx ASC`,
    [config.contractAddress, req.params.grantId]
  );
  res.json({ grant: grantRows[0], milestones: milestoneRows });
});

/**
 * Live re-read straight from the contract (bypasses the Postgres cache).
 * Used sparingly by the frontend — e.g. right after a user submits a
 * transaction, to confirm the latest on-chain state before the indexer has
 * caught up. Subject to the shared GenLayer rate budget.
 */
grantsRouter.get("/:grantId/live", async (req, res) => {
  try {
    assertContractConfigured();
    const grant = await readContract("get_grant", [req.params.grantId]);
    res.json({ grant });
  } catch (err) {
    if (err instanceof GenLayerRateLimitedError) {
      res.status(429).json({ error: err.message });
      return;
    }
    logger.error({ err }, "live grant read failed");
    res.status(502).json({ error: "Could not reach GenLayer contract" });
  }
});

grantsRouter.post("/preview-url", (req, res) => {
  const url = String(req.body?.url ?? "");
  res.json({ safe: isSafePublicUrl(url) });
});
