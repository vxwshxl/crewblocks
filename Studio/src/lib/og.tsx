import { ImageResponse } from "next/og";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { siteConfig } from "@/lib/site";

export const OG_SIZE = { width: 1200, height: 630 } as const;
export const OG_CONTENT_TYPE = "image/png";

/**
 * Pull a static TTF out of the Google Fonts CSS API. Sending a plain
 * User-Agent makes Google serve truetype, which is what satori needs.
 * Any failure falls back to the built-in font so a build never breaks
 * on a flaky network.
 */
async function loadGoogleFont(family: string, weight: number): Promise<ArrayBuffer | null> {
  try {
    const css = await fetch(
      `https://fonts.googleapis.com/css2?family=${encodeURIComponent(family)}:wght@${weight}`,
      { headers: { "User-Agent": "Mozilla/5.0" } },
    ).then((res) => res.text());

    const url = css.match(/src: url\((https:\/\/[^)]+)\) format\('(?:truetype|opentype)'\)/)?.[1];
    if (!url) return null;

    const res = await fetch(url);
    if (!res.ok) return null;
    return await res.arrayBuffer();
  } catch {
    return null;
  }
}

let logoSrcCache: string | null = null;

function logoDataUri(): string {
  if (!logoSrcCache) {
    const logo = readFileSync(join(process.cwd(), "public", "logoCS.png"));
    logoSrcCache = `data:image/png;base64,${logo.toString("base64")}`;
  }
  return logoSrcCache;
}

export type OgImageOptions = {
  /** Big headline, 1–2 lines. */
  title: string;
  /** Supporting line under the headline. */
  subtitle?: string;
  /** Small pills along the bottom edge. */
  chips?: string[];
};

/**
 * The one place the social card is designed. Every route's
 * `opengraph-image` / `twitter-image` renders through here so previews
 * stay visually identical across Slack, X, iMessage, WhatsApp, Discord,
 * LinkedIn, Telegram and Google.
 */
export async function renderOgImage({
  title,
  subtitle = siteConfig.shortDescription,
  chips = ["Block editor", "Browser agent", "Any model"],
}: OgImageOptions) {
  const [bold, medium] = await Promise.all([
    loadGoogleFont("Host Grotesk", 800),
    loadGoogleFont("Host Grotesk", 500),
  ]);

  const fonts = [
    bold && { name: "Host Grotesk", data: bold, weight: 800 as const, style: "normal" as const },
    medium && { name: "Host Grotesk", data: medium, weight: 500 as const, style: "normal" as const },
  ].filter(Boolean) as NonNullable<ConstructorParameters<typeof ImageResponse>[1]>["fonts"];

  const fontFamily = fonts && fonts.length > 0 ? "Host Grotesk" : undefined;

  return new ImageResponse(
    (
      <div
        style={{
          width: "100%",
          height: "100%",
          display: "flex",
          flexDirection: "column",
          justifyContent: "space-between",
          backgroundColor: siteConfig.themeColor,
          fontFamily,
          position: "relative",
          padding: 64,
        }}
      >
        {/* Brand glow */}
        <div
          style={{
            position: "absolute",
            top: -280,
            right: -180,
            width: 760,
            height: 760,
            borderRadius: 9999,
            background: `radial-gradient(circle, ${siteConfig.brandColor}59 0%, ${siteConfig.brandColor}1A 45%, rgba(20,20,20,0) 70%)`,
            display: "flex",
          }}
        />
        <div
          style={{
            position: "absolute",
            bottom: -320,
            left: -220,
            width: 700,
            height: 700,
            borderRadius: 9999,
            background: `radial-gradient(circle, ${siteConfig.brandColor}33 0%, rgba(20,20,20,0) 68%)`,
            display: "flex",
          }}
        />

        {/* Mark + wordmark */}
        <div style={{ display: "flex", alignItems: "center", gap: 24 }}>
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={logoDataUri()} width={96} height={96} alt="" style={{ borderRadius: 24 }} />
          <div
            style={{
              display: "flex",
              fontSize: 44,
              fontWeight: 800,
              color: "#ffffff",
              letterSpacing: -1,
            }}
          >
            {siteConfig.name}
          </div>
        </div>

        {/* Headline */}
        <div style={{ display: "flex", flexDirection: "column", gap: 24, maxWidth: 960 }}>
          <div
            style={{
              display: "flex",
              fontSize: title.length > 42 ? 76 : 92,
              fontWeight: 800,
              color: "#ffffff",
              lineHeight: 1.05,
              letterSpacing: -3,
            }}
          >
            {title}
          </div>
          <div
            style={{
              display: "flex",
              fontSize: 32,
              fontWeight: 500,
              color: "#e3e3db",
              opacity: 0.72,
              lineHeight: 1.3,
            }}
          >
            {subtitle}
          </div>
        </div>

        {/* Chips + url */}
        <div
          style={{
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
            width: "100%",
          }}
        >
          <div style={{ display: "flex", gap: 14 }}>
            {chips.map((chip) => (
              <div
                key={chip}
                style={{
                  display: "flex",
                  fontSize: 24,
                  fontWeight: 500,
                  color: "#e3e3db",
                  padding: "12px 24px",
                  borderRadius: 9999,
                  border: "1px solid rgba(255,255,255,0.14)",
                  backgroundColor: "rgba(255,255,255,0.04)",
                }}
              >
                {chip}
              </div>
            ))}
          </div>
          <div
            style={{
              display: "flex",
              fontSize: 26,
              fontWeight: 800,
              color: siteConfig.brandColor,
            }}
          >
            {siteConfig.url.replace(/^https?:\/\//, "")}
          </div>
        </div>
      </div>
    ),
    { ...OG_SIZE, fonts },
  );
}
