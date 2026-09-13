/**
 * The resolution report for the calling org's theme.
 *
 * This exists because moving styling into a database takes away the thing that
 * made it debuggable: you can no longer grep for the value. Without an answer to
 * "where did this number come from", server-driven UI trades a deploy for a
 * mystery. So every token reports its provenance -- `file` when it came from the
 * checked-in default, `org` when the tenant overrode it -- and every rejected
 * value reports why it was dropped rather than vanishing silently.
 *
 * `?token=--cc-rail-card-w` answers the single question people actually ask.
 *
 * orgId comes from the authenticated session, never from the query string, so
 * this cannot be pointed at another tenant's theme.
 */
import { NextRequest, NextResponse } from "next/server";
import { authenticateRequest } from "@/lib/authenticate";
import { resolveOrgTheme } from "@/lib/sdui/theme/resolve";
import { TOKEN_CONTRACT } from "@/lib/sdui/theme/contract";

export async function GET(req: NextRequest) {
  const result = await authenticateRequest(req);
  if (!result) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const { orgId } = result;

  const theme = await resolveOrgTheme(orgId);
  const one = req.nextUrl.searchParams.get("token");

  if (one) {
    const hits = Object.entries(theme.applied)
      .filter(([k]) => k.endsWith(` ${one}`))
      .map(([k, value]) => ({ scope: k.slice(0, k.length - one.length - 1), value, from: theme.source[k] ?? "file" }));
    return NextResponse.json({
      token: one,
      inContract: one in TOKEN_CONTRACT,
      note: (TOKEN_CONTRACT as Record<string, { note: string }>)[one]?.note ?? null,
      resolved: hits,
      rejected: theme.rejected.filter((r) => r.token === one),
    });
  }

  return NextResponse.json({
    version: theme.version,
    /* True when a row existed but could not be parsed, or the read failed. The
       page still rendered -- on the checked-in default -- and this is the only
       place that says so, because a theme is never worth failing a render for. */
    degraded: theme.degraded,
    tokenCount: Object.keys(theme.applied).length,
    applied: Object.entries(theme.applied).map(([scope, value]) => ({
      scope,
      value,
      from: theme.source[scope] ?? "file",
    })),
    rejected: theme.rejected,
    css: theme.css,
  });
}
