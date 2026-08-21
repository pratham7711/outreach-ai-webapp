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
  viewsOverTime: { date: string; views: number }[];
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

const STATUS_LABELS: Record<string, string> = {
  DRAFT: "Draft",
  PENDING: "Pending",
  IN_PROGRESS: "In Progress",
  COMPLETE: "Complete",
  CANCELLED: "Cancelled",
};

export function statusLabel(status: string) {
  return STATUS_LABELS[status] ?? status.replace(/_/g, " ");
}
