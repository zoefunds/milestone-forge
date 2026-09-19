import Link from "next/link";
import Image from "next/image";
import { ReactNode } from "react";
import { ConnectWalletButton } from "./ConnectWalletButton";

const NAV_LINKS = [
  { href: "/explore", label: "Explore Grants" },
  { href: "/create", label: "Create Grant" },
  { href: "/claim", label: "Claim Milestone" },
  { href: "/validators", label: "Validator Consensus" },
  { href: "/challenges", label: "Challenge Hub" },
  { href: "/history", label: "History" },
  { href: "/docs", label: "Docs" },
];

export function AppShell({ children, active }: { children: ReactNode; active?: string }) {
  return (
    <div className="min-h-screen bg-background flex flex-col">
      <header className="fixed top-0 w-full z-50 bg-surface/90 backdrop-blur-xl">
        <div className="h-[2px] w-full bg-gradient-to-r from-transparent via-primary to-transparent opacity-80" />
        <div className="h-20 w-full px-6 flex items-center justify-between max-w-7xl mx-auto gap-4">
          <Link href="/" className="flex items-center gap-2 shrink-0">
            <Image src="/icon.svg" alt="Milestone Forge" width={32} height={32} />
            <span className="font-headline font-bold text-lg hidden sm:inline-block">
              Milestone<span className="text-primary">Forge</span>
            </span>
          </Link>
          <nav className="hidden lg:flex items-center gap-1 text-sm overflow-x-auto">
            {NAV_LINKS.map((link) => (
              <Link
                key={link.href}
                href={link.href}
                className={`px-3 py-2 rounded-lg transition-colors whitespace-nowrap ${
                  active === link.href
                    ? "bg-primary-container/20 text-primary font-medium"
                    : "text-on-surface-variant hover:text-on-surface hover:bg-surface-container-high"
                }`}
              >
                {link.label}
              </Link>
            ))}
          </nav>
          <ConnectWalletButton />
        </div>
      </header>
      <main className="flex-1 pt-24 px-6 max-w-7xl mx-auto w-full pb-16">{children}</main>
      <footer className="border-t border-surface-container-high py-6 px-6 text-center text-xs text-outline">
        © 2026 Milestone Forge Protocol. Autonomous cryptographic escrows powered by GenLayer.{" "}
        <a
          className="text-primary hover:underline"
          href="https://studio.genlayer.com"
          target="_blank"
          rel="noreferrer"
        >
          Contract: {process.env.NEXT_PUBLIC_MILESTONE_FORGE_CONTRACT_ADDRESS?.slice(0, 10)}...
        </a>
      </footer>
    </div>
  );
}
