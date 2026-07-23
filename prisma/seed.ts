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
      id: "cmnbxsoos00006vfd7jhdvusb",
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
      id: "cmnbxspfv00016vfdz6yuds55",
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
    update: { features: { soundTracker: true, reports: true, csvExport: true, creator_discovery: true } },
    create: {
      orgId: org.id,
      planName: 'pro',
      maxCampaigns: 50,
      maxCreators: 500,
      maxUsers: 10,
      features: { soundTracker: true, reports: true, csvExport: true, creator_discovery: true },
    },
  });

  // ─── OrgUIConfig ───
  await prisma.organization.update({
    where: { id: org.id },
    data: {
      uiConfig: {
        features: { soundTracker: true, creatorPortal: false, aiBriefings: false, reports: true, csvExport: true },
        nav: ["campaigns", "creators", "payouts", "analytics", "trackers", "lists", "activations", "calendar", "clients", "discovery", "fan-pages", "requests", "recipients"],
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
  // deliverableDueDate spread relative to seed time so the calendar always shows current + upcoming deliverables
  const dueIn = (days: number) => { const d = new Date(); d.setDate(d.getDate() + days); d.setHours(12, 0, 0, 0); return d; };
  const activationSeed = [
    { id: "act-1", campaignId: campaigns[0].id, creatorId: creators[0].id, status: "APPROVED" as const, deliverableDueDate: dueIn(5) },
    { id: "act-2", campaignId: campaigns[0].id, creatorId: creators[1].id, status: "APPROVED" as const, deliverableDueDate: dueIn(9) },
    { id: "act-3", campaignId: campaigns[1].id, creatorId: creators[4].id, status: "APPROVED" as const, deliverableDueDate: dueIn(14) },
    { id: "act-4", campaignId: campaigns[2].id, creatorId: creators[0].id, status: "COMPLETE" as const, deliverableDueDate: dueIn(-20) },
    { id: "act-5", campaignId: campaigns[0].id, creatorId: creators[2].id, status: "APPROVED" as const, deliverableDueDate: dueIn(22) },
    { id: "act-6", campaignId: campaigns[1].id, creatorId: creators[8].id, status: "APPROVED" as const, deliverableDueDate: dueIn(30) },
  ];
  for (const a of activationSeed) {
    await prisma.activation.upsert({
      where: { id: a.id },
      update: { deliverableDueDate: a.deliverableDueDate },
      create: a,
    });
  }

  // ─── Posts ───
  await prisma.post.upsert({
    where: { id: "post-1" },
    update: {},
    create: {
      id: "post-1",
      campaignId: campaigns[0].id,
      creatorId: creators[0].id,
      platform: "INSTAGRAM",
      platformPostId: "ig-leak-1",
      postUrl: "https://instagram.com/p/leak1",
      caption: "LEAK IT behind the scenes 🎬",
      postedAt: new Date("2026-01-20"),
      viewsCount: 125000,
      likesCount: 8400,
      commentsCount: 320,
      sharesCount: 1500,
      engagementRate: 8.2,
    },
  });
  await prisma.post.upsert({
    where: { id: "post-2" },
    update: {},
    create: {
      id: "post-2",
      campaignId: campaigns[0].id,
      creatorId: creators[0].id,
      platform: "INSTAGRAM",
      platformPostId: "ig-leak-2",
      postUrl: "https://instagram.com/p/leak2",
      caption: "Studio session vibes ✨",
      postedAt: new Date("2026-01-25"),
      viewsCount: 98000,
      likesCount: 6200,
      commentsCount: 210,
      sharesCount: 890,
      engagementRate: 7.4,
    },
  });
  await prisma.post.upsert({
    where: { id: "post-3" },
    update: {},
    create: {
      id: "post-3",
      campaignId: campaigns[0].id,
      creatorId: creators[1].id,
      platform: "TIKTOK",
      platformPostId: "tt-leak-1",
      postUrl: "https://tiktok.com/@alexturner/leak1",
      caption: "Reacting to LEAK IT 🔥",
      postedAt: new Date("2026-01-22"),
      viewsCount: 340000,
      likesCount: 28000,
      commentsCount: 1200,
      sharesCount: 4500,
      engagementRate: 9.9,
    },
  });
  await prisma.post.upsert({
    where: { id: "post-4" },
    update: {},
    create: {
      id: "post-4",
      campaignId: campaigns[1].id,
      creatorId: creators[4].id,
      platform: "TIKTOK",
      platformPostId: "tt-fuji-1",
      postUrl: "https://tiktok.com/@priyapatel/fuji1",
      caption: "Dancing to Fuji Kaze 💃",
      postedAt: new Date("2026-02-10"),
      viewsCount: 520000,
      likesCount: 42000,
      commentsCount: 3100,
      sharesCount: 8900,
      engagementRate: 10.4,
    },
  });
  await prisma.post.upsert({
    where: { id: "post-5" },
    update: {},
    create: {
      id: "post-5",
      campaignId: campaigns[1].id,
      creatorId: creators[4].id,
      platform: "TIKTOK",
      platformPostId: "tt-fuji-2",
      postUrl: "https://tiktok.com/@priyapatel/fuji2",
      caption: "Part 2 choreography drop 🎶",
      postedAt: new Date("2026-02-15"),
      viewsCount: 410000,
      likesCount: 35000,
      commentsCount: 2400,
      sharesCount: 7200,
      engagementRate: 10.9,
    },
  });
  await prisma.post.upsert({
    where: { id: "post-6" },
    update: {},
    create: {
      id: "post-6",
      campaignId: campaigns[2].id,
      creatorId: creators[0].id,
      platform: "INSTAGRAM",
      platformPostId: "ig-bj-1",
      postUrl: "https://instagram.com/p/bj1",
      caption: "New collab announcement 🌟",
      postedAt: new Date("2026-02-15"),
      viewsCount: 180000,
      likesCount: 12000,
      commentsCount: 540,
      sharesCount: 2100,
      engagementRate: 8.1,
    },
  });
  await prisma.post.upsert({
    where: { id: "post-7" },
    update: {},
    create: {
      id: "post-7",
      campaignId: campaigns[2].id,
      creatorId: creators[0].id,
      platform: "INSTAGRAM",
      platformPostId: "ig-bj-2",
      postUrl: "https://instagram.com/p/bj2",
      caption: "Campaign photoshoot day 📸",
      postedAt: new Date("2026-02-20"),
      viewsCount: 145000,
      likesCount: 9800,
      commentsCount: 410,
      sharesCount: 1600,
      engagementRate: 8.1,
    },
  });
  await prisma.post.upsert({
    where: { id: "post-8" },
    update: {},
    create: {
      id: "post-8",
      campaignId: campaigns[3].id,
      creatorId: creators[0].id,
      platform: "INSTAGRAM",
      platformPostId: "ig-cruel-1",
      postUrl: "https://instagram.com/p/cruel1",
      caption: "CRUEL WORLD final wrap 🎬",
      postedAt: new Date("2025-12-15"),
      viewsCount: 210000,
      likesCount: 15000,
      commentsCount: 680,
      sharesCount: 3200,
      engagementRate: 9.0,
    },
  });
  await prisma.post.upsert({
    where: { id: "post-9" },
    update: {},
    create: {
      id: "post-9",
      campaignId: campaigns[3].id,
      creatorId: creators[1].id,
      platform: "TIKTOK",
      platformPostId: "tt-cruel-1",
      postUrl: "https://tiktok.com/@alexturner/cruel1",
      caption: "My take on CRUEL WORLD 🌍",
      postedAt: new Date("2025-12-20"),
      viewsCount: 280000,
      likesCount: 22000,
      commentsCount: 950,
      sharesCount: 3800,
      engagementRate: 9.6,
    },
  });
  await prisma.post.upsert({
    where: { id: "post-10" },
    update: {},
    create: {
      id: "post-10",
      campaignId: campaigns[0].id,
      creatorId: creators[2].id,
      platform: "YOUTUBE",
      platformPostId: "dQw4w9WgXcQ",
      postUrl: "https://www.youtube.com/watch?v=dQw4w9WgXcQ",
      caption: "LEAK IT — official visualizer reaction",
      postedAt: new Date("2026-01-28"),
      viewsCount: 890000,
      likesCount: 54000,
      commentsCount: 4200,
      sharesCount: 0,
      engagementRate: 6.5,
    },
  });
  await prisma.post.upsert({
    where: { id: "post-11" },
    update: {},
    create: {
      id: "post-11",
      campaignId: campaigns[1].id,
      creatorId: creators[8].id,
      platform: "YOUTUBE",
      platformPostId: "9bZkp7q19f0",
      postUrl: "https://www.youtube.com/watch?v=9bZkp7q19f0",
      caption: "Fuji Kaze cover — full band arrangement",
      postedAt: new Date("2026-02-18"),
      viewsCount: 640000,
      likesCount: 41000,
      commentsCount: 2900,
      sharesCount: 0,
      engagementRate: 6.9,
    },
  });

  // ─── Campaign Financials ───
  await prisma.campaignFinancials.upsert({
    where: { campaignId: campaigns[0].id },
    update: { spentAmount: 7000 },
    create: { id: "fin-1", campaignId: campaigns[0].id, totalBudget: 25000, spentAmount: 7000 },
  });
  await prisma.campaignFinancials.upsert({
    where: { campaignId: campaigns[1].id },
    update: { spentAmount: 16000 },
    create: { id: "fin-2", campaignId: campaigns[1].id, totalBudget: 40000, spentAmount: 16000 },
  });
  await prisma.campaignFinancials.upsert({
    where: { campaignId: campaigns[2].id },
    update: { spentAmount: 5000 },
    create: { id: "fin-3", campaignId: campaigns[2].id, totalBudget: 15000, spentAmount: 5000 },
  });
  await prisma.campaignFinancials.upsert({
    where: { campaignId: campaigns[3].id },
    update: { spentAmount: 28500 },
    create: { id: "fin-4", campaignId: campaigns[3].id, totalBudget: 30000, spentAmount: 28500 },
  });

  // ─── Payouts ───
  await prisma.payout.upsert({ where: { id: "pay-1" }, update: {}, create: { id: "pay-1", orgId: org.id, creatorId: creators[0].id, campaignId: campaigns[2].id, amount: 5000, currency: "USD", status: "SUCCESS" } });
  await prisma.payout.upsert({ where: { id: "pay-2" }, update: {}, create: { id: "pay-2", orgId: org.id, creatorId: creators[1].id, campaignId: campaigns[0].id, amount: 2000, currency: "USD", status: "PENDING" } });
  await prisma.payout.upsert({ where: { id: "pay-3" }, update: {}, create: { id: "pay-3", orgId: org.id, creatorId: creators[4].id, campaignId: campaigns[1].id, amount: 8000, currency: "USD", status: "PENDING" } });

  // ─── TikTok Sounds (Trackers) ───
  const sounds = await Promise.all([
    prisma.tikTokSound.upsert({
      where: { id: "sound-1" },
      update: {},
      create: { id: "sound-1", orgId: org.id, tiktokSoundId: "7300001", title: "Original Sound — Summer Vibes", artist: "DJ Wave", coverImageUrl: null, trackedSince: new Date("2026-02-01") },
    }),
    prisma.tikTokSound.upsert({
      where: { id: "sound-2" },
      update: {},
      create: { id: "sound-2", orgId: org.id, tiktokSoundId: "7300002", title: "Beat Drop Remix", artist: "Fuji Kaze", coverImageUrl: null, trackedSince: new Date("2026-01-15") },
    }),
    prisma.tikTokSound.upsert({
      where: { id: "sound-3" },
      update: {},
      create: { id: "sound-3", orgId: org.id, tiktokSoundId: "7300003", title: "Dance Challenge Audio", artist: "Priya Beats", coverImageUrl: null, trackedSince: new Date("2026-03-01") },
    }),
  ]);

  // Snapshots for each sound (last 7 days)
  for (const [i, sound] of sounds.entries()) {
    const baseUses = [45000, 128000, 67000][i];
    for (let d = 6; d >= 0; d--) {
      const date = new Date();
      date.setDate(date.getDate() - d);
      const growth = Math.floor(baseUses * (0.02 + Math.random() * 0.05));
      const totalUses = baseUses + growth * (7 - d);
      await prisma.soundTrackerSnapshot.upsert({
        where: { id: `snap-${sound.id}-d${d}` },
        update: {},
        create: {
          id: `snap-${sound.id}-d${d}`,
          soundId: sound.id,
          usesCount: totalUses,
          videosAdded24h: Math.floor(growth * 0.3),
          deltaUses24h: growth,
          velocityScore: parseFloat((growth / baseUses * 100).toFixed(2)),
          recordedAt: date,
        },
      });
    }
  }

  // ─── Creator Users (Portal) ───
  const creatorHash = await bcrypt.hash("creator123", 10);
  await prisma.creatorUser.upsert({
    where: { email: "creator@demo.com" },
    update: {},
    create: {
      id: "cuser-1",
      email: "creator@demo.com",
      passwordHash: creatorHash,
      name: "Blessing Jolie",
      handle: "blessingjolie",
      bio: "Lifestyle & fashion content creator",
      platform: "INSTAGRAM",
      followersCount: 2400000,
      averageViews: 180000,
      rate: 5000,
      cpm: 3.5,
      niches: ["FASHION", "LIFESTYLE"],
    },
  });
  await prisma.creatorUser.upsert({
    where: { email: "alex@demo.com" },
    update: {},
    create: {
      id: "cuser-2",
      email: "alex@demo.com",
      passwordHash: creatorHash,
      name: "Alex Turner",
      handle: "alexturner",
      bio: "Music & comedy shorts",
      platform: "TIKTOK",
      followersCount: 890000,
      averageViews: 340000,
      rate: 2000,
      cpm: 2.8,
      niches: ["MUSIC", "COMEDY"],
    },
  });

  // ─── Marketplace campaign (Phase 2M) — GLOBAL, always populated ───
  // Deterministic slug so /explore and /explore/[slug] are never empty in dev/CI.
  const marketplaceSlug = "summer-drop-creator-rewards";
  const deadline = new Date();
  deadline.setDate(deadline.getDate() + 30);

  const marketplaceCampaign = await prisma.campaign.upsert({
    where: { id: "camp-mkt" },
    update: {
      marketplaceVisibility: "GLOBAL",
      publicSlug: marketplaceSlug,
      submissionDeadline: deadline,
    },
    create: {
      id: "camp-mkt",
      orgId: org.id,
      clientId: clients[0].id,
      createdById: user.id,
      title: "Summer Drop — Creator Rewards",
      status: "IN_PROGRESS",
      campaignType: "VIEW_BASED",
      budget: null,
      currency: "USD",
      createdAt: new Date("2026-06-20"),
      marketplaceVisibility: "GLOBAL",
      publicSlug: marketplaceSlug,
      enrollmentOpen: true,
      postApprovalMode: "AUTO_APPROVED",
      autoApproveHours: 48,
      guidelines:
        "Create short-form content featuring the Summer Drop track. Hook in the first 3 seconds, tag the official account, and use the campaign hashtag. Original edits and creative interpretations are encouraged — the more views your clip earns, the more you get paid.",
      requirements:
        "Public account, no follower minimum. One submission per platform. Content must stay live for at least 30 days. No reposting other creators' clips.",
      contentAssetsUrl: "https://example.com/assets/summer-drop-kit.zip",
      ratePerThousand: { TIKTOK: 150, INSTAGRAM: 200, YOUTUBE: 120 },
      minPayoutMinor: 2000,
      marketplaceBudgetCapMinor: 500000,
      submissionDeadline: deadline,
    },
  });

  const marketplaceActivations = await Promise.all([
    prisma.activation.upsert({ where: { id: "act-mkt-1" }, update: { deliverableDueDate: dueIn(7) }, create: { id: "act-mkt-1", campaignId: marketplaceCampaign.id, creatorId: creators[0].id, status: "APPROVED", deliverableDueDate: dueIn(7) } }),
    prisma.activation.upsert({ where: { id: "act-mkt-2" }, update: { deliverableDueDate: dueIn(18) }, create: { id: "act-mkt-2", campaignId: marketplaceCampaign.id, creatorId: creators[1].id, status: "APPROVED", deliverableDueDate: dueIn(18) } }),
    prisma.activation.upsert({ where: { id: "act-mkt-3" }, update: { deliverableDueDate: dueIn(26) }, create: { id: "act-mkt-3", campaignId: marketplaceCampaign.id, creatorId: creators[8].id, status: "APPROVED", deliverableDueDate: dueIn(26) } }),
  ]);

  const marketplacePostSpecs = [
    { id: "post-mkt-1", activationId: marketplaceActivations[0].id, creatorId: creators[0].id, platform: "INSTAGRAM" as const, views: 240000, likes: 18000, comments: 620, shares: 3100, rate: 200 },
    { id: "post-mkt-2", activationId: marketplaceActivations[1].id, creatorId: creators[1].id, platform: "TIKTOK" as const, views: 610000, likes: 52000, comments: 3400, shares: 9800, rate: 150 },
    { id: "post-mkt-3", activationId: marketplaceActivations[2].id, creatorId: creators[8].id, platform: "YOUTUBE" as const, views: 430000, likes: 31000, comments: 2100, shares: 0, rate: 120 },
  ];

  for (const [i, spec] of marketplacePostSpecs.entries()) {
    const postedAt = new Date();
    postedAt.setDate(postedAt.getDate() - (10 - i * 3));
    await prisma.post.upsert({
      where: { id: spec.id },
      update: { viewsCount: spec.views, status: "APPROVED" },
      create: {
        id: spec.id,
        campaignId: marketplaceCampaign.id,
        creatorId: spec.creatorId,
        activationId: spec.activationId,
        platform: spec.platform,
        platformPostId: `mkt-${spec.id}`,
        postUrl: `https://example.com/${spec.platform.toLowerCase()}/${spec.id}`,
        caption: "Summer Drop content 🎵",
        postedAt,
        viewsCount: spec.views,
        likesCount: spec.likes,
        commentsCount: spec.comments,
        sharesCount: spec.shares,
        engagementRate: parseFloat((((spec.likes + spec.comments) / spec.views) * 100).toFixed(1)),
        status: "APPROVED",
      },
    });

    const amountEarned = Math.floor((spec.views / 1000) * spec.rate) / 100;
    await prisma.viewLedger.upsert({
      where: { id: `vl-mkt-${i + 1}` },
      update: { viewsRecorded: spec.views, viewsDelta: spec.views, amountEarned, cumulativeEarned: amountEarned },
      create: {
        id: `vl-mkt-${i + 1}`,
        orgId: org.id,
        campaignId: marketplaceCampaign.id,
        creatorId: spec.creatorId,
        activationId: spec.activationId,
        postId: spec.id,
        viewsRecorded: spec.views,
        viewsDelta: spec.views,
        cpmRate: spec.rate / 100,
        amountEarned,
        cumulativeEarned: amountEarned,
        recordedAt: postedAt,
      },
    });
  }

  const postsByPlatform = await prisma.post.groupBy({
    by: ["platform"],
    where: { campaign: { orgId: org.id } },
    _count: { id: true },
  });

  console.log("Seeded:", {
    org: org.name,
    plan: org.plan,
    user: user.email,
    role: user.role,
    plans: [planStarter.name, planPro.name, planEnterprise.name],
    clients: clients.length,
    creators: creators.length,
    campaigns: campaigns.length,
    posts: 11,
    postsByPlatform: Object.fromEntries(postsByPlatform.map((p) => [p.platform, p._count.id])),
    financials: 4,
    sounds: sounds.length,
    creatorUsers: 2,
    marketplaceCampaign: { slug: marketplaceCampaign.publicSlug, visibility: marketplaceCampaign.marketplaceVisibility },
  });
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
