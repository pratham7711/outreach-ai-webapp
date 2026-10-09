import { platformLabel } from "@/lib/format";
import { PLATFORM_VALUES } from "@/lib/platforms/constants";

/**
 * Recognising the holding row a post goes under when nobody can say who posted
 * it (lib/posts/unattributedCreator), without importing the database.
 *
 * Split out so a client component can ask the question: the post list, the
 * shared report and the add dialog all have to show "Creator unknown" in place
 * of the row's reserved name, which is a filing label of ours and was reaching
 * a brand's report verbatim.
 *
 * Every platform, not the four that were listed: the add route files any
 * detected platform here, so a Facebook post nobody could place got a row its
 * own filters did not recognise.
 */

const NAME_SUFFIX = "posts";

export function unattributedCreatorName(platform: string): string {
  return `Unattributed ${platformLabel(platform)} ${NAME_SUFFIX}`;
}

/** Every reserved name, for filters that cannot know the platform in advance. */
export const UNATTRIBUTED_CREATOR_NAMES: readonly string[] = PLATFORM_VALUES.map(unattributedCreatorName);

export function isUnattributedCreator(creator: { handle: string | null; name: string } | null | undefined): boolean {
  return Boolean(creator) && (creator!.handle ?? "") === "" && UNATTRIBUTED_CREATOR_NAMES.includes(creator!.name);
}

/** What a screen says in place of the holding row's name. */
export const UNKNOWN_CREATOR_LABEL = "Creator unknown";

/**
 * Why the post has no creator, said about one post. The platform would not
 * name the account: on 2026-10-09 Instagram's oEmbed refused all ten such posts
 * on LKM's campaigns and the embed page named nobody, which is what a private
 * account, a trial reel (shown only to non-followers) or a removed post looks
 * like from outside.
 */
export function unknownCreatorReason(platform: string | null | undefined): string {
  const label = platformLabel(platform) || "The platform";
  return platform === "INSTAGRAM"
    ? `${label} won’t show us this post (private, trial reel or removed)`
    : `${label} won’t say who posted this`;
}
