import type { Metadata } from "next";
import { Providers } from "./providers";
import "./globals.css";

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
