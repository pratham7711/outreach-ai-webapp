import { NextRequest, NextResponse } from "next/server";
import { httpUrl } from "@/lib/validation/url";
import { z } from "zod";
import { db } from "@/lib/db";
import { authenticateRequest, getAuditActor, type AuthResult } from "@/lib/authenticate";
import { requirePermission } from "@/lib/authz";
import { hasPermission } from "@/lib/rbac";
import { logAudit } from "@/lib/audit";
import { getRequestIp } from "@/lib/request";

const CURRENCIES = ["USD", "EUR", "GBP", "INR"] as const;

const BANK_FIELDS = [
  "bankAccountName",
  "bankAccountNumber",
  "bankIFSC",
  "bankSwift",
  "bankRoutingNumber",
] as const;

/* The org's own account details. Not payout rails and not creator data, but
   still an account number: a VIEWER has no business reading one, and every
   member of the org could. Same key /api/keys uses, so "who may change the
   workspace" is one answer rather than one per route. */
function canManageSettings(result: AuthResult): boolean {
  /* An API key is an org credential rather than a person, and carries no role
     to compare against — requirePermission already lets one through, so
     refusing it here would only make GET and PATCH disagree. */
  if (result.actorType === "api_key") return true;
  return !!result.role && hasPermission(result.role, "settings:manage");
}

const PatchSchema = z.object({
  name:              z.string().min(1).max(100).optional(),
  orgType:           z.enum(["AGENCY", "BRAND"]).optional(),
  brandName:         z.string().max(100).optional().nullable(),
  timezone:          z.string().max(50).optional(),
  currency:          z.enum(CURRENCIES).optional(),
  logoUrl:           httpUrl().optional().nullable(),
  faviconUrl:        httpUrl().optional().nullable(),
  customDomain:      z.string().max(255).optional().nullable(),
  primaryColor:      z.string().regex(/^#[0-9A-Fa-f]{6}$/).optional(),
  secondaryColor:    z.string().regex(/^#[0-9A-Fa-f]{6}$/).optional(),
  accentColor:       z.string().regex(/^#[0-9A-Fa-f]{6}$/).optional(),
  fontFamily:        z.string().max(100).optional(),
  bankAccountName:   z.string().max(200).optional().nullable(),
  bankAccountNumber: z.string().max(50).optional().nullable(),
  bankIFSC:          z.string().max(20).optional().nullable(),
  bankSwift:         z.string().max(20).optional().nullable(),
  bankRoutingNumber: z.string().max(20).optional().nullable(),
});

export async function GET(req: NextRequest) {
  const result = await authenticateRequest(req);
  if (!result) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const { orgId } = result;

  /* Name, logo, colours and currency stay readable by every member — the
     dashboard layout renders the workspace's own branding on every page and
     would otherwise have nothing to render. Only the bank block is held back,
     and it is left out of the SELECT rather than deleted from the result, so
     there is no version of this response that carried it and then dropped it. */
  const bankVisible = canManageSettings(result);

  const org = await db.organization.findUnique({
    where: { id: orgId },
    select: {
      id: true,
      name: true,
      orgType: true,
      subdomain: true,
      brandName: true,
      timezone: true,
      currency: true,
      plan: true,
      planExpiresAt: true,
      logoUrl: true,
      faviconUrl: true,
      customDomain: true,
      primaryColor: true,
      secondaryColor: true,
      accentColor: true,
      fontFamily: true,
      ...(bankVisible
        ? {
            bankAccountName: true,
            bankAccountNumber: true,
            bankIFSC: true,
            bankSwift: true,
            bankRoutingNumber: true,
          }
        : {}),
      createdAt: true,
    },
  });

  if (!org) return NextResponse.json({ error: "Not found" }, { status: 404 });

  /* Belt and braces over the conditional SELECT above: the response is
     assembled field by field, so re-adding a column to the query by accident
     cannot put it back on the wire.
     canManageSettings is told rather than inferred — the settings form has to
     know whether to render itself editable, and "the bank fields came back
     undefined" is a guess. */
  const {
    bankAccountName,
    bankAccountNumber,
    bankIFSC,
    bankSwift,
    bankRoutingNumber,
    ...shared
  } = org as typeof org & Record<(typeof BANK_FIELDS)[number], string | null | undefined>;

  if (!bankVisible) return NextResponse.json({ ...shared, canManageSettings: false });
  return NextResponse.json({
    ...shared,
    bankAccountName: bankAccountName ?? null,
    bankAccountNumber: bankAccountNumber ?? null,
    bankIFSC: bankIFSC ?? null,
    bankSwift: bankSwift ?? null,
    bankRoutingNumber: bankRoutingNumber ?? null,
    canManageSettings: true,
  });
}

export async function PATCH(req: NextRequest) {
  /* Every member could previously rewrite the workspace: its name, its
     branding, its currency, its custom domain and its bank details. A VIEWER
     is a read-only seat everywhere else in the product. */
  const gate = await requirePermission(req, "settings:manage");
  if (!gate.ok) return gate.response;
  const result = gate.auth;
  const { orgId } = result;

  const org = await db.organization.findUnique({ where: { id: orgId } });
  if (!org) return NextResponse.json({ error: "Not found" }, { status: 404 });

  try {
    const body = await req.json();
    const parsed = PatchSchema.safeParse(body);
    if (!parsed.success) {
      return NextResponse.json({ error: "Invalid input", details: parsed.error.flatten() }, { status: 400 });
    }

    const updated = await db.organization.update({
      where: { id: orgId },
      data: parsed.data,
    });

    await logAudit({
      orgId,
      ...getAuditActor(result),
      action: "org.update",
      entityType: "organization",
      entityId: orgId,
      entityLabel: org.name,
      ipAddress: getRequestIp(req),
      before: { name: org.name, brandName: org.brandName, timezone: org.timezone },
      after: { name: updated.name, brandName: updated.brandName, timezone: updated.timezone },
    });

    return NextResponse.json(updated);
  } catch (err: any) {
    if (err?.code === "P2002") {
      return NextResponse.json({ error: "Custom domain already in use" }, { status: 409 });
    }
    console.error("Failed to update org:", err);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
