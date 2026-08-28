import { absoluteUrl, siteConfig } from "@/lib/site";

/**
 * Schema.org JSON-LD. Google, Bing and a number of link-preview services
 * read this in addition to the OpenGraph tags — it is what powers rich
 * results (sitelinks, app cards, the knowledge panel logo).
 */
function JsonLd({ id, data }: { id: string; data: Record<string, unknown> }) {
  return (
    <script
      id={id}
      type="application/ld+json"
      // Structured data is static and author-controlled.
      dangerouslySetInnerHTML={{ __html: JSON.stringify(data).replace(/</g, "\\u003c") }}
    />
  );
}

export function OrganizationJsonLd() {
  return (
    <JsonLd
      id="ld-organization"
      data={{
        "@context": "https://schema.org",
        "@type": "Organization",
        "@id": absoluteUrl("/#organization"),
        name: siteConfig.name,
        url: siteConfig.url,
        logo: {
          "@type": "ImageObject",
          url: absoluteUrl("/icon-512.png"),
          width: 512,
          height: 512,
        },
        description: siteConfig.description,
        sameAs: [] as string[],
      }}
    />
  );
}

export function WebSiteJsonLd() {
  return (
    <JsonLd
      id="ld-website"
      data={{
        "@context": "https://schema.org",
        "@type": "WebSite",
        "@id": absoluteUrl("/#website"),
        url: siteConfig.url,
        name: siteConfig.name,
        description: siteConfig.description,
        inLanguage: "en",
        publisher: { "@id": absoluteUrl("/#organization") },
      }}
    />
  );
}

export function SoftwareApplicationJsonLd() {
  return (
    <JsonLd
      id="ld-software-application"
      data={{
        "@context": "https://schema.org",
        "@type": "SoftwareApplication",
        "@id": absoluteUrl("/#app"),
        name: siteConfig.name,
        url: siteConfig.url,
        applicationCategory: "BusinessApplication",
        applicationSubCategory: "AI Agent Builder",
        operatingSystem: "Web, Chrome",
        description: siteConfig.description,
        image: absoluteUrl("/opengraph-image"),
        screenshot: absoluteUrl("/opengraph-image"),
        featureList: [
          "Block-based agent builder",
          "Configurable agent role, personality and system prompt",
          "Model, instruction, tool, memory and condition blocks",
          "Chrome side-panel agent that acts on real web pages",
          "Tool library: web search, Gmail, shopping, HTTP, code interpreter",
        ],
        offers: {
          "@type": "Offer",
          price: "0",
          priceCurrency: "INR",
          availability: "https://schema.org/InStock",
          url: absoluteUrl("/pricings"),
        },
        publisher: { "@id": absoluteUrl("/#organization") },
      }}
    />
  );
}

export function BreadcrumbJsonLd({
  items,
}: {
  items: { name: string; path: string }[];
}) {
  return (
    <JsonLd
      id="ld-breadcrumb"
      data={{
        "@context": "https://schema.org",
        "@type": "BreadcrumbList",
        itemListElement: items.map((item, index) => ({
          "@type": "ListItem",
          position: index + 1,
          name: item.name,
          item: absoluteUrl(item.path),
        })),
      }}
    />
  );
}
