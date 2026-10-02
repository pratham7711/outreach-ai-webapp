import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { db } from "@/lib/db";
import { destroyCreatorSession, getCreatorSession, verifyPassword } from "@/lib/creator-auth";
import { findLinkedCreatorsForHandle } from "@/lib/portal/creatorLink";
import { deleteCreatorLogin } from "@/lib/portal/deleteCreatorLogin";
import { logAudit } from "@/lib/audit";
import { rateLimit, rateLimitKey } from "@/lib/rateLimit";
import { DELETE as disconnectAccount } from "@/app/api/portal/connections/route";

const schema = z.object({
  password: z.string().min(1),
  /* Typed by the creator, so a stray tap cannot delete an account. */
  confirm: z.literal("DELETE"),
});

/**
 * POST /api/portal/account/delete -- "Delete my account and data".
 *
 * Two steps, in this order:
 *
 *  1. Every account the creator connected goes through Disconnect -- the
 *     route's own DELETE handler, called here rather than re-implemented, so
 *     the platform-side revoke (TikTok, Google, the last-Meta-row rule, the
 *     Instagram Login and Threads no-ops) is exactly the one the Disconnect
 *     button runs. The handler reads the same session cookie this request
 *     carries.
 *  2. The login and what hangs off it are removed (lib/portal/deleteCreatorLogin.ts).
 *
 * If any Disconnect fails outright, nothing in step 2 runs: the creator is told
 * which platform failed and can try again, with their login still there to do
 * it from. Accounts already disconnected stay disconnected; that is what they
 * asked for either way.
 *
 * An agency's hand-typed account row (origin "manual") is the agency's own
 * record of a public handle, holds no credential, and is left alone.
 */
export async function POST(request: NextRequest) {
  try {
    const session = await getCreatorSession();
    if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

    const rl = rateLimit({
      key: rateLimitKey("portal/account/delete", request),
      limit: 5,
      windowMs: 60 * 60 * 1000,
    });
    if (!rl.allowed) {
      return NextResponse.json(
        { error: "Too many attempts. Try again later." },
        { status: 429, headers: { "Retry-After": String(rl.retryAfterSeconds) } },
      );
    }

    const parsed = schema.safeParse(await request.json().catch(() => null));
    if (!parsed.success) {
      return NextResponse.json(
        { error: "Type DELETE and enter your password to delete your account." },
        { status: 400 },
      );
    }

    const user = await db.creatorUser.findUnique({
      where: { id: session.creatorUserId },
      select: { passwordHash: true },
    });
    if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    if (!(await verifyPassword(parsed.data.password, user.passwordHash))) {
      return NextResponse.json({ error: "Your password is not right." }, { status: 403 });
    }

    const linked = await findLinkedCreatorsForHandle(session);
    const accounts = await db.creatorSocialAccount.findMany({
      where: {
        AND: [
          {
            OR: [
              ...(linked.length > 0 ? [{ creatorId: { in: linked.map((c) => c.id) } }] : []),
              { creatorUserId: session.creatorUserId },
            ],
          },
          { OR: [{ origin: null }, { origin: { not: "manual" } }] },
        ],
      },
      select: { id: true, platform: true },
    });

    for (const account of accounts) {
      const url = new URL("/api/portal/connections", request.nextUrl.origin);
      url.searchParams.set("id", account.id);
      const res = await disconnectAccount(new NextRequest(url, { method: "DELETE" }));
      /* 404 means Disconnect does not count this row as the creator's (it is
         stamped with this login but sits on a roster row no proof links).
         deleteCreatorLogin removes it with the login; nothing here can revoke
         it at the platform, and the account screen tells the creator how. */
      if (!res.ok && res.status !== 404) {
        return NextResponse.json(
          {
            error: `We couldn't disconnect your ${account.platform.toLowerCase()} account, so nothing else was deleted. Try again.`,
          },
          { status: 502 },
        );
      }
    }

    await deleteCreatorLogin(session.creatorUserId);
    await destroyCreatorSession();

    /* The agencies this creator worked with see it in their audit log; the
       roster rows stay theirs. Best-effort: the deletion has already happened. */
    for (const orgId of new Set(linked.map((c) => c.orgId))) {
      await logAudit({
        orgId,
        actorType: "creator",
        action: "creator_account.delete",
        entityType: "CreatorUser",
        entityId: session.creatorUserId,
        entityLabel: "A creator deleted their login and disconnected their accounts",
        after: { disconnected: accounts.length },
      }).catch(() => {});
    }

    return NextResponse.json({ ok: true, disconnected: accounts.length });
  } catch (error) {
    console.error("Failed to delete creator account:", error);
    return NextResponse.json({ error: "Failed to delete the account" }, { status: 500 });
  }
}
