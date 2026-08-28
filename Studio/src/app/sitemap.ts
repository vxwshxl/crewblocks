import type { MetadataRoute } from "next";
import { absoluteUrl } from "@/lib/site";

type Entry = {
  path: string;
  changeFrequency: NonNullable<MetadataRoute.Sitemap[number]["changeFrequency"]>;
  priority: number;
};

const routes: Entry[] = [
  { path: "/", changeFrequency: "weekly", priority: 1 },
  { path: "/pricings", changeFrequency: "weekly", priority: 0.9 },
  { path: "/signup", changeFrequency: "monthly", priority: 0.8 },
  { path: "/privacy", changeFrequency: "yearly", priority: 0.3 },
  { path: "/terms", changeFrequency: "yearly", priority: 0.3 },
];

export default function sitemap(): MetadataRoute.Sitemap {
  const lastModified = new Date();

  return routes.map(({ path, changeFrequency, priority }) => ({
    url: absoluteUrl(path),
    lastModified,
    changeFrequency,
    priority,
  }));
}
