import "dotenv/config";
import { PrismaClient } from "../lib/generated/prisma/client";
import { PrismaPg } from "@prisma/adapter-pg";
import bcrypt from "bcryptjs";

const adapter = new PrismaPg({ connectionString: process.env.DATABASE_URL ?? "" });
const prisma = new PrismaClient({ adapter });

async function main() {
  const org = await prisma.organization.upsert({
    where: { subdomain: "demo-agency" },
    update: {},
    create: {
      name: "Demo Agency",
      subdomain: "demo-agency",
    },
  });

  const hashed = await bcrypt.hash("admin123", 10);
  const user = await prisma.user.upsert({
    where: { email: "admin@demo.com" },
    update: {},
    create: {
      orgId: org.id,
      email: "admin@demo.com",
      name: "Admin",
      password: hashed,
      role: "OWNER",
    },
  });

  console.log("Seeded:", { org: org.name, user: user.email });
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
