import "dotenv/config";
import { db } from "@/lib/db";
import { findPlaintext } from "@/lib/crypto/token-backfill";

async function main() {
  const rows = await db.creatorSocialAccount.findMany({
    select: { id: true, accessToken: true, refreshToken: true },
  });
  const bad = findPlaintext(rows);
  if (bad.length > 0) {
    console.error(
      `FAIL: ${bad.length} CreatorSocialAccount row(s) hold plaintext tokens: ${bad.join(", ")}`,
    );
    process.exit(1);
  }
  console.log(
    `OK: all ${rows.length} social-account token(s) are encrypted at rest.`,
  );
}

main().catch((err) => {
  console.error("assertion failed to run:", err);
  process.exit(1);
});
