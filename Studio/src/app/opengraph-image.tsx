import { OG_CONTENT_TYPE, OG_SIZE, renderOgImage } from "@/lib/og";
import { siteConfig } from "@/lib/site";

export const alt = `${siteConfig.name} — ${siteConfig.tagline}`;
export const size = OG_SIZE;
export const contentType = OG_CONTENT_TYPE;

export default async function Image() {
  return renderOgImage({ title: "Build your AI crew without writing code." });
}
