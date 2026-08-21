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
  type Campaign,
} from "../types";
import { formatDateTimeAbs, timeAgo } from "@/lib/format";

type ActivitySectionProps = {
  recentCampaigns: Campaign[];
};

const HEAD =
  "h-9 px-3 text-[11px] font-semibold tracking-[0.06em] text-muted-foreground uppercase first:pl-6";

export function ActivitySection({ recentCampaigns }: ActivitySectionProps) {
  const feed = recentCampaigns.slice(0, 5);

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
        description="Recent status changes across your campaigns."
      >
        {feed.length > 0 ? (
          <ul className="flex flex-col divide-y divide-border">
            {feed.map((c) => (
              <li key={c.id} className="flex items-start gap-3.5 py-3.5 first:pt-0 last:pb-0">
                <span className="mt-0.5 flex size-8 shrink-0 items-center justify-center rounded-lg bg-muted">
                  <Clock aria-hidden="true" className="size-4 text-muted-foreground" />
                </span>
                <div className="min-w-0 flex-1">
                  <p className="flex flex-wrap items-center gap-1.5 text-[13px] leading-relaxed text-foreground">
                    <span className="font-semibold">{c.title}</span>
                    <span className="text-muted-foreground">status updated to</span>
                    <Badge variant={STATUS_BADGE_VARIANT[c.status] ?? "neutral"} size="sm">
                      {statusLabel(c.status)}
                    </Badge>
                  </p>
                  <p
                    className="mt-1 text-xs text-muted-foreground"
                    title={c.updatedAt ? formatDateTimeAbs(c.updatedAt) : undefined}
                  >
                    {timeAgo(c.updatedAt)}
                  </p>
                </div>
              </li>
            ))}
          </ul>
        ) : (
          <p className="py-8 text-center text-sm text-muted-foreground">No recent activity</p>
        )}
      </SectionCard>
    </div>
  );
}
