import "dotenv/config";
import { PrismaClient } from "../lib/generated/prisma";
import { PrismaPg } from "@prisma/adapter-pg";

const adapter = new PrismaPg({ connectionString: process.env.DATABASE_URL! });
const prisma = new PrismaClient({ adapter });

const PLATFORMS = ["TIKTOK", "INSTAGRAM", "YOUTUBE", "TWITTER", "LINKEDIN", "SNAPCHAT"] as const;

const PHASES = [
  { name: "Teaser", sequence: 1, targetPosts: 6 },
  { name: "Release week", sequence: 2, targetPosts: 8 },
  { name: "Sustain", sequence: 3, targetPosts: 6 },
  { name: "Sync push", sequence: 4, targetPosts: 4 },
];

/**
 * Posting hours carry a deliberate signal so the timing analysis has something
 * real to find: 18:00–21:00 posts land far more views than 03:00–06:00 ones, and
 * every hour used gets at least three posts so it clears the recommendation floor.
 */
function viewsFor(hour: number, index: number): number {
  const prime = hour >= 18 && hour <= 21;
  const dead = hour >= 3 && hour <= 6;
  const base = prime ? 780_000 : dead ? 41_000 : 210_000;
  // Vary within the slot so medians are not synthetic-looking round numbers.
  return Math.round(base * (0.82 + ((index * 37) % 40) / 100));
}

async function main() {
  const org = await prisma.organization.findFirst({
    where: { subdomain: "demo-agency" },
    select: { id: true },
  });
  if (!org) throw new Error("demo-agency org not found");

  const creators = await prisma.creator.findMany({
    where: { orgId: org.id },
    select: { id: true },
    take: 6,
  });
  if (creators.length === 0) throw new Error("no creators in demo org");

  const existing = await prisma.song.findFirst({
    where: { orgId: org.id, title: "Neon Skyline" },
    select: { id: true },
  });

  const song = existing
    ? await prisma.song.update({
        where: { id: existing.id },
        data: { artist: "Aurora Vale", isrc: "USRC17607839" },
        select: { id: true },
      })
    : await prisma.song.create({
        data: {
          orgId: org.id,
          title: "Neon Skyline",
          artist: "Aurora Vale",
          isrc: "USRC17607839",
          releaseDate: new Date("2026-07-10T00:00:00.000Z"),
          notes: "Debut single. Two campaigns, four phases.",
        },
        select: { id: true },
      });

  // Attach the two most recent campaigns to the song; the rest stay standalone,
  // which is the case the nullable songId exists to protect.
  const campaigns = await prisma.campaign.findMany({
    where: { orgId: org.id, deletedAt: null },
    orderBy: { createdAt: "desc" },
    select: { id: true },
    take: 2,
  });
  await prisma.campaign.updateMany({
    where: { id: { in: campaigns.map((c) => c.id) } },
    data: { songId: song.id },
  });

  const primary = campaigns[0];
  const phaseIds: string[] = [];
  for (const p of PHASES) {
    const phase = await prisma.campaignPhase.upsert({
      where: { campaignId_sequence: { campaignId: primary.id, sequence: p.sequence } },
      update: { name: p.name, targetPosts: p.targetPosts },
      create: { campaignId: primary.id, name: p.name, sequence: p.sequence, targetPosts: p.targetPosts },
      select: { id: true },
    });
    phaseIds.push(phase.id);
  }

  // Wipe only this seed's own posts so re-running does not pile up duplicates.
  await prisma.post.deleteMany({ where: { platformPostId: { startsWith: "seed-song-" } } });

  const hours = [19, 20, 21, 4, 5, 12, 13];
  const rows: any[] = [];
  let n = 0;
  for (let week = 0; week < 3; week += 1) {
    for (const hour of hours) {
      const platform = PLATFORMS[n % PLATFORMS.length];
      const creator = creators[n % creators.length];
      const campaign = campaigns[n % campaigns.length];
      const postedAt = new Date(Date.UTC(2026, 6, 13 + week * 7 + (n % 5), hour, 0, 0));
      const views = viewsFor(hour, n);
      const likes = Math.round(views * 0.052);
      const comments = Math.round(views * 0.004);
      const shares = Math.round(views * 0.011);
      rows.push({
        campaignId: campaign.id,
        creatorId: creator.id,
        // Phases live on the primary campaign only, so posts on the other
        // campaign correctly carry a null phaseId.
        phaseId: campaign.id === primary.id ? phaseIds[n % phaseIds.length] : null,
        platform,
        platformPostId: `seed-song-${n}`,
        postUrl: `https://example.com/p/seed-song-${n}`,
        caption: `Neon Skyline — ${platform.toLowerCase()} drop ${n + 1}`,
        postedAt,
        viewsCount: views,
        likesCount: likes,
        commentsCount: comments,
        sharesCount: shares,
        engagementRate: Number((((likes + comments + shares) / views) * 100).toFixed(2)),
        status: "APPROVED",
        lastSyncedAt: new Date(),
      });
      n += 1;
    }
  }

  await prisma.post.createMany({ data: rows });

  console.log(
    JSON.stringify(
      {
        songId: song.id,
        campaignsAttached: campaigns.length,
        phases: phaseIds.length,
        postsCreated: rows.length,
        platforms: [...new Set(rows.map((r) => r.platform))],
      },
      null,
      2,
    ),
  );
  await prisma.$disconnect();
}

main().catch(async (e) => {
  console.error(e.message);
  await prisma.$disconnect();
  process.exit(1);
});
