"use client";

import { CampaignCard } from "./CampaignCard";
import type { CampaignWithRelations } from "@/types";

export function CampaignList({ campaigns }: { campaigns: CampaignWithRelations[] }) {
  if (campaigns.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center rounded-lg border border-dashed bg-white py-16">
        <p className="text-sm text-muted-foreground">No campaigns found</p>
        <p className="mt-1 text-xs text-muted-foreground">
          Create your first campaign to get started
        </p>
      </div>
    );
  }

  return (
    <div className="grid gap-4">
      {campaigns.map((campaign) => (
        <CampaignCard key={campaign.id} campaign={campaign} />
      ))}
    </div>
  );
}
