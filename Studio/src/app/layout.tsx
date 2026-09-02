import type { Metadata, Viewport } from "next";
import { Inter } from "next/font/google";
import "./globals.css";
import CookieConsent from '@/components/CookieConsent';
import { absoluteUrl, siteConfig } from "@/lib/site";
import {
  OrganizationJsonLd,
  SoftwareApplicationJsonLd,
  WebSiteJsonLd,
} from "@/components/StructuredData";

const inter = Inter({
  variable: "--font-sans",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  // Every relative URL below (and in every child page) resolves against this.
  // Without it, social scrapers get relative og:image values and show nothing.
  metadataBase: new URL(siteConfig.url),

  title: {
    default: `${siteConfig.name} — ${siteConfig.tagline}`,
    template: `%s — ${siteConfig.name}`,
  },
  description: siteConfig.description,
  keywords: [...siteConfig.keywords],
  applicationName: siteConfig.name,
  authors: [{ name: siteConfig.name, url: siteConfig.url }],
  creator: siteConfig.name,
  publisher: siteConfig.name,
  category: "technology",
  generator: "Next.js",
  referrer: "origin-when-cross-origin",
  formatDetection: { telephone: false, email: false, address: false },

  alternates: {
    canonical: "/",
    languages: { "en-US": "/", "x-default": "/" },
  },

  manifest: "/manifest.webmanifest",

  // og:image / twitter:image are supplied by app/opengraph-image.tsx and
  // app/twitter-image.tsx, including width, height, type and alt.
  openGraph: {
    type: "website",
    url: "/",
    siteName: siteConfig.name,
    title: `${siteConfig.name} — ${siteConfig.tagline}`,
    description: siteConfig.shortDescription,
    locale: siteConfig.locale,
    countryName: "India",
  },

  twitter: {
    card: "summary_large_image",
    title: `${siteConfig.name} — ${siteConfig.tagline}`,
    description: siteConfig.shortDescription,
    site: siteConfig.twitter,
    creator: siteConfig.twitter,
  },

  appleWebApp: {
    capable: true,
    title: siteConfig.name,
    statusBarStyle: "black-translucent",
  },

  robots: {
    index: true,
    follow: true,
    nocache: false,
    googleBot: {
      index: true,
      follow: true,
      // Lets Google show the full-size OG image in search results.
      "max-image-preview": "large",
      "max-snippet": -1,
      "max-video-preview": -1,
    },
  },

  other: {
    // Windows tiles
    "msapplication-TileColor": siteConfig.themeColor,
    "msapplication-TileImage": absoluteUrl("/icon-192.png"),
    "msapplication-config": "none",
    // Extra rows on the Twitter/X card
    "twitter:label1": "Built with",
    "twitter:data1": "A stack of blocks",
    "twitter:label2": "Runs in",
    "twitter:data2": "Your browser",
  },
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  viewportFit: "cover",
  colorScheme: "dark",
  themeColor: [
    { media: "(prefers-color-scheme: light)", color: siteConfig.themeColor },
    { media: "(prefers-color-scheme: dark)", color: siteConfig.themeColor },
  ],
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en" className="dark" suppressHydrationWarning>
      <head>
        {/* Speeds up the Google Fonts handshake the landing CSS triggers. */}
        <link rel="preconnect" href="https://fonts.googleapis.com" />
        <link rel="preconnect" href="https://fonts.gstatic.com" crossOrigin="" />
        <link
          rel="alternate"
          type="application/json+oembed"
          href={absoluteUrl(`/api/oembed?url=${encodeURIComponent(siteConfig.url)}&format=json`)}
          title={siteConfig.name}
        />
        <OrganizationJsonLd />
        <WebSiteJsonLd />
        <SoftwareApplicationJsonLd />
      </head>
      <body className={`${inter.variable} font-sans antialiased bg-background text-foreground`} suppressHydrationWarning>
        {children}
        <CookieConsent />
      </body>
    </html>
  );
}
