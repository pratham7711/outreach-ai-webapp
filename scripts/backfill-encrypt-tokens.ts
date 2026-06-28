import { db } from "@/lib/db";
import { planReencrypt } from "@/lib/crypto/token-backfill";

async function main() {
  const dryRun = process.argv.includes("--dry-run");
  const accounts = await db.creatorSocialAccount.findMany({
    include: { creator: { select: { orgId: true } } },
  });

  let updated = 0;
  let skipped = 0;
  for (const a of accounts) {
    const plan = planReencrypt({
      accessToken: a.accessToken,
      refreshToken: a.refreshToken,
      orgId: a.creator.orgId,
    });
    if (!plan) {
      skipped++;
      continue;
    }
    if (!dryRun) {
      await db.creatorSocialAccount.update({ where: { id: a.id }, data: plan });
    }
    updated++;
  }

  const verb = dryRun ? "[dry-run] would re-encrypt" : "re-encrypted";
  console.log(
    `${verb} ${updated}; already-encrypted ${skipped}; total ${accounts.length}`,
  );
}

main()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error("backfill failed:", err);
    process.exit(1);
  });
