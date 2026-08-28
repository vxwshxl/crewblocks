import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Dashboard",
  description: "Your CrewBlocks workspace — chatflows, squads, API keys and settings.",
  alternates: { canonical: '/dashboard' },
  robots: { index: false, follow: false, nocache: true, googleBot: { index: false, follow: false } },
};

export default function DashboardLayout({ children }: { children: React.ReactNode }) {
  return children;
}
