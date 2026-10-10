import type { Sandbox } from "@vercel/sandbox";
import { createSandbox } from "@/lib/ops/sandboxBudget";
import { createLogger } from "@/lib/observability/logger";

/**
 * A post's public page, read from a region other than this server's.
 *
 * Instagram decides per country whether a post can be seen, and this
 * project's functions all run in Singapore (vercel.json pins sin1). MEASURED
 * 2026-10-10 on the three LKM posts our own page read called not public, with
 * the same bot user-agent from four places:
 *
 *                     sin1   bom1   iad1   India (residential)
 *   LANTERNS post A   404    page   page   page
 *   post B, post C    404    404    404    404
 *
 * Post A was hidden from Singapore only: from Mumbai and Virginia it gave the
 * full page, the same owner India saw, and a cover address that then loaded
 * from sin1 (200 image/jpeg), so a cover found this way shows through the
 * image proxy. B and C are gone or private everywhere.
 *
 * So a "not public" from here is asked again from these regions before it is
 * believed. A Vercel Sandbox is the one way this app sends a request from
 * another region. It is the same public page with the same honest user-agent
 * and no cookie, so it gets what anyone in that country is shown.
 *
 * One short-lived sandbox per region, and only for a post that already read as
 * not public here. Those are re-read once a day (DAILY_RECHECK_REASONS), not
 * hourly, and createSandbox counts and caps every one.
 */

export const OTHER_REGIONS = ["bom1", "iad1"] as const;

const USER_AGENT = "MadeBoringBot/1.0 (+https://campaign.madeboring.com)";
/* Boot plus two curls measured ~2-5s; the lifetime only bounds a leak. */
const LIFETIME_MS = 90_000;
const CURL_SECONDS = 15;
const COMMAND_TIMEOUT_MS = 20_000;

const log = () => createLogger({ context: { module: "instagramPostPageElsewhere" } });

/** What one region was shown: the page, and the thumbnail address's answer. */
export type RegionPageRead = {
  region: string;
  html: string;
  mediaStatus: number | null;
  mediaLocation: string | null;
};

async function readIn(region: string, shortcode: string): Promise<RegionPageRead | null> {
  let sandbox: Sandbox | null = null;
  try {
    sandbox = await createSandbox({ region, timeout: LIFETIME_MS, persistent: false }, "instagram-post-page");
    const [page, media] = await Promise.all([
      sandbox.runCommand(
        "curl",
        [
          "-sL",
          "--max-time",
          String(CURL_SECONDS),
          "-A",
          USER_AGENT,
          "-H",
          "accept-language: en-US,en;q=0.9",
          "-H",
          "accept: text/html,application/xhtml+xml",
          `https://www.instagram.com/p/${shortcode}/`,
        ],
        { timeoutMs: COMMAND_TIMEOUT_MS },
      ),
      /* Not followed: the redirect's Location is the clean cover, and a 404
         is half of the not-public verdict. */
      sandbox.runCommand(
        "curl",
        [
          "-s",
          "-o",
          "/dev/null",
          "-w",
          "%{http_code} %{redirect_url}",
          "--max-time",
          String(CURL_SECONDS),
          "-A",
          USER_AGENT,
          `https://www.instagram.com/p/${shortcode}/media/?size=l`,
        ],
        { timeoutMs: COMMAND_TIMEOUT_MS },
      ),
    ]);
    const html = page.exitCode === 0 ? await page.stdout() : "";
    if (!html) return null;
    const [code, location] = (await media.stdout()).trim().split(" ");
    const status = Number(code);
    return {
      region,
      html,
      /* curl prints 000 when it got no answer at all. */
      mediaStatus: Number.isInteger(status) && status > 0 ? status : null,
      mediaLocation: location || null,
    };
  } catch (err) {
    log().warn("instagram post page: other-region read did not answer", {
      region,
      error: err instanceof Error ? err.name : String(err),
    });
    return null;
  } finally {
    await sandbox?.delete({ deleteOrphanSnapshots: true }).catch(() => {});
  }
}

/**
 * What each other region was shown, in OTHER_REGIONS order; a region whose
 * sandbox would not boot or whose page did not load is left out. Never throws.
 */
export async function readInstagramPostPageElsewhere(shortcode: string): Promise<RegionPageRead[]> {
  /* Off Vercel with no OIDC token the Sandbox SDK falls back to an interactive
     device login, which would hold a local sync for minutes. With no way to
     boot, nobody else can answer, and the verdict made here stands. */
  if (!process.env.VERCEL && !process.env.VERCEL_OIDC_TOKEN) return [];
  const reads = await Promise.all(OTHER_REGIONS.map((region) => readIn(region, shortcode)));
  return reads.filter((r): r is RegionPageRead => r !== null);
}
