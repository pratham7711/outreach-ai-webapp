"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Modal } from "@pratham7711/ui";
import { Copy } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ds";

/**
 * Starts a new pitch from this list. "Approved only" is the case it exists
 * for: the client said yes to some creators, and the next campaign begins with
 * exactly those, rates and notes carried over and every verdict reset.
 */
export default function DuplicateListDialog({
  listId,
  listName,
  approvedCount,
  onClose,
}: {
  listId: string;
  listName: string;
  approvedCount: number;
  onClose: () => void;
}) {
  const router = useRouter();
  const [name, setName] = useState(`${listName} (Copy)`);
  const [scope, setScope] = useState<"approved" | "all">(approvedCount > 0 ? "approved" : "all");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit() {
    setBusy(true);
    setError(null);
    try {
      const res = await fetch(`/api/lists/${listId}/duplicate`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: name.trim(), scope }),
      });
      const data = await res.json().catch(() => null);
      if (!res.ok) {
        setError(data?.error ?? "That didn't work. Try again.");
        setBusy(false);
        return;
      }
      toast.success(`Created “${data.list.name}” with ${data.list.creators} creator${data.list.creators === 1 ? "" : "s"}`);
      router.push(`/lists/${data.list.id}`);
    } catch {
      setError("Network error. Try again.");
      setBusy(false);
    }
  }

  return (
    <Modal
      open
      onClose={onClose}
      title="Duplicate list"
      size="md"
      footer={
        <div className="cc-modal-footer">
          <Button variant="secondary" onClick={onClose} disabled={busy}>
            Cancel
          </Button>
          <Button variant="primary" iconLeft={<Copy size={15} />} loading={busy} disabled={!name.trim()} onClick={submit}>
            Duplicate
          </Button>
        </div>
      }
    >
      <div className="cc-import">
        {error && (
          <div role="alert" className="cc-import-alert">
            {error}
          </div>
        )}
        <label className="cc-field-label" htmlFor="cc-duplicate-name">
          New list name
        </label>
        <input id="cc-duplicate-name" className="cc-field" value={name} maxLength={200} onChange={(e) => setName(e.target.value)} />
        <fieldset className="cc-share-fields">
          <legend className="cc-field-label">Creators to copy</legend>
          <label className="cc-share-field">
            <input type="radio" name="cc-duplicate-scope" checked={scope === "approved"} disabled={approvedCount === 0} onChange={() => setScope("approved")} />
            <span>
              Approved by the client only ({approvedCount})
              {approvedCount === 0 && <small>Nobody on this list has been approved yet.</small>}
            </span>
          </label>
          <label className="cc-share-field">
            <input type="radio" name="cc-duplicate-scope" checked={scope === "all"} onChange={() => setScope("all")} />
            <span>Every creator on the list</span>
          </label>
          <p className="cc-import-hint">Rates and notes are copied. Client decisions start over, and the copy has no share link.</p>
        </fieldset>
      </div>
    </Modal>
  );
}
