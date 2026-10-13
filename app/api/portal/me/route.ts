import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { getCreatorSession } from "@/lib/creator-auth";
import { z } from "zod";
import { PAYOUTS_ENABLED } from "@/lib/payouts/switch";

/* What the creator app is sent about its own creator. Earnings and the bank
   account name only while payouts are on (lib/payouts/switch.ts): off, the
   creator app has no screen that shows them, and they stay stored. */
const profileSelect = () => ({
  id: true,
  email: true,
  name: true,
  handle: true,
  avatarUrl: true,
  bio: true,
  platform: true,
  followersCount: true,
  averageViews: true,
  rate: true,
  boostRate: true,
  ...(PAYOUTS_ENABLED ? { lifetimeEarnings: true, bankAccountName: true } : {}),
  cpm: true,
  averageRating: true,
  reviewCount: true,
  niches: true,
  createdAt: true,
} as const);

/* The payment details a payout would be sent to. Refused while payouts are
   off rather than quietly dropped, so a client that still sends them is told. */
const BANK_FIELDS = ["bankAccountName", "bankAccountNumber", "bankIFSC", "bankSwift", "bankRoutingNumber"] as const;

// GET /api/portal/me — Get current creator user profile
export async function GET() {
  try {
    const session = await getCreatorSession();
    if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

    const user = await db.creatorUser.findUnique({
      where: { id: session.creatorUserId },
      select: profileSelect(),
    });

    if (!user) return NextResponse.json({ error: "User not found" }, { status: 404 });

    return NextResponse.json(user);
  } catch (error) {
    console.error("Failed to fetch creator profile:", error);
    return NextResponse.json({ error: "Failed to fetch profile" }, { status: 500 });
  }
}

const patchSchema = z.object({
  name: z.string().min(1).optional(),
  handle: z.string().min(1).regex(/^[a-z0-9_]+$/).optional(),
  bio: z.string().optional(),
  platform: z.enum(["TIKTOK", "INSTAGRAM", "YOUTUBE", "TWITTER"]).optional(),
  niches: z.array(z.enum(["MUSIC", "FASHION", "TECH", "FITNESS", "BEAUTY", "FOOD", "TRAVEL", "GAMING", "COMEDY", "EDUCATION", "LIFESTYLE", "SPORTS"])).optional(),
  bankAccountName: z.string().nullable().optional(),
  bankAccountNumber: z.string().nullable().optional(),
  bankIFSC: z.string().nullable().optional(),
  bankSwift: z.string().nullable().optional(),
  bankRoutingNumber: z.string().nullable().optional(),
});

// PATCH /api/portal/me — Update current creator user profile
export async function PATCH(req: NextRequest) {
  try {
    const session = await getCreatorSession();
    if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

    const body = await req.json();
    const parsed = patchSchema.safeParse(body);
    if (!parsed.success) {
      return NextResponse.json({ error: "Invalid input", details: parsed.error.flatten() }, { status: 400 });
    }

    const data = parsed.data;
    if (!PAYOUTS_ENABLED && BANK_FIELDS.some((f) => data[f] !== undefined)) {
      return NextResponse.json(
        { error: "Payment details can't be saved while payouts are switched off." },
        { status: 400 },
      );
    }

    /* Uniqueness against CreatorUser only, for the same reason registration
       does it that way (see app/api/portal/auth/register/route.ts). Renaming
       to an existing roster creator's handle grants nothing: the link is
       recomputed from scratch on every request and needs a proof this rename
       cannot manufacture — lib/portal/creatorLink.ts. */
    if (data.handle && data.handle !== session.handle) {
      const existing = await db.creatorUser.findUnique({
        where: { handle: data.handle },
      });
      if (existing && existing.id !== session.creatorUserId) {
        return NextResponse.json({ error: "Handle already taken" }, { status: 409 });
      }
    }

    const user = await db.creatorUser.update({
      where: { id: session.creatorUserId },
      data,
      select: profileSelect(),
    });

    return NextResponse.json(user);
  } catch (error) {
    console.error("Failed to update creator profile:", error);
    return NextResponse.json({ error: "Failed to update profile" }, { status: 500 });
  }
}
