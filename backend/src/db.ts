import pg from "pg";
import { config } from "./config.js";

/**
 * Postgres pool. This database is a READ CACHE / INDEXER only — it mirrors
 * events emitted by the Intelligent Contract for fast UI reads (grant lists,
 * history, search). It is never the source of truth for escrow balances or
 * milestone verdicts; those are always re-read from the contract at the
 * moment of any action that matters (claim, release, challenge).
 */
export const pool = new pg.Pool({
  connectionString: config.databaseUrl,
  max: 10,
  idleTimeoutMillis: 30_000,
});

export async function withTransaction<T>(fn: (client: pg.PoolClient) => Promise<T>): Promise<T> {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const result = await fn(client);
    await client.query("COMMIT");
    return result;
  } catch (err) {
    await client.query("ROLLBACK");
    throw err;
  } finally {
    client.release();
  }
}
