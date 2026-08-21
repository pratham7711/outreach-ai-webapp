"use client";

import React, { useMemo, useState } from "react";
import { Clock } from "lucide-react";
import { SectionCard } from "@/components/ds";
import {
  DAY_LABELS,
  formatSlot,
  postingTimeReport,
  postingTimeReportFromBuckets,
  resolveTimeZone,
  type TimeBucket,
  type TimedPost,
} from "@/lib/analytics/postingTime";
import { formatNumber } from "./shared";

const HOUR_TICKS = [0, 3, 6, 9, 12, 15, 18, 21];

/** Empty and thin cells must not read as "nothing happens here" the way a pale
 *  tint of the live scale would — they get their own flat treatment. */
function cellBackground(count: number, medianViews: number, scaleMax: number, minSample: number) {
  if (count === 0) return "var(--cc-bg)";
  if (count < minSample || scaleMax <= 0) return "var(--cc-border)";
  const t = Math.min(1, medianViews / scaleMax);
  return `color-mix(in srgb, var(--cc-primary) ${Math.round(12 + t * 88)}%, transparent)`;
}

/**
 * Two ways in, one grid out.
 *
 * `buckets` is the cheap path: the database already grouped and medianed the
 * slots, so nothing here ever holds a post row — which is the whole point on an
 * org with 18,708 posts. `posts` stays for callers that already have the rows in
 * hand for another reason (the song dashboard renders a table of them right
 * beside this), where a second round trip would buy nothing.
 *
 * Whoever bucketed owns the zone: on the aggregate path the server cut the slots
 * in the zone it was handed, so it passes that zone back down rather than
 * letting this component re-resolve it and label the grid with a clock the
 * numbers were not cut in.
 */
export function PostingTimeHeatmap({
  posts,
  buckets,
  platform,
  timeZone: timeZoneProp,
}: {
  posts?: TimedPost[];
  buckets?: TimeBucket[];
  platform: string;
  timeZone?: string;
}) {
  // The viewer's own clock. A posting hour is only actionable in a stated zone,
  // and the browser is the only one we can infer without asking.
  const [localZone] = useState(resolveTimeZone);
  const timeZone = timeZoneProp ?? localZone;

  const report = useMemo(
    () =>
      buckets
        // Server-side already narrowed by platform, so re-filtering here would
        // drop every slot: a bucket carries no platform to match on.
        ? postingTimeReportFromBuckets(buckets, { timeZone, minSample: 3 })
        : postingTimeReport(posts ?? [], { timeZone, platform, minSample: 3 }),
    [buckets, posts, timeZone, platform],
  );

  const byDay = useMemo(() => {
    const rows: (typeof report.buckets)[] = [];
    for (let day = 0; day < 7; day += 1) {
      rows.push(report.buckets.filter((b) => b.day === day).sort((a, b) => a.hour - b.hour));
    }
    return rows;
  }, [report.buckets]);

  const top = report.best.slice(0, 3);

  return (
    <SectionCard
      icon={Clock}
      title="When to post"
      description={`Median views by the hour a post went live, in ${timeZone}. Darker is stronger.`}
    >
      {report.totalPosts === 0 ? (
        <p className="py-10 text-center text-sm text-muted-foreground">
          No posts with a recorded publish time yet.
        </p>
      ) : (
        <>
          {top.length > 0 ? (
            <div className="mb-5 flex flex-wrap gap-2">
              {top.map((b, i) => (
                <span
                  key={`${b.day}-${b.hour}`}
                  className="rounded-full px-3 py-1.5 text-[13px] font-semibold"
                  style={{
                    background: i === 0 ? "var(--cc-primary)" : "var(--cc-bg)",
                    color: i === 0 ? "white" : "var(--cc-text)",
                    border: "1px solid var(--cc-border)",
                  }}
                >
                  {formatSlot(b)} · {formatNumber(b.medianViews)} median
                  <span style={{ opacity: 0.7, fontWeight: 500 }}> · {b.count} posts</span>
                </span>
              ))}
            </div>
          ) : (
            // Ranking one-post slots against each other would dress noise up as a
            // recommendation, so we say what is missing instead.
            <p className="mb-5 text-[13px] text-muted-foreground">
              No hour has {report.minSample} posts yet, so there is nothing solid enough to
              recommend. The grid below shows where the {report.totalPosts} post
              {report.totalPosts === 1 ? "" : "s"} landed.
            </p>
          )}

          <div className="overflow-x-auto">
            <div style={{ minWidth: 560 }}>
              {byDay.map((row, day) => (
                <div key={day} className="mb-1 flex items-center gap-2">
                  <span
                    className="shrink-0 text-[11px] font-semibold uppercase tracking-wide text-muted-foreground"
                    style={{ width: 32 }}
                  >
                    {DAY_LABELS[day]}
                  </span>
                  <div className="flex flex-1 gap-[2px]">
                    {row.map((b) => (
                      <div
                        key={b.hour}
                        title={
                          b.count === 0
                            ? `${formatSlot(b)} — no posts`
                            : `${formatSlot(b)} — ${formatNumber(b.medianViews)} median views from ${b.count} post${b.count === 1 ? "" : "s"}${b.count < report.minSample ? " (too few to recommend)" : ""}`
                        }
                        style={{
                          flex: 1,
                          height: 22,
                          borderRadius: 3,
                          background: cellBackground(
                            b.count,
                            b.medianViews,
                            report.scaleMax,
                            report.minSample,
                          ),
                        }}
                      />
                    ))}
                  </div>
                </div>
              ))}
              <div className="mt-1 flex items-center gap-2">
                <span className="shrink-0" style={{ width: 32 }} />
                <div className="relative flex-1 text-[10px] text-muted-foreground">
                  {HOUR_TICKS.map((h) => (
                    <span
                      key={h}
                      className="absolute"
                      style={{ left: `${(h / 24) * 100}%` }}
                    >
                      {String(h).padStart(2, "0")}
                    </span>
                  ))}
                  <span className="invisible">0</span>
                </div>
              </div>
            </div>
          </div>
        </>
      )}
    </SectionCard>
  );
}
