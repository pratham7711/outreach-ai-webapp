import { extractContactRoutes, type ContactRoute } from "@/lib/creatorFinder/contactRoutes";
import { readYouTubeChannel, YouTubeQuotaError, type YouTubeChannelCard } from "@/lib/creatorFinder/youtubeChannel";
import { getAgencyDiscoveryCredential } from "@/lib/platforms/instagramAgencyCredential";
import { readDiscoveryProfile, type DiscoveryProfileView } from "@/lib/platforms/instagramDiscoveryProfile";
import { InstagramAuthError, InstagramNoSuchAccountError } from "@/lib/platforms/instagram";
import { createLogger } from "@/lib/observability/logger";

const log = createLogger({ context: { call: "creatorFinder.liveProfile" } });

export type LiveProfileRead =
  | { ok: true; platform: "YOUTUBE"; youtube: YouTubeChannelCard; contactRoutes: ContactRoute[]; readAt: string }
  | {
      ok: true;
      platform: "INSTAGRAM";
      instagram: DiscoveryProfileView;
      contactRoutes: ContactRoute[];
      via: { username: string | null };
      readAt: string;
    }
  | { ok: false; status: number; error: string; reason: string };

type ProspectRef = { platform: string; handle: string; channelId: string | null };

const refuse = (status: number, error: string, reason: string): LiveProfileRead => ({ ok: false, status, error, reason });

/**
 * A prospect's public profile, read live and never stored. The drawer and the
 * AI read both start here, so they see the same profile and fail the same way.
 *
 * Instagram goes through Business Discovery on the agency's OWN connected
 * account only, the same rule as /api/creators/[id]/instagram-discovery; an org
 * without one is asked to connect it. YouTube uses the platform API key.
 */
export async function readLiveProfile(orgId: string, prospect: ProspectRef): Promise<LiveProfileRead> {
  const readAt = new Date().toISOString();

  if (prospect.platform === "YOUTUBE") {
    try {
      const channel = await readYouTubeChannel(prospect.channelId ?? prospect.handle);
      if (!channel) return refuse(404, "no_such_channel", `YouTube has no channel @${prospect.handle}.`);
      return { ok: true, platform: "YOUTUBE", youtube: channel, contactRoutes: extractContactRoutes({ bio: channel.description }), readAt };
    } catch (e) {
      if (e instanceof YouTubeQuotaError)
        return refuse(429, "youtube_quota", "YouTube's daily allowance is used up. It resets at midnight Pacific time.");
      if (e instanceof Error && e.message === "no-credentials") return refuse(503, "no_youtube_key", "YouTube isn't configured on this server.");
      log.error("YouTube channel read failed", { message: e instanceof Error ? e.message : String(e) });
      return refuse(502, "unreadable", "YouTube did not answer just now. Try again in a moment.");
    }
  }

  const agency = await getAgencyDiscoveryCredential(orgId);
  if (!agency)
    return refuse(
      409,
      "no_agency_account",
      "Connect your agency's Instagram professional account in Settings > Integrations to read public Instagram profiles.",
    );
  try {
    const profile = await readDiscoveryProfile(prospect.handle, agency);
    if (!profile) return refuse(502, "unreadable", "Instagram did not answer just now. Try again in a moment.");
    return {
      ok: true,
      platform: "INSTAGRAM",
      instagram: profile,
      contactRoutes: extractContactRoutes({ bio: profile.biography, website: profile.website }),
      via: { username: agency.username },
      readAt,
    };
  } catch (err) {
    if (err instanceof InstagramAuthError)
      return refuse(409, "agency_reauthorize", "Instagram rejected your agency's connection. Reconnect it in Settings > Integrations.");
    if (err instanceof InstagramNoSuchAccountError)
      return refuse(
        404,
        "not_professional",
        `@${prospect.handle} is not a public Instagram Business or Creator account, so Instagram shares nothing about it.`,
      );
    log.error("Instagram prospect read failed", { message: err instanceof Error ? err.message : String(err) });
    return refuse(502, "unreadable", "Instagram did not answer just now. Try again in a moment.");
  }
}

/** One piece of profile text the AI may read, and the id a tag points back to. */
export type ProfileSource = { id: string; label: string; text: string; at: string | null };

export const AI_POST_LIMIT = 12;

/**
 * The text of a live profile, split into the sources a tag can cite: the bio
 * (with the website for Instagram) and each recent post's caption or title.
 * Empty sources are left out, so the AI is never shown a blank to label.
 */
export function profileSources(read: Extract<LiveProfileRead, { ok: true }>): ProfileSource[] {
  const out: ProfileSource[] = [];
  if (read.platform === "INSTAGRAM") {
    const p = read.instagram;
    const bio = [p.name, p.biography, p.website].filter((s): s is string => typeof s === "string" && !!s.trim()).join("\n");
    if (bio) out.push({ id: "bio", label: "Bio", text: bio, at: null });
    for (const m of p.media.slice(0, AI_POST_LIMIT)) {
      if (m.caption?.trim()) out.push({ id: `post:${m.id}`, label: "Post caption", text: m.caption, at: m.postedAt });
    }
  } else {
    const c = read.youtube;
    const about = [c.title, c.description].filter((s): s is string => typeof s === "string" && !!s.trim()).join("\n");
    if (about) out.push({ id: "bio", label: "Channel description", text: about, at: null });
    for (const v of c.recent.slice(0, AI_POST_LIMIT)) {
      if (v.title.trim()) out.push({ id: `post:${v.id}`, label: "Video title", text: v.title, at: v.publishedAt });
    }
  }
  return out;
}
