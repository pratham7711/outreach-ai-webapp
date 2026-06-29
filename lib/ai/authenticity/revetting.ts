export interface Snapshot {
  at?: string;
  authenticityScore: number;
  followers: number;
  engagementRate: number;
  audienceCountryShares?: Record<string, number>;
}

export type AnomalyType =
  | "GEOGRAPHIC_ANOMALY"
  | "ENGAGEMENT_DROP"
  | "AUTHENTICITY_DROP"
  | "FOLLOWER_SPIKE";

export type AnomalySeverity = "low" | "medium" | "high";

export interface AnomalyEvent {
  type: AnomalyType;
  severity: AnomalySeverity;
  detail: string;
  delta: number;
}

export interface AnomalyThresholds {
  geographicTopShareShift?: number;
  geographicMajorityCrossing?: number;
  engagementDropFraction?: number;
  authenticityDropPoints?: number;
  followerSpikeFraction?: number;
  followerSpikeAbsoluteFloor?: number;
}

export const DEFAULT_GEOGRAPHIC_TOP_SHARE_SHIFT = 0.25;
export const DEFAULT_GEOGRAPHIC_MAJORITY_CROSSING = 0.5;
export const DEFAULT_ENGAGEMENT_DROP_FRACTION = 0.4;
export const DEFAULT_AUTHENTICITY_DROP_POINTS = 15;
export const DEFAULT_FOLLOWER_SPIKE_FRACTION = 0.5;
export const DEFAULT_FOLLOWER_SPIKE_ABSOLUTE_FLOOR = 1000;

function safeNumber(value: number): number {
  return Number.isFinite(value) ? value : 0;
}

function severityForRatio(magnitude: number, threshold: number): AnomalySeverity {
  if (!Number.isFinite(magnitude) || !Number.isFinite(threshold) || threshold <= 0) {
    return "low";
  }
  const ratio = magnitude / threshold;
  if (ratio >= 2) return "high";
  if (ratio >= 1.5) return "medium";
  return "low";
}

function topShare(shares: Record<string, number> | undefined): { country: string; share: number } {
  if (!shares) return { country: "", share: 0 };
  let country = "";
  let share = 0;
  for (const [key, value] of Object.entries(shares)) {
    const safe = safeNumber(value);
    if (safe > share) {
      share = safe;
      country = key;
    }
  }
  return { country, share };
}

function shareOf(shares: Record<string, number> | undefined, country: string): number {
  if (!shares || country === "") return 0;
  return safeNumber(shares[country]);
}

function detectGeographic(
  previous: Snapshot,
  current: Snapshot,
  shareShift: number,
  majorityCrossing: number,
): AnomalyEvent | null {
  const prevTop = topShare(previous.audienceCountryShares);
  const currTop = topShare(current.audienceCountryShares);

  const prevTopInCurrent = shareOf(current.audienceCountryShares, prevTop.country);
  const currTopInPrevious = shareOf(previous.audienceCountryShares, currTop.country);

  const topShiftDown = prevTop.share - prevTopInCurrent;
  const topShiftUp = currTop.share - currTopInPrevious;
  const topShift = Math.max(topShiftDown, topShiftUp);

  const crossedUp = currTopInPrevious < majorityCrossing && currTop.share > majorityCrossing;

  if (topShift > shareShift || crossedUp) {
    const magnitude = Math.max(topShift, crossedUp ? currTop.share - currTopInPrevious : 0);
    const detail = crossedUp
      ? `Country ${currTop.country} crossed the majority line (${(currTopInPrevious * 100).toFixed(0)}% -> ${(currTop.share * 100).toFixed(0)}%)`
      : `Top-country share shifted by ${(topShift * 100).toFixed(0)} points`;
    return {
      type: "GEOGRAPHIC_ANOMALY",
      severity: severityForRatio(magnitude, shareShift),
      detail,
      delta: safeNumber(magnitude),
    };
  }
  return null;
}

function detectEngagementDrop(
  previous: Snapshot,
  current: Snapshot,
  dropFraction: number,
): AnomalyEvent | null {
  const prev = safeNumber(previous.engagementRate);
  const curr = safeNumber(current.engagementRate);
  if (prev <= 0) return null;

  const relativeDrop = (prev - curr) / prev;
  if (!Number.isFinite(relativeDrop)) return null;

  if (relativeDrop > dropFraction) {
    return {
      type: "ENGAGEMENT_DROP",
      severity: severityForRatio(relativeDrop, dropFraction),
      detail: `Engagement rate fell ${(relativeDrop * 100).toFixed(0)}% relative to the previous snapshot`,
      delta: relativeDrop,
    };
  }
  return null;
}

function detectAuthenticityDrop(
  previous: Snapshot,
  current: Snapshot,
  dropPoints: number,
): AnomalyEvent | null {
  const prev = safeNumber(previous.authenticityScore);
  const curr = safeNumber(current.authenticityScore);
  const drop = prev - curr;

  if (drop > dropPoints) {
    return {
      type: "AUTHENTICITY_DROP",
      severity: severityForRatio(drop, dropPoints),
      detail: `Authenticity score dropped ${drop.toFixed(0)} points (${prev.toFixed(0)} -> ${curr.toFixed(0)})`,
      delta: drop,
    };
  }
  return null;
}

function detectFollowerSpike(
  previous: Snapshot,
  current: Snapshot,
  spikeFraction: number,
  absoluteFloor: number,
): AnomalyEvent | null {
  const prev = safeNumber(previous.followers);
  const curr = safeNumber(current.followers);

  if (prev <= 0) {
    if (curr > absoluteFloor) {
      return {
        type: "FOLLOWER_SPIKE",
        severity: severityForRatio(curr, absoluteFloor),
        detail: `Followers jumped from a zero baseline to ${curr.toFixed(0)}`,
        delta: curr,
      };
    }
    return null;
  }

  const relativeGrowth = (curr - prev) / prev;
  if (!Number.isFinite(relativeGrowth)) return null;

  if (relativeGrowth > spikeFraction) {
    return {
      type: "FOLLOWER_SPIKE",
      severity: severityForRatio(relativeGrowth, spikeFraction),
      detail: `Followers grew ${(relativeGrowth * 100).toFixed(0)}% in one step (${prev.toFixed(0)} -> ${curr.toFixed(0)})`,
      delta: relativeGrowth,
    };
  }
  return null;
}

export function detectAnomalies(
  previous: Snapshot,
  current: Snapshot,
  opts?: AnomalyThresholds,
): AnomalyEvent[] {
  const shareShift = safeNumber(opts?.geographicTopShareShift ?? DEFAULT_GEOGRAPHIC_TOP_SHARE_SHIFT);
  const majorityCrossing = safeNumber(
    opts?.geographicMajorityCrossing ?? DEFAULT_GEOGRAPHIC_MAJORITY_CROSSING,
  );
  const engagementDropFraction = safeNumber(
    opts?.engagementDropFraction ?? DEFAULT_ENGAGEMENT_DROP_FRACTION,
  );
  const authenticityDropPoints = safeNumber(
    opts?.authenticityDropPoints ?? DEFAULT_AUTHENTICITY_DROP_POINTS,
  );
  const followerSpikeFraction = safeNumber(
    opts?.followerSpikeFraction ?? DEFAULT_FOLLOWER_SPIKE_FRACTION,
  );
  const followerSpikeAbsoluteFloor = safeNumber(
    opts?.followerSpikeAbsoluteFloor ?? DEFAULT_FOLLOWER_SPIKE_ABSOLUTE_FLOOR,
  );

  const events: AnomalyEvent[] = [];

  const geographic = detectGeographic(previous, current, shareShift, majorityCrossing);
  if (geographic) events.push(geographic);

  const engagement = detectEngagementDrop(previous, current, engagementDropFraction);
  if (engagement) events.push(engagement);

  const authenticity = detectAuthenticityDrop(previous, current, authenticityDropPoints);
  if (authenticity) events.push(authenticity);

  const follower = detectFollowerSpike(
    previous,
    current,
    followerSpikeFraction,
    followerSpikeAbsoluteFloor,
  );
  if (follower) events.push(follower);

  return events;
}
