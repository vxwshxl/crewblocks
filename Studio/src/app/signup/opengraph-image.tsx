import { OG_CONTENT_TYPE, OG_SIZE, renderOgImage } from "@/lib/og";
import { siteConfig } from "@/lib/site";

export const alt = `Create your ${siteConfig.name} account`;
export const size = OG_SIZE;
export const contentType = OG_CONTENT_TYPE;

export default async function Image() {
  return renderOgImage({
    title: "Your first agent is minutes away.",
    subtitle: "Create a free account and start building on the canvas. No code, no card.",
    chips: ["Free to start", "No credit card", "Chrome extension"],
  });
}
