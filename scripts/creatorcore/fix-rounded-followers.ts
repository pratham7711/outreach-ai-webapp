/**
 * Replace display-rounded follower figures with the exact ones.
 *
 *   npx tsx scripts/creatorcore/fix-rounded-followers.ts            # report only
 *   npx tsx scripts/creatorcore/fix-rounded-followers.ts --apply    # write them
 *
 * Every TikTok surface that carries a post also carries the author's follower
 * count, and all of them round it: measured 2026-09-15, a live video page
 * reports `authorStats.followerCount: 27200000` for an account whose own profile
 * page reports 27,218,982. The hourly post sync wrote that rounded figure over
 * the exact one, so 75 of the 76 Creator rows above 10,000 followers ended up on
 * TikTok's display ladder. keepPrecise now stops it happening again; this repairs
 * what it already happened to.
 *
 * The exact figure comes from `userInfo.statsV2` on the profile page, read
 * through the app's own parseTikTokProfileHtml so this cannot drift from what
 * the tracker sweep would store.
 *
 * Runs on one network, unlike fill-tiktok-metrics.ts. TikTok needs the tunnel up
 * and Neon's postgres port dies under it, but Neon also answers SQL over HTTPS on
 * 443, which the tunnel passes -- so this talks to the database that way and
 * never has to move the VPN underneath itself. Each HTTP request is its own
 * implicit transaction, so there is no session state to strand on a pooler
 * backend either.
 */
import { readFileSync } from "node:fs";
import { parseTikTokProfileHtml } from "../../lib/platforms/tiktokProfile";
import { followerLadder, keepPrecise, roundedStep } from "../../lib/platforms/precision";

const APPLY = process.argv.includes("--apply");
const LIMIT = Number(process.argv.find((a) => a.startsWith("--limit="))?.split("=")[1] ?? 500);

const CONN = /^DATABASE_URL="?([^"\n]+)"?$/m.exec(readFileSync(".env.local", "utf8"))?.[1];
if (!CONN) throw new Error("no DATABASE_URL in .env.local");
const HOST = new URL(CONN).hostname;

async function sql<T = Record<string, string>>(query: string, params: unknown[] = []): Promise<T[]> {
  const res = await fetch(`https://${HOST}/sql`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "Neon-Connection-String": CONN!,
      "Neon-Raw-Text-Output": "true",
      "Neon-Array-Mode": "false",
    },
    body: JSON.stringify({ query, params }),
    signal: AbortSignal.timeout(30_000),
  });
  const body = await res.text();
  if (!res.ok) throw new Error(`neon http ${res.status}: ${body.slice(0, 400)}`);
  return JSON.parse(body).rows as T[];
}

const UA =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0.0.0 Safari/537.36";

async function profileHtml(handle: string): Promise<string | null> {
  const res = await fetch(`https://www.tiktok.com/@${encodeURIComponent(handle)}`, {
    headers: { "User-Agent": UA, "Accept-Language": "en-US,en;q=0.9" },
    redirect: "follow",
    signal: AbortSignal.timeout(30_000),
  });
  if (!res.ok) return null;
  const html = await res.text();
  /* An Indian ISP answers 200 for /in/about with no rehydration blob, which
     reads exactly like a parse failure. Treat a missing blob as unreachable. */
  return html.includes("__UNIVERSAL_DATA_FOR_REHYDRATION__") ? html : null;
}

async function main() {
  const ladder = followerLadder("TIKTOK");

  const rows = await sql<{ id: string; handle: string; name: string; followersCount: string }>(
    `SELECT id, handle, name, "followersCount"
       FROM "Creator"
      WHERE platform = 'TIKTOK' AND "deletedAt" IS NULL AND "followersCount" >= 10000
      ORDER BY "followersCount" DESC
      LIMIT $1`,
    [LIMIT],
  );

  const stale = rows
    .map((r) => ({ ...r, stored: Number(r.followersCount) }))
    .filter((r) => roundedStep(r.stored, ladder) !== null);

  console.log(
    `${rows.length} TikTok creators above 10,000 followers; ${stale.length} hold a display-rounded figure.`,
  );
  console.log(APPLY ? "APPLYING writes.\n" : "Dry run -- pass --apply to write.\n");

  let fixed = 0;
  let unreachable = 0;
  let alreadyRight = 0;

  for (const row of stale) {
    const handle = row.handle.replace(/^@/, "").trim();
    const html = await profileHtml(handle).catch(() => null);
    if (!html) {
      unreachable++;
      console.log(`@${handle.padEnd(18)} unreachable`);
      await new Promise((r) => setTimeout(r, 1200));
      continue;
    }

    const parsed = parseTikTokProfileHtml(html);
    if (!parsed.ok) {
      unreachable++;
      console.log(`@${handle.padEnd(18)} ${parsed.reason}${parsed.detail ? `: ${parsed.detail}` : ""}`);
      await new Promise((r) => setTimeout(r, 1200));
      continue;
    }

    const exact = parsed.profile.followersCount;
    /* The same guard the app uses, run the other way round: refuse to write
       anything that is itself rounded, so a bad read cannot make this worse. */
    if (roundedStep(exact, ladder) !== null && keepPrecise(exact, row.stored, ladder) === row.stored) {
      alreadyRight++;
      console.log(`@${handle.padEnd(18)} page is rounded too (${exact}) -- left alone`);
      await new Promise((r) => setTimeout(r, 1200));
      continue;
    }

    const delta = exact - row.stored;
    console.log(
      `@${handle.padEnd(18)} ${String(row.stored).padStart(10)} -> ${String(exact).padStart(10)} ` +
        `(${delta >= 0 ? "+" : ""}${delta})`,
    );

    if (APPLY) {
      await sql(`UPDATE "Creator" SET "followersCount" = $1, "updatedAt" = now() WHERE id = $2`, [
        exact,
        row.id,
      ]);
      fixed++;
    }
    await new Promise((r) => setTimeout(r, 1200));
  }

  console.log(
    `\n${APPLY ? `wrote ${fixed}` : `would write ${stale.length - unreachable - alreadyRight}`}` +
      ` · unreachable ${unreachable} · page also rounded ${alreadyRight}`,
  );
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
