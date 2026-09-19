import type { Metadata } from "next";
import { Providers } from "./providers";
import "./globals.css";

// This entire app is a wallet-connected dApp — every page depends on the
// Reown AppKit client, which only initializes in the browser. Static
// prerendering at build time would fail (no window/wallet on the server),
// so every route renders dynamically at request time instead.
export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "Milestone Forge",
  description: "Fund the milestone, not the promise. Let the public record decide when it's actually done.",
  icons: {
    icon: "/icon.svg",
    shortcut: "/icon.svg",
    apple: "/icon.svg",
  },
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className="dark">
      <body className="font-body min-h-screen antialiased">
        <Providers>{children}</Providers>
      </body>
    </html>
  );
}
