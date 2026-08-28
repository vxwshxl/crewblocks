import type { Metadata } from "next";
import { siteConfig } from "@/lib/site";

export const metadata: Metadata = {
  title: "Create your account",
  description:
    "Create a free CrewBlocks account and build your first autonomous AI agent in minutes — no credit card, no code.",
  alternates: { canonical: "/signup" },
  openGraph: {
    type: "website",
    url: "/signup",
    siteName: siteConfig.name,
    title: `Create your ${siteConfig.name} account`,
    description: "Build your first autonomous AI agent in minutes. Free to start.",
    locale: siteConfig.locale,
  },
  twitter: {
    card: "summary_large_image",
    title: `Create your ${siteConfig.name} account`,
    description: "Build your first autonomous AI agent in minutes. Free to start.",
    site: siteConfig.twitter,
    creator: siteConfig.twitter,
  },
};

export default function SignupLayout({ children }: { children: React.ReactNode }) {
  return children;
}
