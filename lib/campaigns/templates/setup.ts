import { db } from "@/lib/db";
import type { Prisma } from "@/lib/generated/prisma/client";
import { campaignScopeWhereFor } from "@/lib/campaignScope";
import { hasPermission } from "@/lib/rbac";
import { isMissingRulesTable } from "@/lib/campaigns/rulesDdl";
import { isMissingTemplatesTable } from "./ddl";
import { SETUP_VERSION, briefIsEmpty, parseSetup, type CampaignSetup, type SetupFrom, type SetupRules } from "./payload";

/**
 * The server half of campaign templates: one function reads a campaign's
 * setup (extractCampaignSetup), and both "Save as template" and "copy a past
 * campaign" go through it, so the two can never disagree on what a setup is.
 *
 * Every read here is scoped by the caller's org, and a campaign also by the
 * caller's row scope ("assigned only"), so a source outside either answers
 * exactly like one that does not exist.
 */

export type SetupSubject = {
  orgId: string;
  userId: string | null;
  role: string | null;
  campaignScope: "ALL" | "ASSIGNED" | null;
};

export type SetupSource = {
  kind: SetupFrom["kind"];
  id: string;
  /** The template's name, or the campaign's title. */
  name: string;
  setup: CampaignSetup;
};

/**
 * Whether this caller may save, rename and delete templates: whoever may
 * create campaigns, the gate POST /api/campaigns uses. An org API key passes
 * every permission gate (lib/authz), so it passes this one too.
 */
export function canManageTemplates(subject: { actorType?: string; role: string | null }): boolean {
  return subject.actorType === "api_key" || (subject.role !== null && hasPermission(subject.role, "campaigns:create"));
}

const RULES_SELECT = {
  dos: true,
  donts: true,
  requiredHashtags: true,
  requiredMentions: true,
  minFollowers: true,
  maxPostsPerAccount: true,
  viewGoal: true,
  allowExclusions: true,
  allowBoostCodes: true,
} as const;

/** A campaign's rules as a setup carries them, or null with none set or no table yet. */
async function readRules(campaignId: string, orgId: string): Promise<SetupRules | null> {
  try {
    const row = await db.campaignRules.findFirst({ where: { campaignId, orgId }, select: RULES_SELECT });
    if (!row) return null;
    return {
      dos: row.dos ?? [],
      donts: row.donts ?? [],
      requiredHashtags: row.requiredHashtags ?? [],
      requiredMentions: row.requiredMentions ?? [],
      minFollowers: row.minFollowers,
      maxPostsPerAccount: row.maxPostsPerAccount,
      viewGoal: row.viewGoal,
      allowExclusions: row.allowExclusions === true,
      allowBoostCodes: row.allowBoostCodes === true,
    };
  } catch (e) {
    if (isMissingRulesTable(e)) return null;
    throw e;
  }
}

/**
 * The setup of one campaign in the caller's org and row scope, or null when
 * there is no such campaign. Reads only setup columns -- nothing that names a
 * creator, a post, a sound or a date is selected, so nothing of the kind can
 * travel.
 */
export async function extractCampaignSetup(
  subject: SetupSubject,
  campaignId: string,
): Promise<{ title: string; setup: CampaignSetup } | null> {
  const campaign = await db.campaign.findFirst({
    where: { id: campaignId, orgId: subject.orgId, deletedAt: null, ...campaignScopeWhereFor(subject) },
    select: {
      id: true,
      title: true,
      clientId: true,
      budget: true,
      currency: true,
      postApprovalMode: true,
      notes: true,
      brief: { select: { content: true } },
      phases: { select: { name: true, sequence: true, targetPosts: true }, orderBy: { sequence: "asc" } },
    },
  });
  if (!campaign) return null;
  const rules = await readRules(campaign.id, subject.orgId);
  const brief = campaign.brief?.content ?? null;
  return {
    title: campaign.title,
    setup: {
      version: SETUP_VERSION,
      clientId: campaign.clientId ?? null,
      budget: campaign.budget ?? null,
      currency: campaign.currency ?? null,
      postApprovalMode: campaign.postApprovalMode ?? null,
      notes: campaign.notes?.trim() ? campaign.notes : null,
      brief: briefIsEmpty(brief) ? null : brief,
      rules,
      phases: campaign.phases.map((p, i) => ({
        name: p.name.trim() || `Phase ${i + 1}`,
        sequence: i + 1,
        targetPosts: p.targetPosts ?? null,
      })),
    },
  };
}

export type TemplateRead =
  | { status: "ok"; name: string; description: string | null; setup: CampaignSetup }
  | { status: "missing" }
  /** The row is there but its payload is a version this code cannot read. */
  | { status: "unreadable"; name: string };

/** One live template in the caller's org. A missing table reads as no template. */
export async function readTemplate(orgId: string, templateId: string): Promise<TemplateRead> {
  try {
    const row = await db.campaignTemplate.findFirst({
      where: { id: templateId, orgId, deletedAt: null },
      select: { name: true, description: true, payload: true },
    });
    if (!row) return { status: "missing" };
    const setup = parseSetup(row.payload);
    return setup
      ? { status: "ok", name: row.name, description: row.description, setup }
      : { status: "unreadable", name: row.name };
  } catch (e) {
    if (isMissingTemplatesTable(e)) return { status: "missing" };
    throw e;
  }
}

export type SourceRead =
  | { status: "ok"; source: SetupSource }
  | { status: "missing"; message: string }
  | { status: "unreadable"; message: string };

/** The setup a new campaign starts from, read by the server from its own copy. */
export async function readSetupSource(subject: SetupSubject, from: SetupFrom): Promise<SourceRead> {
  if (from.kind === "campaign") {
    const found = await extractCampaignSetup(subject, from.id);
    if (!found) return { status: "missing", message: "Campaign not found" };
    return { status: "ok", source: { kind: "campaign", id: from.id, name: found.title, setup: found.setup } };
  }
  const template = await readTemplate(subject.orgId, from.id);
  if (template.status === "missing") return { status: "missing", message: "Template not found" };
  if (template.status === "unreadable") {
    return { status: "unreadable", message: `The template "${template.name}" was saved by a newer version and can't be used here.` };
  }
  return { status: "ok", source: { kind: "template", id: from.id, name: template.name, setup: template.setup } };
}

/** The client's name, only if it is still this org's client. */
export async function orgClientName(orgId: string, clientId: string | null): Promise<string | null> {
  if (!clientId) return null;
  const client = await db.client.findFirst({ where: { id: clientId, orgId }, select: { name: true } });
  return client?.name ?? null;
}

/**
 * Whether CampaignRules can be written. Asked before the create's
 * transaction, because a failed statement inside it would abort the campaign
 * too (same reasoning as songLinksReady on the create path).
 */
export async function rulesTableReady(): Promise<boolean> {
  try {
    await db.campaignRules.findFirst({ select: { campaignId: true } });
    return true;
  } catch (e) {
    if (isMissingRulesTable(e)) return false;
    throw e;
  }
}

export type SetupWritten = { brief: boolean; rules: boolean; phases: number };

/**
 * Writes the brief, the rules and the phases of a setup onto a campaign that
 * was created in the same transaction. The rules row is skipped, and said to
 * be, when its table is not on this database yet.
 */
export async function writeSetupExtras(
  tx: Prisma.TransactionClient,
  args: { campaignId: string; orgId: string; userId: string | null; setup: CampaignSetup; rulesReady: boolean },
): Promise<SetupWritten> {
  const { campaignId, orgId, userId, setup, rulesReady } = args;
  const written: SetupWritten = { brief: false, rules: false, phases: 0 };
  if (setup.brief && !briefIsEmpty(setup.brief)) {
    await tx.creativeBrief.create({ data: { campaignId, content: setup.brief, updatedById: userId } });
    written.brief = true;
  }
  if (setup.rules && rulesReady) {
    await tx.campaignRules.create({
      data: {
        campaignId,
        orgId,
        ...setup.rules,
        /* Campaign-specific, never carried: */
        examplePostUrls: [],
        launchAt: null,
      },
    });
    written.rules = true;
  }
  if (setup.phases.length > 0) {
    const created = await tx.campaignPhase.createMany({
      data: setup.phases.map((p, i) => ({
        campaignId,
        name: p.name,
        sequence: i + 1,
        targetPosts: p.targetPosts,
      })),
    });
    written.phases = created.count;
  }
  return written;
}
