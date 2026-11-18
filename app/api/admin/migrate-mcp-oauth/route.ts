import { NextRequest, NextResponse } from "next/server";
import { bearerMatches } from "@/lib/http/bearer";
import { db } from "@/lib/db";
import { MCP_OAUTH_DDL, MCP_OAUTH_TABLES } from "@/lib/oauth/mcpOAuthDdl";

export const maxDuration = 60;
export const dynamic = "force-dynamic";

/**
 * Creates the MCP OAuth tables on production, where `migrate deploy` must never
 * run. Same ADMIN_MIGRATE_TOKEN gate as the other migrate routes: GET reports
 * and changes nothing, POST applies and reports before and after. Additive only.
 */
function authorize(request: NextRequest) {
  const token = process.env.ADMIN_MIGRATE_TOKEN;
  if (!token) return NextResponse.json({ error: "Not found" }, { status: 404 });
  if (!bearerMatches(request.headers.get("authorization"), token)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  return null;
}

async function inspect() {
  const rows = await db.$queryRawUnsafe<{ table_name: string }[]>(
    `SELECT table_name FROM information_schema.tables
      WHERE table_schema = 'public' AND table_name IN (${MCP_OAUTH_TABLES.map((t) => `'${t}'`).join(", ")})`,
  );
  const present = new Set(rows.map((r) => r.table_name));
  const ready = MCP_OAUTH_TABLES.every((t) => present.has(t));
  return {
    ready,
    tables: Object.fromEntries(MCP_OAUTH_TABLES.map((t) => [t, present.has(t)])),
    clients: ready ? await db.mcpOAuthClient.count() : 0,
    activeTokens: ready ? await db.mcpOAuthToken.count({ where: { revokedAt: null } }) : 0,
  };
}

export async function GET(request: NextRequest) {
  const denied = authorize(request);
  if (denied) return denied;
  try {
    return NextResponse.json({ ok: true, ...(await inspect()) });
  } catch (e) {
    return NextResponse.json({ error: String(e instanceof Error ? e.message : e) }, { status: 500 });
  }
}

export async function POST(request: NextRequest) {
  const denied = authorize(request);
  if (denied) return denied;
  try {
    const before = await inspect();
    for (const stmt of MCP_OAUTH_DDL) await db.$executeRawUnsafe(stmt);
    return NextResponse.json({ ok: true, before, after: await inspect() });
  } catch (e) {
    return NextResponse.json({ error: String(e instanceof Error ? e.message : e) }, { status: 500 });
  }
}
