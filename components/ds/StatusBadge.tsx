import type { ReactNode } from "react";
import { PlatformGlyph } from "@/components/ui/PlatformGlyph";
import { enumLabel } from "@/lib/ui/enumLabel";
import { platformLabel } from "@/lib/format";

export type StatusTone = "success" | "warning" | "danger" | "info" | "neutral";

/**
 * Which tone a stored status reads in. Hue is reserved for status, so only the
 * three outcomes that need a reaction get one: done (success), waiting on
 * someone (warning) and stopped (danger). Work in motion is the ink tint, and
 * everything else, drafts included, is neutral.
 */
const TONE: Record<string, StatusTone> = {
  APPROVED: "success",
  ACTIVE: "success",
  COMPLETE: "success",
  COMPLETED: "success",
  LIVE: "success",
  PAID: "success",
  POSTED: "success",
  PUBLISHED: "success",
  SUCCESS: "success",
  VERIFIED: "success",
  AWAITING_APPROVAL: "warning",
  AWAITING_DRAFT: "warning",
  CHANGES_REQUESTED: "warning",
  NEEDS_REVIEW: "warning",
  PENDING: "warning",
  PENDING_REVIEW: "warning",
  STALE: "warning",
  CANCELLED: "danger",
  DECLINED: "danger",
  FAILED: "danger",
  REJECTED: "danger",
  REMOVED: "danger",
  DRAFT_SUBMITTED: "info",
  IN_PROGRESS: "info",
  POSTING: "info",
  PROCESSING: "info",
  SCHEDULED: "info",
};

export function statusTone(status: string | null | undefined): StatusTone {
  return TONE[(status ?? "").toUpperCase()] ?? "neutral";
}

/**
 * The one status badge.
 *
 * In a table it is small and has no dot: the column already says it is a
 * status, and a dot per row is noise. On a detail page's header pass `dot`.
 * It hugs its text rather than stretching to the column, so a long column does
 * not draw a long lozenge.
 *
 * Give it a stored `status` and it picks the tone and the wording itself
 * (`enumLabel`, so "PENDING_REVIEW" reads "Pending review" and never shouts);
 * or give it a `tone` and your own children.
 */
export function StatusBadge({
  status,
  tone,
  dot = false,
  title,
  className,
  children,
}: {
  status?: string | null;
  tone?: StatusTone;
  dot?: boolean;
  /** Extra detail for the tooltip, e.g. "Live · read 15h ago". */
  title?: string;
  className?: string;
  children?: ReactNode;
}) {
  const t = tone ?? statusTone(status);
  return (
    <span className={`cc-status-badge${className ? ` ${className}` : ""}`} data-tone={t} title={title}>
      {dot ? <span className="cc-status-badge-dot" aria-hidden="true" /> : null}
      {children ?? enumLabel(status)}
    </span>
  );
}

/**
 * A platform, named. The glyph alone is not a label, and the stored enum
 * ("TIKTOK") is not a name, so this is always mark + platformLabel().
 */
export function PlatformTag({
  platform,
  hideLabel = false,
  className,
}: {
  platform: string;
  /** Glyph only, for a cramped cell; the name stays as the accessible label. */
  hideLabel?: boolean;
  className?: string;
}) {
  const name = platformLabel(platform);
  return (
    <span className={`cc-platform-tag${className ? ` ${className}` : ""}`} title={hideLabel ? name : undefined}>
      <span className="cc-platform-tag-glyph" aria-hidden="true">
        <PlatformGlyph platform={platform} size="1rem" />
      </span>
      {hideLabel ? <span className="sr-only">{name}</span> : name}
    </span>
  );
}
