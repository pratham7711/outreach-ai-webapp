import { db } from "@/lib/db";
import { notFound } from "next/navigation";
import { Card, Badge, Avatar } from "@pratham7711/ui";
import { Star } from "lucide-react";
import { formatCompact, stripAt } from "@/lib/format";
import { POWERED_BY } from "@/lib/brand";

/* ── Helpers ─────────────────────────────────────────────────────────────── */

function StarRating({ rating }: { rating: number }) {
  return (
    <span style={{ display: "inline-flex", gap: 2 }}>
      {[1, 2, 3, 4, 5].map((i) => (
        <Star
          key={i}
          size={18}
          fill={i <= rating ? "#F59E0B" : "#E4E6F0"}
          color={i <= rating ? "#F59E0B" : "#E4E6F0"}
        />
      ))}
    </span>
  );
}

function formatNumber(n: number) {
  return formatCompact(n);
}

function formatDate(d: Date) {
  return new Intl.DateTimeFormat("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
  }).format(d);
}

function nicheLabel(niche: string) {
  return niche.charAt(0) + niche.slice(1).toLowerCase();
}

const PLATFORM_COLORS: Record<string, { bg: string; color: string }> = {
  TIKTOK: { bg: "#EEF2FF", color: "#4F46E5" },
  INSTAGRAM: { bg: "#FDF2F8", color: "#DB2777" },
  YOUTUBE: { bg: "#FEF2F2", color: "#DC2626" },
  TWITTER: { bg: "#EFF6FF", color: "#2563EB" },
  TWITCH: { bg: "#F5F3FF", color: "#7C3AED" },
};

/* ── Page ────────────────────────────────────────────────────────────────── */

export default async function CreatorProfilePage({
  params,
}: {
  params: Promise<{ handle: string }>;
}) {
  const { handle } = await params;

  const user = await db.creatorUser.findFirst({
    where: { handle },
  });

  if (!user) notFound();

  /* CreatorReview rows are NOT public content, and this page is reachable with
     no session at all.
     
     A review is written from the campaign screen
     (app/(dashboard)/campaigns/[id]/ReviewsSection.tsx), which presents it as an
     internal note on how a creator performed. Nothing there says the text will
     be published. This page used to read every org's reviews for the handle —
     `where: { creatorId: { in: creatorIds } }`, no orgId, deliberately across
     tenants — and render the comment, the reviewing org's name and the campaign
     title. That is one agency's private assessment, plus the fact that a named
     competitor ran a campaign of a given name with this creator, served to
     anyone who guesses the handle.

     So the page now shows only what the creator's own CreatorUser row already
     stores as a public aggregate: averageRating and reviewCount. No review text,
     no reviewer org, no campaign titles, and no tag histogram — the histogram
     was derived from the same private rows and would leak their contents in
     summary.

     The durable design is a `CreatorReview.isPublic` column (defaulting false)
     set by whoever writes the review, with this page filtering on it — the
     creator's public profile then carries the reviews people meant to publish.
     That needs a migration, and production was built with `db push` and has no
     _prisma_migrations table, so it is deferred rather than done here. Until
     then the safe reading of an unlabelled row is "private". */

  /* The same argument, one model over. A CreatorTestimonial IS the creator's
     own words -- they write it from their portal, about an org -- so unlike a
     CreatorReview the text itself is theirs to publish. The ATTRIBUTION is not.
     "Org One" and "Summer Drop 2026" on an unauthenticated page state that a
     named brand ran a named campaign with this creator, which is the brand's
     fact about its own roster and spend, and no one on the org side was ever
     asked. It is the same disclosure the review fix above removed, arriving
     through the one row a creator can write.

     Checked before deciding: CreatorTestimonial has no isPublic, no status and
     no approvedAt (prisma/schema.prisma), /api/portal/testimonials writes it
     straight through on an accepted proposal, and the authoring UI
     (app/(portal)/portal/reviews/page.tsx) says only "Share your experience
     working with orgs" -- nothing anywhere tells either party this lands on a
     public page. With no publish step to honour, the safe reading of an
     unlabelled row is again "not published", and the narrowest fix that keeps
     the creator's own voice is to print the quote without naming who it is
     about.

     The durable design is the same one the reviews comment describes: a column
     the author sets, plus the org's consent for the attribution. That needs a
     migration, and production was built with `db push` and has no
     _prisma_migrations table, so it is deferred rather than done here. */
  const testimonials = await db.creatorTestimonial.findMany({
    where: { creatorUserId: user.id },
    select: { id: true, content: true },
    orderBy: { createdAt: "desc" },
    take: 5,
  });

  const avgRating = user.averageRating;
  const platformStyle = PLATFORM_COLORS[user.platform] ?? {
    bg: "#F3F4F6",
    color: "#374151",
  };

  return (
    <div style={{ maxWidth: 800, margin: "0 auto", padding: "0 20px 80px" }}>
      {/* ── Header / Banner ──────────────────────────────────────────── */}
      <div
        style={{
          background: "linear-gradient(135deg, #EEF2FF 0%, #F5F3FF 40%, #FFFFFF 100%)",
          borderRadius: "0 0 24px 24px",
          padding: "48px 32px 32px",
          marginBottom: 32,
          textAlign: "center",
        }}
      >
        <div style={{ display: "flex", justifyContent: "center", marginBottom: 16 }}>
          <div
            style={{
              width: 96,
              height: 96,
              borderRadius: "50%",
              overflow: "hidden",
              border: "4px solid white",
              boxShadow: "0 4px 24px rgba(91,91,214,0.15)",
              background: "var(--cc-primary)",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              fontSize: 36,
              fontWeight: 700,
              color: "white",
            }}
          >
            {user.avatarUrl ? (
              <img
                src={user.avatarUrl}
                alt={user.name}
                style={{ width: "100%", height: "100%", objectFit: "cover" }}
              />
            ) : (
              user.name.charAt(0).toUpperCase()
            )}
          </div>
        </div>

        <h1
          style={{
            fontSize: 28,
            fontWeight: 700,
            color: "var(--cc-text)",
            margin: "0 0 4px",
          }}
        >
          {user.name}
        </h1>

        <p
          style={{
            fontSize: 15,
            color: "var(--cc-text-muted)",
            margin: "0 0 12px",
          }}
        >
          @{stripAt(user.handle)}
        </p>

        <div style={{ display: "flex", justifyContent: "center", gap: 8, marginBottom: 16 }}>
          <span
            style={{
              display: "inline-block",
              padding: "4px 12px",
              borderRadius: 20,
              fontSize: 12,
              fontWeight: 600,
              background: platformStyle.bg,
              color: platformStyle.color,
            }}
          >
            {user.platform}
          </span>
          {avgRating > 0 && (
            <span
              style={{
                display: "inline-flex",
                alignItems: "center",
                gap: 4,
                padding: "4px 12px",
                borderRadius: 20,
                fontSize: 12,
                fontWeight: 600,
                background: "#FFFBEB",
                color: "#D97706",
              }}
            >
              <Star size={14} fill="var(--cc-warning)" color="var(--cc-warning)" /> {avgRating.toFixed(1)}
            </span>
          )}
        </div>

        {user.bio && (
          <p
            style={{
              fontSize: 14,
              color: "var(--cc-text-muted)",
              maxWidth: 520,
              margin: "0 auto",
              lineHeight: 1.6,
            }}
          >
            {user.bio}
          </p>
        )}
      </div>

      {/* ── Stats Grid ───────────────────────────────────────────────── */}
      <div
        className="rsp-grid-tiles"
        style={{
          marginBottom: 32,
        }}
      >
        {[
          { label: "Followers", value: formatNumber(user.followersCount) },
          { label: "Avg Views", value: formatNumber(user.averageViews) },
          { label: "CPM", value: `$${user.cpm.toFixed(2)}` },
          {
            label: "Lifetime Earnings",
            value: `$${formatNumber(user.lifetimeEarnings)}`,
          },
        ].map((stat) => (
          <div
            key={stat.label}
            style={{
              background: "var(--cc-card)",
              border: "1px solid var(--cc-border)",
              borderRadius: 12,
              padding: "20px 16px",
              textAlign: "center",
            }}
          >
            <div
              style={{
                fontSize: 22,
                fontWeight: 700,
                color: "var(--cc-text)",
                marginBottom: 4,
              }}
            >
              {stat.value}
            </div>
            <div style={{ fontSize: 12, color: "var(--cc-text-muted)", fontWeight: 500 }}>
              {stat.label}
            </div>
          </div>
        ))}
      </div>

      {/* ── Niches ───────────────────────────────────────────────────── */}
      {user.niches.length > 0 && (
        <div style={{ marginBottom: 32 }}>
          <h2
            style={{
              fontSize: 16,
              fontWeight: 600,
              color: "var(--cc-text)",
              marginBottom: 12,
            }}
          >
            Niches
          </h2>
          <div style={{ display: "flex", flexWrap: "wrap", gap: 8 }}>
            {user.niches.map((n) => (
              <span
                key={n}
                style={{
                  display: "inline-block",
                  padding: "6px 14px",
                  borderRadius: 20,
                  fontSize: 13,
                  fontWeight: 500,
                  background: "#EEF2FF",
                  color: "#4F46E5",
                }}
              >
                {nicheLabel(n)}
              </span>
            ))}
          </div>
        </div>
      )}

      {/* ── Rating Overview ──────────────────────────────────────────── */}
      {user.reviewCount > 0 && (
        <div
          style={{
            background: "var(--cc-card)",
            border: "1px solid var(--cc-border)",
            borderRadius: 12,
            padding: 24,
            marginBottom: 32,
          }}
        >
          <h2
            style={{
              fontSize: 16,
              fontWeight: 600,
              color: "var(--cc-text)",
              marginBottom: 16,
            }}
          >
            Rating
          </h2>

          <div
            style={{
              display: "flex",
              alignItems: "center",
              gap: 16,
            }}
          >
            <div
              style={{
                fontSize: 40,
                fontWeight: 700,
                color: "var(--cc-text)",
                lineHeight: 1,
              }}
            >
              {avgRating.toFixed(1)}
            </div>
            <div>
              <StarRating rating={Math.round(avgRating)} />
              <div style={{ fontSize: 13, color: "var(--cc-text-muted)", marginTop: 2 }}>
                {user.reviewCount} review{user.reviewCount !== 1 ? "s" : ""}
              </div>
            </div>
          </div>
        </div>
      )}

      {/* ── Testimonials ─────────────────────────────────────────────── */}
      {testimonials.length > 0 && (
        <div style={{ marginBottom: 32 }}>
          <h2
            style={{
              fontSize: 16,
              fontWeight: 600,
              color: "var(--cc-text)",
              marginBottom: 16,
            }}
          >
            Testimonials
          </h2>

          <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
            {testimonials.map((t) => (
              <div
                key={t.id}
                style={{
                  background: "var(--cc-card)",
                  border: "1px solid var(--cc-border)",
                  borderRadius: 12,
                  padding: 24,
                  position: "relative",
                }}
              >
                <div
                  style={{
                    position: "absolute",
                    top: 16,
                    left: 20,
                    fontSize: 48,
                    lineHeight: 1,
                    color: "var(--cc-border)",
                    fontFamily: "Georgia, serif",
                  }}
                >
                  &ldquo;
                </div>
                <p
                  style={{
                    fontSize: 14,
                    color: "var(--cc-text)",
                    lineHeight: 1.7,
                    margin: "0 0 16px",
                    paddingLeft: 32,
                    fontStyle: "italic",
                  }}
                >
                  {t.content}
                </p>
                {/* No org name and no campaign title: see the query above. The
                    quote is the creator's; naming the brand and the campaign is
                    the brand's disclosure to make. */}
              </div>
            ))}
          </div>
        </div>
      )}

      {/* ── Footer ───────────────────────────────────────────────────── */}
      <div style={{ textAlign: "center", padding: "24px 0" }}>
        <p style={{ fontSize: 12, color: "var(--cc-text-muted)" }}>
          {POWERED_BY}
        </p>
      </div>
    </div>
  );
}
