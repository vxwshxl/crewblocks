import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Log in",
  description: "Log in to your CrewBlocks dashboard and run your agent crew.",
  alternates: { canonical: "/login" },
  // An auth screen has nothing to rank for, but it should still preview
  // nicely when someone shares the link.
  robots: { index: false, follow: true },
};

export default function LoginLayout({ children }: { children: React.ReactNode }) {
  return children;
}
