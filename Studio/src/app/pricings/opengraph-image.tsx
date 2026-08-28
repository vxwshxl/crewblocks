import { OG_CONTENT_TYPE, OG_SIZE, renderOgImage } from "@/lib/og";
import { siteConfig } from "@/lib/site";

export const alt = `Pricing — ${siteConfig.name}`;
export const size = OG_SIZE;
export const contentType = OG_CONTENT_TYPE;

export default async function Image() {
  return renderOgImage({
    title: "Simple pricing for your AI crew.",
    subtitle: "Start free. Upgrade when your agents start earning their keep.",
    chips: ["Free tier", "Pro from ₹299/mo", "Squad plans"],
  });
}
