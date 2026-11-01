import { db } from "@/lib/db";
import type { Platform } from "@/lib/generated/prisma/client";
import { NOT_REMOVED } from "@/lib/posts/removed";
import { platformLabel } from "@/lib/format";
import type { CampaignRules } from "@/lib/campaigns/rulesShape";
import { followerReading } from "./followerReading";
import { checkSubmissionRules, type RuleCheck } from "./submissionRules";

/**
 * The campaign's submission rules checked for one creator on one platform,
 * from what we have measured: the creator's follower reading, and the live
 * posts they already have on the campaign on that platform. The detail route
 * calls this without a caption (those rules show as "checked when you
 * submit"); the submit route calls it again with the caption it read.
 */
export async function ruleChecksFor(
  rules: CampaignRules | null,
  input: { campaignId: string; creatorId: string; platform: string; caption?: string | null },
): Promise<RuleCheck[]> {
  if (!rules) return [];
  const needsFollowers = !!rules.minFollowers;
  const needsCount = !!rules.maxPostsPerAccount;
  const [followers, postsOnAccount] = await Promise.all([
    needsFollowers ? followerReading(input.creatorId, input.platform) : Promise.resolve(null),
    needsCount
      ? db.post.count({
          where: {
            campaignId: input.campaignId,
            creatorId: input.creatorId,
            platform: input.platform as Platform,
            ...NOT_REMOVED,
          },
        })
      : Promise.resolve(0),
  ]);
  return checkSubmissionRules(rules, {
    followers,
    caption: input.caption,
    postsOnAccount,
    platformLabel: platformLabel(input.platform),
  });
}
