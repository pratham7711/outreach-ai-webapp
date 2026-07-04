import { redirect } from "next/navigation";
import { auth } from "@/lib/auth";
import { db } from "@/lib/db";
import SelfServeWizard from "./SelfServeWizard";

const DEFAULT_FLAT_FEE_MINOR = 50000;

function resolvePlatformFeeMinor(): number {
  const raw = process.env.SELF_SERVE_FLAT_FEE_MINOR;
  if (!raw) return DEFAULT_FLAT_FEE_MINOR;
  const parsed = Number.parseInt(raw, 10);
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : DEFAULT_FLAT_FEE_MINOR;
}

export default async function SelfServeCampaignPage() {
  const session = await auth();
  if (!session?.user) redirect("/login");
  const orgId = (session.user as any).orgId as string;

  const org = await db.organization.findUnique({
    where: { id: orgId },
    select: { currency: true },
  });

  return (
    <SelfServeWizard
      defaultCurrency={org?.currency ?? "USD"}
      platformFeeMinor={resolvePlatformFeeMinor()}
    />
  );
}
