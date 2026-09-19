import { Router } from "express";
import { z } from "zod";
import { issueNonce, verifySiweAndIssueSession, requireSession } from "../auth.js";
import type { Request } from "express";
import type { SessionPayload } from "../auth.js";

export const authRouter = Router();

authRouter.get("/nonce", (_req, res) => {
  res.json({ nonce: issueNonce() });
});

const verifySchema = z.object({
  message: z.string().min(1),
  signature: z.string().min(1),
});

authRouter.post("/verify", async (req, res) => {
  const parsed = verifySchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: "Invalid request body" });
    return;
  }
  try {
    const { token, address } = await verifySiweAndIssueSession(parsed.data.message, parsed.data.signature);
    res.cookie("session", token, {
      httpOnly: true,
      secure: true,
      sameSite: "lax",
      maxAge: 12 * 60 * 60 * 1000,
    });
    res.json({ address });
  } catch (err) {
    res.status(401).json({ error: err instanceof Error ? err.message : "Verification failed" });
  }
});

authRouter.post("/logout", (_req, res) => {
  res.clearCookie("session");
  res.status(204).end();
});

authRouter.get("/session", requireSession, (req, res) => {
  const session = (req as Request & { session?: SessionPayload }).session;
  res.json({ address: session?.address });
});
