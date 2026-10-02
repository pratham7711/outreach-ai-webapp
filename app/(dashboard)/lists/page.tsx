import { redirect } from "next/navigation";
import { auth } from "@/lib/auth";
import { db } from "@/lib/db";
import { listApprovalTablesReady } from "@/lib/lists/approvalTables";
import { listSummaries } from "@/lib/lists/listReview";
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

  // Status, favourite and archived exist only once the list-approval tables do;
  // without them the page is exactly the plain grid.
  const summaries = (await listApprovalTablesReady())
    ? await listSummaries(orgId, lists.map((l) => ({ id: l.id, total: l._count.items })))
    : null;

  return (
    <ListsClient
      review={Boolean(summaries)}
      lists={lists.map(l => ({
        id: l.id,
        name: l.name,
        description: l.description,
        _count: l._count,
        createdAt: l.createdAt.toISOString(),
        ...summaries?.get(l.id),
      }))}
    />
  );
}
