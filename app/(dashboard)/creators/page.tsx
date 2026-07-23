import { redirect } from "next/navigation";
import { auth } from "@/lib/auth";
import { db } from "@/lib/db";
import CreatorsClient from "./CreatorsClient";

export default async function CreatorsPage() {
  const session = await auth();
  if (!session?.user) redirect("/login");
  const orgId = (session.user as any).orgId;

  const creators = await db.creator.findMany({
    where: { orgId, deletedAt: null },
    include: { _count: { select: { activations: true } } },
    orderBy: { addedAt: "desc" },
  });

  return (
    <CreatorsClient
      creators={creators.map(c => ({
        id: c.id,
        name: c.name,
        handle: c.handle,
        platform: c.platform,
        avatarUrl: c.avatarUrl,
        followerCount: c.followersCount,
        avgViews: c.averageViews ? Number(c.averageViews) : null,
        rate: c.rate ? Number(c.rate) : null,
        _count: c._count,
      }))}
    />
  );
}
