/**
 * Give one campaign a TikTok sound with a real usage curve, so the audio card
 * on its client report has something to draw.
 *
 * Why this exists: the audio feature is fully wired and has never rendered.
 * Measured on the dev branch 2026-09-11 -- 3 of 514 campaigns carry a songId,
 * none of those three has a public report, `camp-2`'s song row has soundId
 * NULL, the two Wizard Smoke campaigns point at an INSTAGRAM sound that the
 * snapshot job's `platform: "TIKTOK"` filter will never read, and the only
 * three sounds with snapshot history are attached to no campaign at all. So
 * there is no campaign anywhere whose audio card can render, which makes
 * seeding a precondition for verifying the report rather than a convenience.
 *
 * DRY RUN BY DEFAULT. It prints the exact plan and writes nothing until it is
 * given --apply.
 *
 *     node scripts/dev/seed-demo-audio.mjs              # print the plan
 *     node scripts/dev/seed-demo-audio.mjs --apply      # write it
 *
 * Idempotent: re-running finds the rows it made last time and tops the series
 * up to today rather than forking a second tracker or duplicating snapshots.
 */
import fs from "node:fs";
import path from "node:path";
import pg from "pg";

/* The only host this may touch. `ep-green-shadow` is the e2e-tests branch of
   outreach-prod, which local dev points at. Deliberately NOT prod
   (`billowing-frog`) and NOT the Playwright project (`ep-little-recipe`) --
   the suite asserts on seed fixtures, and an extra sound there would change
   what those specs count. A hostname check rather than a flag, because a flag
   is exactly what gets copied into the wrong shell. */
const ALLOWED_HOST_FRAGMENT = "ep-green-shadow";

const APPLY = process.argv.includes("--apply");

/** The sound to attach. A real TikTok id so a later live fetch can replace
 *  these figures with measured ones instead of colliding with a fake. */
const SOUND = {
  tiktokSoundId: "7546394810303694849",
  title: "Roots",
  artist: "Jamie MacDonald & The Chosen",
  coverImageUrl:
    "https://p16-sign-sg.tiktokcdn.com/aweme/720x720/tos-alisg-v-2774/placeholder.jpeg",
};

/** Eleven daily readings ending today: a curve with a visible inflection, not
 *  a straight line, so the chart shows the shape a real campaign produces. */
const USES_SERIES = [30, 32, 34, 48, 66, 76, 78, 80, 84, 90, 93];

function loadEnv() {
  const file = path.join(process.cwd(), ".env.local");
  const text = fs.readFileSync(file, "utf8");
  return Object.fromEntries(
    text
      .split("\n")
      .filter((l) => l.includes("=") && !l.trim().startsWith("#"))
      .map((l) => {
        const i = l.indexOf("=");
        return [l.slice(0, i).trim(), l.slice(i + 1).trim().replace(/^["']|["']$/g, "")];
      })
  );
}

/** Percent change against the previous reading -- the unit every writer of
 *  velocityScore uses, and the one the audio card prints with a "%" suffix. */
function velocityBetween(previous, current) {
  if (!previous) return 0;
  return Number((((current - previous) / previous) * 100).toFixed(2));
}

async function main() {
  /* The environment wins over .env.local, which is what makes the guard below
     testable: point DATABASE_URL at any other host and this must refuse. */
  const env = loadEnv();
  const url = process.env.DATABASE_URL ?? env.DATABASE_URL;
  if (!url) throw new Error("DATABASE_URL missing from the environment and .env.local");

  const host = new URL(url).host;
  if (!host.includes(ALLOWED_HOST_FRAGMENT)) {
    console.error(
      `refusing to run: DATABASE_URL points at ${host}, which is not the dev branch ` +
        `(expected a host containing "${ALLOWED_HOST_FRAGMENT}").`
    );
    process.exit(1);
  }

  const c = new pg.Client({ connectionString: url });
  await c.connect();

  try {
    /* The campaign to attach to: one that already has a PUBLIC report, because
       the whole point is a share link a brand can open. Largest first, so the
       demo has a populated post grid under the audio card. */
    const { rows: candidates } = await c.query(`
      select c.id, c.title, c."orgId", r."shareToken",
             (select count(*) from "Post" p where p."campaignId" = c.id)::int posts
      from "Campaign" c
      join "Report" r on r."campaignId" = c.id
      where r."isPublic" = true and r.config->>'kind' = 'campaign-performance'
      order by posts desc
      limit 1
    `);
    if (candidates.length === 0) throw new Error("no public campaign-performance report to attach to");
    const campaign = candidates[0];
    const { orgId } = campaign;

    const { rows: existingSound } = await c.query(
      `select id from "TikTokSound" where "orgId"=$1 and platform='TIKTOK' and "tiktokSoundId"=$2`,
      [orgId, SOUND.tiktokSoundId]
    );
    const existingSnapCount = existingSound.length
      ? (await c.query(`select count(*)::int n from "SoundTrackerSnapshot" where "soundId"=$1`, [existingSound[0].id])).rows[0].n
      : 0;

    const plan = {
      host,
      mode: APPLY ? "APPLY" : "DRY RUN",
      campaign: `${campaign.title} (${campaign.id}, ${campaign.posts} posts)`,
      shareLink: `/share/${campaign.shareToken}`,
      sound: `${SOUND.title} — ${SOUND.artist} [${SOUND.tiktokSoundId}]`,
      soundRow: existingSound.length ? `reuse ${existingSound[0].id}` : "create",
      snapshots: `${USES_SERIES.length} daily readings (${USES_SERIES[0]} → ${USES_SERIES.at(-1)} uses), ${existingSnapCount} already present`,
    };
    console.log("plan:");
    for (const [k, v] of Object.entries(plan)) console.log(`  ${k.padEnd(12)} ${v}`);

    if (!APPLY) {
      console.log("\nnothing written. re-run with --apply to execute this plan.");
      return;
    }

    await c.query("BEGIN");

    const soundId =
      existingSound[0]?.id ??
      (
        await c.query(
          `insert into "TikTokSound" ("id","orgId","tiktokSoundId",title,artist,"coverImageUrl","trackedSince","createdAt",platform)
           values (gen_random_uuid()::text,$1,$2,$3,$4,$5,now(),now(),'TIKTOK') returning id`,
          [orgId, SOUND.tiktokSoundId, SOUND.title, SOUND.artist, SOUND.coverImageUrl]
        )
      ).rows[0].id;

    const { rows: song } = await c.query(
      `select id from "Song" where "orgId"=$1 and "soundId"=$2 and "deletedAt" is null`,
      [orgId, soundId]
    );
    const songId =
      song[0]?.id ??
      (
        await c.query(
          `insert into "Song" ("id","orgId","soundId",title,artist,"createdAt","updatedAt")
           values (gen_random_uuid()::text,$1,$2,$3,$4,now(),now()) returning id`,
          [orgId, soundId, SOUND.title, SOUND.artist]
        )
      ).rows[0].id;

    await c.query(`update "Campaign" set "songId"=$1 where id=$2 and "orgId"=$3`, [
      songId,
      campaign.id,
      orgId,
    ]);

    /* One reading a day ending today, skipping any day already recorded, so a
       second run tops the series up instead of doubling it. */
    const { rows: have } = await c.query(
      `select date_trunc('day', "recordedAt") d from "SoundTrackerSnapshot" where "soundId"=$1`,
      [soundId]
    );
    const seen = new Set(have.map((r) => new Date(r.d).toISOString().slice(0, 10)));

    let written = 0;
    for (const [i, uses] of USES_SERIES.entries()) {
      const at = new Date(Date.now() - (USES_SERIES.length - 1 - i) * 24 * 60 * 60 * 1000);
      const key = at.toISOString().slice(0, 10);
      if (seen.has(key)) continue;
      const previous = i === 0 ? null : USES_SERIES[i - 1];
      const delta = previous === null ? 0 : uses - previous;
      await c.query(
        `insert into "SoundTrackerSnapshot" ("id","soundId","usesCount","videosAdded24h","deltaUses24h","velocityScore","recordedAt")
         values (gen_random_uuid()::text,$1,$2,$3,$4,$5,$6)`,
        [soundId, uses, Math.max(0, delta), delta, velocityBetween(previous, uses), at]
      );
      written++;
    }

    await c.query("COMMIT");
    console.log(`\nwrote ${written} snapshot(s); campaign ${campaign.id} now points at song ${songId}.`);
    console.log(`open: /share/${campaign.shareToken}`);
  } catch (error) {
    await c.query("ROLLBACK").catch(() => {});
    throw error;
  } finally {
    await c.end();
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
