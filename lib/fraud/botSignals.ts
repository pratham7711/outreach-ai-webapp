export type MetricSnapshot = {
  recordedAt: string | Date;
  viewsCount: number;
  likesCount: number;
  commentsCount: number;
  sharesCount: number;
};

export type Velocity = {
  from: string;
  to: string;
  hours: number;
  viewsPerHour: number;
  engagementPerHour: number;
};

export type BotSignalType = "VIEW_SPIKE" | "LOW_ENGAGEMENT" | "BOT_PATTERN";
export type BotSignalSeverity = "LOW" | "MEDIUM" | "HIGH";

export type BotSignal = {
  type: BotSignalType;
  severity: BotSignalSeverity;
  detail: string;
  at: string;
};

const MIN_SNAPSHOTS = 3;
const VIEW_SPIKE_RATIO = 5;
const ENGAGEMENT_STABLE_RATIO = 1.5;
const LOW_ENGAGEMENT_RATE = 0.005;
const LOW_ENGAGEMENT_MIN_VIEWS = 10000;
const CONSTANT_CV = 0.1;
const CONSTANT_MIN_INTERVALS = 6;
const CONSTANT_MIN_VIEWS = 5000;

function isFiniteNumber(v: unknown): v is number {
  return typeof v === "number" && Number.isFinite(v);
}

function toIso(v: string | Date): string {
  return typeof v === "string" ? v : v.toISOString();
}

function toMs(v: string | Date): number {
  return typeof v === "string" ? new Date(v).getTime() : v.getTime();
}

function median(values: number[]): number {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0 ? (sorted[mid - 1] + sorted[mid]) / 2 : sorted[mid];
}

function mean(values: number[]): number {
  if (values.length === 0) return 0;
  return values.reduce((sum, v) => sum + v, 0) / values.length;
}

function stddev(values: number[]): number {
  if (values.length === 0) return 0;
  const m = mean(values);
  const variance = values.reduce((sum, v) => sum + (v - m) ** 2, 0) / values.length;
  return Math.sqrt(variance);
}

export function computeVelocities(series: MetricSnapshot[]): Velocity[] {
  const velocities: Velocity[] = [];
  for (let i = 1; i < series.length; i++) {
    const prev = series[i - 1];
    const curr = series[i];
    const prevMs = toMs(prev.recordedAt);
    const currMs = toMs(curr.recordedAt);
    if (!Number.isFinite(prevMs) || !Number.isFinite(currMs)) continue;
    const hours = (currMs - prevMs) / (1000 * 60 * 60);
    if (!Number.isFinite(hours) || hours <= 0) continue;

    const prevViews = isFiniteNumber(prev.viewsCount) ? prev.viewsCount : 0;
    const currViews = isFiniteNumber(curr.viewsCount) ? curr.viewsCount : 0;
    const prevLikes = isFiniteNumber(prev.likesCount) ? prev.likesCount : 0;
    const currLikes = isFiniteNumber(curr.likesCount) ? curr.likesCount : 0;
    const prevComments = isFiniteNumber(prev.commentsCount) ? prev.commentsCount : 0;
    const currComments = isFiniteNumber(curr.commentsCount) ? curr.commentsCount : 0;

    const deltaViews = Math.max(0, currViews - prevViews);
    const deltaEngagement = Math.max(0, currLikes + currComments - (prevLikes + prevComments));

    velocities.push({
      from: toIso(prev.recordedAt),
      to: toIso(curr.recordedAt),
      hours,
      viewsPerHour: deltaViews / hours,
      engagementPerHour: deltaEngagement / hours,
    });
  }
  return velocities;
}

export function detectBotSignals(series: MetricSnapshot[]): BotSignal[] {
  if (!Array.isArray(series) || series.length < MIN_SNAPSHOTS) return [];

  const signals: BotSignal[] = [];
  const velocities = computeVelocities(series);
  if (velocities.length === 0) return [];

  const viewRates = velocities.map((v) => v.viewsPerHour);
  const engRates = velocities.map((v) => v.engagementPerHour);
  const medViewRate = median(viewRates);
  const medEngRate = median(engRates);

  for (const v of velocities) {
    if (
      medViewRate > 0 &&
      v.viewsPerHour > VIEW_SPIKE_RATIO * medViewRate &&
      v.engagementPerHour < ENGAGEMENT_STABLE_RATIO * medEngRate
    ) {
      const ratio = v.viewsPerHour / medViewRate;
      const severity: BotSignalSeverity = ratio >= 10 ? "HIGH" : ratio >= 7 ? "MEDIUM" : "LOW";
      signals.push({
        type: "VIEW_SPIKE",
        severity,
        detail: `View velocity of ${Math.round(v.viewsPerHour).toLocaleString()}/h is ${ratio.toFixed(1)}x the median (${Math.round(medViewRate).toLocaleString()}/h) while engagement stayed flat`,
        at: v.to,
      });
    }
  }

  const last = series[series.length - 1];
  const totalViews = isFiniteNumber(last.viewsCount) ? last.viewsCount : 0;
  const totalLikes = isFiniteNumber(last.likesCount) ? last.likesCount : 0;
  const totalComments = isFiniteNumber(last.commentsCount) ? last.commentsCount : 0;
  if (totalViews > LOW_ENGAGEMENT_MIN_VIEWS) {
    const rate = (totalLikes + totalComments) / totalViews;
    if (Number.isFinite(rate) && rate < LOW_ENGAGEMENT_RATE) {
      const severity: BotSignalSeverity =
        rate < 0.001 ? "HIGH" : rate < 0.0025 ? "MEDIUM" : "LOW";
      signals.push({
        type: "LOW_ENGAGEMENT",
        severity,
        detail: `Cumulative engagement rate is ${(rate * 100).toFixed(3)}% on ${totalViews.toLocaleString()} views (below the ${(LOW_ENGAGEMENT_RATE * 100).toFixed(1)}% floor)`,
        at: toIso(last.recordedAt),
      });
    }
  }

  if (viewRates.length >= CONSTANT_MIN_INTERVALS && totalViews > CONSTANT_MIN_VIEWS) {
    const m = mean(viewRates);
    if (m > 0) {
      const cv = stddev(viewRates) / m;
      if (Number.isFinite(cv) && cv < CONSTANT_CV) {
        const severity: BotSignalSeverity = cv < 0.03 ? "HIGH" : cv < 0.06 ? "MEDIUM" : "LOW";
        signals.push({
          type: "BOT_PATTERN",
          severity,
          detail: `View velocity is near-constant across ${viewRates.length} intervals (coefficient of variation ${cv.toFixed(3)}); organic reach decays rather than holding steady`,
          at: toIso(last.recordedAt),
        });
      }
    }
  }

  return signals;
}
