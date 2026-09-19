import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { pool } from "../db.js";
import { logger } from "../logger.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

async function main() {
  const sql = fs.readFileSync(path.join(__dirname, "schema.sql"), "utf-8");
  await pool.query(sql);
  logger.info("Migration applied successfully");
  await pool.end();
}

main().catch((err) => {
  logger.error({ err }, "Migration failed");
  process.exit(1);
});
