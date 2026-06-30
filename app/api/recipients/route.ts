import { NextRequest, NextResponse } from "next/server";
import { authenticateRequest } from "@/lib/authenticate";
import { getRecipients } from "@/lib/recipients/query";

export async function GET(req: NextRequest) {
  const result = await authenticateRequest(req);
  if (!result) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { recipients, stats } = await getRecipients(result.orgId);
  return NextResponse.json({ recipients, stats });
}
