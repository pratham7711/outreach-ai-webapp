import { NextResponse } from "next/server";
import { destroyCreatorSession } from "@/lib/creator-auth";

// POST /api/portal/auth/logout
export async function POST() {
  try {
    await destroyCreatorSession();
    return NextResponse.json({ success: true });
  } catch (error) {
    console.error("Creator logout failed:", error);
    return NextResponse.json({ error: "Logout failed" }, { status: 500 });
  }
}
