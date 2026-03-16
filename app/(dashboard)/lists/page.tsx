import { redirect } from "next/navigation";
import { auth } from "@/lib/auth";
import { db } from "@/lib/db";
import ListsClient from "./ListsClient";

export default async function ListsPage() {
  const session = await auth();
  if (!session?.user) redirect("/login");
  const orgId = (session.user as any).orgId;

  const lists = await db.creatorList.findMany({
    where: { orgId },
    include: { _count: { select: { items: true } } },
    orderBy: { createdAt: "desc" },
  });

  return (
    <ListsClient
      lists={lists.map(l => ({
        id: l.id,
        name: l.name,
        description: l.description,
        _count: l._count,
        createdAt: l.createdAt.toISOString(),
      }))}
    />
  );
}
