import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Block editor",
  description: "Assemble an agent from blocks.",
  alternates: { canonical: '/agent' },
  robots: { index: false, follow: false, nocache: true, googleBot: { index: false, follow: false } },
};

export default function AgentLayout({ children }: { children: React.ReactNode }) {
  return children;
}
