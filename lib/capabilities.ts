import { OAUTH_PLATFORMS, isProviderConfigured, type OAuthPlatform } from "@/lib/oauth/providers";

export type CapabilityStatus = "live" | "gated" | "coming_soon";

type StatusRule = CapabilityStatus | "auto";

export type PlatformCapability = {
  platform: OAuthPlatform;
  label: string;
  connect: CapabilityStatus;
  metrics: CapabilityStatus;
  connectNote: string;
  metricsNote: string;
};

export type CapabilityReport = {
  platforms: PlatformCapability[];
  anyConnectLive: boolean;
  anyMetricsLive: boolean;
};

const LABELS: Record<OAuthPlatform, string> = {
  instagram: "Instagram",
  /* Named by what the creator has to have, not by which Meta product the token
     comes from: the only question a creator can answer about themselves is
     whether their Instagram is linked to a Facebook Page. */
  "instagram-login": "Instagram (no Facebook Page)",
  tiktok: "TikTok",
  youtube: "YouTube",
  facebook: "Facebook",
  threads: "Threads",
};

const DEFAULT_CONNECT: Record<OAuthPlatform, StatusRule> = {
  /* Was a hardcoded "gated", which renders the Connect button anyway and only
     changes the note beside it -- so the card read "Instagram sign-in is
     unavailable right now" next to a button that works, which is the worst of
     both for a reviewer. INSTAGRAM_CLIENT_ID/SECRET are set on production, so
     auto resolves live there and gated on any environment without them. */
  instagram: "auto",
  /* "auto": live wherever INSTAGRAM_LOGIN_CLIENT_ID/SECRET are set, gated
     everywhere else. Gated does NOT hide the Connect button — measured in the
     browser 2026-09-09, it renders for every status except coming_soon — so the
     settings screen shows the capability's note beside it, and the start route
     redirects back with reason=provider rather than answering raw JSON. Without
     both, this card was a button whose only outcome was an unexplained error. */
  "instagram-login": "auto",
  /* "auto" rather than coming_soon, which is the only status that hides the
     card entirely -- so TikTok had no reachable Connect button and none of the
     four Login Kit scopes could be demonstrated to a reviewer. auto resolves
     live only where TIKTOK_CLIENT_KEY and TIKTOK_CLIENT_SECRET are both set
     (both are, on production), and gated everywhere else, so this asserts the
     credentials exist rather than that the app is approved. */
  tiktok: "auto",
  youtube: "auto",
  /* Both are "auto": live wherever their client id and secret are configured,
     and absent everywhere else. Neither is gated behind approval the way
     Instagram is, because until the Meta review clears, the credentials simply
     will not be set in an environment a real creator can reach. */
  facebook: "auto",
  threads: "auto",
};

/**
 * The credential a platform's metric collector needs, or null when it needs
 * none.
 *
 * TikTok is null, and that is a correction rather than a simplification. It
 * used to name SOCIALKIT_API_KEY, which is the *third* rung of
 * fetchTikTokMetrics: the first is a keyless read of the video page's
 * rehydration blob, and unlike TikTok's profile and music pages, video pages
 * answer Vercel egress. Measured on production 2026-09-01: 422 cron-written
 * TikTok post snapshots with counts genuinely moving (336 -> 952 views on one
 * post), and no SOCIALKIT_API_KEY set anywhere.
 *
 * The cost of the old answer was not internal. TikTok is 15,324 of the 18,690
 * posts on production, and the onboarding step read "Instagram and YouTube
 * counts refresh on their own" -- telling a new user that the platform holding
 * 82% of their posts was the one that would not update, while it was in fact
 * updating hourly. A capability report that understates is not the safe
 * direction to be wrong in; it just makes the product look less finished than
 * it is, and invites someone to go buy a key they do not need.
 */
const METRICS_ENV: Record<OAuthPlatform, string | null> = {
  instagram: "INSTAGRAM_BUSINESS_TOKEN",
  /* No agency-side collector, and there cannot be one: business_discovery is a
     Facebook-Login-path edge, so a creator who connected without a Page is
     readable only through their own token. Metrics are live the moment they
     connect and need no credential of ours. */
  "instagram-login": null,
  tiktok: null,
  youtube: "YOUTUBE_API_KEY",
  /* Neither has an agency-side collector: there is no app token that reads a
     stranger's Page or Threads profile the way INSTAGRAM_BUSINESS_TOKEN reads a
     business account. Both are creator-authorised only, so the metrics path is
     live as soon as a creator connects and needs no credential of ours. */
  facebook: null,
  threads: null,
};

function isStatusRule(value: string): value is StatusRule {
  return value === "live" || value === "gated" || value === "coming_soon" || value === "auto";
}

function connectOverrides(): Partial<Record<OAuthPlatform, StatusRule>> {
  const raw = process.env.PLATFORM_CONNECT_STATUS;
  if (!raw) return {};

  const overrides: Partial<Record<OAuthPlatform, StatusRule>> = {};
  for (const entry of raw.split(",")) {
    const [platform, status] = entry.split(":").map((part) => part.trim().toLowerCase());
    if (!platform || !status) continue;
    if (!(OAUTH_PLATFORMS as readonly string[]).includes(platform)) continue;
    if (!isStatusRule(status)) continue;
    overrides[platform as OAuthPlatform] = status;
  }
  return overrides;
}

function resolveRule(platform: OAuthPlatform, rule: StatusRule): CapabilityStatus {
  if (rule !== "auto") return rule;
  return isProviderConfigured(platform) ? "live" : "gated";
}

function connectNote(platform: OAuthPlatform, status: CapabilityStatus): string {
  if (status === "live") return "Connect your account so metrics sync automatically.";
  if (status === "coming_soon") {
    return `${LABELS[platform]} sign-in is awaiting platform approval. It will appear here the moment it is live.`;
  }
  return `${LABELS[platform]} sign-in is unavailable right now. Submit your post URL instead and we will still track it.`;
}

function metricsNote(platform: OAuthPlatform, status: CapabilityStatus): string {
  if (status === "live") return "Public metrics are collected automatically once a post URL is submitted.";
  return `${LABELS[platform]} metrics cannot be collected on this environment yet, so counts will not update.`;
}

export function resolvePlatformCapability(platform: OAuthPlatform): PlatformCapability {
  const rule = connectOverrides()[platform] ?? DEFAULT_CONNECT[platform];
  const connect = resolveRule(platform, rule);
  const metricsEnv = METRICS_ENV[platform];
  const metrics: CapabilityStatus =
    metricsEnv === null || process.env[metricsEnv] ? "live" : "coming_soon";

  return {
    platform,
    label: LABELS[platform],
    connect,
    metrics,
    connectNote: connectNote(platform, connect),
    metricsNote: metricsNote(platform, metrics),
  };
}

export function resolveCapabilities(): CapabilityReport {
  const platforms = OAUTH_PLATFORMS.map(resolvePlatformCapability);
  return {
    platforms,
    anyConnectLive: platforms.some((p) => p.connect === "live"),
    anyMetricsLive: platforms.some((p) => p.metrics === "live"),
  };
}

export function isConnectComingSoon(platform: OAuthPlatform): boolean {
  return resolvePlatformCapability(platform).connect === "coming_soon";
}
