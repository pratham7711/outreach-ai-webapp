import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { isWellFormedJoinCode, resolveJoinCode } from "@/lib/creators/joinLink";
import { LegalLinks } from "@/components/LegalLinks";

export const dynamic = "force-dynamic";

/**
 * /join/<code> -- an agency's one join link. Sends the creator to sign up on
 * the creator portal with the code carried along; after sign-up (or sign-in,
 * from the same page) they are put on the agency's roster and asked to connect
 * their accounts (lib/portal/afterAuth.ts). Signed out by design, so /join is
 * on the signed-out allowlist in lib/auth.config.ts.
 */

export const metadata: Metadata = { title: "Join", robots: { index: false, follow: false }, referrer: "no-referrer" };

export default async function JoinPage({ params }: { params: Promise<{ code: string }> }) {
  const { code } = await params;
  const link = isWellFormedJoinCode(code) ? await resolveJoinCode(code) : null;
  if (link) redirect(`/portal/register?agency=${encodeURIComponent(code)}`);

  return (
    <main style={{ minHeight: "100dvh", display: "grid", placeItems: "center", padding: 24, background: "var(--cc-bg)" }}>
      <div style={{ maxWidth: 420, textAlign: "center", display: "grid", gap: 12 }}>
        <h1 style={{ fontSize: 22, fontWeight: 700, margin: 0, color: "var(--cc-text)" }}>This link isn&rsquo;t active</h1>
        <p style={{ margin: 0, fontSize: 14, color: "var(--cc-text-muted)" }}>Ask the agency that sent it for a new one.</p>
        <LegalLinks />
      </div>
    </main>
  );
}
