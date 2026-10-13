import { NextRequest, NextResponse } from "next/server";
import { payoutsOffResponse } from "@/lib/payouts/routeGate";
import { authenticateRequest } from "@/lib/authenticate";
import { getRecipients } from "@/lib/recipients/query";

export async function GET(req: NextRequest) {
  const off = payoutsOffResponse(); // 404 while payouts are off: lib/payouts/switch.ts
  if (off) return off;
  const result = await authenticateRequest(req);
  if (!result) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { recipients, stats } = await getRecipients(result.orgId);
  return NextResponse.json({ recipients, stats });
}
