import { db } from "@/lib/db";
import { notFound } from "next/navigation";
import { Card, Badge, Avatar } from "@pratham7711/ui";

/* ── Helpers ─────────────────────────────────────────────────────────────── */

function StarRating({ rating }: { rating: number }) {
  return (
    <span style={{ display: "inline-flex", gap: 2 }}>
      {[1, 2, 3, 4, 5].map((i) => (
        <span
          key={i}
          style={{ color: i <= rating ? "#F59E0B" : "#E4E6F0", fontSize: 18 }}
        >
          ★
        </span>
      ))}
    </span>
  );
}

function formatNumber(n: number) {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}K`;
  return n.toString();
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

const TAG_LABELS: Record<string, string> = {
  on_time: "On Time",
  high_quality: "High Quality",
  creative: "Creative",
  responsive: "Responsive",
  professional: "Professional",
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

  // Fetch reviews via org-side Creator records that share this handle
  const creators = await db.creator.findMany({
    where: { handle },
    select: { id: true },
  });
  const creatorIds = creators.map((c) => c.id);

  const reviews =
    creatorIds.length > 0
      ? await db.creatorReview.findMany({
          where: { creatorId: { in: creatorIds } },
          include: {
            org: { select: { name: true } },
            campaign: { select: { title: true } },
          },
          orderBy: { createdAt: "desc" },
          take: 10,
        })
      : [];

  const testimonials = await db.creatorTestimonial.findMany({
    where: { creatorUserId: user.id },
    include: {
      org: { select: { name: true } },
      campaign: { select: { title: true } },
    },
    orderBy: { createdAt: "desc" },
    take: 5,
  });

  // Aggregate tag counts across all reviews
  const tagCounts: Record<string, number> = {};
  for (const review of reviews) {
    const tags = (review.tags as string[] | null) ?? [];
    for (const tag of tags) {
      tagCounts[tag] = (tagCounts[tag] || 0) + 1;
    }
  }

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
          @{user.handle}
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
              <span style={{ fontSize: 14 }}>★</span> {avgRating.toFixed(1)}
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
        style={{
          display: "grid",
          gridTemplateColumns: "repeat(4, 1fr)",
          gap: 12,
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
              marginBottom: 20,
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

          {Object.keys(tagCounts).length > 0 && (
            <div style={{ display: "flex", flexWrap: "wrap", gap: 8 }}>
              {Object.entries(tagCounts)
                .sort((a, b) => b[1] - a[1])
                .map(([tag, count]) => (
                  <span
                    key={tag}
                    style={{
                      display: "inline-flex",
                      alignItems: "center",
                      gap: 6,
                      padding: "5px 12px",
                      borderRadius: 20,
                      fontSize: 12,
                      fontWeight: 500,
                      background: "#F3F4F6",
                      color: "#374151",
                    }}
                  >
                    {TAG_LABELS[tag] ?? tag}
                    <span
                      style={{
                        background: "#E5E7EB",
                        borderRadius: 10,
                        padding: "1px 7px",
                        fontSize: 11,
                        fontWeight: 600,
                      }}
                    >
                      {count}
                    </span>
                  </span>
                ))}
            </div>
          )}
        </div>
      )}

      {/* ── Reviews ──────────────────────────────────────────────────── */}
      {reviews.length > 0 && (
        <div style={{ marginBottom: 32 }}>
          <h2
            style={{
              fontSize: 16,
              fontWeight: 600,
              color: "var(--cc-text)",
              marginBottom: 16,
            }}
          >
            Reviews
          </h2>

          <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
            {reviews.map((review) => {
              const reviewTags = (review.tags as string[] | null) ?? [];
              return (
                <div
                  key={review.id}
                  style={{
                    background: "var(--cc-card)",
                    border: "1px solid var(--cc-border)",
                    borderRadius: 12,
                    padding: 20,
                  }}
                >
                  <div
                    style={{
                      display: "flex",
                      justifyContent: "space-between",
                      alignItems: "flex-start",
                      marginBottom: 8,
                    }}
                  >
                    <div>
                      <div
                        style={{
                          fontSize: 14,
                          fontWeight: 600,
                          color: "var(--cc-text)",
                        }}
                      >
                        {review.org.name}
                      </div>
                      <div
                        style={{
                          fontSize: 12,
                          color: "var(--cc-text-muted)",
                          marginTop: 2,
                        }}
                      >
                        {review.campaign.title}
                      </div>
                    </div>
                    <div style={{ textAlign: "right" }}>
                      <StarRating rating={review.rating} />
                      <div
                        style={{
                          fontSize: 11,
                          color: "var(--cc-text-muted)",
                          marginTop: 2,
                        }}
                      >
                        {formatDate(review.createdAt)}
                      </div>
                    </div>
                  </div>

                  {reviewTags.length > 0 && (
                    <div
                      style={{
                        display: "flex",
                        flexWrap: "wrap",
                        gap: 6,
                        marginBottom: 8,
                      }}
                    >
                      {reviewTags.map((tag) => (
                        <span
                          key={tag}
                          style={{
                            display: "inline-block",
                            padding: "3px 10px",
                            borderRadius: 16,
                            fontSize: 11,
                            fontWeight: 500,
                            background: "#EEF2FF",
                            color: "#4F46E5",
                          }}
                        >
                          {TAG_LABELS[tag] ?? tag}
                        </span>
                      ))}
                    </div>
                  )}

                  {review.comment && (
                    <p
                      style={{
                        fontSize: 13,
                        color: "var(--cc-text-muted)",
                        lineHeight: 1.6,
                        margin: 0,
                      }}
                    >
                      {review.comment}
                    </p>
                  )}
                </div>
              );
            })}
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
                <div style={{ paddingLeft: 32 }}>
                  <div
                    style={{
                      fontSize: 13,
                      fontWeight: 600,
                      color: "var(--cc-text)",
                    }}
                  >
                    {t.org.name}
                  </div>
                  <div style={{ fontSize: 12, color: "var(--cc-text-muted)" }}>
                    {t.campaign.title}
                  </div>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* ── Footer ───────────────────────────────────────────────────── */}
      <div style={{ textAlign: "center", padding: "24px 0" }}>
        <p style={{ fontSize: 12, color: "var(--cc-text-muted)" }}>
          Powered by Outreach AI
        </p>
      </div>
    </div>
  );
}
