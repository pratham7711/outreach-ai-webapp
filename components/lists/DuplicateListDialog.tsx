"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Input } from "@pratham7711/ui";
import { Modal, ModalNotice, ModalOption, ModalOptionList, ModalSection } from "@/components/ds/Modal";
import { AlertCircle, BadgeCheck, Copy, Info, Users } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ds";

/* Native radios at the end of a dialog option row, in the brand colour. */
const RADIO = "m-0 size-4 cursor-pointer [accent-color:var(--cc-primary)]";

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
      icon={Copy}
      title="Duplicate list"
      description={<>Start a new list from <strong className="cc-dialog__subject">{listName}</strong>.</>}
      size="md"
      dismissible={false}
      footer={
        <div className="cc-modal-footer">
          <Button variant="secondary" size="sm" onClick={onClose} disabled={busy}>
            Cancel
          </Button>
          <Button variant="primary" size="sm" iconLeft={<Copy size={16} aria-hidden="true" />} loading={busy} disabled={!name.trim()} onClick={submit}>
            Duplicate
          </Button>
        </div>
      }
    >
      <div className="cc-dialog-stack">
        {error && (
          <ModalNotice tone="danger" icon={AlertCircle}>
            {error}
          </ModalNotice>
        )}
        <Input id="cc-duplicate-name" label="New list name" value={name} maxLength={200} onChange={(e) => setName(e.target.value)} />
        {/* The choice below exists for the client's yeses. With none on the
            list there is nothing to choose, so the copy simply takes everyone. */}
        {approvedCount === 0 && (
          <ModalNotice tone="neutral" icon={Info}>
            Every creator is copied, with their rates and notes. Client decisions start over, and the copy has no share link.
          </ModalNotice>
        )}
      </div>

      {approvedCount > 0 && (
        <ModalSection title="Creators to copy">
          <div role="radiogroup" aria-label="Creators to copy">
            <ModalOptionList>
              <ModalOption
                icon={BadgeCheck}
                title={`Approved by the client only (${approvedCount})`}
                control={
                  <input
                    type="radio"
                    className={RADIO}
                    name="cc-duplicate-scope"
                    checked={scope === "approved"}
                    onChange={() => setScope("approved")}
                  />
                }
              />
              <ModalOption
                icon={Users}
                title="Every creator on the list"
                control={<input type="radio" className={RADIO} name="cc-duplicate-scope" checked={scope === "all"} onChange={() => setScope("all")} />}
              />
            </ModalOptionList>
          </div>
          <ModalNotice tone="neutral" icon={Info}>
            Rates and notes are copied. Client decisions start over, and the copy has no share link.
          </ModalNotice>
        </ModalSection>
      )}
    </Modal>
  );
}
