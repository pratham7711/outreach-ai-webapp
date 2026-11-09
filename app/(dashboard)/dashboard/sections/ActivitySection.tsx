"use client";

import React from "react";
import Link from "next/link";
import { ArrowRight, ChevronRight, Clock, Megaphone } from "lucide-react";
import { DataTable, SectionCard, StatusBadge, type DataTableColumn } from "@/components/ds";
import { type ActivityEvent, type Campaign } from "../types";
import { formatDateTimeAbs, timeAgo } from "@/lib/format";
import { NOTIFICATION_LOOKBACK_DAYS, describeNotification } from "@/lib/notificationFeed";

type ActivitySectionProps = {
  recentCampaigns: Campaign[];
  recentEvents: ActivityEvent[];
};

/* The recent campaigns are a short listing, so they use the listing table:
   the title links to the campaign, the status badge has no dot, and the
   time column is right-aligned. */
const CAMPAIGN_COLUMNS: DataTableColumn<Campaign>[] = [
  {
    key: "campaign",
    header: "Campaign",
    minWidth: 220,
    render: (c) => (
      <>
        <span className="cc-dt-truncate" title={c.title}>{c.title}</span>
        <span className="cc-dt-sub">{c.client?.name ?? "No client assigned"}</span>
      </>
    ),
  },
  { key: "status", header: "Status", width: 140, render: (c) => <StatusBadge status={c.status} /> },
  {
    key: "updated",
    header: "Last updated",
    width: 136,
    align: "right",
    render: (c) => (
      <span title={c.updatedAt ? formatDateTimeAbs(c.updatedAt) : undefined}>{timeAgo(c.updatedAt)}</span>
    ),
  },
];

export function ActivitySection({ recentCampaigns, recentEvents }: ActivitySectionProps) {

  return (
    <div className="flex flex-col gap-6">
      <SectionCard
        icon={Megaphone}
        title="Recent campaigns"
        description="The five campaigns your team touched most recently."
        padded={false}
        action={
          <Link href="/campaigns" className="cc-dt-primary inline-flex items-center gap-1">
            View all
            <ArrowRight aria-hidden="true" size={14} />
          </Link>
        }
      >
        <DataTable
          bare
          caption="Recent campaigns"
          columns={CAMPAIGN_COLUMNS}
          rows={recentCampaigns}
          rowKey={(c) => c.id}
          rowHref={(c) => `/campaigns/${c.id}`}
          stickyFirstColumn={false}
          empty={<p className="py-12 text-center text-sm text-[var(--cc-text-muted)]">No campaigns yet</p>}
        />
      </SectionCard>

      <SectionCard
        icon={Clock}
        title="Activity feed"
        /* Was the same five campaigns as the card above -- the same array,
           unfiltered -- described as status changes and dated by updatedAt,
           which any edit bumps. It now reads AuditLog, narrowed to the
           notification catalog, so a row is an event that actually happened and
           its timestamp is when it happened. */
        description={`What your team did across the workspace in the last ${NOTIFICATION_LOOKBACK_DAYS} days.`}
      >
        {recentEvents.length > 0 ? (
          <ul className="flex flex-col divide-y divide-border">
            {recentEvents.map((e) => {
              const { glyph, title, href } = describeNotification(e);
              return (
                <li key={e.id} className="group relative flex items-start gap-3.5 py-3.5 first:pt-0 last:pb-0">
                  <span
                    aria-hidden="true"
                    className="mt-0.5 flex size-8 shrink-0 items-center justify-center rounded-lg bg-muted text-sm"
                  >
                    {glyph}
                  </span>
                  <div className="min-w-0 flex-1">
                    <p className="text-[13px] leading-relaxed text-foreground">
                      {href ? (
                        <Link
                          prefetch={false}
                          href={href}
                          className="rounded-sm font-semibold after:absolute after:inset-0 after:content-[''] focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none"
                        >
                          {title}
                        </Link>
                      ) : (
                        <span className="font-semibold">{title}</span>
                      )}
                    </p>
                    <p
                      className="mt-1 text-xs text-muted-foreground"
                      title={formatDateTimeAbs(e.createdAt)}
                    >
                      {timeAgo(e.createdAt)}
                      {e.actorEmail ? ` \u00b7 ${e.actorEmail}` : ""}
                    </p>
                  </div>
                  {href && (
                    <ChevronRight
                      aria-hidden="true"
                      className="mt-1.5 size-4 shrink-0 text-muted-foreground opacity-0 transition-opacity group-hover:opacity-100"
                    />
                  )}
                </li>
              );
            })}
          </ul>
        ) : (
          <p className="py-8 text-center text-sm text-muted-foreground">No recent activity</p>
        )}
      </SectionCard>
    </div>
  );
}
