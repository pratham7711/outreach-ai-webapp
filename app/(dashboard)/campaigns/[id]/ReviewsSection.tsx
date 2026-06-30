"use client";
import { useState, useEffect, useCallback } from "react";
import { Card, Badge, Button, EmptyState, Skeleton, Avatar, Modal } from "@pratham7711/ui";
import { Star } from "lucide-react";
import { toast } from "sonner";

type Activation = {
  id: string;
  creator: {
    id: string;
    name: string;
    handle: string;
    avatarUrl: string | null;
    platform: string;
    followersCount: number;
    rate: number | null;
  };
};

type Review = {
  id: string;
  creatorId: string;
  rating: number;
  tags: string[] | null;
  comment: string | null;
  createdAt: string;
  creator: { id: string; name: string; handle: string; avatarUrl: string | null } | null;
};

const AVAILABLE_TAGS = ["on_time", "high_quality", "creative", "responsive", "professional"];

export default function ReviewsSection({
  campaignId,
  activations,
}: {
  campaignId: string;
  activations: Activation[];
}) {
  const [reviews, setReviews] = useState<Review[]>([]);
  const [loading, setLoading] = useState(true);
  const [showModal, setShowModal] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [form, setForm] = useState<{
    creatorId: string;
    rating: number;
    tags: string[];
    comment: string;
  }>({ creatorId: "", rating: 0, tags: [], comment: "" });

  const fetchReviews = useCallback(async () => {
    const res = await fetch(`/api/campaigns/${campaignId}/reviews`);
    if (res.ok) {
      const data = await res.json();
      setReviews(data.reviews);
    }
    setLoading(false);
  }, [campaignId]);

  useEffect(() => {
    fetchReviews();
  }, [fetchReviews]);

  const reviewedCreatorIds = new Set(reviews.map((r) => r.creatorId));
  const unreviewedActivations = activations.filter(
    (act) => !reviewedCreatorIds.has(act.creator.id)
  );

  function openModal() {
    const firstUnreviewed = unreviewedActivations[0];
    setForm({
      creatorId: firstUnreviewed?.creator.id ?? "",
      rating: 0,
      tags: [],
      comment: "",
    });
    setShowModal(true);
  }

  async function handleSubmit() {
    setSubmitting(true);
    const res = await fetch(`/api/campaigns/${campaignId}/reviews`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(form),
    });
    setSubmitting(false);
    if (res.status === 201) {
      toast.success("Review submitted");
      setShowModal(false);
      setForm({ creatorId: "", rating: 0, tags: [], comment: "" });
      fetchReviews();
    } else if (res.status === 409) {
      toast.error("Already reviewed this creator");
    } else {
      toast.error("Failed to submit review");
    }
  }

  function toggleTag(tag: string) {
    setForm((f) => ({
      ...f,
      tags: f.tags.includes(tag) ? f.tags.filter((t) => t !== tag) : [...f.tags, tag],
    }));
  }

  return (
    <div>
      {/* Header row */}
      <div
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          marginBottom: 20,
        }}
      >
        <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
          <Star size={16} color="var(--cc-text)" />
          <h3
            style={{
              fontSize: 16,
              fontWeight: 700,
              color: "var(--cc-text)",
              margin: 0,
            }}
          >
            Creator Reviews
          </h3>
          <Badge variant="neutral">{reviews.length}</Badge>
        </div>
        <Button
          variant="secondary"
          size="sm"
          onClick={openModal}
          disabled={activations.length === 0}
        >
          Leave Review
        </Button>
      </div>

      {/* Loading */}
      {loading && (
        <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
          {[1, 2, 3].map((i) => (
            <Skeleton key={i} width="100%" height="64px" borderRadius="8px" />
          ))}
        </div>
      )}

      {/* Empty */}
      {!loading && reviews.length === 0 && (
        <EmptyState
          icon="⭐"
          title="No reviews yet"
          description="Review creators after they complete their deliverables."
        />
      )}

      {/* Review list */}
      {!loading && reviews.length > 0 && (
        <div>
          {reviews.map((review) => (
            <div
              key={review.id}
              style={{
                borderTop: "1px solid var(--cc-border)",
                padding: "16px 0",
                display: "flex",
                flexDirection: "column",
                gap: 8,
              }}
            >
              {/* Row 1: Avatar + name + handle + date */}
              <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
                <Avatar
                  name={review.creator?.name ?? "Creator"}
                  src={review.creator?.avatarUrl ?? undefined}
                  size="sm"
                />
                <span style={{ fontWeight: 600, fontSize: 14, color: "var(--cc-text)" }}>
                  {review.creator?.name ?? "Unknown"}
                </span>
                <span style={{ fontSize: 13, color: "var(--cc-text-muted)" }}>
                  @{review.creator?.handle ?? ""}
                </span>
                <span
                  style={{
                    fontSize: 12,
                    color: "var(--cc-text-muted)",
                    marginLeft: "auto",
                  }}
                >
                  {new Date(review.createdAt).toLocaleDateString()}
                </span>
              </div>

              {/* Row 2: Stars */}
              <div style={{ display: "flex", alignItems: "center", gap: 2 }}>
                {[0, 1, 2, 3, 4].map((i) => (
                  <Star
                    key={i}
                    size={14}
                    fill={i < review.rating ? "#F59E0B" : "none"}
                    color={i < review.rating ? "#F59E0B" : "var(--cc-text-subtle)"}
                  />
                ))}
              </div>

              {/* Row 3: Tags */}
              {review.tags && review.tags.length > 0 && (
                <div style={{ display: "flex", flexWrap: "wrap", gap: 6 }}>
                  {review.tags.map((tag) => (
                    <span
                      key={tag}
                      style={{
                        background: "var(--cc-bg)",
                        border: "1px solid var(--cc-border)",
                        borderRadius: 10,
                        padding: "2px 8px",
                        fontSize: 11,
                        color: "var(--cc-text-muted)",
                      }}
                    >
                      {tag.toUpperCase().replace(/_/g, " ")}
                    </span>
                  ))}
                </div>
              )}

              {/* Row 4: Comment */}
              {review.comment && (
                <p
                  style={{
                    fontSize: 13,
                    color: "var(--cc-text-muted)",
                    fontStyle: "italic",
                    margin: 0,
                  }}
                >
                  &ldquo;{review.comment}&rdquo;
                </p>
              )}
            </div>
          ))}
        </div>
      )}

      {/* Modal */}
      <Modal
        open={showModal}
        onClose={() => setShowModal(false)}
        title="Leave Review"
      >
        <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
          {/* Creator select */}
          <select
            value={form.creatorId}
            onChange={(e) => setForm((f) => ({ ...f, creatorId: e.target.value }))}
            style={{
              width: "100%",
              height: 38,
              borderRadius: 8,
              border: "1px solid var(--cc-border)",
              padding: "0 12px",
              background: "var(--cc-card)",
              color: "var(--cc-text)",
              marginBottom: 16,
              fontSize: 14,
            }}
          >
            <option value="">Select a creator...</option>
            {unreviewedActivations.map((act) => (
              <option key={act.creator.id} value={act.creator.id}>
                {act.creator.name} (@{act.creator.handle})
              </option>
            ))}
          </select>

          {/* Star picker */}
          <div>
            <label
              style={{
                display: "block",
                fontSize: 13,
                fontWeight: 600,
                color: "var(--cc-text)",
                marginBottom: 8,
              }}
            >
              Rating
            </label>
            <div style={{ display: "flex", alignItems: "center", gap: 4 }}>
              {[0, 1, 2, 3, 4].map((i) => (
                <Star
                  key={i}
                  size={24}
                  fill={i < form.rating ? "#F59E0B" : "none"}
                  color={i < form.rating ? "#F59E0B" : "var(--cc-text-subtle)"}
                  style={{ cursor: "pointer" }}
                  onClick={() => setForm((f) => ({ ...f, rating: i + 1 }))}
                />
              ))}
            </div>
          </div>

          {/* Tag checkboxes */}
          <div>
            <label
              style={{
                display: "block",
                fontSize: 13,
                fontWeight: 600,
                color: "var(--cc-text)",
                marginBottom: 8,
              }}
            >
              Tags
            </label>
            <div style={{ display: "flex", flexWrap: "wrap", gap: 8 }}>
              {AVAILABLE_TAGS.map((tag) => {
                const selected = form.tags.includes(tag);
                return (
                  <span
                    key={tag}
                    onClick={() => toggleTag(tag)}
                    style={{
                      cursor: "pointer",
                      borderRadius: 10,
                      padding: "4px 12px",
                      fontSize: 12,
                      fontWeight: 500,
                      background: selected ? "rgba(91,91,214,0.12)" : "var(--cc-bg)",
                      color: selected ? "var(--cc-primary)" : "var(--cc-text-muted)",
                      border: selected
                        ? "1.5px solid var(--cc-primary)"
                        : "1px solid var(--cc-border)",
                      transition: "all 0.15s",
                    }}
                  >
                    {tag.replace(/_/g, " ")}
                  </span>
                );
              })}
            </div>
          </div>

          {/* Comment */}
          <div>
            <label
              style={{
                display: "block",
                fontSize: 13,
                fontWeight: 600,
                color: "var(--cc-text)",
                marginBottom: 8,
              }}
            >
              Comment (optional)
            </label>
            <textarea
              rows={3}
              value={form.comment}
              onChange={(e) => setForm((f) => ({ ...f, comment: e.target.value }))}
              placeholder="Share your experience working with this creator..."
              style={{
                width: "100%",
                borderRadius: 8,
                border: "1px solid var(--cc-border)",
                padding: 10,
                fontSize: 14,
                color: "var(--cc-text)",
                background: "var(--cc-card)",
                resize: "vertical",
                outline: "none",
                boxSizing: "border-box",
              }}
            />
          </div>

          {/* Submit */}
          <div style={{ display: "flex", justifyContent: "flex-end" }}>
            <Button
              variant="primary"
              loading={submitting}
              onClick={handleSubmit}
              disabled={form.rating === 0 || !form.creatorId}
            >
              Submit Review
            </Button>
          </div>
        </div>
      </Modal>
    </div>
  );
}
