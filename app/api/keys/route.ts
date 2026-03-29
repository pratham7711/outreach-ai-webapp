import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { auth } from "@/lib/auth";
import { randomBytes, createHash } from "crypto";

// GET /api/keys — List all API keys for the org (never return hash)
export async function GET(request: NextRequest) {
  try {
    const session = await auth();
    if (!session?.user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    const orgId = (session.user as any).orgId;

    const keys = await db.apiKey.findMany({
      where: { orgId },
      select: {
        id: true,
        name: true,
        createdAt: true,
        lastUsedAt: true,
      },
      orderBy: { createdAt: "desc" },
    });

    return NextResponse.json({ keys });
  } catch (error) {
    console.error("GET /api/keys error:", error);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}

// POST /api/keys — Create a new API key
export async function POST(request: NextRequest) {
  try {
    const session = await auth();
    if (!session?.user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    const orgId = (session.user as any).orgId;

    const body = await request.json();
    const name = typeof body.name === "string" ? body.name.trim() : "";

    if (!name) {
      return NextResponse.json({ error: "Name is required" }, { status: 400 });
    }

    // Generate plaintext key: oai_ + 32 random hex chars
    const plaintext = "oai_" + randomBytes(16).toString("hex");

    // SHA-256 hash for storage
    const keyHash = createHash("sha256").update(plaintext).digest("hex");

    const apiKey = await db.apiKey.create({
      data: {
        orgId,
        name,
        keyHash,
      },
      select: {
        id: true,
        name: true,
        createdAt: true,
      },
    });

    // Return plaintext key ONLY in the creation response
    return NextResponse.json({ ...apiKey, key: plaintext }, { status: 201 });
  } catch (error) {
    console.error("POST /api/keys error:", error);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
