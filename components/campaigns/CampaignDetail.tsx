"use client";

import { Badge } from "@/components/ui/badge";
import type { CampaignWithRelations } from "@/types";

const statusLabels: Record<string, string> = {
  DRAFT: "Draft",
  PENDING: "Pending",
  IN_PROGRESS: "In Progress",
  COMPLETE: "Complete",
  CANCELLED: "Cancelled",
};

export function CampaignDetail({ campaign }: { campaign: CampaignWithRelations }) {
  return (
    <div>
      <div className="flex items-center gap-3">
        <h1 className="text-2xl font-bold">{campaign.title}</h1>
        <Badge variant="secondary">{statusLabels[campaign.status]}</Badge>
      </div>
      <p className="mt-2 text-sm text-muted-foreground">
        {campaign._count.activations} creators &middot; {campaign._count.posts} posts
      </p>
    </div>
  );
}
