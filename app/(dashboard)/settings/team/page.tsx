import { redirect } from "next/navigation";
import { db } from "@/lib/db";
import { auth } from "@/lib/auth";
import TeamClient from "./TeamClient";

export default async function TeamPage() {
  const session = await auth();
  if (!session?.user) redirect("/login");
  const orgId = (session.user as any).orgId;

  const [users, invites] = await Promise.all([
    db.user.findMany({
      where: { orgId },
      select: {
        id: true,
        name: true,
        email: true,
        role: true,
        avatarUrl: true,
        lastLoginAt: true,
        isActive: true,
      },
      orderBy: { createdAt: "asc" },
    }),
    db.userInvite.findMany({
      where: { orgId },
      orderBy: { createdAt: "desc" },
    }),
  ]);

  const now = new Date();
  const enrichedInvites = invites.map((invite) => ({
    ...invite,
    createdAt: invite.createdAt.toISOString(),
    expiresAt: invite.expiresAt.toISOString(),
    acceptedAt: invite.acceptedAt?.toISOString() ?? null,
    status: invite.acceptedAt
      ? ("accepted" as const)
      : new Date(invite.expiresAt) < now
        ? ("expired" as const)
        : ("pending" as const),
  }));

  const serializedUsers = users.map((u) => ({
    ...u,
    lastLoginAt: u.lastLoginAt?.toISOString() ?? null,
  }));

  return <TeamClient users={serializedUsers} invites={enrichedInvites} />;
}
