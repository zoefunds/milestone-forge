import Link from "next/link";
import Image from "next/image";
import { ConnectWalletButton } from "@/components/ConnectWalletButton";

export default function LandingPage() {
  return (
    <main className="min-h-screen bg-background">
      <header className="fixed top-0 w-full z-50 bg-surface/90 backdrop-blur-xl">
        <div className="h-[2px] w-full bg-gradient-to-r from-transparent via-primary to-transparent opacity-80" />
        <div className="h-20 w-full px-6 flex items-center justify-between max-w-7xl mx-auto">
          <div className="flex items-center gap-2">
            <Image src="/icon.svg" alt="Milestone Forge" width={32} height={32} />
            <span className="font-headline font-bold text-lg">
              Milestone<span className="text-primary">Forge</span>
            </span>
          </div>
          <nav className="hidden lg:flex items-center gap-1 text-sm">
            <Link href="/explore" className="px-3 py-2 text-on-surface-variant hover:text-on-surface rounded-lg">
              Explore Grants
            </Link>
            <Link href="/create" className="px-3 py-2 text-on-surface-variant hover:text-on-surface rounded-lg">
              Create Grant
            </Link>
            <Link href="/claim" className="px-3 py-2 text-on-surface-variant hover:text-on-surface rounded-lg">
              Claim Milestone
            </Link>
            <Link href="/validators" className="px-3 py-2 text-on-surface-variant hover:text-on-surface rounded-lg">
              Validator Consensus
            </Link>
            <Link href="/challenges" className="px-3 py-2 text-on-surface-variant hover:text-on-surface rounded-lg">
              Challenge Hub
            </Link>
            <Link href="/docs" className="px-3 py-2 text-on-surface-variant hover:text-on-surface rounded-lg">
              Docs
            </Link>
          </nav>
          <ConnectWalletButton />
        </div>
      </header>

      <section className="relative pt-40 pb-24 px-6 text-center overflow-hidden">
        <div className="absolute top-0 left-1/2 -translate-x-1/2 w-[720px] h-[340px] bg-primary/10 blur-3xl pointer-events-none" />
        <div className="relative max-w-4xl mx-auto flex flex-col items-center gap-6">
          <span className="inline-flex items-center gap-2 px-3.5 py-1.5 rounded-full bg-surface-container-high text-xs uppercase tracking-widest text-secondary">
            <span className="h-2 w-2 rounded-full bg-secondary animate-pulse" />
            Powered by GenLayer Intelligent Contracts · StudioNet
          </span>
          <h1 className="font-headline text-4xl md:text-5xl font-bold tracking-tight leading-tight">
            Fund the milestone,{" "}
            <span className="text-transparent bg-clip-text bg-gradient-to-r from-primary to-secondary">
              not the promise.
            </span>
          </h1>
          <p className="text-on-surface-variant max-w-2xl">
            An onchain grant and milestone-release protocol where public records, independent
            multi-validator inspection, and cryptographic consensus decide when builders get paid.
          </p>
          <div className="flex flex-wrap items-center justify-center gap-4 pt-2">
            <Link
              href="/explore"
              className="px-6 py-3 rounded-lg bg-primary text-on-primary font-semibold hover:opacity-90 transition-opacity"
            >
              Explore Active Grants
            </Link>
            <Link
              href="/create"
              className="px-6 py-3 rounded-lg bg-surface-container-high text-on-surface font-semibold hover:bg-surface-bright transition-colors"
            >
              Create Autonomous Grant
            </Link>
          </div>
        </div>
      </section>

      <section className="px-6 pb-24 max-w-5xl mx-auto">
        <div className="grid grid-cols-1 md:grid-cols-5 gap-4 rounded-xl bg-surface-container-low p-6">
          {[
            { label: "Genesis", detail: "Locked, machine-checkable criteria" },
            { label: "Snapshot", detail: "Artifact pinned before evaluation" },
            { label: "Inspection", detail: "Independent multi-validator fetch" },
            { label: "Consensus", detail: "Equivalence on structured result" },
            { label: "Release", detail: "Deterministic, challengeable, pull-based" },
          ].map((step, i) => (
            <div key={step.label} className="flex flex-col gap-2 p-4 rounded-lg bg-surface-container">
              <span className="font-code text-primary font-bold">{String(i + 1).padStart(2, "0")}</span>
              <span className="font-headline font-semibold text-sm">{step.label}</span>
              <span className="text-xs text-on-surface-variant">{step.detail}</span>
            </div>
          ))}
        </div>
      </section>

      <footer className="border-t border-surface-container-high py-8 px-6 text-center text-xs text-outline">
        © 2026 Milestone Forge Protocol. Autonomous cryptographic escrows powered by GenLayer.
      </footer>
    </main>
  );
}
