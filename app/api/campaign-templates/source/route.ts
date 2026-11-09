import { NextRequest, NextResponse } from "next/server";
import { authenticateRequest } from "@/lib/authenticate";
import { canManageTemplates, orgClientName, readSetupSource } from "@/lib/campaigns/templates/setup";
import { alsoCopies, setupFromSchema, summarise } from "@/lib/campaigns/templates/payload";

/**
 * GET /api/campaign-templates/source?kind=template|campaign&id= -- one
 * starting point's setup, for New Campaign to pre-fill its fields and for Save
 * as template to list what it would save. Read-only. What a create copies is
 * read again by POST /api/campaigns from the server's own copy, never taken
 * from what this returned.
 */
export async function GET(request: NextRequest) {
  try {
    const auth = await authenticateRequest(request);
    if (!auth) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

    const from = setupFromSchema.safeParse({
      kind: request.nextUrl.searchParams.get("kind"),
      id: request.nextUrl.searchParams.get("id"),
    });
    if (!from.success) return NextResponse.json({ error: "Send kind=template|campaign and an id" }, { status: 400 });

    const read = await readSetupSource(auth, from.data);
    if (read.status === "missing") return NextResponse.json({ error: read.message }, { status: 404 });
    if (read.status === "unreadable") return NextResponse.json({ error: read.message }, { status: 422 });

    const { source } = read;
    const summary = summarise(source.setup);
    return NextResponse.json({
      kind: source.kind,
      id: source.id,
      name: source.name,
      setup: source.setup,
      summary,
      alsoCopies: alsoCopies(summary),
      /* Null when the client has gone since the template was saved: the form
         then starts with no client rather than a dangling id. */
      clientName: await orgClientName(auth.orgId, source.setup.clientId),
      canSave: canManageTemplates(auth),
    });
  } catch (error) {
    console.error("Failed to read a campaign setup:", error);
    return NextResponse.json({ error: "Failed to read that setup" }, { status: 500 });
  }
}
