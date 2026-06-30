"use client";

import { useState, useEffect, useCallback } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { Card, EmptyState, Skeleton, Button, Modal } from "@pratham7711/ui";
import { ArrowLeft, Star } from "lucide-react";
import { toast } from "sonner";

type Review = {
  id: string;
  rating: number;
  tags: string[];
  comment: string | null;
  createdAt: string;
  org: { id: string; name: string } | null;
  campaign: { id: string; title: string } | null;
};

type Testimonial = {
  id: string;
  content: string;
  createdAt: string;
  campaign: { id: string; title: string } | null;
  org: { id: string; name: string } | null;
};

type AcceptedProposal = {
  id: string;
  campaignId: string;
  campaign: {
    id: string;
    title: string;
    org: { id: string; name: string };
  };
};

export default function PortalReviewsPage() {
  const router = useRouter();
  const [reviews, setReviews] = useState<Review[]>([]);
  const [reviewsLoading, setReviewsLoading] = useState(true);
  const [testimonials, setTestimonials] = useState<Testimonial[]>([]);
  const [testimonialsLoading, setTestimonialsLoading] = useState(true);
  const [showModal, setShowModal] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [acceptedProposals, setAcceptedProposals] = useState<AcceptedProposal[]>([]);
  const [form, setForm] = useState({ campaignId: "", orgId: "", content: "" });

  useEffect(() => {
    Promise.all([
      fetch("/api/portal/reviews").then((r) => (r.ok ? r.json() : null)),
      fetch("/api/portal/testimonials").then((r) => (r.ok ? r.json() : null)),
      fetch("/api/portal/proposals?status=ACCEPTED").then((r) => (r.ok ? r.json() : null)),
    ]).then(([rv, tm, pr]) => {
      if (rv) setReviews(rv.reviews ?? []);
      if (tm) setTestimonials(tm.testimonials ?? []);
      if (pr) setAcceptedProposals(pr.proposals ?? []);
      setReviewsLoading(false);
      setTestimonialsLoading(false);
    });
  }, []);

  async function handleSubmitTestimonial() {
    setSubmitting(true);
    const res = await fetch("/api/portal/testimonials", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        orgId: form.orgId,
        campaignId: form.campaignId,
        content: form.content,
      }),
    });
    setSubmitting(false);
    if (res.status === 201) {
      toast.success("Testimonial submitted");
      setShowModal(false);
      setForm({ campaignId: "", orgId: "", content: "" });
      // re-fetch testimonials
      fetch("/api/portal/testimonials")
        .then((r) => (r.ok ? r.json() : null))
        .then((d) => {
          if (d) setTestimonials(d.testimonials ?? []);
        });
    } else if (res.status === 409) {
      toast.error("Already submitted a testimonial for this campaign");
    } else {
      toast.error("Failed to submit testimonial");
    }
  }

  if (reviewsLoading) {
    return (
      <div style={{ maxWidth: 960, margin: "0 auto", padding: 32 }}>
        <Skeleton width="200px" height="32px" />
        <Skeleton width="100%" height="300px" borderRadius="12px" />
      </div>
    );
  }

  return (
    <div style={{ maxWidth: 960, margin: "0 auto", padding: 32 }}>
      {/* Page header */}
      <div style={{ marginBottom: 32 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 4 }}>
          <Link
            href="/portal/dashboard"
            style={{ color: "var(--cc-text-muted)", display: "flex", alignItems: "center" }}
          >
            <ArrowLeft size={16} />
          </Link>
          <h1 style={{ fontSize: 24, fontWeight: 700, color: "var(--cc-text)" }}>My Reviews</h1>
        </div>
        <p style={{ fontSize: 14, color: "var(--cc-text-muted)", marginLeft: 24 }}>
          Your ratings and testimonials from campaigns
        </p>
      </div>

      {/* Section 1 — Reviews from Orgs */}
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 12 }}>
        <h2 style={{ fontSize: 16, fontWeight: 700, color: "var(--cc-text)" }}>Reviews from Orgs</h2>
      </div>

      {reviews.length === 0 ? (
        <EmptyState
          icon="⭐"
          title="No reviews yet"
          description="Orgs will review you after campaigns are completed."
        />
      ) : (
        <Card variant="solid" noPadding>
          {/* Table header */}
          <div
            style={{
              display: "grid",
              gridTemplateColumns: "1.2fr 1fr 100px 160px 100px",
              gap: 12,
              padding: "12px 16px",
              borderBottom: "1px solid var(--cc-border)",
              background: "var(--cc-bg)",
            }}
          >
            {["Campaign", "Org", "Rating", "Tags", "Date"].map((h) => (
              <span
                key={h}
                style={{
                  fontSize: 11,
                  fontWeight: 700,
                  textTransform: "uppercase",
                  letterSpacing: "0.06em",
                  color: "var(--cc-text-subtle)",
                }}
              >
                {h}
              </span>
            ))}
          </div>

          {reviews.map((review) => (
            <div
              key={review.id}
              style={{
                display: "grid",
                gridTemplateColumns: "1.2fr 1fr 100px 160px 100px",
                gap: 12,
                padding: "14px 16px",
                alignItems: "center",
                borderTop: "1px solid var(--cc-border)",
              }}
            >
              <span style={{ fontWeight: 600, color: "var(--cc-text)" }}>
                {review.campaign?.title ?? "—"}
              </span>
              <span style={{ color: "var(--cc-text-muted)" }}>
                {review.org?.name ?? "—"}
              </span>
              <div style={{ display: "flex", gap: 2 }}>
                {[0, 1, 2, 3, 4].map((i) => (
                  <Star
                    key={i}
                    size={14}
                    fill={i < review.rating ? "#F59E0B" : "var(--cc-text-subtle)"}
                    color={i < review.rating ? "#F59E0B" : "var(--cc-text-subtle)"}
                  />
                ))}
              </div>
              <span style={{ fontSize: 12, color: "var(--cc-text-muted)" }}>
                {review.tags.slice(0, 2).join(", ")}
              </span>
              <span style={{ fontSize: 12, color: "var(--cc-text-muted)" }}>
                {new Date(review.createdAt).toLocaleDateString()}
              </span>
            </div>
          ))}
        </Card>
      )}

      {/* Section 2 — My Testimonials */}
      <div style={{ marginTop: 32 }}>
        <div
          style={{
            display: "flex",
            justifyContent: "space-between",
            alignItems: "center",
            marginBottom: 12,
          }}
        >
          <h2 style={{ fontSize: 16, fontWeight: 700, color: "var(--cc-text)" }}>My Testimonials</h2>
          <Button variant="secondary" size="sm" onClick={() => setShowModal(true)}>
            Write Testimonial
          </Button>
        </div>

        {testimonialsLoading ? (
          <Skeleton width="100%" height="120px" borderRadius="12px" />
        ) : testimonials.length === 0 ? (
          <EmptyState
            icon="💬"
            title="No testimonials yet"
            description="Share your experience working with orgs."
          />
        ) : (
          testimonials.map((testimonial) => (
            <div
              key={testimonial.id}
              style={{
                background: "var(--cc-card)",
                border: "1px solid var(--cc-border)",
                borderRadius: 12,
                padding: 16,
                marginBottom: 12,
              }}
            >
              <div style={{ display: "flex", alignItems: "center", gap: 4 }}>
                <span style={{ fontWeight: 600, color: "var(--cc-text)", fontSize: 14 }}>
                  {testimonial.campaign?.title ?? "—"}
                </span>
                <span style={{ color: "var(--cc-text-muted)", fontSize: 14 }}> · </span>
                <span style={{ color: "var(--cc-text-muted)", fontSize: 14 }}>
                  {testimonial.org?.name ?? "—"}
                </span>
              </div>
              <p
                style={{
                  fontSize: 14,
                  color: "var(--cc-text)",
                  fontStyle: "italic",
                  margin: "8px 0",
                }}
              >
                &quot;{testimonial.content}&quot;
              </p>
              <span style={{ fontSize: 12, color: "var(--cc-text-muted)" }}>
                {new Date(testimonial.createdAt).toLocaleDateString()}
              </span>
            </div>
          ))
        )}
      </div>

      {/* Testimonial Modal */}
      <Modal open={showModal} onClose={() => setShowModal(false)} title="Write a Testimonial">
        <label
          style={{
            fontSize: 12,
            fontWeight: 600,
            color: "var(--cc-text-muted)",
            textTransform: "uppercase",
          }}
        >
          Campaign
        </label>
        <select
          value={form.campaignId}
          onChange={(e) => {
            const p = acceptedProposals.find((p) => p.campaignId === e.target.value);
            setForm((f) => ({
              ...f,
              campaignId: e.target.value,
              orgId: p?.campaign?.org?.id ?? "",
            }));
          }}
          style={{
            width: "100%",
            height: 38,
            borderRadius: 8,
            border: "1px solid var(--cc-border)",
            marginBottom: 16,
            padding: "0 12px",
          }}
        >
          <option value="">Select campaign...</option>
          {acceptedProposals
            .filter((p) => !testimonials.some((t) => t.campaign?.id === p.campaignId))
            .map((p) => (
              <option key={p.campaignId} value={p.campaignId}>
                {p.campaign?.title}
              </option>
            ))}
        </select>

        <label
          style={{
            fontSize: 12,
            fontWeight: 600,
            color: "var(--cc-text-muted)",
            textTransform: "uppercase",
          }}
        >
          Your Experience
        </label>
        <textarea
          rows={4}
          value={form.content}
          onChange={(e) => setForm((f) => ({ ...f, content: e.target.value }))}
          placeholder="Share what it was like working with this org..."
          style={{
            width: "100%",
            borderRadius: 8,
            border: "1px solid var(--cc-border)",
            padding: 10,
            fontSize: 14,
            color: "var(--cc-text)",
            background: "var(--cc-card)",
            resize: "vertical",
            marginBottom: 16,
          }}
        />

        <Button
          variant="primary"
          onClick={handleSubmitTestimonial}
          loading={submitting}
          disabled={!form.campaignId || form.content.trim().length < 10}
        >
          Submit Testimonial
        </Button>
      </Modal>
    </div>
  );
}
