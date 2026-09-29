/**
 * @jest-environment node
 */
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, relative } from "node:path";

/**
 * Nothing may email or alert a creator. The app sends mail from exactly the
 * modules below, each to a person who asked for it or to ops. A new sender
 * fails here until someone decides, on purpose, who it writes to.
 */

const ROOT = join(__dirname, "..", "..", "..");
const MAIL = /from\s+["']@\/lib\/(email|inviteEmail|emailVerification|alerts)["']/;

const SENDERS = new Map<string, string>([
  ["app/api/auth/forgot-password/route.ts", "the account holder who asked"],
  ["app/api/auth/resend-verification/route.ts", "the account holder who asked"],
  ["app/api/auth/verify-email/route.ts", "the account holder who asked"],
  ["app/api/invites/[id]/resend/route.ts", "a teammate an admin typed in"],
  ["app/api/invites/route.ts", "a teammate an admin typed in"],
  ["app/api/signup/route.ts", "the person signing up"],
  ["lib/alerts.ts", "ALERT_EMAIL_TO (ops)"],
  ["lib/auth.ts", "the account holder signing in"],
  ["lib/emailVerification.ts", "the account holder"],
  ["lib/inviteEmail.ts", "a teammate an admin typed in"],
]);

function walk(dir: string, out: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    if (name === "node_modules" || name.startsWith(".")) continue;
    const p = join(dir, name);
    if (statSync(p).isDirectory()) walk(p, out);
    else if (/\.(ts|tsx)$/.test(name)) out.push(p);
  }
  return out;
}

const importers = ["app", "lib", "components"]
  .flatMap((d) => walk(join(ROOT, d)))
  .filter((f) => MAIL.test(readFileSync(f, "utf8")))
  .map((f) => relative(ROOT, f));

describe("no email reaches a creator", () => {
  it("mail is sent only from the known modules", () => {
    const direct = importers.filter((f) => !/^app\/api\/cron\//.test(f) && !/^lib\/integrations\//.test(f));
    expect(direct.sort()).toEqual([...SENDERS.keys()].sort());
  });

  it("crons and integrations reach mail only through ops alerts", () => {
    for (const f of importers.filter((x) => /^(app\/api\/cron|lib\/integrations)\//.test(x))) {
      const src = readFileSync(join(ROOT, f), "utf8");
      expect([f, src.match(new RegExp(MAIL, "g"))]).toEqual([f, [expect.stringContaining("@/lib/alerts")]]);
    }
  });

  it("ops alerts go only to ALERT_EMAIL_TO", () => {
    const src = readFileSync(join(ROOT, "lib/alerts.ts"), "utf8");
    expect(src.match(/sendEmail\(/g)).toHaveLength(1);
    expect(src).toMatch(/process\.env\.ALERT_EMAIL_TO/);
    expect(src).not.toMatch(/contactEmail|creator\.email/);
  });
});
