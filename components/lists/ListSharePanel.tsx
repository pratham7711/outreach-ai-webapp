"use client";

import { useEffect, useState } from "react";
import {
  AlertCircle,
  BarChart3,
  Calculator,
  Check,
  DollarSign,
  ExternalLink,
  Globe,
  Link2,
  MapPin,
  MessageSquareText,
  RefreshCw,
  Tag,
  ThumbsUp,
  TrendingUp,
  Unlink,
} from "lucide-react";
import { toast } from "sonner";
import { Button, Skeleton, useConfirm } from "@/components/ds";
import { CopyField, Modal, ModalNotice, ModalOption, ModalOptionList, ModalSection } from "@/components/ds/Modal";
import { Switch } from "@/components/ds/Switch";
import { PlatformGlyph } from "@/components/ui/PlatformGlyph";
import type { ListShareFields } from "@/lib/lists/listShare";
import { SHARE_PLATFORM_CHIPS, SHARE_REVIEW_SWITCHES, type SharePlatform, type ShareReview, type ShareReviewSwitch } from "@/lib/lists/shareSettings";

/** `review` is only sent once the list-approval tables exist; absent, the panel is the plain one. */
type Share = { token: string; path: string; fields: ListShareFields; review?: ShareReview; createdAt: string };

const DEFAULTS: ListShareFields = { stats: true, tags: true, audienceCountry: true, price: false };

const FIELD_ROWS: { key: keyof ListShareFields; label: string; hint?: string; icon: React.ElementType }[] = [
  { key: "stats", label: "Followers and average views", icon: BarChart3 },
  { key: "tags", label: "Tags", icon: Tag },
  { key: "audienceCountry", label: "Audience country", icon: MapPin },
  { key: "price", label: "Price per video", hint: "Off unless you want brands to see your rates.", icon: DollarSign },
];

const REVIEW_ROWS: Record<ShareReviewSwitch, { icon: React.ElementType; hint: string }> = {
  approvals: { icon: ThumbsUp, hint: "Off makes the page a read-only deck." },
  feedback: { icon: MessageSquareText, hint: "A reason typed with each verdict." },
  engagementRate: { icon: TrendingUp, hint: "Per creator, measured from synced posts." },
  rateTotal: { icon: Calculator, hint: "The sum of the rates on this list." },
};

const formatDay = (iso: string) => {
  const d = new Date(iso);
  return Number.isNaN(d.getTime())
    ? null
    : d.toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" });
};

async function call(url: string, method: string, body?: unknown) {
  const res = await fetch(url, {
    method,
    headers: body ? { "Content-Type": "application/json" } : undefined,
    body: body ? JSON.stringify(body) : undefined,
  });
  const data = await res.json().catch(() => null);
  if (!res.ok) throw new Error(data?.error ?? "That didn't work. Try again.");
  return data as { share: Share | null; platforms?: string[] | null };
}

/**
 * Turns a list into a link a brand can open without signing in. The page it
 * opens reads the list live, so adding creators later needs no re-sharing.
 */
export default function ListSharePanel({ listId, listName, onClose }: { listId: string; listName: string; onClose: () => void }) {
  const confirm = useConfirm();
  const [share, setShare] = useState<Share | null>(null);
  const [draft, setDraft] = useState<ListShareFields>(DEFAULTS);
  const [review, setReview] = useState<ShareReview | null>(null);
  /** Platforms the list's creators have an account on; null when unknown. */
  const [listPlatforms, setListPlatforms] = useState<string[] | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const url = share && typeof window !== "undefined" ? `${window.location.origin}${share.path}` : "";

  useEffect(() => {
    call(`/api/lists/${listId}/share`, "GET")
      .then((d) => {
        setShare(d.share);
        if (d.share) setDraft(d.share.fields);
        setReview(d.share?.review ?? null);
        setListPlatforms(d.platforms ?? null);
      })
      .catch((e: Error) => setError(e.message))
      .finally(() => setLoading(false));
  }, [listId]);

  async function create() {
    setBusy(true);
    setError(null);
    try {
      const d = await call(`/api/lists/${listId}/share`, "POST", { fields: draft });
      setShare(d.share);
      setReview(d.share?.review ?? null);
      // Only GET reads the list's platforms, and only for a live link.
      if (d.share?.review && !listPlatforms) {
        call(`/api/lists/${listId}/share`, "GET")
          .then((g) => setListPlatforms(g.platforms ?? null))
          .catch(() => {});
      }
    } catch (e) {
      setError((e as Error).message);
    }
    setBusy(false);
  }

  async function toggleField(key: keyof ListShareFields) {
    const next = { ...draft, [key]: !draft[key] };
    setDraft(next);
    if (!share) return;
    try {
      const d = await call(`/api/lists/${listId}/share`, "PATCH", { fields: { [key]: next[key] } });
      if (d.share) setDraft(d.share.fields);
    } catch (e) {
      setDraft(draft);
      toast.error((e as Error).message);
    }
  }

  async function patchReview(patch: Partial<ShareReview>) {
    if (!review) return;
    const before = review;
    setReview({ ...review, ...patch });
    try {
      const d = await call(`/api/lists/${listId}/share`, "PATCH", { review: patch });
      if (d.share?.review) setReview(d.share.review);
    } catch (e) {
      setReview(before);
      toast.error((e as Error).message);
    }
  }

  const toggleReview = (key: ShareReviewSwitch) => {
    if (review) void patchReview({ [key]: !review[key] } as Partial<ShareReview>);
  };

  function togglePlatform(p: SharePlatform) {
    if (!review) return;
    const next = review.platforms.includes(p) ? review.platforms.filter((x) => x !== p) : [...review.platforms, p];
    void patchReview({ platforms: next });
  }

  async function rotate() {
    const ok = await confirm({
      title: "Make a new link?",
      description: "The current link stops working straight away. Send the new one to whoever should still see this list.",
      confirmLabel: "Make new link",
      tone: "default",
    });
    if (!ok) return;
    setBusy(true);
    try {
      const d = await call(`/api/lists/${listId}/share`, "POST", { rotate: true });
      setShare(d.share);
      toast.success("New link made. The old one no longer works.");
    } catch (e) {
      toast.error((e as Error).message);
    }
    setBusy(false);
  }

  async function revoke() {
    const ok = await confirm({
      title: "Turn off this link?",
      description: "Anyone who has it will see “This list is no longer shared”. Sharing again makes a new link.",
      confirmLabel: "Turn off link",
      tone: "default",
    });
    if (!ok) return;
    setBusy(true);
    try {
      await call(`/api/lists/${listId}/share`, "DELETE");
      setShare(null);
      toast.success("Link turned off");
    } catch (e) {
      toast.error((e as Error).message);
    }
    setBusy(false);
  }


  const created = share ? formatDay(share.createdAt) : null;

  /* A chip for each platform the list's creators have an account on, plus any
     the link already names, so "none selected shows every platform" is never
     quietly untrue. The row appears only when there are two to choose between. */
  const platformChips = review
    ? SHARE_PLATFORM_CHIPS.filter((c) => !listPlatforms || listPlatforms.includes(c.value) || review.platforms.includes(c.value))
    : [];
  /* Dependent switches show once what they depend on is on. A note is typed
     with a verdict, so it follows approvals. The rates total sums the prices
     the link shows, so it sits under Price per video and appears with it. */
  const reviewSwitches = review
    ? SHARE_REVIEW_SWITCHES.filter((f) => (f.key === "feedback" ? review.approvals : f.key !== "rateTotal"))
    : [];
  const rateTotal = share && review && draft.price ? SHARE_REVIEW_SWITCHES.find((f) => f.key === "rateTotal") : undefined;

  return (
    <Modal
      open
      onClose={onClose}
      icon={Link2}
      title={`Share “${listName}”`}
      description={
        share || loading
          ? "Anyone with this link can see the creators on this list, without signing in."
          : "Make a link a brand can open without signing in, kept up to date as you add or remove creators."
      }
      size="md"
      footer={
        share ? (
          <div className="cc-modal-footer" data-layout="split">
            <Button
              variant="ghost"
              size="sm"
              className="cc-btn-danger-ghost"
              onClick={revoke}
              disabled={busy}
              iconLeft={<Unlink size={16} aria-hidden="true" />}
            >
              Turn off link
            </Button>
            <Button variant="primary" size="sm" onClick={onClose}>
              Done
            </Button>
          </div>
        ) : (
          <div className="cc-modal-footer">
            <Button variant="secondary" size="sm" onClick={onClose}>
              Cancel
            </Button>
            <Button variant="primary" size="sm" iconLeft={<Link2 size={16} aria-hidden="true" />} loading={busy} disabled={loading} onClick={create}>
              Create link
            </Button>
          </div>
        )
      }
    >
      {loading ? (
        <div className="cc-dialog-stack" aria-busy="true" aria-label="Loading share link">
          <Skeleton width="100%" height="var(--cc-control-h)" radius="var(--cc-r-control)" />
          <Skeleton width="60%" height={16} />
          <Skeleton width="100%" height={220} radius="var(--cc-r-card)" />
        </div>
      ) : (
        <>
          {share && (
            <div className="cc-dialog-stack" data-gap="tight">
              <CopyField
                value={url}
                icon={Globe}
                autoFocus
                onError={() => toast.error("Couldn't copy. Select the link and copy it instead.")}
              />
              <div className="flex flex-wrap items-center justify-between gap-2">
                <p className="cc-dialog-meta">
                  <span className="cc-dialog-meta__live">
                    <span className="cc-dialog-meta__dot" aria-hidden="true" />
                    Live
                  </span>
                  {created && <span>Created {created}</span>}
                  <span>Updates as you add or remove creators</span>
                </p>
                <div className="flex items-center gap-1">
                  <a
                    className="cc-share-open"
                    href={share.path}
                    target="_blank"
                    rel="noopener noreferrer"
                    aria-label="Open the shared page in a new tab"
                  >
                    <ExternalLink size={16} aria-hidden />
                  </a>
                  <Button variant="ghost" size="sm" iconLeft={<RefreshCw size={14} aria-hidden="true" />} onClick={rotate} disabled={busy}>
                    New link
                  </Button>
                </div>
              </div>
            </div>
          )}

          {share && review && (
            <>
              <ModalSection title="Client review">
                <ModalOptionList>
                  {reviewSwitches.map((f) => (
                    <ModalOption
                      key={f.key}
                      icon={REVIEW_ROWS[f.key].icon}
                      title={f.label}
                      description={REVIEW_ROWS[f.key].hint}
                      control={<Switch checked={review[f.key]} onChange={() => toggleReview(f.key)} aria-label={f.label} />}
                    />
                  ))}
                </ModalOptionList>
              </ModalSection>

              {platformChips.length >= 2 && (
                <ModalSection title="Platforms shown" description="None selected shows every platform.">
                  <div className="cc-dialog-chips" role="group" aria-label="Platforms shown">
                    {platformChips.map((c) => {
                      const on = review.platforms.includes(c.value);
                      return (
                        <button
                          key={c.value}
                          type="button"
                          className="cc-dialog-chip"
                          aria-pressed={on}
                          onClick={() => togglePlatform(c.value)}
                        >
                          <PlatformGlyph platform={c.value} size="1.125em" />
                          {c.label}
                          {on && <Check size={14} strokeWidth={2.5} className="cc-dialog-chip__check" aria-hidden="true" />}
                        </button>
                      );
                    })}
                  </div>
                </ModalSection>
              )}
            </>
          )}

          <ModalSection
            title="What they can see"
            description="Every card shows the creator’s picture, name and account links. Email addresses are never shown."
          >
            <ModalOptionList>
              {FIELD_ROWS.map((f) => (
                <ModalOption
                  key={f.key}
                  icon={f.icon}
                  title={f.label}
                  description={f.hint}
                  control={<Switch checked={draft[f.key]} onChange={() => toggleField(f.key)} aria-label={f.label} />}
                />
              ))}
              {review && rateTotal && (
                <ModalOption
                  icon={REVIEW_ROWS.rateTotal.icon}
                  title={rateTotal.label}
                  description={REVIEW_ROWS.rateTotal.hint}
                  control={<Switch checked={review.rateTotal} onChange={() => toggleReview("rateTotal")} aria-label={rateTotal.label} />}
                />
              )}
            </ModalOptionList>
          </ModalSection>
        </>
      )}

      {error && (
        <div className="cc-dialog-after">
          <ModalNotice tone="danger" icon={AlertCircle}>
            {error}
          </ModalNotice>
        </div>
      )}
    </Modal>
  );
}
