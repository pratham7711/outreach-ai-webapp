/**
 * Ways to reach a creator, taken from text they published themselves: an
 * Instagram bio and website, or a YouTube channel description. Every route
 * carries the exact words it came from, so a reader can check it against the
 * profile; nothing is guessed, and nothing is stored.
 */
export type ContactRoute =
  | { kind: "email"; value: string; quote: string }
  | { kind: "link"; value: string; quote: string }
  | { kind: "whatsapp"; value: string; quote: string }
  | { kind: "dm"; value: string; quote: string };

const EMAIL = /[a-z0-9._%+-]+@[a-z0-9.-]+\.[a-z]{2,}/gi;
/* "name [at] gmail [dot] com", "name(at)gmail.com", "name at gmail dot com" */
const OBFUSCATED_EMAIL =
  /([a-z0-9._%+-]+)\s*(?:\[at\]|\(at\)|\{at\}|\sat\s)\s*([a-z0-9-]+)\s*(?:\[dot\]|\(dot\)|\{dot\}|\sdot\s|\.)\s*([a-z]{2,})(?:\s*(?:\[dot\]|\(dot\)|\sdot\s|\.)\s*([a-z]{2,}))?/gi;
const URL_RE = /\b(?:https?:\/\/)?(?:www\.)?[a-z0-9-]+(?:\.[a-z0-9-]+)*\.(?:com|net|org|io|me|ee|ai|co|app|link|bio|page|to|br|in|uk|us)(?:\/[^\s)]*)?/gi;
const WHATSAPP = /\b(?:https?:\/\/)?(?:wa\.me|api\.whatsapp\.com\/send\?phone=)\/?\+?(\d{8,15})/gi;
/* English and Portuguese: "DM for collabs", "DM me", "chama na DM", "parcerias via direct". */
const DM_CUE = /\b(dm(?:s)?\s+(?:for|me|open)[^\n.|•]*|(?:chama|manda|fala)\s+(?:na|no)\s+(?:dm|direct)[^\n.|•]*|parcerias?[^\n.|•]*\b(?:dm|direct)\b[^\n.|•]*)/gi;

function clean(value: string): string {
  return value.replace(/[.,;:!?)]+$/, "");
}

export function extractContactRoutes(input: { bio?: string | null; website?: string | null }): ContactRoute[] {
  const bio = input.bio ?? "";
  const routes: ContactRoute[] = [];
  const seen = new Set<string>();
  const add = (route: ContactRoute) => {
    const key = `${route.kind}:${route.value.toLowerCase()}`;
    if (seen.has(key)) return;
    seen.add(key);
    routes.push(route);
  };

  for (const m of bio.matchAll(EMAIL)) add({ kind: "email", value: clean(m[0]).toLowerCase(), quote: m[0] });
  for (const m of bio.matchAll(OBFUSCATED_EMAIL)) {
    const domain = [m[2], m[3], m[4]].filter(Boolean).join(".");
    add({ kind: "email", value: `${m[1]}@${domain}`.toLowerCase(), quote: m[0].trim() });
  }
  for (const m of bio.matchAll(WHATSAPP)) add({ kind: "whatsapp", value: `https://wa.me/${m[1]}`, quote: m[0] });
  const emailText = new Set(routes.filter((r) => r.kind === "email").map((r) => r.quote));
  for (const m of bio.matchAll(URL_RE)) {
    const raw = clean(m[0]);
    if ([...emailText].some((q) => q.includes(raw))) continue;
    if (/wa\.me|whatsapp\.com/i.test(raw)) continue;
    add({ kind: "link", value: /^https?:\/\//i.test(raw) ? raw : `https://${raw}`, quote: m[0] });
  }
  if (input.website) {
    const site = input.website.trim();
    add({ kind: "link", value: /^https?:\/\//i.test(site) ? site : `https://${site}`, quote: site });
  }
  for (const m of bio.matchAll(DM_CUE)) add({ kind: "dm", value: "Instagram DM", quote: m[0].trim() });
  return routes;
}
