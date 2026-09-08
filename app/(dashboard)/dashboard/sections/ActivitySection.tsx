"use client";

import React from "react";
import Link from "next/link";
import { ArrowUpRight, ChevronRight, Clock, Megaphone } from "lucide-react";
import { Badge } from "@pratham7711/ui";
import { SectionCard } from "@/components/ds";
import { Button } from "@/components/ui/button";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  statusLabel,
  STATUS_BADGE_VARIANT,
  type ActivityEvent,
  type Campaign,
} from "../types";
import { formatDateTimeAbs, timeAgo } from "@/lib/format";
import { NOTIFICATION_LOOKBACK_DAYS, describeNotification } from "@/lib/notificationFeed";

type ActivitySectionProps = {
  recentCampaigns: Campaign[];
  recentEvents: ActivityEvent[];
};

const HEAD =
  "h-9 px-3 text-[11px] font-semibold tracking-[0.06em] text-muted-foreground uppercase first:pl-6";

export function ActivitySection({ recentCampaigns, recentEvents }: ActivitySectionProps) {

  return (
    <div className="flex flex-col gap-6">
      <SectionCard
        icon={Megaphone}
        title="Recent campaigns"
        description="The five campaigns your team touched most recently."
        padded={false}
        action={
          <Button
            variant="outline"
            size="sm"
            nativeButton={false}
            render={<Link href="/campaigns" />}
          >
            View all
            <ArrowUpRight aria-hidden="true" className="size-3.5" />
          </Button>
        }
      >
        {recentCampaigns.length > 0 ? (
          <div className="overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow className="border-border hover:bg-transparent">
                  <TableHead className={`${HEAD} w-full`}>Campaign</TableHead>
                  <TableHead className={`${HEAD} w-[132px]`}>Status</TableHead>
                  <TableHead className={`${HEAD} w-[116px] text-right`}>Last updated</TableHead>
                  <TableHead className="w-10 min-w-10" aria-label="Open campaign" />
                </TableRow>
              </TableHeader>
              <TableBody>
                {recentCampaigns.map((c) => (
                  <TableRow key={c.id} className="group relative border-border">
                    <TableCell className="py-3 pr-3 pl-6">
                      <Link prefetch={false}
                        href={`/campaigns/${c.id}`}
                        title={c.title}
                        className="inline-block max-w-[34ch] truncate rounded-sm font-semibold text-foreground after:absolute after:inset-0 after:content-[''] focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none"
                      >
                        {c.title}
                      </Link>
                      <span className="mt-0.5 block text-xs text-muted-foreground">
                        {c.client?.name ?? "No client assigned"}
                      </span>
                    </TableCell>
                    <TableCell className="px-3 py-3">
                      <Badge variant={STATUS_BADGE_VARIANT[c.status] ?? "neutral"} dot>
                        {statusLabel(c.status)}
                      </Badge>
                    </TableCell>
                    <TableCell
                      className="px-3 py-3 text-right text-xs whitespace-nowrap text-muted-foreground tabular-nums"
                      title={c.updatedAt ? formatDateTimeAbs(c.updatedAt) : undefined}
                    >
                      {timeAgo(c.updatedAt)}
                    </TableCell>
                    <TableCell className="w-10 min-w-10 py-3 pr-4 pl-0 text-right">
                      <ChevronRight
                        aria-hidden="true"
                        className="ml-auto size-4 text-muted-foreground opacity-0 transition-opacity group-hover:opacity-100"
                      />
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        ) : (
          <p className="py-12 text-center text-sm text-muted-foreground">No campaigns yet</p>
        )}
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
