import { NextRequest, NextResponse } from "next/server";
import { randomBytes } from "crypto";
import { db } from "@/lib/db";
import { authenticateRequest } from "@/lib/authenticate";
import { campaignScopeWhereFor } from "@/lib/campaignScope";
import {
  DEFAULT_SHARE_VISIBILITY,
  SHARE_PLATFORMS,
  parseShareVisibility,
  sanitizeShareVisibility,
  type ShareFacts,
  type ShareVisibility,
} from "@/lib/reports/shareVisibility";
import { requirePermission } from "@/lib/authz";
import { NOT_REMOVED } from "@/lib/posts/removed";
import { HIDDEN_FETCH_REASON, REMOVED_FETCH_REASON, REMOVED_FETCH_STATE } from "@/lib/postRemoval";
import { LAST_FETCH_KEY } from "@/lib/metricDisplay";
import { loadCampaignRules } from "@/lib/campaigns/rules";

const SHARE_KIND = "campaign-performance";

function slugify(text: string): string {
  return text
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9\s-]/g, "")
    .replace(/\s+/g, "-")
    .replace(/-+/g, "-");
}

async function findShareLink(orgId: string, campaignId: string) {
  const links = await db.report.findMany({
    where: { orgId, campaignId },
    orderBy: { createdAt: "desc" },
  });
  return links.find((r) => {
    const config = (r.config as { kind?: string } | null) ?? {};
    return config.kind === SHARE_KIND;
  });
}

function serialize(link: { shareToken: string; isPublic: boolean; createdAt: Date; config: unknown }) {
  return {
    token: link.shareToken,
    isPublic: link.isPublic,
    createdAt: link.createdAt.toISOString(),
    path: `/share/${link.shareToken}`,
    visibility: parseShareVisibility(link.config),
  };
}

/** Empty bodies are normal here — "create a link" carries no payload. */
async function readVisibility(req: NextRequest): Promise<ShareVisibility> {
  const body = (await req.json().catch(() => null)) as { visibility?: unknown } | null;
  if (!body || body.visibility === undefined) return DEFAULT_SHARE_VISIBILITY;
  return sanitizeShareVisibility(body.visibility);
}

/**
 * The campaign a share operation acts on.
 *
 * deletedAt is only filtered for POST. Deleting a campaign is a soft delete and
 * leaves its share links live on purpose — the confirm copy tells the operator
 * so. Filtering it everywhere therefore removed the one control that mattered:
 * a link already emailed to a client could no longer be read, retargeted or
 * revoked. Minting a *new* public link for a deleted campaign is a different
 * act, and that one still refuses.
 */
async function findCampaignForShare(
  auth: { orgId: string } & Parameters<typeof campaignScopeWhereFor>[0],
  id: string,
  opts: { allowDeleted: boolean }
) {
  return db.campaign.findFirst({
    where: {
      id,
      orgId: auth.orgId,
      ...(opts.allowDeleted ? null : { deletedAt: null }),
      ...campaignScopeWhereFor(auth),
    },
    select: { id: true, title: true, budget: true },
  });
}

/**
 * ShareFacts for the dialog. Each test is the one the shared report itself
 * applies -- the same post set (this campaign, not removed from it), the same
 * isPostRemoved signals, the same "the brief has something to show".
 */
async function readShareFacts(orgId: string, campaignId: string, budget: number | null): Promise<ShareFacts> {
  const posts = { campaignId, campaign: { orgId }, ...NOT_REMOVED };
  const reason = [LAST_FETCH_KEY, "reason"];
  const [platformRows, removedPosts, rules] = await Promise.all([
    db.post.findMany({ where: posts, distinct: ["platform"], select: { platform: true } }),
    db.post.count({
      where: {
        ...posts,
        OR: [
          { fetchState: REMOVED_FETCH_STATE },
          { platformMetrics: { path: reason, equals: REMOVED_FETCH_REASON } },
          { platformMetrics: { path: reason, equals: HIDDEN_FETCH_REASON } },
        ],
      },
    }),
    loadCampaignRules(campaignId, orgId),
  ]);
  const present = new Set<string>(platformRows.map((r) => r.platform));
  return {
    platforms: SHARE_PLATFORMS.filter((p) => present.has(p)),
    hasBudget: budget != null && budget > 0,
    hasBrief: !!rules && (rules.dos.length + rules.donts.length + rules.examplePostUrls.length > 0 || !!rules.viewGoal),
    removedPosts,
  };
}

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const result = await authenticateRequest(req);
  if (!result) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const { orgId } = result;
  const { id } = await params;

  /* Row scope, same as GET /api/campaigns/[id]. Creating a public link to a
     campaign is the strongest thing a seat can do with it, so an ASSIGNED seat
     that cannot open the campaign must not be able to read, mint, retarget or
     revoke its share link either. */
  const campaign = await findCampaignForShare(result, id, { allowDeleted: true });
  if (!campaign) return NextResponse.json({ error: "Campaign not found" }, { status: 404 });

  /* The facts only decide which switches the dialog draws. If reading them
     fails, the link is still answered and `facts` is null, which the dialog
     reads as "show every switch" -- what it did before they existed. */
  const [link, facts] = await Promise.all([
    findShareLink(orgId, id),
    readShareFacts(orgId, id, campaign.budget).catch((e) => {
      console.error("[share] could not read share facts", e);
      return null;
    }),
  ]);
  return NextResponse.json({ link: link && link.isPublic ? serialize(link) : null, facts });
}

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  /* A share link publishes the campaign to anyone holding the URL, so minting,
     retargeting and revoking one is a write: VIEWER (and read-only act-as)
     could do all three while every other campaign write refused them. */
  const gate = await requirePermission(req, "campaigns:edit_own");
  if (!gate.ok) return gate.response;
  const result = gate.auth;
  const { orgId, userId } = result;
  const { id } = await params;

  const campaign = await findCampaignForShare(result, id, { allowDeleted: false });
  if (!campaign) return NextResponse.json({ error: "Campaign not found" }, { status: 404 });

  const token = randomBytes(32).toString("base64url");
  const existing = await findShareLink(orgId, id);
  const visibility = await readVisibility(req);

  if (existing) {
    const updated = await db.report.update({
      where: { id: existing.id },
      data: { shareToken: token, isPublic: true, config: { kind: SHARE_KIND, visibility } },
    });
    return NextResponse.json({ link: serialize(updated) }, { status: 201 });
  }

  const baseSlug = slugify(`share ${campaign.title}`) || "share";
  let slug = baseSlug;
  let counter = 1;
  while (await db.report.findUnique({ where: { orgId_slug: { orgId, slug } } })) {
    slug = `${baseSlug}-${counter++}`;
  }

  const created = await db.report.create({
    data: {
      orgId,
      campaignId: id,
      title: `${campaign.title} — Performance`,
      slug,
      shareToken: token,
      isPublic: true,
      config: { kind: SHARE_KIND, visibility },
      createdById: userId,
    },
  });

  return NextResponse.json({ link: serialize(created) }, { status: 201 });
}

/**
 * Changes what an existing link shows, without touching the token.
 *
 * Deliberately not POST: that rotates the token, and someone toggling "show
 * budget" is not asking to break a URL they have already emailed to a client.
 */
export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const gate = await requirePermission(req, "campaigns:edit_own");
  if (!gate.ok) return gate.response;
  const result = gate.auth;
  const { orgId } = result;
  const { id } = await params;

  const campaign = await findCampaignForShare(result, id, { allowDeleted: true });
  if (!campaign) return NextResponse.json({ error: "Campaign not found" }, { status: 404 });

  const link = await findShareLink(orgId, id);
  if (!link || !link.isPublic) {
    return NextResponse.json({ error: "No active share link" }, { status: 404 });
  }

  const visibility = await readVisibility(req);
  const updated = await db.report.update({
    where: { id: link.id },
    data: { config: { kind: SHARE_KIND, visibility } },
  });

  return NextResponse.json({ link: serialize(updated) });
}

export async function DELETE(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const gate = await requirePermission(req, "campaigns:edit_own");
  if (!gate.ok) return gate.response;
  const result = gate.auth;
  const { orgId } = result;
  const { id } = await params;

  const campaign = await findCampaignForShare(result, id, { allowDeleted: true });
  if (!campaign) return NextResponse.json({ error: "Campaign not found" }, { status: 404 });

  const link = await findShareLink(orgId, id);
  if (link) {
    await db.report.update({ where: { id: link.id }, data: { isPublic: false } });
  }

  return NextResponse.json({ link: null });
}
