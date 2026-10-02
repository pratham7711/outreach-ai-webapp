/**
 * The platforms the readers read, as the ops guards name them. A kill switch
 * is "source:<name>" and a breaker "<reader>:<name>"; anything not listed here
 * (Twitch, LinkedIn) has no reader behind it and is never guarded.
 */
export const OPS_SOURCES = ["tiktok", "instagram", "youtube"] as const;
export type OpsSource = (typeof OPS_SOURCES)[number];

const PLATFORM_OF: Record<OpsSource, "TIKTOK" | "INSTAGRAM" | "YOUTUBE"> = {
  tiktok: "TIKTOK",
  instagram: "INSTAGRAM",
  youtube: "YOUTUBE",
};

export function platformOfSource(source: OpsSource): "TIKTOK" | "INSTAGRAM" | "YOUTUBE" {
  return PLATFORM_OF[source];
}

export function sourceOfPlatform(platform: string | null | undefined): OpsSource | null {
  const p = String(platform ?? "").toUpperCase();
  return OPS_SOURCES.find((s) => PLATFORM_OF[s] === p) ?? null;
}
