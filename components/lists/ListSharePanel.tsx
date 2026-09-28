"use client";

import { useEffect, useState } from "react";
import { Modal } from "@pratham7711/ui";
import { Copy, ExternalLink, Link2 } from "lucide-react";
import { toast } from "sonner";
import { Button, useConfirm } from "@/components/ds";
import type { ListShareFields } from "@/lib/lists/listShare";

type Share = { token: string; path: string; fields: ListShareFields; createdAt: string };

const DEFAULTS: ListShareFields = { stats: true, tags: true, audienceCountry: true, price: false };

const FIELD_ROWS: { key: keyof ListShareFields; label: string; hint?: string }[] = [
  { key: "stats", label: "Followers and average views" },
  { key: "tags", label: "Tags" },
  { key: "audienceCountry", label: "Audience country" },
  { key: "price", label: "Price per video", hint: "Off unless you want brands to see your rates." },
];

async function call(url: string, method: string, body?: unknown) {
  const res = await fetch(url, {
    method,
    headers: body ? { "Content-Type": "application/json" } : undefined,
    body: body ? JSON.stringify(body) : undefined,
  });
  const data = await res.json().catch(() => null);
  if (!res.ok) throw new Error(data?.error ?? "That didn't work. Try again.");
  return data as { share: Share | null };
}

/**
 * Turns a list into a link a brand can open without signing in. The page it
 * opens reads the list live, so adding creators later needs no re-sharing.
 */
export default function ListSharePanel({ listId, listName, onClose }: { listId: string; listName: string; onClose: () => void }) {
  const confirm = useConfirm();
  const [share, setShare] = useState<Share | null>(null);
  const [draft, setDraft] = useState<ListShareFields>(DEFAULTS);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const url = share && typeof window !== "undefined" ? `${window.location.origin}${share.path}` : "";

  useEffect(() => {
    call(`/api/lists/${listId}/share`, "GET")
      .then((d) => {
        setShare(d.share);
        if (d.share) setDraft(d.share.fields);
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

  async function revoke() {
    const ok = await confirm({
      title: "Turn off this link?",
      description: "Anyone who has it will see “This list is no longer shared”. Sharing again makes a new link.",
      confirmLabel: "Turn off link",
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

  async function copy() {
    try {
      await navigator.clipboard.writeText(url);
      toast.success("Link copied");
    } catch {
      toast.error("Couldn't copy. Select the link and copy it instead.");
    }
  }

  return (
    <Modal
      open
      onClose={onClose}
      title={`Share “${listName}”`}
      size="md"
      footer={
        <div className="cc-modal-footer">
          {share ? (
            <>
              <Button variant="danger" onClick={revoke} disabled={busy}>
                Turn off link
              </Button>
              <Button variant="primary" onClick={onClose}>
                Done
              </Button>
            </>
          ) : (
            <>
              <Button variant="secondary" onClick={onClose}>
                Cancel
              </Button>
              <Button variant="primary" iconLeft={<Link2 size={15} />} loading={busy} disabled={loading} onClick={create}>
                Create link
              </Button>
            </>
          )}
        </div>
      }
    >
      <div className="cc-import">
        {error && (
          <div role="alert" className="cc-import-alert">
            {error}
          </div>
        )}
        <p className="cc-import-lead">
          {share
            ? "Anyone with this link can see the creators on this list, without signing in. It stays up to date as you add or remove creators."
            : "Make a link a brand can open without signing in. It stays up to date as you add or remove creators."}
        </p>

        {share && (
          <div className="cc-share-link">
            <input className="cc-field" readOnly value={url} aria-label="Share link" onFocus={(e) => e.currentTarget.select()} />
            <Button variant="secondary" size="sm" iconLeft={<Copy size={14} />} onClick={copy}>
              Copy
            </Button>
            <a className="cc-share-open" href={share.path} target="_blank" rel="noopener noreferrer" aria-label="Open the shared page in a new tab">
              <ExternalLink size={16} aria-hidden />
            </a>
          </div>
        )}

        <fieldset className="cc-share-fields" disabled={loading}>
          <legend className="cc-field-label">What they can see</legend>
          <p className="cc-import-hint">Every card shows the creator’s picture, name and account links.</p>
          {FIELD_ROWS.map((f) => (
            <label key={f.key} className="cc-share-field">
              <input type="checkbox" checked={draft[f.key]} onChange={() => toggleField(f.key)} />
              <span>
                {f.label}
                {f.hint && <small>{f.hint}</small>}
              </span>
            </label>
          ))}
          <label className="cc-share-field" data-locked>
            <input type="checkbox" checked={false} disabled readOnly />
            <span>
              Email address
              <small>Never shown on a shared link.</small>
            </span>
          </label>
        </fieldset>
      </div>
    </Modal>
  );
}
