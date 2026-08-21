import { redirect } from "next/navigation";
import { auth } from "@/lib/auth";
import { db } from "@/lib/db";
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
        select: { id: true, status: true, posts: { select: { viewsCount: true, platform: true } } },
      },
    },
  });

  return (
    <SongsClient
      songs={songs.map((s) => {
        const posts = s.campaigns.flatMap((c) => c.posts);
        return {
          id: s.id,
          title: s.title,
          artist: s.artist,
          coverUrl: s.coverUrl,
          releaseDate: s.releaseDate ? s.releaseDate.toISOString() : null,
          campaignCount: s.campaigns.length,
          activeCampaignCount: s.campaigns.filter((c) => c.status === "IN_PROGRESS").length,
          postCount: posts.length,
          totalViews: posts.reduce((sum, p) => sum + p.viewsCount, 0),
          platforms: [...new Set(posts.map((p) => p.platform))],
        };
      })}
    />
  );
}
