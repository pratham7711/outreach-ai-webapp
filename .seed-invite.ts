import { db } from "@/lib/db";
const DEMO = "cmnbxsoos00006vfd7jhdvusb";
const EMAIL = "zz-layout-check@invalid.local";
async function main() {
  if (process.argv[2] === "clean") {
    const r = await db.userInvite.deleteMany({ where: { email: EMAIL } });
    console.log(`removed ${r.count} seeded invite(s)`);
    return;
  }
  const inv = await db.userInvite.create({
    data: { orgId: DEMO, email: EMAIL, role: "MEMBER",
            expiresAt: new Date(Date.now() + 7 * 864e5) },
  });
  console.log(`seeded pending invite ${inv.id} (no email sent — written directly)`);
}
main().catch(e => { console.error(String(e).slice(0,300)); process.exit(1); }).finally(() => db.$disconnect());
