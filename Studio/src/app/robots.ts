import type { MetadataRoute } from "next";
import { absoluteUrl } from "@/lib/site";

export default function robots(): MetadataRoute.Robots {
  return {
    rules: [
      {
        userAgent: "*",
        allow: ["/", "/api/oembed"],
        disallow: ["/api/", "/dashboard", "/flow"],
      },
      // Social-preview crawlers must never be rate-limited or blocked.
      {
        userAgent: [
          "Twitterbot",
          "facebookexternalhit",
          "Facebot",
          "LinkedInBot",
          "Slackbot",
          "Slackbot-LinkExpanding",
          "Discordbot",
          "WhatsApp",
          "TelegramBot",
          "Applebot",
          "redditbot",
          "Pinterestbot",
          "SkypeUriPreview",
          "vkShare",
          "Iframely",
          "Embedly",
        ],
        allow: "/",
      },
    ],
    sitemap: absoluteUrl("/sitemap.xml"),
    host: absoluteUrl("/").replace(/\/$/, ""),
  };
}
