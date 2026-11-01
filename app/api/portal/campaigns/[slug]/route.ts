import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { NOT_REMOVED } from "@/lib/posts/removed";
import { getCreatorSession } from "@/lib/creator-auth";
import { parseRatePerThousand, earnedMinorForPost } from "@/lib/marketplace/earnings";
import { isPortalCampaignActionable } from "@/lib/marketplace/portalVisibility";
import { isCampaignIdKey, resolvePortalAccess } from "@/lib/portal/campaignAccess";
import { campaignDates } from "@/lib/portal/campaignDates";
import { fieldMetricValue } from "@/lib/metricDisplay";
import { boostCodesAllowed, loadCampaignRules, scheduledUntil } from "@/lib/campaigns/rules";
import { ruleChecksFor } from "@/lib/portal/ruleChecks";
import { loadAnnotationsForPosts } from "@/lib/posts/annotations";

const CAMPAIGN_SELECT = {
  id: true,
  orgId: true,
  title: true,
  status: true,
  publicSlug: true,
  currency: true,
  guidelines: true,
  requirements: true,
  contentAssetsUrl: true,
  ratePerThousand: true,
  minPayoutMinor: true,
  submissionDeadline: true,
  marketplaceVisibility: true,
  deletedAt: true,
  org: { select: { name: true, logoUrl: true } },
  brief: { select: { content: true } },
  phases: {
    select: { name: true, startDate: true, endDate: true },
    orderBy: { sequence: "asc" as const },
  },
} as const;

/**
 * GET /api/portal/campaigns/<slug-or-id> -- the creator app's Campaign screen.
 *
 * The key is a marketplace campaign's public slug or, for an agency's private
 * campaign (which has none), its id. Who may see it is decided in
 * lib/portal/campaignAccess.ts: a GLOBAL campaign is public; anything else
 * needs the creator's own activation, and on a PRIVATE campaign that
 * activation must hang off a roster row linked to this login rather than one
 * that merely shares the handle (F10).
 */
export async function GET(
  _request: Request,
  { params }: { params: Promise<{ slug: string }> }
) {
  try {
    const session = await getCreatorSession();
    if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

    const { slug } = await params;

    const campaign =
      (await db.campaign.findUnique({ where: { publicSlug: slug }, select: CAMPAIGN_SELECT })) ??
      (isCampaignIdKey(slug)
        ? await db.campaign.findUnique({ where: { id: slug }, select: CAMPAIGN_SELECT })
        : null);

    if (!campaign || campaign.deletedAt) {
      return NextResponse.json({ error: "Campaign not found" }, { status: 404 });
    }

    /* marketplaceVisibility was selected and never read, so a campaign pulled
       back to PRIVATE (or one that was only ever INVITE_ONLY) kept serving its
       guidelines, per-platform rates, deadline and internal id to any logged-in
       portal creator who had the slug — the reverse of the filter every other
       public surface applies (lib/marketplace/public.ts, and the join gate in
       lib/marketplace/join.ts). The rule now lives in one place, because the
       submissions and draft routes behind the same slug have to apply it too. */
    const access = await resolvePortalAccess(session, campaign);
    if (!access.visible) {
      return NextResponse.json({ error: "Campaign not found" }, { status: 404 });
    }
    const activation = access.activation;

    const rates = parseRatePerThousand(campaign.ratePerThousand);

    let submissions: {
      id: string;
      postUrl: string;
      platform: string;
      status: string;
      viewsCount: number;
      /** What the page may print: null when views were not measured. */
      views: number | null;
      thumbnailUrl: string | null;
      caption: string | null;
      rejectionReason: string | null;
      createdAt: Date;
      lastSyncedAt: Date | null;
      earnedMinor: number;
      /** The ad-authorization code the creator gave the agency, if any. */
      boostCode: string | null;
      boostCodeExpiresAt: string | null;
    }[] = [];

    if (activation) {
      const posts = await db.post.findMany({
        where: { activationId: activation.id, ...NOT_REMOVED },
        select: {
          id: true,
          postUrl: true,
          platform: true,
          status: true,
          viewsCount: true,
          thumbnailUrl: true,
          caption: true,
          rejectionReason: true,
          createdAt: true,
          lastSyncedAt: true,
          platformMetrics: true,
        },
        orderBy: { createdAt: "desc" },
      });
      /* The bag holds the importer's record and our fetch notes, which are not
         the creator's to read, so only the verdict on views leaves here. */
      /* Only the creator's own code and its expiry; the rule notes are for
         the agency. */
      const notes = await loadAnnotationsForPosts(posts.map((p) => p.id), campaign.orgId);
      submissions = posts.map(({ platformMetrics, ...p }) => ({
        ...p,
        views: fieldMetricValue(p.viewsCount, p.lastSyncedAt, platformMetrics, "views"),
        earnedMinor:
          p.status === "APPROVED" ? earnedMinorForPost(p.viewsCount, p.platform, rates) : 0,
        boostCode: notes[p.id]?.boostCode ?? null,
        boostCodeExpiresAt: notes[p.id]?.boostCodeExpiresAt ?? null,
      }));
    }

    const deadlinePassed =
      !!campaign.submissionDeadline && campaign.submissionDeadline.getTime() < Date.now();

    /* The agency's checklist and submission rules (lib/campaigns/rules). A
       launch date still ahead holds the campaign closed to posts: whoever can
       already see it reads the brief, and submitting opens on that date. */
    const [rules, boostCodes] = await Promise.all([
      loadCampaignRules(campaign.id, campaign.orgId),
      boostCodesAllowed(campaign.id, campaign.orgId),
    ]);
    const opensAt = scheduledUntil(rules, Date.now());
    let ruleChecks: Awaited<ReturnType<typeof ruleChecksFor>> = [];
    let ruleChecksPlatform: string | null = null;
    if (rules && activation && access.creatorId) {
      /* Checked against the roster row's own platform: a creator's row is one
         account, and the submit route checks the post's platform again. */
      const roster = await db.creator.findUnique({ where: { id: access.creatorId }, select: { platform: true } });
      if (roster) {
        ruleChecksPlatform = roster.platform;
        ruleChecks = await ruleChecksFor(rules, {
          campaignId: campaign.id,
          creatorId: access.creatorId,
          platform: roster.platform,
        });
      }
    }

    return NextResponse.json({
      campaign: {
        id: campaign.id,
        title: campaign.title,
        slug: campaign.publicSlug,
        status: campaign.status,
        /* Whether this creator could join it from here: a marketplace campaign
           they are not on yet. A private one is reached by invite instead. */
        joinable:
          !activation &&
          !!campaign.publicSlug &&
          campaign.marketplaceVisibility !== "PRIVATE" &&
          isPortalCampaignActionable(campaign.status) &&
          !deadlinePassed &&
          !opensAt,
        acceptsPosts: isPortalCampaignActionable(campaign.status) && !deadlinePassed && !opensAt,
        scheduledUntil: opensAt,
        checklist: rules
          ? { dos: rules.dos, donts: rules.donts, examples: rules.examplePostUrls }
          : { dos: [], donts: [], examples: [] },
        ruleChecks,
        /* The platform those checks were made for: a post on another platform
           is checked again, against that platform, when it is submitted. */
        ruleChecksPlatform,
        marketplace: campaign.marketplaceVisibility !== "PRIVATE",
        /* Whether the agency asks for boost codes on this campaign; codes a
           creator already gave are still listed under submissions. */
        boostCodes,
        currency: campaign.currency,
        brief: campaign.brief?.content?.trim() || null,
        guidelines: campaign.guidelines,
        requirements: campaign.requirements,
        contentAssetsUrl: campaign.contentAssetsUrl,
        rates,
        minPayoutMinor: campaign.minPayoutMinor,
        submissionDeadline: campaign.submissionDeadline,
        deadlinePassed,
        dates: campaignDates({
          deliverableDueDate: activation?.deliverableDueDate ?? null,
          submissionDeadline: campaign.submissionDeadline,
          phases: campaign.phases,
        }),
        orgName: campaign.org.name,
        orgLogoUrl: campaign.org.logoUrl,
      },
      joined: !!activation,
      draft: activation
        ? {
            status: activation.status,
            draftUrl: activation.draftUrl,
            draftCaption: activation.draftCaption,
            draftMediaType: activation.draftMediaType,
            draftSubmittedAt: activation.draftSubmittedAt,
            feedbackNotes: activation.feedbackNotes,
          }
        : null,
      submissions,
    });
  } catch (error) {
    console.error("Failed to fetch campaign detail:", error);
    return NextResponse.json({ error: "Failed to fetch campaign" }, { status: 500 });
  }
}
