import { formatCompact } from "@/lib/format";

export type Campaign = {
  id: string;
  title: string;
  status: string;
  client?: { name: string } | null;
  updatedAt?: string | null;
};

export type PerformanceData = {
  summary: {
    activeCampaigns: number;
    totalCreators: number;
  };
  /* One measured reading per bucket. `views` is a LEVEL -- lifetime views of
     every post the org held on that day -- not the views earned during the
     bucket, so these points must never be summed. */
  viewsOverTime: { date: string; views: number; posts: number }[];
  viewsByCampaign: {
    campaignId: string;
    title: string;
    views: number;
    creatorsCount: number;
  }[];
  platformBreakdown: { platform: string; views: number; postsCount: number }[];
  creatorPerformance: {
    creatorId: string;
    name: string;
    handle: string;
    /* Two rows can share a handle across platforms; without this the table
       cannot tell them apart. Null only when the creator row has gone. */
    platform: string | null;
    activationCount: number;
    views: number;
    avgEngagement: number;
  }[];
  topPosts: {
    id: string;
    postUrl: string;
    platform: string;
    viewsCount: number;
    likesCount: number;
    engagementRate: number;
    creatorName: string | null;
    campaignTitle: string | null;
  }[];
};

export type StatusVariant = "warning" | "accent" | "success" | "danger" | "neutral";

export const STATUS_BADGE_VARIANT: Record<string, StatusVariant> = {
  PENDING: "warning",
  IN_PROGRESS: "accent",
  COMPLETE: "success",
  CANCELLED: "danger",
  DRAFT: "neutral",
};


export function formatNumber(n: number) {
  return formatCompact(n);
}

/* Re-exported rather than redefined. This file used to hold its own copy that
   spelled the running state "In Progress" while three other files spelled it
   two other ways. */
export { campaignStatusLabel as statusLabel } from "@/lib/statusColors";
