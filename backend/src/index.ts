import express from "express";
import cors from "cors";
import helmet from "helmet";
import cookieParser from "cookie-parser";
import pinoHttp from "pino-http";
import { config } from "./config.js";
import { logger } from "./logger.js";
import { httpRateLimit } from "./rateLimiter.js";
import { authRouter } from "./routes/auth.js";
import { grantsRouter } from "./routes/grants.js";
import { healthRouter } from "./routes/health.js";
import { startIndexer } from "./indexer.js";
import { closeRateLimiterRedis } from "./genlayerRateLimiter.js";
import { pool } from "./db.js";

const app = express();

app.use(helmet());
app.use(
  cors({
    origin: config.frontendOrigin,
    credentials: true,
  })
);
app.use(express.json({ limit: "256kb" }));
app.use(cookieParser());
app.use(pinoHttp({ logger }));

// Ordinary per-IP HTTP rate limiting (in-memory — see rateLimiter.ts).
app.use(httpRateLimit(120));

app.use("/health", healthRouter);
app.use("/auth", authRouter);
app.use("/grants", grantsRouter);

app.use((err: unknown, _req: express.Request, res: express.Response, _next: express.NextFunction) => {
  logger.error({ err }, "unhandled error");
  res.status(500).json({ error: "Internal server error" });
});

const server = app.listen(config.port, () => {
  logger.info(`Milestone Forge backend listening on :${config.port}`);
  startIndexer();
});

// Graceful shutdown so Fly.io machine restarts/deploys don't drop
// in-flight requests — part of the "must never die" 24/7 requirement.
async function shutdown(signal: string) {
  logger.info(`Received ${signal}, shutting down gracefully`);
  server.close(async () => {
    await closeRateLimiterRedis();
    await pool.end();
    process.exit(0);
  });
  setTimeout(() => process.exit(1), 10_000).unref();
}

process.on("SIGTERM", () => void shutdown("SIGTERM"));
process.on("SIGINT", () => void shutdown("SIGINT"));
process.on("unhandledRejection", (err) => logger.error({ err }, "unhandledRejection"));
process.on("uncaughtException", (err) => logger.error({ err }, "uncaughtException"));
