import { redirect } from "next/navigation";
import { auth } from "@/lib/auth";
import { db } from "@/lib/db";
import { NOT_REMOVED } from "@/lib/posts/removed";
import { oneCopyPerVideo } from "@/lib/posts/duplicates";
import { viewTotals } from "@/lib/posts/viewTotals";
import SongsClient from "./SongsClient";

export default async function SongsPage() {
  const session = await auth();
  if (!session?.user) redirect("/login");
  const orgId = (session.user as any).orgId;

  const songs = await db.song.findMany({
    where: { orgId, deletedAt: null },
    orderBy: { createdAt: "desc" },
    select: {
      id: true,
      title: true,
      artist: true,
      coverUrl: true,
      releaseDate: true,
      campaigns: {
        where: { deletedAt: null },
        select: {
          id: true,
          status: true,
          // Provenance as well as the count, so an unread post is not summed as
          // 0 and the card can say when its views were read.
          posts: {
            where: NOT_REMOVED,
            select: {
              viewsCount: true, platform: true, postUrl: true,
              lastSyncedAt: true, lastFreshAt: true, platformMetrics: true,
            },
          },
        },
      },
    },
  });

  return (
    <SongsClient
      songs={songs.map((s) => {
        const posts = s.campaigns.flatMap((c) => c.posts);
        /* Each video once, as the song page and GET /api/songs/[id] count it:
           a video delivered to two of the song's campaigns is two rows. */
        const totals = viewTotals(oneCopyPerVideo(posts));
        return {
          id: s.id,
          title: s.title,
          artist: s.artist,
          coverUrl: s.coverUrl,
          releaseDate: s.releaseDate ? s.releaseDate.toISOString() : null,
          campaignCount: s.campaigns.length,
          activeCampaignCount: s.campaigns.filter((c) => c.status === "IN_PROGRESS").length,
          postCount: posts.length,
          totalViews: totals.views,
          viewsKnown: totals.viewsKnown,
          videoCount: totals.posts,
          viewsAsOf: totals.asOf,
          platforms: [...new Set(posts.map((p) => p.platform))],
        };
      })}
    />
  );
}
