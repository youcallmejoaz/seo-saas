import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: { default: "RankPilot", template: "%s · RankPilot" },
  description: "AI website generation and autonomous SEO management for agencies.",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body className="min-h-screen antialiased font-sans">{children}</body>
    </html>
  );
}
