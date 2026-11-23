import { z } from "zod";
import { errandQuery } from "@/lib/portal/afterAuth";

/**
 * The errand a creator arrived with (join link, invite, connect link, campaign
 * join), sent with sign-up and sign-in so the confirmation link mailed to them
 * carries it on (lib/portal/afterAuth.ts).
 */
const Value = z.string().min(1).max(200).nullish();
export const ErrandBody = z
  .object({ invitation: Value, join: Value, invite: Value, connect: Value, agency: Value })
  .partial()
  .optional();

export function errandQueryOf(errand: z.infer<typeof ErrandBody>): string {
  return errandQuery({
    invitation: errand?.invitation ?? null,
    join: errand?.join ?? null,
    invite: errand?.invite ?? null,
    connect: errand?.connect ?? null,
    agency: errand?.agency ?? null,
  });
}
