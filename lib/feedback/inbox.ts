import { db } from "@/lib/db";
import { feedbackTablesReady } from "@/lib/feedback/feedbackTables";

/**
 * The operator's feedback inbox: newest first, without the screenshot bytes
 * (each row's picture loads from /api/platform/feedback/[id]/screenshot), and
 * with who sent it spelled out -- the org's name, the user's email, the
 * creator's name -- rather than ids.
 */

export const INBOX_PAGE = 100;
export type InboxFilter = "open" | "resolved" | "all";

export type InboxRow = {
  id: string;
  createdAt: string;
  surface: string;
  orgId: string | null;
  orgName: string | null;
  userEmail: string | null;
  creatorName: string | null;
  creatorEmail: string | null;
  fromLink: boolean;
  message: string | null;
  pageUrl: string;
  pageTitle: string | null;
  hasScreenshot: boolean;
  screenshotError: string | null;
  context: unknown;
  resolvedAt: string | null;
  resolvedBy: string | null;
};

export type Inbox = { ready: boolean; rows: InboxRow[]; open: number };

export async function readInbox(filter: InboxFilter = "open"): Promise<Inbox> {
  if (!(await feedbackTablesReady())) return { ready: false, rows: [], open: 0 };
  const where = filter === "open" ? { resolvedAt: null } : filter === "resolved" ? { resolvedAt: { not: null } } : {};
  const [rows, open] = await Promise.all([
    db.feedback.findMany({
      where,
      orderBy: { createdAt: "desc" },
      take: INBOX_PAGE,
      select: {
        id: true,
        createdAt: true,
        surface: true,
        orgId: true,
        userEmail: true,
        creatorUserId: true,
        linkToken: true,
        message: true,
        pageUrl: true,
        pageTitle: true,
        screenshotType: true,
        screenshotError: true,
        context: true,
        resolvedAt: true,
        resolvedBy: true,
      },
    }),
    db.feedback.count({ where: { resolvedAt: null } }),
  ]);

  const orgIds = [...new Set(rows.map((r) => r.orgId).filter((v): v is string => !!v))];
  const creatorIds = [...new Set(rows.map((r) => r.creatorUserId).filter((v): v is string => !!v))];
  const [orgs, creators] = await Promise.all([
    orgIds.length ? db.organization.findMany({ where: { id: { in: orgIds } }, select: { id: true, name: true } }) : [],
    creatorIds.length
      ? db.creatorUser.findMany({ where: { id: { in: creatorIds } }, select: { id: true, name: true, email: true } })
      : [],
  ]);
  const orgName = new Map(orgs.map((o) => [o.id, o.name]));
  const creator = new Map(creators.map((c) => [c.id, c]));

  return {
    ready: true,
    open,
    rows: rows.map((r) => ({
      id: r.id,
      createdAt: r.createdAt.toISOString(),
      surface: r.surface,
      orgId: r.orgId,
      orgName: r.orgId ? (orgName.get(r.orgId) ?? null) : null,
      userEmail: r.userEmail,
      creatorName: r.creatorUserId ? (creator.get(r.creatorUserId)?.name ?? null) : null,
      creatorEmail: r.creatorUserId ? (creator.get(r.creatorUserId)?.email ?? null) : null,
      fromLink: !!r.linkToken && !r.userEmail,
      message: r.message,
      pageUrl: r.pageUrl,
      pageTitle: r.pageTitle,
      hasScreenshot: !!r.screenshotType,
      screenshotError: r.screenshotError,
      context: r.context,
      resolvedAt: r.resolvedAt?.toISOString() ?? null,
      resolvedBy: r.resolvedBy,
    })),
  };
}
