"use client";

import { cn } from "@/lib/utils";
import { Badge } from "@/components/ui/badge";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { Users, FileText, Clock } from "lucide-react";
import { formatDistanceToNow } from "date-fns";
import type { CampaignWithRelations } from "@/types";

const statusColors: Record<string, string> = {
  DRAFT: "bg-gray-100 text-gray-700",
  PENDING: "bg-yellow-100 text-yellow-700",
  IN_PROGRESS: "bg-blue-100 text-blue-700",
  COMPLETE: "bg-green-100 text-green-700",
  CANCELLED: "bg-red-100 text-red-700",
};

const statusLabels: Record<string, string> = {
  DRAFT: "Draft",
  PENDING: "Pending",
  IN_PROGRESS: "In Progress",
  COMPLETE: "Complete",
  CANCELLED: "Cancelled",
};

function formatBudget(budget: string | null, currency: string): string {
  if (!budget) return "—";
  const num = parseFloat(budget);
  const symbols: Record<string, string> = { USD: "$", EUR: "€", GBP: "£", INR: "₹" };
  return `${symbols[currency] ?? ""}${num.toLocaleString()}`;
}

export function CampaignCard({ campaign }: { campaign: CampaignWithRelations }) {
  return (
    <div className="group rounded-lg border bg-white p-4 transition-shadow hover:shadow-md">
      <div className="flex items-start gap-4">
        {/* Thumbnail */}
        <div className="h-16 w-16 flex-shrink-0 overflow-hidden rounded-md bg-gradient-to-br from-indigo-400 to-purple-500">
          {campaign.thumbnailUrl ? (
            <img
              src={campaign.thumbnailUrl}
              alt={campaign.title}
              className="h-full w-full object-cover"
            />
          ) : (
            <div className="flex h-full w-full items-center justify-center text-xl font-bold text-white">
              {campaign.title.charAt(0)}
            </div>
          )}
        </div>

        {/* Content */}
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            <h3 className="truncate text-sm font-semibold text-gray-900">
              {campaign.title}
            </h3>
            <Badge
              variant="secondary"
              className={cn("shrink-0 text-[10px] font-medium", statusColors[campaign.status])}
            >
              {statusLabels[campaign.status]}
            </Badge>
          </div>

          <p className="mt-1 text-sm text-muted-foreground">
            {formatBudget(campaign.budget, campaign.currency)}
          </p>

          {/* Tags */}
          {campaign.tags.length > 0 && (
            <div className="mt-1.5 flex flex-wrap gap-1">
              {campaign.tags.slice(0, 3).map((t) => (
                <span
                  key={t.tag}
                  className="rounded bg-gray-100 px-1.5 py-0.5 text-[10px] text-gray-600"
                >
                  {t.tag}
                </span>
              ))}
              {campaign.tags.length > 3 && (
                <span className="text-[10px] text-gray-400">
                  +{campaign.tags.length - 3}
                </span>
              )}
            </div>
          )}

          {/* Footer */}
          <div className="mt-2.5 flex items-center gap-4 text-xs text-muted-foreground">
            <span className="flex items-center gap-1">
              <Users className="h-3 w-3" />
              {campaign._count.activations} creators
            </span>
            <span className="flex items-center gap-1">
              <FileText className="h-3 w-3" />
              {campaign._count.posts} posts
            </span>
            <span className="flex items-center gap-1">
              <Clock className="h-3 w-3" />
              {formatDistanceToNow(new Date(campaign.updatedAt), { addSuffix: true })}
            </span>

            {/* Team avatars */}
            {campaign.teamMembers.length > 0 && (
              <div className="ml-auto flex -space-x-1.5">
                {campaign.teamMembers.slice(0, 3).map((tm) => (
                  <Avatar key={tm.id} className="h-5 w-5 border-2 border-white">
                    <AvatarFallback className="text-[8px]">
                      {tm.user.name
                        .split(" ")
                        .map((n) => n[0])
                        .join("")}
                    </AvatarFallback>
                  </Avatar>
                ))}
                {campaign.teamMembers.length > 3 && (
                  <div className="flex h-5 w-5 items-center justify-center rounded-full border-2 border-white bg-gray-200 text-[8px] text-gray-600">
                    +{campaign.teamMembers.length - 3}
                  </div>
                )}
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
