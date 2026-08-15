import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { getOnboardingProgress } from "@/lib/onboarding/snapshot";

export async function GET() {
  const session = await auth();
  if (!session?.user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const orgId = (session.user as any).orgId;
  if (!orgId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  return NextResponse.json(await getOnboardingProgress(orgId));
}
