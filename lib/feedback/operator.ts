import { auth } from "@/lib/auth";
import { isPlatformAdmin } from "@/lib/billing/subscription";

/** The signed-in platform operator's email, or null -- the feedback inbox is theirs alone. */
export async function operatorEmail(): Promise<string | null> {
  const session = await auth();
  const email = (session?.user as { email?: string } | undefined)?.email ?? null;
  return email && isPlatformAdmin(email) ? email : null;
}
