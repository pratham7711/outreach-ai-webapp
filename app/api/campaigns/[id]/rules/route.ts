import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { db } from "@/lib/db";
import { permissionDenial } from "@/lib/authz";
import { campaignScopeWhere, scopeSubjectFromSession } from "@/lib/campaignScope";
import { logAudit } from "@/lib/audit";
import { getRequestIp } from "@/lib/request";
import {
  CAMPAIGN_SWITCHES,
  EMPTY_RULES,
  SWITCHES_OFF,
  loadCampaignRules,
  loadCampaignSwitches,
  parseRulesInput,
  saveCampaignRules,
  setCampaignSwitch,
  type CampaignSwitch,
} from "@/lib/campaigns/rules";
import { isMissingRulesTable } from "@/lib/campaigns/rulesDdl";

type Ctx = { params: Promise<{ id: string }> };

async function findCampaign(id: string, user: Parameters<typeof scopeSubjectFromSession>[0]) {
  const orgId = (user as { orgId: string }).orgId;
  const scope = scopeSubjectFromSession(user);
  const campaign = await db.campaign.findFirst({
    where: { id, orgId, deletedAt: null, ...(scope ? campaignScopeWhere(scope) : {}) },
    select: { id: true, orgId: true, title: true },
  });
  return campaign;
}

/**
 * GET /api/campaigns/[id]/rules -- the campaign's checklist, submission rules,
 * launch date and view goal, and its feature switches (boost codes, excluding
 * a checked post with a reason). `ready: false` means the table is not on this
 * database yet: the card says so instead of offering an editor that cannot
 * save. `canEdit` is whether this user's role may change any of it.
 */
export async function GET(_request: NextRequest, { params }: Ctx) {
  try {
    const session = await auth();
    if (!session?.user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    const { id } = await params;
    const campaign = await findCampaign(id, session.user);
    if (!campaign) return NextResponse.json({ error: "Campaign not found" }, { status: 404 });
    const canEdit = permissionDenial(session.user, "campaigns:edit_own") === null;
    try {
      const [rules, switches] = await Promise.all([
        loadCampaignRules(campaign.id, campaign.orgId),
        loadCampaignSwitches(campaign.id, campaign.orgId),
      ]);
      const ready = rules !== null || Object.values(switches).some(Boolean) || (await tableReady());
      return NextResponse.json({ rules: rules ?? EMPTY_RULES, ...switches, ready, canEdit });
    } catch (e) {
      if (isMissingRulesTable(e)) return NextResponse.json({ rules: EMPTY_RULES, ...SWITCHES_OFF, ready: false, canEdit });
      throw e;
    }
  } catch (error) {
    console.error("Failed to read campaign rules:", error);
    return NextResponse.json({ error: "Failed to read campaign rules" }, { status: 500 });
  }
}

/** loadCampaignRules folds "no row" and "no table" into null; this tells them apart. */
async function tableReady(): Promise<boolean> {
  try {
    await db.campaignRules.findFirst({ select: { campaignId: true } });
    return true;
  } catch (e) {
    if (isMissingRulesTable(e)) return false;
    throw e;
  }
}

/** PUT /api/campaigns/[id]/rules -- replaces the whole set. An empty field clears that rule. */
export async function PUT(request: NextRequest, { params }: Ctx) {
  try {
    const session = await auth();
    if (!session?.user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    const denied = permissionDenial(session.user, "campaigns:edit_own");
    if (denied) return denied;
    const { id } = await params;
    const campaign = await findCampaign(id, session.user);
    if (!campaign) return NextResponse.json({ error: "Campaign not found" }, { status: 404 });

    const body = await request.json().catch(() => null);
    const { rules, errors } = parseRulesInput(body);
    if (errors.length > 0) return NextResponse.json({ error: errors[0], errors }, { status: 400 });

    const before = await loadCampaignRules(campaign.id, campaign.orgId).catch(() => null);
    try {
      await saveCampaignRules(campaign.id, campaign.orgId, rules);
    } catch (e) {
      if (isMissingRulesTable(e)) {
        return NextResponse.json(
          { error: "Checklist and rules aren't available on this database yet.", code: "rules_not_ready" },
          { status: 503 },
        );
      }
      throw e;
    }
    await logAudit({
      orgId: campaign.orgId,
      userId: session.user.id ?? undefined,
      actorEmail: session.user.email ?? undefined,
      action: "campaign.rules.update",
      entityType: "campaign",
      entityId: campaign.id,
      entityLabel: campaign.title,
      ipAddress: getRequestIp(request),
      before: before ?? EMPTY_RULES,
      after: rules,
    });
    return NextResponse.json({ rules, ready: true });
  } catch (error) {
    console.error("Failed to save campaign rules:", error);
    return NextResponse.json({ error: "Failed to save campaign rules" }, { status: 500 });
  }
}

/** The audit action for each switch. */
const SWITCH_AUDIT: Record<CampaignSwitch, string> = {
  allowBoostCodes: "campaign.boost_codes.update",
  allowExclusions: "campaign.exclusions.update",
};

/**
 * PATCH /api/campaigns/[id]/rules -- one or both feature switches,
 * `{ allowBoostCodes?: boolean, allowExclusions?: boolean }`. Only the
 * switches named; the rules themselves are PUT as a whole.
 */
export async function PATCH(request: NextRequest, { params }: Ctx) {
  try {
    const session = await auth();
    if (!session?.user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    const denied = permissionDenial(session.user, "campaigns:edit_own");
    if (denied) return denied;
    const { id } = await params;
    const campaign = await findCampaign(id, session.user);
    if (!campaign) return NextResponse.json({ error: "Campaign not found" }, { status: 404 });

    const body = (await request.json().catch(() => null)) as Record<string, unknown> | null;
    const changes: [CampaignSwitch, boolean][] = [];
    for (const key of CAMPAIGN_SWITCHES) {
      const value = body?.[key];
      if (value === undefined) continue;
      if (typeof value !== "boolean") return NextResponse.json({ error: `${key} must be true or false.` }, { status: 400 });
      changes.push([key, value]);
    }
    if (changes.length === 0) {
      return NextResponse.json({ error: `Send ${CAMPAIGN_SWITCHES.join(" or ")} as true or false.` }, { status: 400 });
    }

    const before = await loadCampaignSwitches(campaign.id, campaign.orgId);
    try {
      for (const [key, on] of changes) await setCampaignSwitch(campaign.id, campaign.orgId, key, on);
    } catch (e) {
      if (isMissingRulesTable(e)) {
        return NextResponse.json(
          { error: "This setting isn't available on this database yet.", code: "rules_not_ready" },
          { status: 503 },
        );
      }
      throw e;
    }
    for (const [key, on] of changes) {
      if (before[key] === on) continue;
      await logAudit({
        orgId: campaign.orgId,
        userId: session.user.id ?? undefined,
        actorEmail: session.user.email ?? undefined,
        action: SWITCH_AUDIT[key],
        entityType: "campaign",
        entityId: campaign.id,
        entityLabel: campaign.title,
        ipAddress: getRequestIp(request),
        before: { [key]: before[key] },
        after: { [key]: on },
      });
    }
    return NextResponse.json({ ...before, ...Object.fromEntries(changes) });
  } catch (error) {
    console.error("Failed to save a campaign switch:", error);
    return NextResponse.json({ error: "Failed to save the setting" }, { status: 500 });
  }
}
