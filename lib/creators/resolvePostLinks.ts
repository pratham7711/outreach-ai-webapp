import { detectMapping, parseProfileLink, profileUrl, type ColumnMapping, type ImportCell, type ImportPlatform } from "@/lib/creators/importParse";
import { resolveAuthorFromPlatform } from "@/lib/platforms/postAuthor";

/**
 * A sign-up sheet's link column often holds a post instead of a profile: an
 * Instagram reel, a YouTube Short, a TikTok share link. The importer refuses
 * those, and the creator falls out of the import. The post names its own
 * author, so this asks the platform and swaps the cell for the profile link
 * before the sheet is parsed. Anything the platform will not answer is left as
 * it was and is refused with the same message as before.
 *
 * Instagram and YouTube go through resolveAuthorFromPlatform, the lookup the
 * add-a-post flow already uses. TikTok share links (vm./vt./tiktok.com/t/)
 * redirect to the profile or to a /@handle/video URL, and to a URL with no
 * handle at all when the platform hides it from the caller's region, in which
 * case its oEmbed is asked instead.
 */

const LINK_COLUMN: Record<string, ImportPlatform> = {
  tiktokLink: "TIKTOK",
  instagramLink: "INSTAGRAM",
  youtubeLink: "YOUTUBE",
};

export const MAX_POST_LOOKUPS = 60;
const CONCURRENCY = 5;
const TIMEOUT_MS = 6000;

export type ResolvedPostLink = { row: number; platform: ImportPlatform; handle: string };

function timeoutSignal(ms: number): AbortSignal | undefined {
  const t = (AbortSignal as unknown as { timeout?: (ms: number) => AbortSignal }).timeout;
  return typeof t === "function" ? t.call(AbortSignal, ms) : undefined;
}

function firstUrl(cell: ImportCell): URL | null {
  const m = /https?:\/\/\S+?(?=https?:\/\/|\s|$)/i.exec(cell == null ? "" : String(cell));
  if (!m) return null;
  try {
    return new URL(m[0]);
  } catch {
    return null;
  }
}

const isTikTokShare = (u: URL) => /(^|\.)tiktok\.com$/i.test(u.hostname) && (/^(vm|vt)\./i.test(u.hostname) || /^\/t\//.test(u.pathname));

function tiktokHandleFromUrl(raw: string | null): string | null {
  const m = raw ? /tiktok\.com\/@([A-Za-z0-9._]{1,64})(?:[/?#]|$)/i.exec(raw) : null;
  return m ? m[1] : null;
}

async function tiktokAuthor(url: URL): Promise<string | null> {
  try {
    const res = await fetch(url.toString(), {
      redirect: "manual",
      headers: { "user-agent": "Mozilla/5.0" },
      signal: timeoutSignal(TIMEOUT_MS),
    });
    const fromRedirect = tiktokHandleFromUrl(res.headers.get("location"));
    if (fromRedirect) return fromRedirect;

    const target = res.headers.get("location") ?? url.toString();
    const oembed = await fetch(`https://www.tiktok.com/oembed?url=${encodeURIComponent(target)}`, {
      signal: timeoutSignal(TIMEOUT_MS),
    });
    if (!oembed.ok) return null;
    const data = (await oembed.json()) as { author_unique_id?: unknown; author_url?: unknown };
    if (typeof data.author_unique_id === "string" && data.author_unique_id.trim()) return data.author_unique_id.trim();
    return tiktokHandleFromUrl(typeof data.author_url === "string" ? data.author_url : null);
  } catch {
    return null;
  }
}

async function authorOf(url: URL, platform: ImportPlatform): Promise<string | null> {
  if (isTikTokShare(url)) return tiktokAuthor(url);
  if (platform === "INSTAGRAM" || platform === "YOUTUBE") {
    const a = await resolveAuthorFromPlatform(url.toString(), platform);
    return a?.handle ?? null;
  }
  return null;
}

async function pool<T>(items: T[], run: (item: T) => Promise<void>): Promise<void> {
  let next = 0;
  const workers = Array.from({ length: Math.min(CONCURRENCY, items.length) }, async () => {
    while (next < items.length) await run(items[next++]);
  });
  await Promise.all(workers);
}

/**
 * Returns the rows with post links replaced by profile links, and what was
 * resolved. `rows` is what the modal sends: a header row, then one array per
 * answer, columns in the order `mapping` names them. Rows are never mutated.
 */
export async function resolvePostLinks(
  rows: ImportCell[][],
  mapping: ColumnMapping | undefined,
): Promise<{ rows: ImportCell[][]; resolved: ResolvedPostLink[]; unresolved: number }> {
  const columns = (mapping ?? detectMapping(rows[0] ?? [])).flatMap((field, i) => (field && LINK_COLUMN[field] ? [{ i, platform: LINK_COLUMN[field] }] : []));
  if (!columns.length) return { rows, resolved: [], unresolved: 0 };

  const jobs: { row: number; col: number; platform: ImportPlatform; url: URL }[] = [];
  for (let r = 1; r < rows.length; r++) {
    for (const { i, platform } of columns) {
      const cell = rows[r][i];
      const parsed = parseProfileLink(cell, platform);
      if (parsed.ok || "empty" in parsed) continue;
      const url = firstUrl(cell);
      if (url) jobs.push({ row: r, col: i, platform, url });
    }
  }

  const todo = jobs.slice(0, MAX_POST_LOOKUPS);
  const out = rows.map((r) => r.slice());
  const resolved: ResolvedPostLink[] = [];
  await pool(todo, async (job) => {
    const handle = await authorOf(job.url, job.platform);
    if (!handle) return;
    out[job.row][job.col] = profileUrl(job.platform, handle);
    resolved.push({ row: job.row + 1, platform: job.platform, handle });
  });
  resolved.sort((a, b) => a.row - b.row);
  return { rows: out, resolved, unresolved: jobs.length - resolved.length };
}
