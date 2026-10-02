import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { isPlatformAdmin } from "@/lib/billing/subscription";
import { isKillSwitchKey, setKillSwitch } from "@/lib/ops/killSwitch";
import { opsGuardsReport } from "@/lib/ops/opsReport";
import { resetBreaker } from "@/lib/ops/sourceBreaker";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/**
 * The ops guards page's API (plan §13 C). Platform admins only -- a kill
 * switch stops a job for every agency -- and 404 for anyone else, like the
 * other /api/platform routes.
 *
 *   GET                                          the report
 *   POST {action:"kill-switch", key, off, reason} flip one switch (logged)
 *   POST {action:"reset-breaker", key}            close one breaker by hand
 */
async function operatorEmail(): Promise<string | null> {
  const session = await auth();
  const email = (session?.user as { email?: string } | undefined)?.email ?? null;
  return email && isPlatformAdmin(email) ? email : null;
}

const notFound = () => NextResponse.json({ error: "Not found" }, { status: 404 });

export async function GET() {
  if (!(await operatorEmail())) return notFound();
  return NextResponse.json(await opsGuardsReport());
}

export async function POST(request: NextRequest) {
  const email = await operatorEmail();
  if (!email) return notFound();
  let body: Record<string, unknown>;
  try {
    body = (await request.json()) as Record<string, unknown>;
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  if (body.action === "kill-switch") {
    if (!isKillSwitchKey(body.key)) return NextResponse.json({ error: "unknown kill switch" }, { status: 400 });
    if (typeof body.off !== "boolean") return NextResponse.json({ error: "off must be true or false" }, { status: 400 });
    try {
      const result = await setKillSwitch({
        key: body.key,
        off: body.off,
        reason: typeof body.reason === "string" ? body.reason : null,
        changedBy: email,
      });
      if (!result.ok) return NextResponse.json({ error: result.error }, { status: 409 });
    } catch (e) {
      return NextResponse.json({ error: e instanceof Error ? e.message : "could not save the switch" }, { status: 500 });
    }
    return NextResponse.json({ ok: true, report: await opsGuardsReport() });
  }

  if (body.action === "reset-breaker") {
    if (typeof body.key !== "string") return NextResponse.json({ error: "unknown breaker" }, { status: 400 });
    const result = await resetBreaker(body.key);
    if (!result.ok) return NextResponse.json({ error: result.error }, { status: result.error === "unknown breaker" ? 400 : 409 });
    return NextResponse.json({ ok: true, report: await opsGuardsReport() });
  }

  return NextResponse.json({ error: "action must be kill-switch or reset-breaker" }, { status: 400 });
}
