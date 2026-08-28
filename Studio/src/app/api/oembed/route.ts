import { NextResponse } from "next/server";
import { absoluteUrl, siteConfig } from "@/lib/site";

/**
 * Minimal oEmbed provider (https://oembed.com).
 *
 * OpenGraph already covers most previews, but Discord reads oEmbed for the
 * small provider/author line above an embed, and Notion, Iframely, Embedly
 * and WordPress prefer it when present. Serving it is a few lines and buys
 * a noticeably richer card in those clients.
 */

const OG_IMAGE = absoluteUrl("/opengraph-image");

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const format = searchParams.get("format") ?? "json";

  if (format !== "json") {
    // The spec requires 501 for a format the provider cannot produce.
    return new NextResponse("Only the json format is supported", { status: 501 });
  }

  const payload = {
    version: "1.0",
    type: "link",
    title: `${siteConfig.name} — ${siteConfig.tagline}`,
    description: siteConfig.shortDescription,
    author_name: siteConfig.name,
    author_url: siteConfig.url,
    provider_name: siteConfig.name,
    provider_url: siteConfig.url,
    thumbnail_url: OG_IMAGE,
    thumbnail_width: 1200,
    thumbnail_height: 630,
    cache_age: 86400,
  };

  return NextResponse.json(payload, {
    headers: {
      "Cache-Control": "public, max-age=86400, s-maxage=86400, stale-while-revalidate=604800",
      "Access-Control-Allow-Origin": "*",
    },
  });
}
