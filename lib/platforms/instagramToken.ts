import { db } from "@/lib/db";
import { decrypt } from "@/lib/crypto/encrypt";

export function decryptInstagramToken(
  encrypted: string | null | undefined,
  orgId: string,
): string | undefined {
  if (!encrypted) return undefined;
  try {
    return decrypt(encrypted, orgId);
  } catch {
    return undefined;
  }
}

export async function getInstagramAccountForCreator(
  creatorId: string,
  orgId: string,
): Promise<{ token?: string; handle?: string }> {
  const creator = await db.creator.findUnique({
    where: { id: creatorId },
    select: {
      handle: true,
      socialAccounts: {
        where: { platform: "INSTAGRAM" },
        select: { accessToken: true, handle: true },
      },
    },
  });
  const social = creator?.socialAccounts[0];
  return {
    token: decryptInstagramToken(social?.accessToken, orgId),
    handle: social?.handle ?? creator?.handle ?? undefined,
  };
}
