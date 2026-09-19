import { SiweMessage } from "siwe";
import jwt from "jsonwebtoken";
import crypto from "node:crypto";
import type { Request, Response, NextFunction } from "express";
import { config } from "./config.js";

/**
 * Wallet-based (SIWE) authentication. No passwords, no custodial keys, no
 * private key material ever touches this backend. Flow:
 *   1. GET /auth/nonce           -> issues a one-time nonce (in-memory, short TTL)
 *   2. POST /auth/verify {message, signature} -> verifies the signed SIWE
 *      message against the nonce, then issues a short-lived JWT session
 *      cookie identifying the wallet address. That JWT is the only session
 *      artifact — it authorizes API calls, never contract writes (those are
 *      signed by the wallet itself in the browser).
 */

const NONCE_TTL_MS = 5 * 60_000;
const nonces = new Map<string, number>();

setInterval(() => {
  const now = Date.now();
  for (const [nonce, issuedAt] of nonces) {
    if (now - issuedAt > NONCE_TTL_MS) nonces.delete(nonce);
  }
}, 60_000).unref();

export function issueNonce(): string {
  const nonce = crypto.randomBytes(16).toString("hex");
  nonces.set(nonce, Date.now());
  return nonce;
}

export interface SessionPayload {
  address: string;
}

export async function verifySiweAndIssueSession(
  message: string,
  signature: string
): Promise<{ token: string; address: string }> {
  const siweMessage = new SiweMessage(message);

  if (!nonces.has(siweMessage.nonce)) {
    throw new Error("Unknown or expired nonce");
  }
  nonces.delete(siweMessage.nonce); // one-time use

  const result = await siweMessage.verify({ signature });
  if (!result.success) {
    throw new Error("Signature verification failed");
  }

  const address = siweMessage.address.toLowerCase();
  const token = jwt.sign({ address } satisfies SessionPayload, config.sessionJwtSecret, {
    expiresIn: "12h",
  });
  return { token, address };
}

export function requireSession(req: Request, res: Response, next: NextFunction): void {
  const token = req.cookies?.session ?? req.headers.authorization?.replace(/^Bearer\s+/i, "");
  if (!token) {
    res.status(401).json({ error: "Not authenticated" });
    return;
  }
  try {
    const payload = jwt.verify(token, config.sessionJwtSecret) as SessionPayload;
    (req as Request & { session?: SessionPayload }).session = payload;
    next();
  } catch {
    res.status(401).json({ error: "Invalid or expired session" });
  }
}
