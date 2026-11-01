/**
 * When a campaign went live, for the marker its charts draw and the "before vs
 * since" figures beside them.
 *
 * A launch date the team set wins. Without one it is the first post's time:
 * the moment the campaign started producing views is a measured fact, so the
 * marker needs nothing typed in. A campaign with neither has no launch, and its
 * charts draw no marker.
 */

export type CampaignLaunch = {
  /** ISO instant. */
  at: string;
  /** The UTC day of `at`, YYYY-MM-DD: the day charts keyed by day mark. */
  day: string;
  /** "launchDate" when the team set one, "firstPost" when it is the first post's time. */
  source: "launchDate" | "firstPost";
};

export function campaignLaunch(firstPostAt: Date | string | null | undefined, launchAt?: Date | string | null): CampaignLaunch | null {
  const pick = launchAt ?? firstPostAt ?? null;
  if (!pick) return null;
  const at = new Date(pick);
  if (Number.isNaN(at.getTime())) return null;
  const iso = at.toISOString();
  return { at: iso, day: iso.slice(0, 10), source: launchAt ? "launchDate" : "firstPost" };
}

/** The earliest postedAt among posts already loaded; null when none carries one. */
export function earliestPostedAt(posts: readonly { postedAt: Date | string | null }[]): Date | null {
  let min: number | null = null;
  for (const p of posts) {
    if (!p.postedAt) continue;
    const t = new Date(p.postedAt).getTime();
    if (!Number.isNaN(t) && (min === null || t < min)) min = t;
  }
  return min === null ? null : new Date(min);
}

/** "First post" or "Launch", for the marker and the copy that names it. */
export function launchLabel(launch: CampaignLaunch): string {
  return launch.source === "launchDate" ? "Launch" : "First post";
}

/** "12 Oct", the launch's UTC day. */
export function launchShortDay(launch: CampaignLaunch): string {
  return new Date(`${launch.day}T00:00:00Z`).toLocaleDateString("en-GB", { day: "numeric", month: "short", timeZone: "UTC" });
}
