"use client";

import React from "react";
import { Clock } from "lucide-react";
import { formatDateTimeAbs, timeAgo } from "@/lib/format";

export type LastUpdatedProps = {
  /** When the number beside this was last measured. Null means never. */
  at: string | Date | null | undefined;
  /** What has never happened, e.g. "Never synced". */
  neverLabel?: string;
  prefix?: string;
  /** Age past which the chip turns amber. Sound snapshots run daily, so 48h is two misses. */
  staleAfterHours?: number;
  className?: string;
  style?: React.CSSProperties;
};

/**
 * A freshness chip. Every number fed by a cron is stale by up to a day here
 * (vercel.json runs sync-posts 02:00 and snapshot-sounds 04:00, both daily), and a
 * figure with no timestamp reads as live.
 */
export function LastUpdated({
  at,
  neverLabel = "Never synced",
  prefix = "Updated",
  staleAfterHours = 48,
  className,
  style,
}: LastUpdatedProps) {
  const date = at ? (at instanceof Date ? at : new Date(at)) : null;
  const valid = date && !Number.isNaN(date.getTime()) ? date : null;
  const ageHours = valid ? (Date.now() - valid.getTime()) / 3_600_000 : Infinity;
  const stale = ageHours > staleAfterHours;

  return (
    <span
      className={className}
      // jsdom's CSS parser drops a var() colour, so the amber state would be
      // unobservable from a test without this.
      data-stale={stale ? "true" : "false"}
      title={valid ? formatDateTimeAbs(valid) : undefined}
      style={{
        display: "inline-flex",
        alignItems: "center",
        gap: 4,
        fontSize: 11,
        color: stale ? "var(--cc-warning)" : "var(--cc-text-muted)",
        whiteSpace: "nowrap",
        ...style,
      }}
    >
      <Clock aria-hidden="true" size={11} />
      {valid ? `${prefix} ${timeAgo(valid)}` : neverLabel}
    </span>
  );
}
