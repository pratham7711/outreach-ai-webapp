export type ComplianceFlagCode =
  | "POSTED_AFTER_DEADLINE"
  | "SYNC_DEAD_LETTERED"
  | "SYNC_FAILING";

export type ComplianceSeverity = "warning" | "error";

export type ComplianceFlag = {
  code: ComplianceFlagCode;
  severity: ComplianceSeverity;
  message: string;
};

export type CompliancePost = {
  postedAt: Date | string;
  syncFailCount?: number | null;
  syncDisabledAt?: Date | string | null;
};

export type ComplianceCampaign = {
  submissionDeadline?: Date | string | null;
};

function toDate(value: Date | string | null | undefined): Date | null {
  if (value == null) return null;
  const d = value instanceof Date ? value : new Date(value);
  return Number.isNaN(d.getTime()) ? null : d;
}

export function checkPostCompliance(
  post: CompliancePost,
  campaign: ComplianceCampaign,
): ComplianceFlag[] {
  const flags: ComplianceFlag[] = [];

  const deadline = toDate(campaign.submissionDeadline);
  const postedAt = toDate(post.postedAt);
  if (deadline && postedAt && postedAt.getTime() > deadline.getTime()) {
    flags.push({
      code: "POSTED_AFTER_DEADLINE",
      severity: "error",
      message: "Posted after the campaign submission deadline.",
    });
  }

  if (toDate(post.syncDisabledAt)) {
    flags.push({
      code: "SYNC_DEAD_LETTERED",
      severity: "error",
      message: "Post is unreachable — likely deleted or set to private; tracking has stopped.",
    });
  } else if ((post.syncFailCount ?? 0) > 0) {
    const n = post.syncFailCount ?? 0;
    flags.push({
      code: "SYNC_FAILING",
      severity: "warning",
      message: `Last ${n} sync attempt${n === 1 ? "" : "s"} failed — the post may be private or temporarily unavailable.`,
    });
  }

  return flags;
}
