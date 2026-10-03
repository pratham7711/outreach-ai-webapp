import type { MetadataRoute } from "next";
import { BRAND } from "@/lib/brand";

/** The pages anyone can open signed out, which platform reviewers start from. */
const SITEMAP_PATHS = ["/", "/explore", "/about", "/privacy", "/terms", "/data-deletion"] as const;

export default function sitemap(): MetadataRoute.Sitemap {
  const base = BRAND.url.replace(/\/+$/, "");
  return SITEMAP_PATHS.map((path) => ({ url: path === "/" ? `${base}/` : `${base}${path}` }));
}
