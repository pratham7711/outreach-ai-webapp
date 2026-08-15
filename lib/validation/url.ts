import { z } from "zod";

// Zod's bare .url() accepts ANY parseable scheme — including `javascript:` and
// `data:text/html,...`. Stored values reach <a href> / <img src> sinks, so a
// hostile URL from a lower-trust actor becomes stored XSS. Every URL crossing a
// trust boundary must use these instead of z.string().url().
export function isHttpUrl(value: string): boolean {
  return /^https?:\/\//i.test(value.trim());
}

export const httpUrl = () =>
  z.string().url().refine(isHttpUrl, "Must be an http(s) URL");

export const httpUrlMax = (max: number) =>
  z.string().url().max(max).refine(isHttpUrl, "Must be an http(s) URL");
