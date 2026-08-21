/**
 * Spend figures are optional to enter, and must not render where they were
 * never entered. That makes coverage the deciding number: a column that is
 * empty for every visible row should not exist, while a detail page can show
 * the field for the few records that carry one.
 *
 *   npx tsx --env-file=.env scripts/optional-money-coverage.ts
 */
import { db } from "@/lib/db";

async function main() {
  const campaigns = await db.campaign.count({ where: { deletedAt: null } });
  const withBudget = await db.campaign.count({ where: { deletedAt: null, budget: { not: null } } });
  const budgetOverZero = await db.campaign.count({ where: { deletedAt: null, budget: { gt: 0 } } });

  const creators = await db.creator.count({ where: { deletedAt: null } });
  const withRate = await db.creator.count({ where: { deletedAt: null, rate: { not: null } } });
  const rateOverZero = await db.creator.count({ where: { deletedAt: null, rate: { gt: 0 } } });

  const pct = (n: number, of: number) => `${((n / of) * 100).toFixed(1)}%`;
  console.log(`campaigns: ${campaigns}`);
  console.log(`  budget set:  ${withBudget} (${pct(withBudget, campaigns)})`);
  console.log(`  budget > 0:  ${budgetOverZero} (${pct(budgetOverZero, campaigns)})`);
  console.log(`creators: ${creators}`);
  console.log(`  rate set:    ${withRate} (${pct(withRate, creators)})`);
  console.log(`  rate > 0:    ${rateOverZero} (${pct(rateOverZero, creators)})`);
}

main().then(() => process.exit(0));
