import { config as loadEnv } from "dotenv";

/* Next.js reads .env.local; this config read only .env, so every prisma CLI
   invocation on a dev machine failed for want of a URL unless someone
   hand-exported it. Load both, .env.local first — dotenv never overwrites a
   variable that is already set, so an explicit DATABASE_URL in the
   environment (e.g. pointing a push at another branch) still wins. */
loadEnv({ path: [".env.local", ".env"] });
import { defineConfig } from "prisma/config";

export default defineConfig({
  schema: "prisma/schema.prisma",
  migrations: {
    path: "prisma/migrations",
    seed: "npx tsx prisma/seed.ts",
  },
  datasource: {
    url: process.env.DIRECT_DATABASE_URL ?? process.env.DATABASE_URL!,
  },
});
