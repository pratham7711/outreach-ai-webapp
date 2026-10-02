/**
 * Runs reader v2 exactly as /api/cron/read-creator-trackers does -- the same
 * runReaderV2, the same sweep, gate and writes -- against the e2e seed
 * database and nothing else, on test orgs of public brand accounts.
 *
 *   npx tsx scripts/trackers/reader-local-run.mts --plan A --orgs 9 --label soak
 *   npx tsx scripts/trackers/reader-local-run.mts --plan B --worker http://host:8787 --orgs 1
 *   npx tsx scripts/trackers/reader-local-run.mts --plan B --sandbox-worker --orgs 1
 *   npx tsx scripts/trackers/reader-local-run.mts --clean
 *
 * Plan A boots real Vercel Sandboxes with the CLI's login (non-persistent,
 * time-boxed, deleted on close). Plan B calls the worker URL given, or, with
 * --sandbox-worker, boots scripts/creator-worker/fetch-server.mjs in a Sandbox
 * with its port exposed and calls that -- the whole B path end to end, on an
 * AWS address rather than B's own network.
 * Prints counts only; writes the full result to --out.
 */
import fs from "node:fs";
import { execFileSync } from "node:child_process";
import { randomBytes } from "node:crypto";
import os from "node:os";
import path from "node:path";

const argv = process.argv.slice(2);
const arg = (name: string, fallback?: string) => {
  const i = argv.indexOf(`--${name}`);
  return i >= 0 && argv[i + 1] && !argv[i + 1].startsWith("--") ? argv[i + 1] : fallback;
};
const flag = (name: string) => argv.includes(`--${name}`);

process.loadEnvFile(".env.local");
const testUrl = process.env.TEST_DATABASE_URL ?? "";
if (!new URL(testUrl).hostname.startsWith("ep-little-recipe")) throw new Error("refusing: TEST_DATABASE_URL is not the e2e seed database");
process.env.DATABASE_URL = testUrl;

// eslint-disable-next-line @typescript-eslint/no-explicit-any -- tsx's CJS interop shape
const load = async (p: string): Promise<any> => {
  const m = await import(p);
  return m.default && Object.keys(m).length <= 2 ? { ...m.default, ...m } : m;
};
const { db } = await load("../../lib/db.ts");
const { runReaderV2 } = await load("../../lib/trackers/readerRun.ts");
const { trackerSourceTablesReady } = await load("../../lib/trackers/sourceSwitch.ts");

const BRANDS = [
  "tiktok", "khaby.lame", "charlidamelio", "mrbeast", "bellapoarch", "zachking", "willsmith", "nba", "espn", "natgeo",
  "nasa", "jimmyfallon", "addisonre", "kimberly.loaiza", "dixiedamelio", "domelipa", "therock", "jasonderulo",
  "selenagomez", "billieeilish", "badbunny", "redbull", "nike", "gymshark", "duolingo", "netflix", "spotify",
  "washingtonpost", "nfl", "ufc", "realmadrid", "fcbarcelona", "psg", "chelseafc", "nbcnews", "bbcnews", "skynews",
  "cbsnews", "abcnews", "nytimes", "theguardian", "ryanair", "chipotle", "starbucks", "mcdonalds", "dunkin",
  "sephora", "fentybeauty", "crocs", "samsung", "xbox", "playstation", "marvel", "disney", "pixar", "nickelodeon",
  "mtv", "billboard", "grammys", "nbcsnl", "fallontonight", "warnerbros", "universalpictures", "sonypictures",
  "peopleofnba", "nhl", "mlb", "wwe", "f1", "nascar", "olympics",
];
const ORG_PREFIX = "tracker-live-";

if (flag("clean")) {
  const orgs = await db.organization.findMany({ where: { subdomain: { startsWith: ORG_PREFIX } }, select: { id: true } });
  const ids = orgs.map((o: { id: string }) => o.id);
  await db.creator.deleteMany({ where: { orgId: { in: ids } } });
  await db.organization.deleteMany({ where: { id: { in: ids } } });
  console.log(JSON.stringify({ cleaned: ids.length }));
  await db.$disconnect();
  process.exit(0);
}

if (!(await trackerSourceTablesReady())) throw new Error("tracker source tables are not applied to the test database");

const plan = (arg("plan", "A") as "A" | "B");
const orgCount = Number(arg("orgs", "1"));
const stalePostOrgs = Number(arg("stale-post-orgs", "1"));
const deadlineMs = Number(arg("deadline", "240")) * 1000;
const label = arg("label", `${plan}-${Date.now()}`)!;
const out = arg("out", path.join(process.env.TMPDIR ?? "/tmp", `reader-${label}.json`))!;

/* Seed: one org per slice of brands, idempotent. Every creator is made due by
   pushing its snapshots back three days; the first org's Top Posts are made
   stale, so its creators also take an embed read through the lanes, as a
   daily-cadence creator does in production. */
const orgIds: string[] = [];
for (let i = 1; i <= orgCount; i++) {
  const org = await db.organization.upsert({
    where: { subdomain: `${ORG_PREFIX}${i}` },
    create: { name: `Tracker live test ${i}`, subdomain: `${ORG_PREFIX}${i}` },
    update: {},
    select: { id: true },
  });
  orgIds.push(org.id);
  const have = new Set(
    (await db.creator.findMany({ where: { orgId: org.id }, select: { handle: true } })).map((c: { handle: string }) => c.handle)
  );
  const missing = BRANDS.filter((h) => !have.has(h));
  if (missing.length) {
    await db.creator.createMany({
      data: missing.map((h) => ({ orgId: org.id, name: h, handle: h, platform: "TIKTOK", trackedSince: new Date() })),
    });
  }
  const stale = i <= stalePostOrgs;
  await db.creator.updateMany({
    where: { orgId: org.id },
    data: stale
      ? { topPostsAt: null, trackerLastAttemptAt: null }
      : { topPostsAt: new Date(), topPostsSource: "platform", trackerLastAttemptAt: null },
  });
}
await db.$executeRawUnsafe(
  `UPDATE "CreatorTrackerSnapshot" s SET "recordedAt" = s."recordedAt" - interval '3 days'
     FROM "Creator" c WHERE c.id = s."creatorId" AND c."orgId" = ANY($1::text[]) AND s."recordedAt" > now() - interval '3 days'`,
  orgIds
);

/* T4: the first org's creators carry a roster profile link, so the run can
   show the link fed from the same read. */
const linkCreators = await db.creator.findMany({ where: { orgId: orgIds[0] }, select: { id: true, handle: true } });
for (const c of linkCreators) {
  await db.creatorProfileLink
    .upsert({
      where: { orgId_platform_handle: { orgId: orgIds[0], platform: "TIKTOK", handle: c.handle } },
      create: { creatorId: c.id, orgId: orgIds[0], platform: "TIKTOK", handle: c.handle, url: `https://www.tiktok.com/@${c.handle}`, isPrimary: true },
      update: { refreshedAt: null, followersCount: null },
    })
    .catch(() => {});
}

function cliSandboxCredentials() {
  /* The CLI's token lives about eight hours; whoami refreshes it. */
  execFileSync("vercel", ["whoami"], { stdio: "ignore", timeout: 40_000 });
  const cliDir = path.join(os.homedir(), "Library/Application Support/com.vercel.cli");
  return {
    token: JSON.parse(fs.readFileSync(path.join(cliDir, "auth.json"), "utf8")).token as string,
    teamId: JSON.parse(fs.readFileSync(path.join(cliDir, "config.json"), "utf8")).currentTeam as string,
    projectId: "prj_qG6uzSDP9ZLrJytmCGE4mlp20knf",
  };
}

let sandboxCredentials: { token: string; teamId: string; projectId: string } | undefined;
let workerSandbox: { delete: (o: { deleteOrphanSnapshots: boolean }) => Promise<unknown> } | null = null;
if (plan === "A") {
  sandboxCredentials = cliSandboxCredentials();
} else if (flag("sandbox-worker")) {
  const { Sandbox } = await import("@vercel/sandbox");
  const token = randomBytes(24).toString("hex");
  const sb = await Sandbox.create({
    runtime: "node22",
    region: arg("worker-region", "iad1"),
    ports: [8787],
    timeout: deadlineMs + 5 * 60_000,
    persistent: false,
    resources: { vcpus: 1 },
    ...cliSandboxCredentials(),
  } as Parameters<typeof Sandbox.create>[0]);
  workerSandbox = sb;
  await sb.writeFiles([{ path: "fetch-server.mjs", content: fs.readFileSync("scripts/creator-worker/fetch-server.mjs") }]);
  await sb.runCommand({ cmd: "node", args: ["fetch-server.mjs"], env: { FETCH_TOKEN: token, FETCH_HOST: "0.0.0.0", FETCH_PORT: "8787" }, detached: true });
  const url = sb.domain(8787);
  for (let i = 0; i < 20; i++) {
    const ok = await fetch(`${url}/healthz`).then((r) => r.ok).catch(() => false);
    if (ok) break;
    await new Promise((r) => setTimeout(r, 1000));
  }
  process.env.TRACKER_PLAN_B_URL = url;
  process.env.TRACKER_PLAN_B_TOKEN = token;
} else {
  process.env.TRACKER_PLAN_B_URL = arg("worker") ?? process.env.TRACKER_PLAN_B_URL;
  if (!process.env.TRACKER_PLAN_B_URL || !process.env.TRACKER_PLAN_B_TOKEN) throw new Error("--worker and TRACKER_PLAN_B_TOKEN are required for B");
}

const startedAt = new Date();
let run;
let workerHealth: unknown = null;
try {
  run = await runReaderV2({
    plan: { position: plan, effective: plan, scopeOrgIds: orgIds, percent: 100, changedAt: null, changedBy: "local", reason: null },
    deadlineMs,
    maxLanes: Number(arg("lanes", "5")),
    sandboxCredentials,
  });
  if (workerSandbox) workerHealth = await fetch(`${process.env.TRACKER_PLAN_B_URL}/healthz`).then((r) => r.json()).catch(() => null);
} finally {
  if (workerSandbox) await workerSandbox.delete({ deleteOrphanSnapshots: true }).catch(() => {});
}
const secs = (Date.now() - startedAt.getTime()) / 1000;

const inOrgs = { creator: { orgId: { in: orgIds } } };
const [snapshots, sources, held, rejected, links, health] = await Promise.all([
  db.creatorTrackerSnapshot.count({ where: { ...inOrgs, recordedAt: { gte: startedAt } } }),
  db.trackerSnapshotSource.findMany({ where: { recordedAt: { gte: startedAt }, creatorId: { in: (await db.creator.findMany({ where: { orgId: { in: orgIds } }, select: { id: true } })).map((c: { id: string }) => c.id) } }, select: { exitId: true, plan: true } }),
  db.trackerReadingQuarantine.count({ where: { orgId: { in: orgIds }, recordedAt: { gte: startedAt }, verdict: "held" } }),
  db.trackerReadingQuarantine.count({ where: { orgId: { in: orgIds }, recordedAt: { gte: startedAt }, verdict: "rejected" } }),
  db.creatorProfileLink.count({ where: { orgId: orgIds[0], refreshedAt: { gte: startedAt }, followersCount: { gt: 0 } } }),
  db.trackerSourceHealth.findFirst({ where: { plan, kind: "run", startedAt: { gte: startedAt } }, orderBy: { startedAt: "desc" } }),
]);
const byExit: Record<string, number> = {};
for (const s of sources) byExit[s.exitId ?? "none"] = (byExit[s.exitId ?? "none"] ?? 0) + 1;

const summary = {
  label,
  plan,
  orgs: orgIds.length,
  creators: orgIds.length * BRANDS.length,
  seconds: Math.round(secs),
  sweep: run.counts,
  dueTikTok: run.dueTikTok,
  postsStale: run.health.detail?.postsStale,
  lanes: run.lanes,
  health: { reads: run.health.reads, proper: run.health.proper, walls: run.health.walls, failures: run.health.failures, medianMs: run.health.medianMs, ok: run.health.ok },
  properRate: run.health.reads ? Math.round((run.health.proper / run.health.reads) * 1000) / 10 : null,
  readsPerLanePerMinute: run.lanes ? Math.round((run.health.reads / run.lanes / (secs / 60)) * 10) / 10 : null,
  maxWallStreak: run.maxWallStreak,
  db: { snapshotsWritten: snapshots, sourceRows: sources.length, sourceRowsByExit: byExit, held, rejected, rosterLinksFed: links, healthRowRecorded: Boolean(health) },
  worker: workerHealth,
  exits: run.exits.map((e: { exitId: string; pages: number; proper: number; walls: number; failures: number }) => ({ id: e.exitId, pages: e.pages, proper: e.proper, walls: e.walls, failures: e.failures })),
};
fs.writeFileSync(out, JSON.stringify(summary, null, 2));
console.log(JSON.stringify(summary, null, 2));
await db.$disconnect();
