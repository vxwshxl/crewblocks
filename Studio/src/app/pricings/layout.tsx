import type { Metadata } from "next";
import { siteConfig } from "@/lib/site";

export const metadata: Metadata = {
  title: "Pricing",
  description:
    "CrewBlocks pricing — start free, then scale to Pro, Ultra or Squad plans for API access, advanced control rules and team collaboration.",
  alternates: { canonical: "/pricings" },
  openGraph: {
    type: "website",
    url: "/pricings",
    siteName: siteConfig.name,
    title: `Pricing — ${siteConfig.name}`,
    description:
      "Start free. Upgrade for API access, advanced control rules and team collaboration.",
    locale: siteConfig.locale,
  },
  twitter: {
    card: "summary_large_image",
    title: `Pricing — ${siteConfig.name}`,
    description:
      "Start free. Upgrade for API access, advanced control rules and team collaboration.",
    site: siteConfig.twitter,
    creator: siteConfig.twitter,
  },
};

export default function PricingsLayout({ children }: { children: React.ReactNode }) {
  return children;
}
