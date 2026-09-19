import "dotenv/config";

function required(name: string, allowEmptyInDev = false): string {
  const value = process.env[name];
  if (!value) {
    if (process.env.NODE_ENV !== "production" && allowEmptyInDev) return "";
    throw new Error(`Missing required environment variable: ${name}`);
  }
  return value;
}

export const config = {
  port: Number(process.env.PORT ?? 8080),
  nodeEnv: process.env.NODE_ENV ?? "development",
  databaseUrl: required("DATABASE_URL"),
  genlayerRpcUrl: required("GENLAYER_RPC_URL"),
  genlayerChainId: Number(process.env.GENLAYER_CHAIN_ID ?? 61999),
  // Empty until the user deploys the contract themselves and provides it.
  contractAddress: process.env.MILESTONE_FORGE_CONTRACT_ADDRESS ?? "",
  redisUrl: process.env.REDIS_URL ?? "",
  sessionJwtSecret: required("SESSION_JWT_SECRET"),
  reownProjectId: process.env.REOWN_PROJECT_ID ?? "",
  frontendOrigin: process.env.FRONTEND_ORIGIN ?? "http://localhost:3000",
} as const;

export function assertContractConfigured(): void {
  if (!config.contractAddress) {
    throw new Error(
      "MILESTONE_FORGE_CONTRACT_ADDRESS is not set. Deploy the Intelligent Contract via GenLayer " +
        "Studio/CLI yourself, then set this env var — the backend never deploys or holds contract keys."
    );
  }
}
