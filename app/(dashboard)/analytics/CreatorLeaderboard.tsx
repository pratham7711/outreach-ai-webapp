"use client";
import React from "react";
import { EmptyState } from "@pratham7711/ui";
import { Trophy, User } from "lucide-react";
import { DataTable, SectionCard, type DataTableColumn } from "@/components/ds";
import { formatNumber, formatPercent } from "./shared";
import { stripAt, UNKNOWN } from "@/lib/format";
import CreatorAvatar from "@/components/creators/CreatorAvatar";

export type LeaderboardCreator = {
  id: string;
  name: string;
  handle: string;
  platform: string;
  avatarUrl: string | null;
  followersCount: number;
  campaigns: number;
  /** Null when none of their posts in range has a view count. */
  views: number | null;
  likes: number;
  posts: number;
  earnings: number;
  /** Null when none of their posts had views and likes read. */
  engagements: number | null;
  engagementRate: number | null;
};

const COLUMNS: DataTableColumn<LeaderboardCreator & { rank: number }>[] = [
  { key: "rank", header: "Rank", width: 64, align: "right", render: (c) => c.rank },
  {
    key: "creator",
    header: "Creator",
    primary: true,
    minWidth: 200,
    render: (c) => (
      <span className="flex min-w-0 items-center gap-2.5">
        <CreatorAvatar id={c.id} name={c.name} size="sm" />
        <span className="min-w-0">
          <span className="cc-dt-truncate" title={c.name}>{c.name}</span>
          <span className="cc-dt-sub cc-dt-truncate" title={`@${stripAt(c.handle)}`}>@{stripAt(c.handle)}</span>
        </span>
      </span>
    ),
  },
  { key: "campaigns", header: "Campaigns", width: 120, align: "right", render: (c) => formatNumber(c.campaigns) },
  {
    key: "views",
    header: "Views",
    width: 120,
    align: "right",
    /* "—" with the reason, never 0: these creators' posts carry no view count
       we read (Instagram photos publish none), and the route ranks them last. */
    render: (c) =>
      c.views === null ? (
        <span title={`No view count read for any of their ${c.posts} post${c.posts === 1 ? "" : "s"} in this range`}>{UNKNOWN}</span>
      ) : (
        formatNumber(c.views)
      ),
  },
  {
    key: "engagement",
    header: "Engagement",
    width: 124,
    align: "right",
    render: (c) =>
      c.engagementRate === null ? (
        <span title="No post of theirs in this range had both views and likes read">{UNKNOWN}</span>
      ) : (
        formatPercent(c.engagementRate)
      ),
  },
];

/**
 * The ranked creators, as a listing table in a titled card: the same header,
 * cell padding and right-aligned figures as every other table, and each row
 * opens the creator.
 */
export default function CreatorLeaderboard({ creators }: { creators: LeaderboardCreator[] }) {
  return (
    <SectionCard icon={Trophy} title="Creator leaderboard" padded={false}>
      <DataTable
        bare
        caption="Creator leaderboard"
        columns={COLUMNS}
        rows={creators.map((c, i) => ({ ...c, rank: i + 1 }))}
        rowKey={(c) => c.id}
        rowHref={(c) => `/creators/${c.id}`}
        empty={
          <EmptyState icon={<User size={32} color="var(--cc-text-subtle)" />} title="No post data yet" description="Sync posts to see creator rankings." />
        }
      />
    </SectionCard>
  );
}
