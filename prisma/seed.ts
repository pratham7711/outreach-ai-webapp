import "dotenv/config";
import { PrismaClient } from "../lib/generated/prisma";
import { PrismaBetterSqlite3 } from "@prisma/adapter-better-sqlite3";
import bcrypt from "bcryptjs";

const url = process.env.DATABASE_URL ?? "file:./dev.db";
const adapter = new PrismaBetterSqlite3({ url });
const prisma = new PrismaClient({ adapter } as any);

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

  // Clients
  const clients = await Promise.all([
    prisma.client.upsert({ where: { id: "client-1" }, update: {}, create: { id: "client-1", orgId: org.id, name: "Sony Music", logoUrl: null, contactInfo: JSON.stringify({ email: "contact@sony.com" }) } }),
    prisma.client.upsert({ where: { id: "client-2" }, update: {}, create: { id: "client-2", orgId: org.id, name: "Universal Records", logoUrl: null, contactInfo: JSON.stringify({ email: "hello@universal.com" }) } }),
    prisma.client.upsert({ where: { id: "client-3" }, update: {}, create: { id: "client-3", orgId: org.id, name: "Warner Music", logoUrl: null, contactInfo: JSON.stringify({ email: "info@warner.com" }) } }),
  ]);

  // Creators
  const creators = await Promise.all([
    prisma.creator.upsert({ where: { id: "creator-1" }, update: {}, create: { id: "creator-1", orgId: org.id, name: "Blessing Jolie", handle: "@blessingjolie", platform: "INSTAGRAM", followersCount: 2400000, rate: 5000 } }),
    prisma.creator.upsert({ where: { id: "creator-2" }, update: {}, create: { id: "creator-2", orgId: org.id, name: "Alex Turner", handle: "@alexturner", platform: "TIKTOK", followersCount: 890000, rate: 2000 } }),
    prisma.creator.upsert({ where: { id: "creator-3" }, update: {}, create: { id: "creator-3", orgId: org.id, name: "Maria Santos", handle: "@mariasantos", platform: "YOUTUBE", followersCount: 1200000, rate: 3500 } }),
    prisma.creator.upsert({ where: { id: "creator-4" }, update: {}, create: { id: "creator-4", orgId: org.id, name: "James Kim", handle: "@jameskim", platform: "INSTAGRAM", followersCount: 450000, rate: 1500 } }),
    prisma.creator.upsert({ where: { id: "creator-5" }, update: {}, create: { id: "creator-5", orgId: org.id, name: "Priya Patel", handle: "@priyapatel", platform: "TIKTOK", followersCount: 3100000, rate: 8000 } }),
  ]);

  // Campaigns
  const campaigns = await Promise.all([
    prisma.campaign.upsert({ where: { id: "camp-1" }, update: {}, create: { id: "camp-1", orgId: org.id, clientId: clients[0].id, createdById: user.id, title: "LEAK IT (BTS)", status: "IN_PROGRESS", budget: 25000, currency: "USD", createdAt: new Date("2026-01-15") } }),
    prisma.campaign.upsert({ where: { id: "camp-2" }, update: {}, create: { id: "camp-2", orgId: org.id, clientId: clients[1].id, createdById: user.id, title: "FUJI KAZE (2ND PHASE)", status: "IN_PROGRESS", budget: 40000, currency: "USD", createdAt: new Date("2026-02-01") } }),
    prisma.campaign.upsert({ where: { id: "camp-3" }, update: {}, create: { id: "camp-3", orgId: org.id, clientId: clients[0].id, createdById: user.id, title: "Blessing Jolie", status: "IN_PROGRESS", budget: 15000, currency: "USD", createdAt: new Date("2026-02-10") } }),
    prisma.campaign.upsert({ where: { id: "camp-4" }, update: {}, create: { id: "camp-4", orgId: org.id, clientId: clients[2].id, createdById: user.id, title: "CRUEL WORLD", status: "COMPLETE", budget: 30000, currency: "USD", createdAt: new Date("2025-12-01") } }),
    prisma.campaign.upsert({ where: { id: "camp-5" }, update: {}, create: { id: "camp-5", orgId: org.id, clientId: clients[1].id, createdById: user.id, title: "American Girls", status: "PENDING", budget: null, currency: "USD", createdAt: new Date("2026-03-01") } }),
  ]);

  // Activations (creator-campaign assignments)
  await prisma.activation.upsert({ where: { id: "act-1" }, update: {}, create: { id: "act-1", campaignId: campaigns[0].id, creatorId: creators[0].id, status: "APPROVED" } });
  await prisma.activation.upsert({ where: { id: "act-2" }, update: {}, create: { id: "act-2", campaignId: campaigns[0].id, creatorId: creators[1].id, status: "APPROVED" } });
  await prisma.activation.upsert({ where: { id: "act-3" }, update: {}, create: { id: "act-3", campaignId: campaigns[1].id, creatorId: creators[4].id, status: "APPROVED" } });
  await prisma.activation.upsert({ where: { id: "act-4" }, update: {}, create: { id: "act-4", campaignId: campaigns[2].id, creatorId: creators[0].id, status: "COMPLETE" } });

  // Payouts
  await prisma.payout.upsert({ where: { id: "pay-1" }, update: {}, create: { id: "pay-1", orgId: org.id, creatorId: creators[0].id, campaignId: campaigns[2].id, amount: 5000, currency: "USD", status: "SUCCESS" } });
  await prisma.payout.upsert({ where: { id: "pay-2" }, update: {}, create: { id: "pay-2", orgId: org.id, creatorId: creators[1].id, campaignId: campaigns[0].id, amount: 2000, currency: "USD", status: "PENDING" } });
  await prisma.payout.upsert({ where: { id: "pay-3" }, update: {}, create: { id: "pay-3", orgId: org.id, creatorId: creators[4].id, campaignId: campaigns[1].id, amount: 8000, currency: "USD", status: "PENDING" } });

  console.log("Seeded:", { org: org.name, plan: org.plan, user: user.email, role: user.role, clients: clients.length, creators: creators.length, campaigns: campaigns.length });
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
