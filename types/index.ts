import type { CampaignStatus, CampaignType, Currency, Platform, ActivationStatus, PayoutStatus, PaymentMethod, UserRole } from "@/lib/generated/prisma/client";

export type { CampaignStatus, CampaignType, Currency, Platform, ActivationStatus, PayoutStatus, PaymentMethod, UserRole };

export interface CampaignWithRelations {
  id: string;
  orgId: string;
  title: string;
  status: CampaignStatus;
  campaignType?: CampaignType;
  thumbnailUrl: string | null;
  budget: string | null;
  currency: Currency;
  notes: string | null;
  clientId: string | null;
  folderId: string | null;
  createdById: string;
  createdAt: Date;
  updatedAt: Date;
  deletedAt: Date | null;
  tags: { campaignId: string; tag: string }[];
  teamMembers: {
    id: string;
    user: {
      id: string;
      name: string;
      avatarUrl: string | null;
    };
  }[];
  _count: {
    activations: number;
    posts: number;
  };
}

export interface NavItem {
  label: string;
  href: string;
  icon: string;
  badge?: string;
}

export interface NavSection {
  title: string;
  items: NavItem[];
}
