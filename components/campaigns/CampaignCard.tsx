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
    <div className="group rounded-xl border bg-white p-5 transition-shadow hover:shadow-lg">
      <div className="flex items-start gap-5">
        {/* Thumbnail */}
        <div className="h-20 w-20 flex-shrink-0 overflow-hidden rounded-lg bg-gradient-to-br from-indigo-400 to-purple-500">
          {campaign.thumbnailUrl ? (
            <img
              src={campaign.thumbnailUrl}
              alt={campaign.title}
              className="h-full w-full object-cover"
            />
          ) : (
            <div className="flex h-full w-full items-center justify-center text-2xl font-bold text-white">
              {campaign.title.charAt(0)}
            </div>
          )}
        </div>

        {/* Content */}
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-3">
            <h3 className="truncate text-base font-semibold text-gray-900">
              {campaign.title}
            </h3>
            <Badge
              variant="secondary"
              className={cn("shrink-0 text-xs font-medium px-2.5 py-1", statusColors[campaign.status])}
            >
              {statusLabels[campaign.status]}
            </Badge>
          </div>

          <p className="mt-1.5 text-base text-muted-foreground font-medium">
            {formatBudget(campaign.budget, campaign.currency)}
          </p>

          {/* Tags */}
          {campaign.tags.length > 0 && (
            <div className="mt-2 flex flex-wrap gap-1.5">
              {campaign.tags.slice(0, 3).map((t) => (
                <span
                  key={t.tag}
                  className="rounded bg-gray-100 px-2 py-1 text-xs text-gray-600"
                >
                  {t.tag}
                </span>
              ))}
              {campaign.tags.length > 3 && (
                <span className="text-xs text-gray-400">
                  +{campaign.tags.length - 3}
                </span>
              )}
            </div>
          )}

          {/* Footer */}
          <div className="mt-3 flex items-center gap-5 text-sm text-muted-foreground">
            <span className="flex items-center gap-1.5">
              <Users className="h-4 w-4" />
              {campaign._count.activations} creators
            </span>
            <span className="flex items-center gap-1.5">
              <FileText className="h-4 w-4" />
              {campaign._count.posts} posts
            </span>
            <span className="flex items-center gap-1.5">
              <Clock className="h-4 w-4" />
              {formatDistanceToNow(new Date(campaign.updatedAt), { addSuffix: true })}
            </span>

            {/* Team avatars */}
            {campaign.teamMembers.length > 0 && (
              <div className="ml-auto flex -space-x-2">
                {campaign.teamMembers.slice(0, 3).map((tm) => (
                  <Avatar key={tm.id} className="h-7 w-7 border-2 border-white">
                    <AvatarFallback className="text-[10px]">
                      {tm.user.name
                        .split(" ")
                        .map((n) => n[0])
                        .join("")}
                    </AvatarFallback>
                  </Avatar>
                ))}
                {campaign.teamMembers.length > 3 && (
                  <div className="flex h-7 w-7 items-center justify-center rounded-full border-2 border-white bg-gray-200 text-[10px] text-gray-600">
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
