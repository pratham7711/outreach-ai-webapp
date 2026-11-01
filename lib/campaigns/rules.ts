import { db } from "@/lib/db";
import { isMissingRulesTable } from "./rulesDdl";
import { EMPTY_RULES, SWITCHES_OFF, rulesAreEmpty, type CampaignRules, type CampaignSwitch, type CampaignSwitches } from "./rulesShape";

export * from "./rulesShape";

/**
 * A campaign's checklist, submission rules, launch date and view goal
 * (CampaignRules). Every read here answers "nothing set" when the table does
 * not exist yet, so the screens that show these ship before the DDL and simply
 * show nothing until it lands (lib/campaigns/rulesDdl.ts). The shape and the
 * pure helpers are in ./rulesShape, which client code imports instead.
 */

const RULES_SELECT = {
  dos: true,
  donts: true,
  examplePostUrls: true,
  minFollowers: true,
  requiredHashtags: true,
  requiredMentions: true,
  maxPostsPerAccount: true,
  launchAt: true,
  viewGoal: true,
} as const;

type RulesRow = {
  dos: string[];
  donts: string[];
  examplePostUrls: string[];
  minFollowers: number | null;
  requiredHashtags: string[];
  requiredMentions: string[];
  maxPostsPerAccount: number | null;
  launchAt: Date | null;
  viewGoal: number | null;
};

function fromRow(row: RulesRow): CampaignRules {
  return {
    dos: row.dos ?? [],
    donts: row.donts ?? [],
    examplePostUrls: row.examplePostUrls ?? [],
    minFollowers: row.minFollowers,
    requiredHashtags: row.requiredHashtags ?? [],
    requiredMentions: row.requiredMentions ?? [],
    maxPostsPerAccount: row.maxPostsPerAccount,
    launchAt: row.launchAt ? row.launchAt.toISOString() : null,
    viewGoal: row.viewGoal,
  };
}

/**
 * The campaign's rules, or null when none are set or the table is not there
 * yet. `orgId` is part of the lookup so a caller can never read another org's
 * row by guessing a campaign id.
 */
export async function loadCampaignRules(campaignId: string, orgId: string): Promise<CampaignRules | null> {
  try {
    const row = await db.campaignRules.findFirst({ where: { campaignId, orgId }, select: RULES_SELECT });
    /* A row can exist for the exclusions switch alone; with every rule empty
       it still means "no rules set". */
    const rules = row ? fromRow(row) : null;
    return rules && !rulesAreEmpty(rules) ? rules : null;
  } catch (e) {
    if (isMissingRulesTable(e)) return null;
    throw e;
  }
}

/**
 * Ids of every campaign whose launch is still ahead, across orgs: the public
 * marketplace leaves them out. Empty when the table is missing, so Explore
 * lists exactly what it listed before.
 */
export async function scheduledCampaignIds(now: Date): Promise<string[]> {
  try {
    const rows = await db.campaignRules.findMany({ where: { launchAt: { gt: now } }, select: { campaignId: true } });
    return rows.map((r) => r.campaignId);
  } catch (e) {
    if (isMissingRulesTable(e)) return [];
    throw e;
  }
}

/** Whether one campaign's launch is still ahead. False when the table is missing. */
export async function isScheduledCampaign(campaignId: string, now: Date): Promise<boolean> {
  try {
    const row = await db.campaignRules.findFirst({ where: { campaignId, launchAt: { gt: now } }, select: { campaignId: true } });
    return !!row;
  } catch (e) {
    if (isMissingRulesTable(e)) return false;
    throw e;
  }
}

/**
 * Launch dates still ahead for these campaigns in one org, as ISO strings: the
 * campaign list's "Opens <day>" badge. Empty when the table is missing.
 */
export async function launchDatesAhead(campaignIds: string[], orgId: string): Promise<Map<string, string>> {
  if (campaignIds.length === 0) return new Map();
  try {
    const rows = await db.campaignRules.findMany({
      where: { campaignId: { in: campaignIds }, orgId, launchAt: { gt: new Date() } },
      select: { campaignId: true, launchAt: true },
    });
    return new Map(rows.flatMap((r) => (r.launchAt ? [[r.campaignId, r.launchAt.toISOString()] as const] : [])));
  } catch (e) {
    if (isMissingRulesTable(e)) return new Map();
    throw e;
  }
}

/**
 * Writes every rule; a row that would set nothing is deleted instead, unless
 * it also holds the exclusions switch, which this never changes.
 */
export async function saveCampaignRules(campaignId: string, orgId: string, rules: CampaignRules): Promise<void> {
  if (rulesAreEmpty(rules)) {
    await db.campaignRules.deleteMany({ where: { campaignId, orgId, ...SWITCHES_OFF } });
    await db.campaignRules.updateMany({ where: { campaignId, orgId }, data: { ...EMPTY_RULES, launchAt: null } });
    return;
  }
  const data = { ...rules, launchAt: rules.launchAt ? new Date(rules.launchAt) : null };
  await db.campaignRules.upsert({
    where: { campaignId },
    create: { campaignId, orgId, ...data },
    update: data,
  });
}


/**
 * The campaign's feature switches (rulesShape CAMPAIGN_SWITCHES). All off with
 * no row, and all off while the table is missing.
 */
export async function loadCampaignSwitches(campaignId: string, orgId: string): Promise<CampaignSwitches> {
  try {
    const row = await db.campaignRules.findFirst({
      where: { campaignId, orgId },
      select: { allowBoostCodes: true, allowExclusions: true },
    });
    return { allowBoostCodes: row?.allowBoostCodes === true, allowExclusions: row?.allowExclusions === true };
  } catch (e) {
    if (isMissingRulesTable(e)) return { ...SWITCHES_OFF };
    throw e;
  }
}

/** Whether a reviewer may exclude a view-checked post from totals with a reason. */
export async function exclusionsAllowed(campaignId: string, orgId: string): Promise<boolean> {
  return (await loadCampaignSwitches(campaignId, orgId)).allowExclusions;
}

/** Whether creators are offered a boost-code field for this campaign. */
export async function boostCodesAllowed(campaignId: string, orgId: string): Promise<boolean> {
  return (await loadCampaignSwitches(campaignId, orgId)).allowBoostCodes;
}

/** Turns one switch on or off; leaves every rule and the other switches as they were. */
export async function setCampaignSwitch(campaignId: string, orgId: string, key: CampaignSwitch, on: boolean): Promise<void> {
  if (!on) {
    await db.campaignRules.updateMany({ where: { campaignId, orgId }, data: { [key]: false } });
    return;
  }
  await db.campaignRules.upsert({
    where: { campaignId },
    create: { campaignId, orgId, [key]: true },
    update: { [key]: true },
  });
}
