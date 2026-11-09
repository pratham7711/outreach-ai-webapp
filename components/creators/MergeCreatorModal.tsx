"use client";

import { useEffect, useState } from "react";
import { AlertCircle, AlertTriangle, ArrowDownToLine, Combine, Link2, Loader2, PencilLine } from "lucide-react";
import { Modal, ModalNotice, ModalOption, ModalOptionList, ModalSection } from "@/components/ds/Modal";
import { toast } from "sonner";
import { Button, EntityPicker, type PickerOption } from "@/components/ds";
import { platformLabel, stripAt } from "@/lib/format";
import { creatorNameText } from "@/lib/creators/creatorName";

type Summary = {
  filled: string[];
  links: number;
  account: { platform: string; handle: string } | null;
  posts: number;
  activations: number;
  lists: number;
  tags: number;
  flags: number;
  payouts: number;
};

const FIELD_LABEL: Record<string, string> = {
  name: "name",
  contactEmail: "email",
  rate: "rate",
  boostRate: "boost rate",
  bio: "bio",
  paymentInfo: "payment details",
  notes: "notes",
  niches: "niches",
  trackedSince: "tracker watchlist",
  creatorUserId: "portal sign-in",
};

const plural = (n: number, one: string, many = `${one}s`) => `${n.toLocaleString()} ${n === 1 ? one : many}`;

const NOTHING_MOVES = "Nothing else is attached to it.";

/** "7 posts, 1 campaign and 2 accounts", leaving out what is zero. */
function movedText(s: Summary): string {
  const parts = [
    s.posts && plural(s.posts, "post"),
    s.activations && plural(s.activations, "campaign"),
    s.links && plural(s.links, "account"),
    s.lists && plural(s.lists, "list"),
    s.tags && plural(s.tags, "tag"),
    s.flags && plural(s.flags, "flag"),
    s.payouts && plural(s.payouts, "payout"),
  ].filter(Boolean) as string[];
  if (!parts.length) return NOTHING_MOVES;
  const last = parts.pop();
  return `Moves ${parts.length ? `${parts.join(", ")} and ${last}` : last} onto this profile.`;
}

/**
 * Fold a duplicate of this creator into this profile. The duplicate is picked
 * by search, the move is previewed before anything changes, and this profile's
 * own name, handle and numbers are kept.
 */
export default function MergeCreatorModal({
  open,
  onClose,
  creator,
  onMerged,
}: {
  open: boolean;
  onClose: () => void;
  creator: { id: string; name: string; handle: string };
  onMerged: () => void;
}) {
  const [picked, setPicked] = useState<PickerOption | null>(null);
  const [preview, setPreview] = useState<Summary | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [merging, setMerging] = useState(false);

  useEffect(() => {
    if (!open) {
      setPicked(null);
      setPreview(null);
      setError(null);
    }
  }, [open]);

  useEffect(() => {
    setPreview(null);
    setError(null);
    if (!picked) return;
    if (picked.id === creator.id) {
      setError("That's this creator. Pick the duplicate.");
      return;
    }
    let live = true;
    setLoading(true);
    fetch(`/api/creators/${creator.id}/merge`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ from: picked.id, dryRun: true }),
    })
      .then(async (res) => {
        const data = await res.json().catch(() => ({}));
        if (!live) return;
        if (res.status === 403) setError("Only admins and managers can merge creators.");
        else if (!res.ok) setError(data.error ?? "Couldn't check that creator. Try again.");
        else setPreview(data.summary);
      })
      .catch(() => live && setError("The request didn't go through. Nothing has changed."))
      .finally(() => live && setLoading(false));
    return () => {
      live = false;
    };
  }, [picked, creator.id]);

  const merge = async () => {
    if (!picked) return;
    setMerging(true);
    try {
      const res = await fetch(`/api/creators/${creator.id}/merge`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ from: picked.id }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setError(data.error ?? "Couldn't merge them. Nothing has changed.");
        return;
      }
      toast.success(`Merged ${picked.label} into this profile.`);
      onClose();
      onMerged();
    } catch {
      setError("The request didn't go through. Nothing has changed.");
    } finally {
      setMerging(false);
    }
  };

  const name = creatorNameText(creator.name, creator.handle);
  const filled = preview?.filled.map((f) => FIELD_LABEL[f] ?? f) ?? [];

  return (
    <Modal
      open={open}
      onClose={onClose}
      icon={Combine}
      tone="warning"
      title="Merge a duplicate"
      description={
        <>
          The duplicate&rsquo;s posts, campaigns, accounts and lists move onto{" "}
          <strong className="cc-dialog__subject">{name}</strong>, which keeps its own name, handle and numbers.
        </>
      }
      size="md"
      footer={
        <div className="cc-modal-footer">
          <Button type="button" variant="secondary" size="sm" onClick={onClose}>
            Cancel
          </Button>
          <Button
            type="button"
            variant="primary"
            size="sm"
            iconLeft={<Combine size={16} aria-hidden="true" />}
            onClick={merge}
            loading={merging}
            disabled={!preview || !!error}
          >
            Merge into this profile
          </Button>
        </div>
      }
    >
      <div className="cc-dialog-stack">
        <div className="ui-input-root">
          <label htmlFor="merge-creator" className="ui-input-label">
            Duplicate profile
          </label>
          <EntityPicker
            id="merge-creator"
            endpoint="/api/creators"
            placeholder="Search by name or handle…"
            extract={(json) =>
              json.creators
                .filter((c: any) => c.id !== creator.id)
                .map((c: any) => ({ id: c.id, label: c.name, hint: `@${stripAt(c.handle)} · ${platformLabel(c.platform)}` }))
            }
            value={picked}
            onChange={setPicked}
          />
        </div>
        {loading && (
          <ModalNotice tone="neutral" icon={Loader2}>
            Checking what would move…
          </ModalNotice>
        )}
        {error && (
          <ModalNotice tone="danger" icon={AlertCircle}>
            {error}
          </ModalNotice>
        )}
      </div>

      {preview && picked && (
        <ModalSection title="What happens">
          <div aria-live="polite" className="cc-dialog-stack" data-gap="tight">
            <ModalOptionList>
              {!(preview.account && movedText(preview) === NOTHING_MOVES) && (
                <ModalOption as="div" icon={ArrowDownToLine} title={movedText(preview)} />
              )}
              {preview.account && (
                <ModalOption
                  as="div"
                  icon={Link2}
                  title={`Adds its ${platformLabel(preview.account.platform)} account @${preview.account.handle} to this profile.`}
                />
              )}
              {filled.length > 0 && (
                <ModalOption as="div" icon={PencilLine} title={`Fills this profile’s empty ${filled.join(", ")} from it.`} />
              )}
            </ModalOptionList>
            <ModalNotice tone="warning" icon={AlertTriangle}>
              {picked.label}{" "}then leaves the roster. This can’t be undone here.
            </ModalNotice>
          </div>
        </ModalSection>
      )}
    </Modal>
  );
}
