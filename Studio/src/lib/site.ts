/**
 * Single source of truth for everything SEO / social-preview related.
 * Change the copy here and it propagates to <head>, the OG image, the
 * sitemap, the web manifest and the JSON-LD structured data.
 */

const VERCEL_URL = process.env.NEXT_PUBLIC_SITE_URL ?? process.env.VERCEL_PROJECT_PRODUCTION_URL;

export const siteConfig = {
  name: "CrewBlocks",
  /** Used as the `title.template` suffix, e.g. "Pricing — CrewBlocks" */
  shortName: "CrewBlocks",
  url: VERCEL_URL
    ? VERCEL_URL.startsWith("http")
      ? VERCEL_URL
      : `https://${VERCEL_URL}`
    : "https://crewblocks.vercel.app",
  tagline: "Build a browser agent out of blocks",
  description:
    "Build your AI crew without writing code. Stack blocks — a model, your instructions, the tools it can reach for, a memory — and the agent runs inside your browser, clicking, typing, searching and getting real work done.",
  /** Short form for og:description / twitter:description on the home page. */
  shortDescription:
    "Stack blocks into an agent. Run it inside your browser. No code required.",
  locale: "en_US",
  themeColor: "#141414",
  brandColor: "#FF66C4",
  twitter: "@crewblocks",
  keywords: [
    "AI agents",
    "AI agent builder",
    "autonomous agents",
    "no-code AI",
    "block based agents",
    "AI workflow builder",
    "no-code agent builder",
    "browser automation",
    "Chrome AI extension",
    "AI assistant",
    "multi-agent system",
    "AI crew",
    "block based agent builder",
    "LLM orchestration",
    "CrewBlocks",
  ],
} as const;

export type SiteConfig = typeof siteConfig;

/** Absolute URL helper — social scrapers refuse relative paths. */
export function absoluteUrl(path = "/"): string {
  return new URL(path, siteConfig.url).toString();
}
