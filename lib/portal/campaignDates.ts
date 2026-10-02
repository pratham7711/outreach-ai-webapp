/**
 * The dates a creator acts on, worked out from what the agency already entered.
 *
 * A campaign carries its dates in three places: the creator's own due date on
 * their activation, the campaign's submission deadline, and the start and end of
 * each phase. None of them is required, so a campaign may have all of them or
 * none. The creator app shows one "next date" per campaign on Home and every
 * date on the campaign screen; both come from here so the two can never
 * disagree about which date is next.
 *
 * Pure on purpose: it runs on the server for Home and is unit-tested without a
 * database.
 */

export type CampaignDateKind = "post_due" | "submissions_close" | "phase_start" | "phase_end";

export type CampaignDate = {
  kind: CampaignDateKind;
  label: string;
  /** ISO string, so the shape is identical on both sides of a JSON response. */
  at: string;
};

export type CampaignDateInput = {
  deliverableDueDate?: Date | string | null;
  submissionDeadline?: Date | string | null;
  phases?: ReadonlyArray<{
    name: string;
    startDate?: Date | string | null;
    endDate?: Date | string | null;
  }>;
};

function toDate(value: Date | string | null | undefined): Date | null {
  if (!value) return null;
  const d = value instanceof Date ? value : new Date(value);
  return Number.isNaN(d.getTime()) ? null : d;
}

/** Every date the campaign has, earliest first. */
export function campaignDates(input: CampaignDateInput): CampaignDate[] {
  const out: Array<{ kind: CampaignDateKind; label: string; at: Date }> = [];

  const due = toDate(input.deliverableDueDate);
  if (due) out.push({ kind: "post_due", label: "Your post is due", at: due });

  const deadline = toDate(input.submissionDeadline);
  /* The activation's due date is copied from the deadline when a creator joins
     (lib/marketplace/join.ts), so the same instant would otherwise be listed
     twice under two names. The creator's own date is the one they act on. */
  if (deadline && (!due || due.getTime() !== deadline.getTime())) {
    out.push({ kind: "submissions_close", label: "Submissions close", at: deadline });
  }

  for (const phase of input.phases ?? []) {
    const start = toDate(phase.startDate);
    const end = toDate(phase.endDate);
    if (start) out.push({ kind: "phase_start", label: `${phase.name} starts`, at: start });
    if (end) out.push({ kind: "phase_end", label: `${phase.name} ends`, at: end });
  }

  return out
    .sort((a, b) => a.at.getTime() - b.at.getTime())
    .map((d) => ({ kind: d.kind, label: d.label, at: d.at.toISOString() }));
}

/**
 * The first date that has not passed yet, or null when every date is behind
 * the campaign or it has none. "Not passed" is measured against the start of
 * today, so a post due today still reads as next rather than vanishing at
 * midnight UTC on the morning it is due.
 */
export function nextCampaignDate(input: CampaignDateInput, now: Date = new Date()): CampaignDate | null {
  const startOfToday = new Date(now);
  startOfToday.setUTCHours(0, 0, 0, 0);
  return campaignDates(input).find((d) => new Date(d.at).getTime() >= startOfToday.getTime()) ?? null;
}
