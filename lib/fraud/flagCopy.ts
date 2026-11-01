import { formatFull, formatDateAbs } from "@/lib/format";

/**
 * A view-check flag in words a client lead can act on.
 *
 * The stored description is the detector's own sentence ("Views increased by
 * 800% between snapshots (1000 -> 9000) while the added views engaged at only
 * 0.03%..."), written for whoever tunes the rules. This reads the same evidence
 * and says what was seen and why it is worth a look, without calling it fraud:
 * a flag is a reason to check, not a finding.
 */

export type ViewCheckFlag = {
  id: string;
  postId: string;
  creatorId: string;
  flagType: "VIEW_SPIKE" | "LOW_ENGAGEMENT" | "BOT_PATTERN" | string;
  severity: "LOW" | "MEDIUM" | "HIGH" | "CRITICAL" | string;
  description: string;
  evidence: unknown;
  isResolved: boolean;
  createdAt: string;
};

const num = (v: unknown): number | null => (typeof v === "number" && Number.isFinite(v) ? v : null);
const pct = (v: number) => `${v.toFixed(2)}%`;

export function viewCheckTitle(flagType: string): string {
  switch (flagType) {
    case "VIEW_SPIKE": return "Sudden jump in views";
    case "LOW_ENGAGEMENT": return "Very few likes, comments or shares for the views";
    case "BOT_PATTERN": return "Views with almost no likes or comments";
    default: return "Views worth a second look";
  }
}

export function viewCheckDetail(flag: Pick<ViewCheckFlag, "flagType" | "evidence" | "description">): string {
  const e = (flag.evidence && typeof flag.evidence === "object" ? flag.evidence : {}) as Record<string, unknown>;
  if (flag.flagType === "VIEW_SPIKE") {
    const before = num(e.viewsBefore);
    const after = num(e.viewsAfter);
    const marginal = num(e.marginalEngagementRate);
    const prior = num(e.priorEngagementRate);
    const from = typeof e.snapshotBeforeAt === "string" ? formatDateAbs(e.snapshotBeforeAt) : null;
    const to = typeof e.snapshotAfterAt === "string" ? formatDateAbs(e.snapshotAfterAt) : null;
    if (before !== null && after !== null && marginal !== null && prior !== null) {
      const when = from && to ? (from === to ? ` on ${to}` : ` between ${from} and ${to}`) : "";
      /* Interactions can fall between two readings (likes removed, a counter
         read low), which makes the rate on the added views negative. */
      if (marginal <= 0) {
        return `Views went from ${formatFull(before)} to ${formatFull(after)}${when}, but likes, comments and shares did not grow with them at all. Before the jump, ${pct(prior)} of views engaged.`;
      }
      return `Views went from ${formatFull(before)} to ${formatFull(after)}${when}, but the new views brought almost no likes, comments or shares: ${pct(marginal)} of them engaged, against ${pct(prior)} before the jump.`;
    }
  }
  if (flag.flagType === "LOW_ENGAGEMENT") {
    const views = num(e.viewsCount);
    const rate = num(e.engagementRate);
    if (views !== null && rate !== null) {
      return `${formatFull(views)} views, and ${pct(rate)} of them liked, commented or shared. The check looks at posts over 10,000 views below 0.5%.`;
    }
  }
  if (flag.flagType === "BOT_PATTERN") {
    const views = num(e.viewsCount);
    const rate = num(e.interactionRate);
    if (views !== null && rate !== null) {
      return `${formatFull(views)} views, and only ${rate.toFixed(3)}% of them liked or commented. The check looks at posts over 50,000 views below 0.1%.`;
    }
  }
  return flag.description;
}

const SEVERITY_RANK: Record<string, number> = { LOW: 0, MEDIUM: 1, HIGH: 2, CRITICAL: 3 };

export type ViewCheckCard = { key: string; title: string; detail: string; severity: string };

/**
 * One card per thing seen on a post. LOW_ENGAGEMENT and BOT_PATTERN read the
 * same evidence (views against likes and comments) at two thresholds, so a
 * post under both gets one engagement card, at the stronger severity, rather
 * than two cards saying nearly the same sentence.
 */
export function viewCheckCards(flags: ViewCheckFlag[]): ViewCheckCard[] {
  const low = flags.find((f) => f.flagType === "LOW_ENGAGEMENT");
  const bot = flags.find((f) => f.flagType === "BOT_PATTERN");
  const cards: ViewCheckCard[] = [];
  let merged = false;
  for (const f of flags) {
    if (low && bot && (f === low || f === bot)) {
      if (merged) continue;
      merged = true;
      const strongest = (SEVERITY_RANK[bot.severity] ?? 0) > (SEVERITY_RANK[low.severity] ?? 0) ? bot : low;
      const e = (low.evidence && typeof low.evidence === "object" ? low.evidence : {}) as Record<string, unknown>;
      const views = num(e.viewsCount);
      const rate = num(e.engagementRate);
      cards.push({
        key: `${low.id}+${bot.id}`,
        title: viewCheckTitle("LOW_ENGAGEMENT"),
        detail: views !== null && rate !== null
          ? `${formatFull(views)} views, and only ${pct(rate)} of them liked, commented or shared. That is under both engagement checks: 0.5% on posts over 10,000 views, and 0.1% on posts over 50,000.`
          : viewCheckDetail(low),
        severity: strongest.severity,
      });
      continue;
    }
    cards.push({ key: f.id, title: viewCheckTitle(f.flagType), detail: viewCheckDetail(f), severity: f.severity });
  }
  return cards;
}

export function viewCheckSeverity(severity: string): { label: string; tone: "danger" | "warning" | "neutral" } {
  if (severity === "CRITICAL" || severity === "HIGH") return { label: "Strong signal", tone: "danger" };
  if (severity === "MEDIUM") return { label: "Worth a look", tone: "warning" };
  return { label: "Mild", tone: "neutral" };
}
