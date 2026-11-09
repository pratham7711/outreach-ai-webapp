import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { db } from "@/lib/db";
import { authenticateRequest, getAuditActor } from "@/lib/authenticate";
import { requirePermission } from "@/lib/authz";
import { logAudit } from "@/lib/audit";
import { getRequestIp } from "@/lib/request";
import { campaignScopeWhereFor } from "@/lib/campaignScope";
import { isMissingTemplatesTable } from "@/lib/campaigns/templates/ddl";
import { canManageTemplates, extractCampaignSetup } from "@/lib/campaigns/templates/setup";
import {
  SETUP_PARTS,
  TEMPLATE_DESCRIPTION_MAX,
  TEMPLATE_NAME_MAX,
  campaignSetupSchema,
  parseSetup,
  partsPresent,
  summarise,
  withParts,
} from "@/lib/campaigns/templates/payload";

/**
 * Campaign templates: a campaign's setup saved under a name, to start new
 * campaigns from (lib/campaigns/templates). Saving and starting from one both
 * belong to whoever may create campaigns -- the same campaigns:create gate as
 * POST /api/campaigns.
 */

const TEMPLATE_LIMIT = 100;
const CAMPAIGN_LIMIT = 20;

const notReady = () =>
  NextResponse.json(
    { error: "Templates aren't available on this database yet.", code: "templates_not_ready" },
    { status: 503 },
  );

/**
 * GET /api/campaign-templates?q= -- what New Campaign can start from: this
 * org's templates, and its most recent campaigns (in the caller's row scope)
 * to copy the setup of. `q` narrows both by name. `ready: false` means the
 * templates table is not on this database yet; past campaigns still work.
 */
export async function GET(request: NextRequest) {
  try {
    const auth = await authenticateRequest(request);
    if (!auth) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    const { orgId } = auth;
    const q = (request.nextUrl.searchParams.get("q") ?? "").trim().slice(0, 100);
    const nameLike = q ? { contains: q, mode: "insensitive" as const } : undefined;

    let ready = true;
    let templateRows: { id: string; name: string; description: string | null; payload: unknown; updatedAt: Date }[] = [];
    try {
      templateRows = await db.campaignTemplate.findMany({
        where: { orgId, deletedAt: null, ...(nameLike ? { name: nameLike } : {}) },
        select: { id: true, name: true, description: true, payload: true, updatedAt: true },
        orderBy: { updatedAt: "desc" },
        take: TEMPLATE_LIMIT,
      });
    } catch (e) {
      if (!isMissingTemplatesTable(e)) throw e;
      ready = false;
    }

    const campaignRows = await db.campaign.findMany({
      where: {
        orgId,
        deletedAt: null,
        ...(nameLike ? { title: nameLike } : {}),
        ...campaignScopeWhereFor(auth),
      },
      select: { id: true, title: true, updatedAt: true, client: { select: { name: true } } },
      orderBy: { updatedAt: "desc" },
      take: CAMPAIGN_LIMIT + 1,
    });

    /* Names for the clients the templates point at, from this org only: a
       client deleted since the template was saved simply has no name. */
    const parsed = templateRows.map((row) => ({ row, setup: parseSetup(row.payload) }));
    const clientIds = [...new Set(parsed.map((p) => p.setup?.clientId).filter((id): id is string => Boolean(id)))];
    const clients = clientIds.length
      ? await db.client.findMany({ where: { id: { in: clientIds }, orgId }, select: { id: true, name: true } })
      : [];
    const clientName = new Map(clients.map((c) => [c.id, c.name]));

    return NextResponse.json({
      ready,
      canManage: canManageTemplates(auth),
      templates: parsed.map(({ row, setup }) => ({
        id: row.id,
        name: row.name,
        description: row.description,
        updatedAt: row.updatedAt,
        /* Null for a payload this version cannot read: listed, so it can be
           deleted, but not offered as a starting point. */
        summary: setup ? summarise(setup) : null,
        clientName: setup?.clientId ? clientName.get(setup.clientId) ?? null : null,
      })),
      campaigns: campaignRows.slice(0, CAMPAIGN_LIMIT).map((c) => ({
        id: c.id,
        title: c.title,
        clientName: c.client?.name ?? null,
        updatedAt: c.updatedAt,
      })),
      campaignsMore: campaignRows.length > CAMPAIGN_LIMIT,
    });
  } catch (error) {
    console.error("Failed to list campaign templates:", error);
    return NextResponse.json({ error: "Failed to list campaign templates" }, { status: 500 });
  }
}

const includeSchema = z.object(Object.fromEntries(SETUP_PARTS.map((p) => [p, z.boolean().optional()])) as Record<
  (typeof SETUP_PARTS)[number],
  z.ZodOptional<z.ZodBoolean>
>);

const createSchema = z.object({
  campaignId: z.string().min(1).max(100),
  name: z.string().trim().min(1, "Give the template a name").max(TEMPLATE_NAME_MAX),
  description: z.string().trim().max(TEMPLATE_DESCRIPTION_MAX).nullable().optional(),
  /** Parts to leave out, as `false`. A part not named is saved. */
  include: includeSchema.optional(),
});

/**
 * POST /api/campaign-templates -- saves a campaign's setup as a template.
 * The setup is read here from the campaign itself (extractCampaignSetup, the
 * same function "copy a past campaign" uses); the body names the campaign and
 * which parts to leave out, never the setup.
 */
export async function POST(request: NextRequest) {
  try {
    const gate = await requirePermission(request, "campaigns:create");
    if (!gate.ok) return gate.response;
    const auth = gate.auth;
    const { orgId } = auth;

    const parsed = createSchema.safeParse(await request.json().catch(() => null));
    if (!parsed.success) {
      const first = parsed.error.issues[0];
      return NextResponse.json(
        { error: first?.path[0] === "name" ? first.message : "Invalid input", details: parsed.error.flatten() },
        { status: 400 },
      );
    }
    const { campaignId, name, description, include } = parsed.data;

    const found = await extractCampaignSetup(auth, campaignId);
    if (!found) return NextResponse.json({ error: "Campaign not found" }, { status: 404 });

    const setup = withParts(found.setup, include);
    if (partsPresent(setup).length === 0) {
      return NextResponse.json({ error: "Choose at least one part of the setup to save." }, { status: 400 });
    }
    const checked = campaignSetupSchema.safeParse(setup);
    if (!checked.success) {
      return NextResponse.json({ error: "This campaign's setup is too large to save as a template." }, { status: 400 });
    }

    let template;
    try {
      template = await db.campaignTemplate.create({
        data: {
          orgId,
          name,
          description: description || null,
          payload: checked.data,
          createdById: auth.userId ?? "api",
        },
        select: { id: true, name: true, description: true, createdAt: true, updatedAt: true },
      });
    } catch (e) {
      if (isMissingTemplatesTable(e)) return notReady();
      throw e;
    }

    const summary = summarise(checked.data);
    await logAudit({
      orgId,
      ...getAuditActor(auth),
      action: "campaign_template.create",
      entityType: "campaign_template",
      entityId: template.id,
      entityLabel: template.name,
      ipAddress: getRequestIp(request),
      after: { name: template.name, fromCampaignId: campaignId, parts: partsPresent(checked.data) },
    });

    return NextResponse.json({ template: { ...template, summary } }, { status: 201 });
  } catch (error) {
    console.error("Failed to save campaign template:", error);
    return NextResponse.json({ error: "Failed to save the template" }, { status: 500 });
  }
}
