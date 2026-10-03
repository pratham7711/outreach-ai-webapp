import type { MetadataRoute } from "next";
import { BRAND } from "@/lib/brand";

/** Crawlers may read the public site; the app, the creator portal and every
    tokenised link stay out of search results. */
export default function robots(): MetadataRoute.Robots {
  return {
    rules: {
      userAgent: "*",
      allow: "/",
      disallow: ["/api/", "/portal/", "/connect/", "/invite/", "/l/", "/share/"],
    },
    sitemap: `${BRAND.url.replace(/\/+$/, "")}/sitemap.xml`,
  };
}
