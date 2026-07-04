import "dotenv/config";
import { db } from "@/lib/db";

async function main() {
  const cols = await db.$queryRawUnsafe<any[]>(
    `SELECT 1 FROM information_schema.columns WHERE table_name = 'Campaign' AND column_name = 'marketplaceVisibility'`,
  );
  if (cols.length === 0) {
    console.log("stale column already cleared; nothing to do — run: npx prisma db push --accept-data-loss");
    return;
  }
  const usage = await db.$queryRawUnsafe<any[]>(
    `SELECT "marketplaceVisibility"::text AS v, count(*)::int AS n FROM "Campaign" GROUP BY 1`,
  );
  const nonPrivate = usage.filter((r) => r.v !== "ROSTER_ONLY" && r.v !== null);
  if (nonPrivate.length > 0) {
    console.error("unexpected visibility values, aborting:", JSON.stringify(nonPrivate));
    process.exit(1);
  }
  await db.$executeRawUnsafe(`ALTER TABLE "Campaign" DROP COLUMN IF EXISTS "marketplaceVisibility"`);
  await db.$executeRawUnsafe(`DROP TYPE IF EXISTS "MarketplaceVisibility"`);
  console.log(
    `dropped stale draft enum + column (${usage[0]?.n ?? 0} rows were ROSTER_ONLY = new default PRIVATE); now run: npx prisma db push`,
  );
}

main()
  .catch((e) => {
    console.error(e.message);
    process.exit(1);
  })
  .finally(() => process.exit(0));
