import "dotenv/config";
import { PrismaClient } from "../lib/generated/prisma/client";
import { PrismaPg } from "@prisma/adapter-pg";
import bcrypt from "bcryptjs";

const adapter = new PrismaPg({ connectionString: process.env.DATABASE_URL ?? "" });
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
      creatorIds: [],
      createdById: user.id,
    },
  });

  console.log("Seeded:", { org: org.name, plan: org.plan, user: user.email, role: user.role });
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
