/**
 * Fill in the TikTok half of a campaign, moving the VPN underneath itself.
 *
 *   npx tsx scripts/creatorcore/fill-tiktok-metrics.ts <campaignId>
 *
 * TikTok is DNS-blackholed on Indian ISPs, so nothing about a TikTok post can be
 * fetched from here without a tunnel. Through the tunnel our Neon database stops
 * answering -- port 5432 connects and is then reset, while 443 passes -- so
 * fetching and storing cannot happen on one network. This runs in three phases
 * and toggles the tunnel between them:
 *
 *   1. tunnel down  -- read the campaign's posts out of the database
 *   2. tunnel up    -- fetch every TikTok post and the tracked sound
 *   3. tunnel down  -- write what came back
 *
 * The write goes through applyPostMetrics, the same function the live sync uses,
 * so this cannot drift from the app on which columns it sets -- including the
 * rule that lastSyncedAt is stamped only when counts actually arrived.
 *
 * On a machine that can already reach TikTok (production, or any host outside
 * the blocked region) the tunnel steps are skipped: phase 2 checks reachability
 * first and only raises the VPN if it has to.
 */
import { db } from "../../lib/db";
import { fetchPostMetrics, type PostMetrics } from "../../lib/platforms/fetchPostMetrics";
import { fetchTikTokSoundStats } from "../../lib/platforms/tiktokSound";
import { applyPostMetrics } from "../../lib/sync/syncPost";
import { velocityBetween } from "../../lib/trackers/metrics";
import { vpnDown, vpnUp, vpnStatus, egress, tiktokReachable } from "../dev/vpn.mjs";
import { fetchSoundStatsViaBrowser } from "../dev/tiktokSoundViaBrowser.mjs";

const campaignId = process.argv[2];
if (!campaignId) {
  console.error("usage: npx tsx scripts/creatorcore/fill-tiktok-metrics.ts <campaignId>");
  process.exit(1);
}

const log = (...a: unknown[]) => console.log(...a);

/**
 * Dropping the tunnel does not mean the database is answering yet. The route
 * table takes a moment to settle, and a write attempted inside that window dies
 * with "Unable to start a transaction in the given time" -- the connection pool
 * is still pointed down the tunnel that just closed. So wait for a trivial query
 * to succeed before trusting the network, rather than assuming it.
 */
async function waitForDb(timeoutMs = 60_000) {
  const deadline = Date.now() + timeoutMs;
  let lastError: unknown = null;
  while (Date.now() < deadline) {
    try {
      await db.$queryRaw`SELECT 1`;
      return;
    } catch (err) {
      lastError = err;
      await new Promise((r) => setTimeout(r, 2000));
    }
  }
  throw new Error(
    `database did not come back within ${timeoutMs}ms: ${lastError instanceof Error ? lastError.message : String(lastError)}`,
  );
}

async function main() {
  // ── phase 1: database, tunnel down ─────────────────────────────────────
  const startedConnected = (await vpnStatus()) === "Connected";
  if (startedConnected) {
    log("tunnel is up; dropping it to read the database");
    await vpnDown();
    await waitForDb();
  }

  const campaign = await db.campaign.findUnique({
    where: { id: campaignId },
    select: { id: true, title: true, song: { select: { soundId: true } } },
  });
  if (!campaign) {
    console.error(`no campaign ${campaignId}`);
    process.exit(2);
  }

  const posts = await db.post.findMany({
    where: { campaignId, platform: "TIKTOK" },
    select: {
      id: true, platform: true, creatorId: true, postUrl: true,
      thumbnailUrl: true, caption: true,
      creator: { select: { handle: true } },
    },
  });

  const sound = campaign.song?.soundId
    ? await db.tikTokSound.findUnique({
        where: { id: campaign.song.soundId },
        select: {
          id: true, tiktokSoundId: true,
          snapshots: { orderBy: { recordedAt: "desc" }, take: 1, select: { usesCount: true } },
        },
      })
    : null;

  log(`campaign "${campaign.title}": ${posts.length} TikTok posts, sound ${sound ? sound.tiktokSoundId : "none"}`);
  if (posts.length === 0 && !sound) {
    log("nothing to fetch");
    return;
  }

  // Hand the connection back before the network changes under it, so phase 3
  // opens a fresh one instead of reusing a socket the tunnel killed.
  await db.$disconnect();

  // ── phase 2: platform, tunnel up ───────────────────────────────────────
  let raisedTunnel = false;
  if (!(await tiktokReachable())) {
    log("TikTok unreachable; raising the tunnel");
    if (!(await vpnUp())) {
      console.error("the VPN would not connect; nothing fetched, nothing written");
      process.exit(3);
    }
    raisedTunnel = true;
    if (!(await tiktokReachable())) {
      console.error("still cannot reach TikTok with the tunnel up; refusing to write empty metrics");
      await vpnDown();
      process.exit(3);
    }
  }
  log("egress:", (await egress()) ?? "(unknown)");

  const fetched: { post: (typeof posts)[number]; metrics: PostMetrics | null }[] = [];
  for (const post of posts) {
    // No creator OAuth token here: tokens live in the database, which is exactly
    // what is unreachable right now. The public path is what these posts use
    // anyway -- they are other people's videos, not our connected accounts.
    const metrics = await fetchPostMetrics(post.postUrl);
    fetched.push({ post, metrics });
    log(
      `  ${metrics ? (typeof metrics.viewsCount === "number" ? `views=${metrics.viewsCount}` : "no counts") : "FETCH FAILED"}` +
        ` thumb=${metrics?.thumbnailUrl ? "yes" : "no"}  @${post.creator.handle}`,
    );
    // A burst of page loads gets a challenge instead of data.
    await new Promise((r) => setTimeout(r, 1500));
  }

  /* The plain-fetch path first, because it is what production uses. Music pages
     no longer server-render their payload, so it fails there and the browser
     fallback earns its keep -- see scripts/dev/tiktokSoundViaBrowser.mjs. */
  let soundStats = sound ? await fetchTikTokSoundStats(sound.tiktokSoundId) : null;
  if (sound && !soundStats) {
    log("  sound page carried no payload; rendering it in a browser instead");
    soundStats = await fetchSoundStatsViaBrowser(sound.tiktokSoundId);
  }
  if (sound) log(`  sound ${sound.tiktokSoundId}: ${soundStats ? `${soundStats.usesCount} uses` : "FETCH FAILED"}`);

  // ── phase 3: database, tunnel down ─────────────────────────────────────
  if (raisedTunnel || (await vpnStatus()) === "Connected") {
    log("dropping the tunnel to write");
    await vpnDown();
  }
  await waitForDb();

  let measured = 0;
  let noCounts = 0;
  let failed = 0;
  for (const { post, metrics } of fetched) {
    if (!metrics) {
      failed++;
      continue;
    }
    const outcome = await applyPostMetrics(post, metrics);
    if (outcome.status === "measured") measured++;
    else noCounts++;
  }

  if (sound && soundStats) {
    // Fill in the tracker's own metadata if this is the first time we have seen
    // it. The audio card falls back to the song's art without a cover, so a
    // real one is worth keeping.
    await db.tikTokSound.update({
      where: { id: sound.id },
      data: {
        ...(soundStats.title ? { title: soundStats.title } : {}),
        ...(soundStats.artist ? { artist: soundStats.artist } : {}),
        ...(soundStats.coverImageUrl ? { coverImageUrl: soundStats.coverImageUrl } : {}),
      },
    });

    const previous = sound.snapshots[0]?.usesCount ?? 0;
    await db.soundTrackerSnapshot.create({
      data: {
        soundId: sound.id,
        usesCount: soundStats.usesCount,
        // Same derivation the nightly snapshot uses, so one tracker's series
        // does not have two definitions of "added in the last day".
        videosAdded24h: velocityBetween(previous, soundStats.usesCount),
      },
    });
    log(`sound snapshot written: ${soundStats.usesCount} uses`);
  }

  log(`\nposts: ${measured} measured, ${noCounts} answered without counts, ${failed} fetch failures`);
  if (startedConnected) await vpnUp();
}

main()
  .catch(async (err) => {
    console.error(err);
    process.exitCode = 1;
  })
  .finally(async () => {
    await db.$disconnect().catch(() => {});
  });
