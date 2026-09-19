import { createClient, createAccount } from "genlayer-js";
import { config } from "./config.js";
import { tryAcquireGenLayerSlot } from "./genlayerRateLimiter.js";
import { logger } from "./logger.js";

/**
 * Thin wrapper around genlayer-js. The backend NEVER holds a private key
 * capable of writing to the contract on a user's behalf — writes are always
 * signed client-side in the user's own wallet via Reown AppKit and submitted
 * from the frontend. This client is read-only: it indexes/mirrors contract
 * state into Postgres and serves cached reads, and it is the only thing
 * subject to GenLayer's 30 req/min budget on this backend.
 */

const readOnlyAccount = createAccount(); // ephemeral, used only for unauthenticated view calls
export const genlayerClient = createClient({
  chain: {
    id: config.genlayerChainId,
    rpcUrls: { default: { http: [config.genlayerRpcUrl] } },
  } as any,
  account: readOnlyAccount,
});

export class GenLayerRateLimitedError extends Error {
  constructor() {
    super("GenLayer request budget exhausted for this minute — retry shortly");
    this.name = "GenLayerRateLimitedError";
  }
}

/**
 * Every read against the deployed contract MUST go through this function so
 * the shared 30/min budget is respected regardless of which route or
 * background indexer job triggered it.
 */
export async function readContract<T>(functionName: string, args: unknown[] = []): Promise<T> {
  const allowed = await tryAcquireGenLayerSlot();
  if (!allowed) {
    logger.warn({ functionName }, "GenLayer rate budget exhausted, rejecting read");
    throw new GenLayerRateLimitedError();
  }
  return genlayerClient.readContract({
    address: config.contractAddress as `0x${string}`,
    functionName,
    args,
  }) as Promise<T>;
}
