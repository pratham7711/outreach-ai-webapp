import "dotenv/config";
import { PrismaClient } from "../lib/generated/prisma";
import { PrismaPg } from "@prisma/adapter-pg";
import bcrypt from "bcryptjs";

const adapter = new PrismaPg({ connectionString: process.env.DATABASE_URL! });
const prisma = new PrismaClient({ adapter });

async function main() {
  const org = await prisma.organization.upsert({
    where: { subdomain: "demo-agency" },
    update: { plan: "pro" },
    create: {
      name: "Demo Agency",
      subdomain: "demo-agency",
      plan: "pro",
    },
  });

  const hashed = await bcrypt.hash("admin123", 10);
  const user = await prisma.user.upsert({
    where: { email: "admin@demo.com" },
    update: { role: "OWNER" },
    create: {
      orgId: org.id,
      email: "admin@demo.com",
      name: "Admin",
      password: hashed,
      role: "OWNER",
    },
  });

  // ─── OrgPlanConfig ───
  await prisma.orgPlanConfig.upsert({
    where: { orgId: org.id },
    update: {},
    create: {
      orgId: org.id,
      planName: 'pro',
      maxCampaigns: 50,
      maxCreators: 500,
      maxUsers: 10,
      features: { soundTracker: true, reports: true, csvExport: true },
    },
  });

  // ─── OrgUIConfig ───
  await prisma.organization.update({
    where: { id: org.id },
    data: {
      uiConfig: {
        features: { soundTracker: true, creatorPortal: false, aiBriefings: false, reports: true, csvExport: true },
        nav: ["campaigns", "creators", "payouts", "analytics", "trackers", "lists"],
        branding: { primaryColor: "#6366f1", brandName: "Outreach AI" },
        limits: { maxCampaigns: 50, maxCreators: 500, maxUsers: 10 },
        platforms: { tiktok: true, instagram: true, youtube: true },
        dashboard: ["kpi_grid", "views_over_time", "platform_breakdown", "top_posts", "financial_summary", "creator_performance"],
      },
    },
  });

  // Sample report
  await prisma.report.upsert({
    where: { orgId_slug: { orgId: org.id, slug: "q1-campaign-overview" } },
    update: {},
    create: {
      orgId: org.id,
      title: "Q1 Campaign Overview",
      slug: "q1-campaign-overview",
      isPublic: true,
      createdById: user.id,
    },
  });

  await prisma.report.upsert({
    where: { orgId_slug: { orgId: org.id, slug: "creator-performance-report" } },
    update: {},
    create: {
      orgId: org.id,
      title: "Creator Performance Report",
      slug: "creator-performance-report",
      isPublic: false,
      createdById: user.id,
    },
  });

  // Sample media kit
  await prisma.mediaKit.upsert({
    where: { orgId_slug: { orgId: org.id, slug: "summer-2025-kit" } },
    update: {},
    create: {
      orgId: org.id,
      title: "Summer 2025 Kit",
      slug: "summer-2025-kit",
      isPublic: true,
      creatorIds: "[]",
      createdById: user.id,
    },
  });

  // ─── Plans ───
  const starterFeatures = {
    analytics: true,
    bulk_export: false,
    api_access: false,
    custom_branding: false,
    advanced_reports: false,
    creator_discovery: false,
    campaign_budget: true,
    multi_currency: false,
    audit_log: false,
    media_kits: false,
  };

  const proFeatures = {
    analytics: true,
    bulk_export: true,
    api_access: true,
    custom_branding: false,
    advanced_reports: true,
    creator_discovery: true,
    campaign_budget: true,
    multi_currency: true,
    audit_log: false,
    media_kits: true,
  };

  const enterpriseFeatures = {
    analytics: true,
    bulk_export: true,
    api_access: true,
    custom_branding: true,
    advanced_reports: true,
    creator_discovery: true,
    campaign_budget: true,
    multi_currency: true,
    audit_log: true,
    media_kits: true,
  };

  const planStarter = await prisma.plan.upsert({
    where: { id: "plan-starter" },
    update: { features: starterFeatures },
    create: {
      id: "plan-starter",
      orgId: org.id,
      name: "Starter",
      description: "Basic plan with essential campaign and payout features",
      features: starterFeatures,
      isCustom: false,
    },
  });

  const planPro = await prisma.plan.upsert({
    where: { id: "plan-pro" },
    update: { features: proFeatures },
    create: {
      id: "plan-pro",
      orgId: org.id,
      name: "Pro",
      description: "Full-featured plan for growing agencies",
      features: proFeatures,
      isCustom: false,
    },
  });

  const planEnterprise = await prisma.plan.upsert({
    where: { id: "plan-enterprise" },
    update: { features: enterpriseFeatures },
    create: {
      id: "plan-enterprise",
      orgId: org.id,
      name: "Enterprise",
      description: "All features unlocked with custom branding and audit log",
      features: enterpriseFeatures,
      isCustom: true,
    },
  });

  // ─── Clients (5) ───
  const clients = await Promise.all([
    prisma.client.upsert({
      where: { id: "client-1" },
      update: { planId: planPro.id },
      create: { id: "client-1", orgId: org.id, name: "Sony Music", logoUrl: null, contactInfo: JSON.stringify({ email: "contact@sony.com" }), planId: planPro.id },
    }),
    prisma.client.upsert({
      where: { id: "client-2" },
      update: { planId: planStarter.id },
      create: { id: "client-2", orgId: org.id, name: "Universal Records", logoUrl: null, contactInfo: JSON.stringify({ email: "hello@universal.com" }), planId: planStarter.id },
    }),
    prisma.client.upsert({
      where: { id: "client-3" },
      update: { planId: planEnterprise.id },
      create: { id: "client-3", orgId: org.id, name: "Warner Music", logoUrl: null, contactInfo: JSON.stringify({ email: "info@warner.com" }), planId: planEnterprise.id },
    }),
    prisma.client.upsert({
      where: { id: "client-4" },
      update: { planId: planPro.id, featureOverrides: { api_access: false, media_kits: false } },
      create: {
        id: "client-4", orgId: org.id, name: "Atlantic Records", logoUrl: null,
        contactInfo: JSON.stringify({ email: "team@atlantic.com" }),
        planId: planPro.id,
        featureOverrides: { api_access: false, media_kits: false },
      },
    }),
    prisma.client.upsert({
      where: { id: "client-5" },
      update: {},
      create: { id: "client-5", orgId: org.id, name: "Interscope Records", logoUrl: null, contactInfo: JSON.stringify({ email: "bookings@interscope.com" }) },
    }),
  ]);

  // ─── Creators (10) ───
  const creators = await Promise.all([
    prisma.creator.upsert({ where: { id: "creator-1" }, update: {}, create: { id: "creator-1", orgId: org.id, name: "Blessing Jolie", handle: "@blessingjolie", platform: "INSTAGRAM", followersCount: 2400000, rate: 5000, bio: "Lifestyle & fashion content creator" } }),
    prisma.creator.upsert({ where: { id: "creator-2" }, update: {}, create: { id: "creator-2", orgId: org.id, name: "Alex Turner", handle: "@alexturner", platform: "TIKTOK", followersCount: 890000, rate: 2000, bio: "Music & comedy shorts" } }),
    prisma.creator.upsert({ where: { id: "creator-3" }, update: {}, create: { id: "creator-3", orgId: org.id, name: "Maria Santos", handle: "@mariasantos", platform: "YOUTUBE", followersCount: 1200000, rate: 3500, bio: "Travel vlogger and storyteller" } }),
    prisma.creator.upsert({ where: { id: "creator-4" }, update: {}, create: { id: "creator-4", orgId: org.id, name: "James Kim", handle: "@jameskim", platform: "INSTAGRAM", followersCount: 450000, rate: 1500, bio: "Food & restaurant reviews" } }),
    prisma.creator.upsert({ where: { id: "creator-5" }, update: {}, create: { id: "creator-5", orgId: org.id, name: "Priya Patel", handle: "@priyapatel", platform: "TIKTOK", followersCount: 3100000, rate: 8000, bio: "Dance & culture content" } }),
    prisma.creator.upsert({ where: { id: "creator-6" }, update: {}, create: { id: "creator-6", orgId: org.id, name: "Liam Brooks", handle: "@liambrooks", platform: "YOUTUBE", followersCount: 780000, rate: 2500, bio: "Tech reviews & unboxings" } }),
    prisma.creator.upsert({ where: { id: "creator-7" }, update: {}, create: { id: "creator-7", orgId: org.id, name: "Nina Okafor", handle: "@ninaokafor", platform: "INSTAGRAM", followersCount: 1600000, rate: 4500, bio: "Beauty & skincare guru" } }),
    prisma.creator.upsert({ where: { id: "creator-8" }, update: {}, create: { id: "creator-8", orgId: org.id, name: "Tomás Rivera", handle: "@tomasrivera", platform: "TIKTOK", followersCount: 520000, rate: 1800, bio: "Fitness & wellness" } }),
    prisma.creator.upsert({ where: { id: "creator-9" }, update: {}, create: { id: "creator-9", orgId: org.id, name: "Emma Chen", handle: "@emmachen", platform: "YOUTUBE", followersCount: 2100000, rate: 6000, bio: "Music covers & original songs" } }),
    prisma.creator.upsert({ where: { id: "creator-10" }, update: {}, create: { id: "creator-10", orgId: org.id, name: "David Osei", handle: "@davidosei", platform: "TWITTER", followersCount: 340000, rate: 1200, bio: "Pop culture commentary" } }),
  ]);

  // ─── Campaigns ───
  const campaigns = await Promise.all([
    prisma.campaign.upsert({ where: { id: "camp-1" }, update: {}, create: { id: "camp-1", orgId: org.id, clientId: clients[0].id, createdById: user.id, title: "LEAK IT (BTS)", status: "IN_PROGRESS", budget: 25000, currency: "USD", createdAt: new Date("2026-01-15") } }),
    prisma.campaign.upsert({ where: { id: "camp-2" }, update: {}, create: { id: "camp-2", orgId: org.id, clientId: clients[1].id, createdById: user.id, title: "FUJI KAZE (2ND PHASE)", status: "IN_PROGRESS", budget: 40000, currency: "USD", createdAt: new Date("2026-02-01") } }),
    prisma.campaign.upsert({ where: { id: "camp-3" }, update: {}, create: { id: "camp-3", orgId: org.id, clientId: clients[0].id, createdById: user.id, title: "Blessing Jolie", status: "IN_PROGRESS", budget: 15000, currency: "USD", createdAt: new Date("2026-02-10") } }),
    prisma.campaign.upsert({ where: { id: "camp-4" }, update: {}, create: { id: "camp-4", orgId: org.id, clientId: clients[2].id, createdById: user.id, title: "CRUEL WORLD", status: "COMPLETE", budget: 30000, currency: "USD", createdAt: new Date("2025-12-01") } }),
    prisma.campaign.upsert({ where: { id: "camp-5" }, update: {}, create: { id: "camp-5", orgId: org.id, clientId: clients[1].id, createdById: user.id, title: "American Girls", status: "PENDING", budget: null, currency: "USD", createdAt: new Date("2026-03-01") } }),
  ]);

  // ─── Activations ───
  await prisma.activation.upsert({ where: { id: "act-1" }, update: {}, create: { id: "act-1", campaignId: campaigns[0].id, creatorId: creators[0].id, status: "APPROVED" } });
  await prisma.activation.upsert({ where: { id: "act-2" }, update: {}, create: { id: "act-2", campaignId: campaigns[0].id, creatorId: creators[1].id, status: "APPROVED" } });
  await prisma.activation.upsert({ where: { id: "act-3" }, update: {}, create: { id: "act-3", campaignId: campaigns[1].id, creatorId: creators[4].id, status: "APPROVED" } });
  await prisma.activation.upsert({ where: { id: "act-4" }, update: {}, create: { id: "act-4", campaignId: campaigns[2].id, creatorId: creators[0].id, status: "COMPLETE" } });

  // ─── Payouts ───
  await prisma.payout.upsert({ where: { id: "pay-1" }, update: {}, create: { id: "pay-1", orgId: org.id, creatorId: creators[0].id, campaignId: campaigns[2].id, amount: 5000, currency: "USD", status: "SUCCESS" } });
  await prisma.payout.upsert({ where: { id: "pay-2" }, update: {}, create: { id: "pay-2", orgId: org.id, creatorId: creators[1].id, campaignId: campaigns[0].id, amount: 2000, currency: "USD", status: "PENDING" } });
  await prisma.payout.upsert({ where: { id: "pay-3" }, update: {}, create: { id: "pay-3", orgId: org.id, creatorId: creators[4].id, campaignId: campaigns[1].id, amount: 8000, currency: "USD", status: "PENDING" } });

  console.log("Seeded:", {
    org: org.name,
    plan: org.plan,
    user: user.email,
    role: user.role,
    plans: [planStarter.name, planPro.name, planEnterprise.name],
    clients: clients.length,
    creators: creators.length,
    campaigns: campaigns.length,
  });
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
