import { Router } from "express";
import { pool } from "../db.js";

export const healthRouter = Router();

/**
 * Used by Fly.io's health checks to keep this service at true 24/7 uptime —
 * a failing health check triggers an automatic machine restart.
 */
healthRouter.get("/healthz", async (_req, res) => {
  try {
    await pool.query("SELECT 1");
    res.status(200).json({ status: "ok" });
  } catch {
    res.status(503).json({ status: "degraded", detail: "database unreachable" });
  }
});
