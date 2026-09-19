import { WagmiAdapter } from "@reown/appkit-adapter-wagmi";
import { createAppKit } from "@reown/appkit/react";
import { cookieStorage, createStorage } from "wagmi";

/**
 * Reown AppKit wiring for wallet-based (SIWE) authentication.
 *
 * Users connect MetaMask/Rainbow/Zerion/etc through Reown's AppKit modal,
 * then the app requests a SIWE nonce from the backend, has the wallet sign
 * the SIWE message, and posts it back for verification — connecting a
 * wallet by itself is never treated as proof of authentication.
 *
 * GenLayer StudioNet is registered here as a custom EVM-compatible chain so
 * AppKit/wagmi can target it directly for reads and (client-signed) writes.
 */

const projectId = process.env.NEXT_PUBLIC_REOWN_PROJECT_ID ?? "";
if (!projectId && typeof window !== "undefined") {
  // eslint-disable-next-line no-console
  console.warn("NEXT_PUBLIC_REOWN_PROJECT_ID is not set — wallet connect will not function.");
}

export const genLayerStudioNet = {
  id: Number(process.env.NEXT_PUBLIC_GENLAYER_CHAIN_ID ?? 61999),
  name: "GenLayer StudioNet",
  nativeCurrency: { name: "GEN", symbol: "GEN", decimals: 18 },
  rpcUrls: {
    default: { http: [process.env.NEXT_PUBLIC_API_BASE_URL ? `${process.env.NEXT_PUBLIC_API_BASE_URL}/rpc` : "https://studio.genlayer.com/api"] },
  },
  blockExplorers: {
    default: { name: "GenLayer Explorer", url: "https://studio.genlayer.com" },
  },
} as const;

export const wagmiAdapter = new WagmiAdapter({
  storage: createStorage({ storage: cookieStorage }),
  ssr: true,
  projectId,
  networks: [genLayerStudioNet as any],
});

// createAppKit() must be called unconditionally at module scope, including
// during SSR — the `useAppKit()` hook used by ConnectWalletButton runs on
// every server render (Next.js renders "use client" components on the
// server for the initial HTML too), and throws "Please call createAppKit
// before using useAppKit" if this registration hasn't happened yet. Only
// the actual modal UI needs a real `window`; createAppKit()'s config
// registration itself is SSR-safe by design (this matches Reown's own
// Next.js App Router integration pattern).
export const appKit = createAppKit({
  adapters: [wagmiAdapter],
  networks: [genLayerStudioNet as any],
  projectId,
  metadata: {
    name: "Milestone Forge",
    description: "Fund the milestone, not the promise.",
    url: typeof window !== "undefined" ? window.location.origin : "https://milestone-forge.vercel.app",
    icons: ["/icon.svg"],
  },
  features: {
    analytics: false,
    email: false,
    socials: false,
  },
  themeMode: "dark",
  themeVariables: {
    "--w3m-accent": "#4cd7f6",
  },
});

export const wagmiConfig = wagmiAdapter.wagmiConfig;
