/**
 * Move one tenant onto a plan tier. There is no UI for this: /plans is the
 * org's own client-facing retainer plans, and /settings/billing only displays
 * what the tier already says. Changing a SaaS tier is a database write, so it
 * should at least be a reviewed and dry-runnable one.
 *
 * Two columns have to move together. getOrgEntitlements reads
 * OrgPlanConfig.planName first and falls back to Organization.plan, so writing
 * only one of them leaves a tenant whose screen and whose limits disagree.
 *
 *   npx tsx --env-file=.env scripts/set-org-plan.ts -- --org <id|subdomain> --plan pro
 *   npx tsx --env-file=.env scripts/set-org-plan.ts -- --org lkay-media --plan pro --apply
 *
 * Without --apply it prints the before/after and writes nothing.
 * --trackers <n> additionally sets a per-org override; --trackers clear removes
 * one, putting the org back on its tier's number.
 */
import { db } from "@/lib/db";
import { PLANS, type PlanName } from "@/lib/plans";

function arg(name: string): string | undefined {
  const i = process.argv.indexOf(`--${name}`);
  return i === -1 ? undefined : process.argv[i + 1];
}

async function main() {
  const apply = process.argv.includes("--apply");
  const orgRef = arg("org");
  const plan = arg("plan");
  const trackersRaw = arg("trackers");

  if (!orgRef || !plan) {
    console.error("need --org <id|subdomain> and --plan <" + Object.keys(PLANS).join("|") + ">");
    process.exit(1);
  }
  if (!(plan in PLANS)) {
    console.error(`unknown plan "${plan}". known: ${Object.keys(PLANS).join(", ")}`);
    process.exit(1);
  }
  const planName = plan as PlanName;

  /* clear and a number are different intentions: one removes the override, the
     other sets it. Undefined means leave whatever is there alone. */
  let override: number | null | undefined;
  if (trackersRaw === "clear") override = null;
  else if (trackersRaw !== undefined) {
    const n = Number(trackersRaw);
    if (!Number.isInteger(n) || n < 0) {
      console.error(`--trackers wants a non-negative integer or "clear", got "${trackersRaw}"`);
      process.exit(1);
    }
    override = n;
  }

  const org = await db.organization.findFirst({
    where: { OR: [{ id: orgRef }, { subdomain: orgRef }] },
    include: { planConfig: true, _count: { select: { users: true, campaigns: true, creators: true } } },
  });
  if (!org) {
    console.error(`no org matched "${orgRef}" by id or subdomain`);
    process.exit(1);
  }

  const trackersInUse = await db.tikTokSound.count({ where: { orgId: org.id } });
  const effectiveBefore = org.planConfig?.maxTrackers ?? PLANS[(org.planConfig?.planName ?? org.plan) as PlanName]?.max_trackers;
  const effectiveAfter = (override === undefined ? org.planConfig?.maxTrackers : override) ?? PLANS[planName].max_trackers;

  console.log(`org        ${org.name}  (${org.id}, ${org.subdomain})`);
  console.log(`holds      ${org._count.users} users · ${org._count.campaigns} campaigns · ${org._count.creators} creators`);
  console.log(`plan       Organization.plan=${org.plan}  planConfig.planName=${org.planConfig?.planName ?? "(no row)"}`);
  console.log(`           -> both become "${planName}"`);
  console.log(`override   ${org.planConfig?.maxTrackers ?? "(none)"} -> ${override === undefined ? "(unchanged)" : (override ?? "(none)")}`);
  console.log(`trackers   ${trackersInUse} in use · limit ${effectiveBefore} -> ${effectiveAfter}`);

  /* Lowering a limit below what the org already holds is legal but worth
     saying out loud -- nothing is deleted, they simply cannot add another. */
  if (Number.isFinite(effectiveAfter) && trackersInUse > (effectiveAfter as number)) {
    console.log(`\n  note: they already hold ${trackersInUse} trackers, more than the new limit of ${effectiveAfter}.`);
    console.log(`        Existing ones keep working; they cannot add another until they are under it.`);
  }

  if (!apply) {
    console.log(`\ndry run. re-run with --apply to write.`);
    return;
  }

  await db.$transaction(async (tx) => {
    await tx.organization.update({ where: { id: org.id }, data: { plan: planName } });
    await tx.orgPlanConfig.upsert({
      where: { orgId: org.id },
      /* planName and the override only. The maxCampaigns/maxCreators/maxUsers
         columns carry db-push defaults nobody chose and are no longer read --
         see lib/entitlements.ts -- so touching them here would only make the
         stored row look more authoritative than it is. */
      create: { orgId: org.id, planName, ...(override !== undefined ? { maxTrackers: override } : {}) },
      update: { planName, ...(override !== undefined ? { maxTrackers: override } : {}) },
    });
  });

  console.log(`\napplied. ${org.name} is on ${planName} with a tracker limit of ${effectiveAfter}.`);
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => db.$disconnect());
