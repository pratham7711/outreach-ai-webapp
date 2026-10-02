/**
 * @jest-environment node
 *
 * The canary judges each heartbeat against the cadence vercel.json gives the
 * job. The registry is a typed copy of that file, so these tests are what keep
 * the two from drifting: a cron added to one and not the other fails here,
 * not silently in production.
 */
import fs from "fs";
import path from "path";
import { CRON_JOBS, cronCadenceMinutes, cronIntervalMinutes, isCronJobName } from "@/lib/ops/cronJobs";

const root = path.resolve(__dirname, "../../..");
const vercel = JSON.parse(fs.readFileSync(path.join(root, "vercel.json"), "utf8")) as {
  crons: { path: string; schedule: string }[];
};

describe("cronIntervalMinutes", () => {
  it.each([
    ["40 * * * *", 60],
    ["0 */6 * * *", 360],
    ["15 */6 * * *", 360],
    ["30 */2 * * *", 120],
    ["0 4 * * *", 1440],
    ["30 0 * * *", 1440],
    ["14 3 * * 1", 7 * 1440],
    ["*/15 * * * *", 15],
    ["0 9-17 * * 1-5", 64 * 60], // Friday 17:00 to Monday 09:00
    ["0,30 * * * *", 30],
    ["0 0 * * 0,7", 7 * 1440],
  ])("%s fires at most every %i minutes", (expr, minutes) => {
    expect(cronIntervalMinutes(expr)).toBe(minutes);
  });

  it.each(["", "* * * *", "0 0 1 * *", "0 0 * 1 *", "0 0 * * MON", "61 * * * *", "0 */0 * * *"])(
    "refuses %p rather than guessing",
    (expr) => {
      expect(cronIntervalMinutes(expr)).toBeNull();
    },
  );
});

describe("the cron registry", () => {
  it("lists exactly the crons vercel.json schedules, with the same schedules", () => {
    const fromVercel = vercel.crons.map((c) => `${c.path} ${c.schedule}`).sort();
    const fromRegistry = CRON_JOBS.map((j) => `${j.path} ${j.schedule}`).sort();
    expect(fromRegistry).toEqual(fromVercel);
  });

  it("names each job after its route", () => {
    for (const j of CRON_JOBS) expect(j.path).toBe(`/api/cron/${j.job}`);
    expect(new Set(CRON_JOBS.map((j) => j.job)).size).toBe(CRON_JOBS.length);
  });

  it("gives every job a cadence the parser understands", () => {
    for (const j of CRON_JOBS) {
      expect(cronIntervalMinutes(j.schedule)).not.toBeNull();
      expect(cronCadenceMinutes(j.job)).toBe(cronIntervalMinutes(j.schedule));
    }
  });

  it("wraps every cron route in cronRoute under its own job name", () => {
    for (const j of CRON_JOBS) {
      const file = path.join(root, "app", j.path, "route.ts");
      const source = fs.readFileSync(file, "utf8");
      expect(source).toContain(`export const GET = cronRoute("${j.job}", `);
      expect(source).not.toMatch(/export async function GET\b/);
    }
  });

  it("puts the canary on a minute no other job uses", () => {
    const minute = (s: string) => s.split(" ")[0];
    const canary = CRON_JOBS.find((j) => j.job === "ops-canary")!;
    const others = CRON_JOBS.filter((j) => j.job !== "ops-canary").map((j) => minute(j.schedule));
    expect(others).not.toContain(minute(canary.schedule));
  });

  it("knows its own names", () => {
    expect(isCronJobName("sync-posts")).toBe(true);
    expect(isCronJobName("drop-tables")).toBe(false);
    expect(isCronJobName(undefined)).toBe(false);
  });
});
