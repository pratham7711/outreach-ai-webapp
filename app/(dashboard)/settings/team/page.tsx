import { redirect } from "next/navigation";
import { auth } from "@/lib/auth";
import TeamClient from "./TeamClient";
import { loadTeamPageData } from "@/lib/team/teamPageData";

export default async function TeamPage() {
  const session = await auth();
  if (!session?.user) redirect("/login");
  const orgId = (session.user as any).orgId;
  const role = (session.user as any).role ?? null;

  const { users, invites, seats, canManage } = await loadTeamPageData({ orgId, role });

  return (
    <TeamClient
      users={users}
      invites={invites}
      seats={seats}
      canManage={canManage}
      currentUserId={session.user.id ?? null}
      viewerRole={role}
    />
  );
}
