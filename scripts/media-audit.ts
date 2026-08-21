import { db } from "../lib/db";

/**
 * How many of the image fields the UI already renders actually hold a value?
 * A null thumbnail and a missing <img> look identical on screen, so this
 * separates "we never built it" from "we never populated it".
 */
async function main() {
  const pct = (n: number, total: number) => (total === 0 ? "  n/a" : `${((n / total) * 100).toFixed(1).padStart(5)}%`);

  const row = async (label: string, total: number, filled: number) => {
    console.log(`  ${label.padEnd(34)} ${String(filled).padStart(6)} / ${String(total).padEnd(6)} ${pct(filled, total)}`);
  };

  console.log("\n=== POSTS ===");
  const posts = await db.post.count();
  await row("thumbnailUrl set", posts, await db.post.count({ where: { thumbnailUrl: { not: null } } }));
  await row("authorProfilePic set", posts, await db.post.count({ where: { authorProfilePic: { not: null } } }));
  await row("postUrl set (needed to embed)", posts, await db.post.count({ where: { postUrl: { not: "" } } }));
  await row("platformPostId set", posts, await db.post.count({ where: { platformPostId: { not: "" } } }));

  console.log("\n  by platform:");
  const byPlatform = await db.post.groupBy({ by: ["platform"], _count: { _all: true } });
  for (const p of byPlatform) {
    const withThumb = await db.post.count({ where: { platform: p.platform, thumbnailUrl: { not: null } } });
    await row(`  ${p.platform}`, p._count._all, withThumb);
  }

  console.log("\n=== CREATORS ===");
  const creators = await db.creator.count();
  await row("avatarUrl set", creators, await db.creator.count({ where: { avatarUrl: { not: null } } }));

  console.log("\n=== CAMPAIGNS ===");
  const campaigns = await db.campaign.count();
  await row("thumbnailUrl set", campaigns, await db.campaign.count({ where: { thumbnailUrl: { not: null } } }));

  console.log("\n=== CLIENTS ===");
  const clients = await db.client.count();
  await row("logoUrl set", clients, await db.client.count({ where: { logoUrl: { not: null } } }));

  console.log("\n=== IMPORTED CREATORCORE MIRROR ===");
  for (const t of ["CcPost", "CcCampaign"] as const) {
    try {
      const n = await db.$queryRawUnsafe<{ c: bigint }[]>(`SELECT COUNT(*)::bigint AS c FROM "${t}"`);
      console.log(`  ${t.padEnd(34)} ${String(n[0].c).padStart(6)} rows`);
    } catch {
      console.log(`  ${t.padEnd(34)}  (table absent)`);
    }
  }
  try {
    const r = await db.$queryRawUnsafe<{ thumbs: bigint; pics: bigint }[]>(
      `SELECT COUNT("thumbnail") AS thumbs, COUNT("authorProfilePic") AS pics FROM "CcPost"`
    );
    console.log(`  CcPost.thumbnail non-null          ${String(r[0].thumbs).padStart(6)}`);
    console.log(`  CcPost.authorProfilePic non-null   ${String(r[0].pics).padStart(6)}`);
  } catch {
    /* table absent */
  }

  console.log("\n=== SAMPLE THUMBNAIL HOSTS (are they hotlinkable?) ===");
  const samples = await db.post.findMany({
    where: { thumbnailUrl: { not: null } },
    select: { platform: true, thumbnailUrl: true },
    take: 6,
  });
  if (samples.length === 0) console.log("  none stored");
  for (const s of samples) {
    let host = "unparseable";
    try {
      host = new URL(s.thumbnailUrl!).host;
    } catch {
      /* keep placeholder */
    }
    console.log(`  ${String(s.platform).padEnd(12)} ${host}`);
  }
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => process.exit(0));
