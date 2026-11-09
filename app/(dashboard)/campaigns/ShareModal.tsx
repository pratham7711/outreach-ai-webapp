"use client";

import { useCallback, useEffect, useState } from "react";
import {
  AlertCircle,
  Check,
  EyeOff,
  Flag,
  Globe,
  Link2,
  ListChecks,
  LockKeyhole,
  Target,
  Trophy,
  Unlink,
  Wallet,
} from "lucide-react";
import { Button, Skeleton, useConfirm } from "@/components/ds";
import { CopyField, Modal, ModalNotice, ModalOption, ModalOptionList, ModalSection } from "@/components/ds/Modal";
import { Switch } from "@/components/ds/Switch";
import { PlatformGlyph } from "@/components/ui/PlatformGlyph";
import { SHARE_PLATFORMS, type ShareFacts, type SharePlatform, type ShareVisibility } from "@/lib/reports/shareVisibility";

/*
 * The campaign share link, and everything the owner can choose to put on it.
 *
 * Lifted out of PerformanceTab so the campaigns list can open the same dialog.
 * The reference has a Share button on every row, and a second, thinner
 * implementation there would be the one that forgets that PATCH keeps the token
 * while POST rotates it, or that an empty platform list means "no restriction".
 */

type ShareLink = {
  token: string;
  isPublic: boolean;
  createdAt: string;
  path: string;
  visibility: ShareVisibility;
};

const PLATFORM_LABELS: Record<SharePlatform, string> = {
  TIKTOK: "TikTok",
  INSTAGRAM: "Instagram",
  YOUTUBE: "YouTube",
};

type VisibilityFlag = "showCreators" | "showBudget" | "showStatuses" | "markRemovedPosts" | "showBrief";

const RECIPIENT_OPTIONS: { key: VisibilityFlag; icon: React.ElementType; title: string; description: string }[] = [
  { key: "showCreators", icon: Trophy, title: "Creator leaderboard", description: "Names, post counts and views per creator." },
  { key: "showBudget", icon: Wallet, title: "Total budget", description: "Hidden from the brand unless you turn it on." },
  { key: "showStatuses", icon: ListChecks, title: "Creator statuses", description: "Where each activation stands, including who declined." },
  { key: "markRemovedPosts", icon: Flag, title: "Flag removed posts", description: "When off, deleted posts show their last recorded stats." },
  { key: "showBrief", icon: Target, title: "Brief and view goal", description: "Campaign rules, example posts and progress to the goal." },
];

/**
 * Whether a recipient switch has anything to act on.
 *
 * A switch that controls nothing is left out: no budget tile without a budget,
 * no brief without a brief or view goal, no removed-post flag while every post
 * is still up, and no creator statuses while the leaderboard they sit on is
 * hidden. A data-dependent switch that is already on stays, so the dialog
 * never hides a choice the link is serving. Null facts (the read failed) show
 * every switch, as the dialog did before it had them.
 */
function optionApplies(key: VisibilityFlag, v: ShareVisibility, facts: ShareFacts | null): boolean {
  if (key === "showStatuses") return v.showCreators;
  if (v[key] || !facts) return true;
  if (key === "showBudget") return facts.hasBudget;
  if (key === "showBrief") return facts.hasBrief;
  if (key === "markRemovedPosts") return facts.removedPosts > 0;
  return true;
}

const formatDay = (iso: string) => {
  const d = new Date(iso);
  return Number.isNaN(d.getTime())
    ? null
    : d.toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" });
};

export function ShareModal({
  campaignId,
  campaignTitle,
  onClose,
}: {
  campaignId: string;
  /** Named in the header when opened from a list, where the row is the only context. */
  campaignTitle?: string;
  onClose: () => void;
}) {
  const confirm = useConfirm();
  const [link, setLink] = useState<ShareLink | null>(null);
  const [facts, setFacts] = useState<ShareFacts | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    setError(false);
    try {
      const res = await fetch(`/api/campaigns/${campaignId}/share`);
      if (!res.ok) throw new Error("failed");
      const json = await res.json();
      setLink(json.link ?? null);
      setFacts(json.facts ?? null);
    } catch {
      setError(true);
    } finally {
      setLoading(false);
    }
  }, [campaignId]);

  useEffect(() => { load(); }, [load]);

  const shareUrl = link ? `${typeof window !== "undefined" ? window.location.origin : ""}${link.path}` : "";

  const create = async () => {
    setBusy(true);
    setError(false);
    try {
      const res = await fetch(`/api/campaigns/${campaignId}/share`, { method: "POST" });
      if (!res.ok) throw new Error("failed");
      const json = await res.json();
      setLink(json.link ?? null);
    } catch {
      setError(true);
    } finally {
      setBusy(false);
    }
  };

  /* PATCH, not POST: POST rotates the token, and nobody toggling "show budget"
     is asking to break a URL they have already sent. The switch is optimistic
     and rolls back on failure, so it never shows a setting the link is not
     actually serving. */
  const setVisibility = async (next: ShareVisibility) => {
    if (!link) return;
    const previous = link.visibility;
    setLink({ ...link, visibility: next });
    setError(false);
    try {
      const res = await fetch(`/api/campaigns/${campaignId}/share`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ visibility: next }),
      });
      if (!res.ok) throw new Error("failed");
      const json = await res.json();
      if (json.link) setLink(json.link);
    } catch {
      setLink((current) => (current ? { ...current, visibility: previous } : current));
      setError(true);
    }
  };

  const togglePlatform = (platform: SharePlatform, on: boolean) => {
    if (!link) return;
    const current = link.visibility.platforms;
    // Empty means "no restriction", so turning off the last platform would
    // silently widen the report to everything. Keep the others explicitly.
    const next = on
      ? [...current.filter((p) => p !== platform), platform]
      : (current.length ? current : [...SHARE_PLATFORMS]).filter((p) => p !== platform);
    setVisibility({ ...link.visibility, platforms: next });
  };

  /* Revoking breaks a URL the owner may already have sent, so it is asked
     first, in its own dialog over this one, the way an API key's revoke is. */
  const revoke = async () => {
    const ok = await confirm({
      title: "Revoke this share link?",
      description:
        "Anyone who opens it will see “Link unavailable” from now on. A new link will have a different address.",
      confirmLabel: "Revoke link",
      tone: "default",
    });
    if (!ok) return;
    setBusy(true);
    setError(false);
    try {
      const res = await fetch(`/api/campaigns/${campaignId}/share`, { method: "DELETE" });
      if (!res.ok) throw new Error("failed");
      setLink(null);
    } catch {
      setError(true);
    } finally {
      setBusy(false);
    }
  };

  const selectedPlatforms = link
    ? link.visibility.platforms.length
      ? link.visibility.platforms
      : [...SHARE_PLATFORMS]
    : [];
  /* A chip for each platform the campaign has posts on, and the row only when
     there is a choice to make: two or more of them, or one the link currently
     leaves out (so it can be put back). */
  const platformChips = facts ? SHARE_PLATFORMS.filter((p) => facts.platforms.includes(p)) : [...SHARE_PLATFORMS];
  const chipsOn = platformChips.filter((p) => selectedPlatforms.includes(p)).length;
  const showPlatforms = platformChips.length >= 2 || chipsOn < platformChips.length;

  const subject = campaignTitle ? <strong className="cc-dialog__subject">{campaignTitle}</strong> : "this campaign";

  const footer = loading ? null : link ? (
    <div className="cc-modal-footer" data-layout="split">
      <Button variant="ghost" size="sm" className="cc-btn-danger-ghost" onClick={revoke} disabled={busy} iconLeft={<Unlink size={16} aria-hidden="true" />}>
        Revoke link
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
      <Button variant="primary" size="sm" onClick={create} loading={busy} iconLeft={<Link2 size={16} aria-hidden="true" />}>
        Create share link
      </Button>
    </div>
  );

  return (
    <Modal
      open
      onClose={onClose}
      icon={Link2}
      title="Share campaign report"
      description={
        link || loading ? (
          <>Anyone with the link can view the performance of {subject}. No login needed.</>
        ) : (
          <>Create a read-only link to the performance report of {subject}.</>
        )
      }
      size="md"
      footer={footer}
    >
      {loading ? (
        <div className="cc-dialog-stack" aria-busy="true" aria-label="Loading share link">
          <Skeleton width="100%" height="44px" borderRadius="10px" />
          <Skeleton width="60%" height="16px" borderRadius="6px" />
          <Skeleton width="100%" height="180px" borderRadius="12px" />
        </div>
      ) : link ? (
        <>
          <div className="cc-dialog-stack" data-gap="tight">
            <CopyField value={shareUrl} icon={Globe} onError={() => setError(true)} autoFocus />
            <p className="cc-dialog-meta">
              <span className="cc-dialog-meta__live">
                <span className="cc-dialog-meta__dot" aria-hidden="true" />
                Live
              </span>
              {formatDay(link.createdAt) && <span>Created {formatDay(link.createdAt)}</span>}
              <span>Read-only</span>
            </p>
          </div>

          {showPlatforms && (
            <ModalSection title="Platforms" description="Posts from these platforms appear in the report.">
              <div className="cc-dialog-chips" role="group" aria-label="Platforms included">
                {platformChips.map((p) => {
                  const on = selectedPlatforms.includes(p);
                  // One platform has to stay on: an empty list means "no
                  // restriction", the opposite of asking for nothing.
                  const locked = on && chipsOn === 1;
                  return (
                    <button
                      key={p}
                      type="button"
                      className="cc-dialog-chip"
                      aria-pressed={on}
                      disabled={locked}
                      title={locked ? "At least one platform stays included" : undefined}
                      onClick={() => togglePlatform(p, !on)}
                    >
                      <PlatformGlyph platform={p} size="1.125em" />
                      {PLATFORM_LABELS[p]}
                      {on && <Check size={14} strokeWidth={2.5} className="cc-dialog-chip__check" aria-hidden="true" />}
                    </button>
                  );
                })}
              </div>
            </ModalSection>
          )}

          <ModalSection title="What the recipient sees">
            <ModalOptionList>
              {RECIPIENT_OPTIONS.filter((o) => optionApplies(o.key, link.visibility, facts)).map((o) => (
                <ModalOption
                  key={o.key}
                  icon={o.icon}
                  title={o.title}
                  description={o.description}
                  control={
                    <Switch
                      checked={link.visibility[o.key]}
                      onChange={(next) => setVisibility({ ...link.visibility, [o.key]: next })}
                      aria-label={o.title}
                    />
                  }
                />
              ))}
            </ModalOptionList>
          </ModalSection>
        </>
      ) : (
        <ModalOptionList>
          <ModalOption as="div" icon={EyeOff} title="Read-only" description="They see the numbers. Nothing in your workspace can be changed." />
          <ModalOption as="div" icon={Globe} title="No login needed" description="Opens in any browser, on any device." />
          <ModalOption as="div" icon={LockKeyhole} title="Revoke anytime" description="The link stops working the moment you switch it off." />
        </ModalOptionList>
      )}

      {error && (
        <div className="cc-dialog-after">
          <ModalNotice tone="danger" icon={AlertCircle}>
            Something went wrong. Please try again.
          </ModalNotice>
        </div>
      )}
    </Modal>
  );
}
