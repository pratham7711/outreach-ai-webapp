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
  tiktok: "TikTok",
  youtube: "YouTube",
};

const DEFAULT_CONNECT: Record<OAuthPlatform, StatusRule> = {
  instagram: "gated",
  tiktok: "coming_soon",
  youtube: "auto",
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
  tiktok: null,
  youtube: "YOUTUBE_API_KEY",
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
