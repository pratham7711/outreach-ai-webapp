"use client";

import React, { useCallback, useEffect, useState } from "react";
import { Modal, ModalOption, ModalOptionList, ModalSection } from "@/components/ds/Modal";
import { Dropdown, Button, Skeleton } from "@/components/ds";
import { ListChecks, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { formatDateAbs } from "@/lib/format";

/**
 * The reference's "Manage Deliverables" -- what one creator owes on one
 * activation, and which of it has landed.
 *
 * One row per thing owed rather than a quantity field: two videos have two due
 * dates and are finished separately, and a count cannot express that. The org's
 * deliverable types come from Settings → General, and a free-typed name is
 * accepted too, so a one-off does not require defining a type first.
 */

type Deliverable = {
  id: string;
  name: string;
  typeDefId: string | null;
  dueDate: string | null;
  completedAt: string | null;
  notes: string | null;
  sortOrder: number;
};

type TypeDef = { id: string; name: string };

export default function DeliverablesModal({
  activationId, creatorName, onClose, onChanged,
}: {
  activationId: string;
  creatorName: string;
  onClose: () => void;
  onChanged?: () => void;
}) {
  const [items, setItems] = useState<Deliverable[] | null>(null);
  const [types, setTypes] = useState<TypeDef[]>([]);
  const [typeDefId, setTypeDefId] = useState("");
  const [name, setName] = useState("");
  const [dueDate, setDueDate] = useState("");
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    const res = await fetch(`/api/activations/${activationId}/deliverables`);
    if (res.ok) {
      const data = await res.json();
      setItems(Array.isArray(data.deliverables) ? data.deliverables : []);
    } else {
      setItems([]);
      toast.error("Could not load deliverables");
    }
  }, [activationId]);

  useEffect(() => {
    load();
    fetch("/api/settings/taxonomy/deliverable-types")
      .then((r) => (r.ok ? r.json() : { items: [] }))
      .then((d) => setTypes(Array.isArray(d.items) ? d.items : []))
      .catch(() => setTypes([]));
  }, [load]);

  const add = async () => {
    const typed = name.trim();
    if (!typeDefId && !typed) {
      toast.error("Pick a type or give the deliverable a name");
      return;
    }
    setBusy(true);
    try {
      const res = await fetch(`/api/activations/${activationId}/deliverables`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          typeDefId: typeDefId || null,
          name: typed || undefined,
          // A date input gives a day, not an instant; the API wants an instant.
          dueDate: dueDate ? new Date(`${dueDate}T00:00:00.000Z`).toISOString() : null,
        }),
      });
      if (!res.ok) {
        const err = await res.json().catch(() => null);
        toast.error(err?.error ?? "Could not add it");
        return;
      }
      setTypeDefId("");
      setName("");
      setDueDate("");
      await load();
      onChanged?.();
    } finally {
      setBusy(false);
    }
  };

  const patch = async (id: string, body: Record<string, unknown>) => {
    setBusy(true);
    try {
      const res = await fetch(`/api/activations/${activationId}/deliverables/${id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      if (!res.ok) {
        toast.error("Could not update it");
        return;
      }
      await load();
      onChanged?.();
    } finally {
      setBusy(false);
    }
  };

  const remove = async (id: string) => {
    setBusy(true);
    try {
      const res = await fetch(`/api/activations/${activationId}/deliverables/${id}`, { method: "DELETE" });
      if (!res.ok) {
        toast.error("Could not remove it");
        return;
      }
      await load();
      onChanged?.();
    } finally {
      setBusy(false);
    }
  };

  const done = items?.filter((d) => d.completedAt).length ?? 0;

  return (
    <Modal
      open
      onClose={onClose}
      icon={ListChecks}
      tone="brand"
      title="Manage deliverables"
      description={<>What <strong className="cc-dialog__subject">{creatorName}</strong> owes on this activation.</>}
      size="md"
      dismissible={false}
      footer={
        /* The tally only once there is something to count: "0 of 0 complete"
           says nothing the empty dialog does not. */
        items?.length ? (
          <div className="cc-modal-footer" data-layout="split" data-align="center" data-gap="0">
            <span className="cc-dialog-meta">{`${done} of ${items.length} complete`}</span>
            <Button variant="secondary" size="sm" onClick={onClose}>Done</Button>
          </div>
        ) : (
          <div className="cc-modal-footer">
            <Button variant="secondary" size="sm" onClick={onClose}>Done</Button>
          </div>
        )
      }
    >
      {/* With nothing listed, the dialog is just the form below. */}
      {items?.length !== 0 && (
        <ModalSection>
          {items === null ? (
            <div className="cc-dialog-stack" data-gap="tight">
              {[1, 2].map((i) => <Skeleton key={i} height={44} />)}
            </div>
          ) : (
            <ModalOptionList>
              {items.map((d) => (
                <ModalOption
                  key={d.id}
                  as="div"
                  title={
                    <span
                      style={{
                        textDecoration: d.completedAt ? "line-through" : "none",
                        opacity: d.completedAt ? 0.6 : 1,
                      }}
                    >
                      {d.name}
                    </span>
                  }
                  description={
                    d.completedAt
                      ? `Completed ${formatDateAbs(d.completedAt)}`
                      : d.dueDate
                        ? `Due ${formatDateAbs(d.dueDate)}`
                        : "No due date"
                  }
                  control={
                    <span className="flex items-center gap-2">
                      <input
                        type="checkbox"
                        checked={!!d.completedAt}
                        disabled={busy}
                        aria-label={`Mark ${d.name} complete`}
                        onChange={(e) => patch(d.id, { completed: e.target.checked })}
                        style={{ width: 16, height: 16, cursor: busy ? "default" : "pointer" }}
                      />
                      <Button
                        variant="ghost"
                        size="sm"
                        className="cc-btn-danger-ghost"
                        aria-label={`Remove deliverable ${d.name}`}
                        disabled={busy}
                        onClick={() => remove(d.id)}
                      >
                        <Trash2 size={14} aria-hidden="true" />
                      </Button>
                    </span>
                  }
                />
              ))}
            </ModalOptionList>
          )}
        </ModalSection>
      )}

      <ModalSection title="Add a deliverable">
        <div className="cc-dialog-stack" data-gap="tight">
          {types.length > 0 && (
            <Dropdown
              ariaLabel="Deliverable type"
              size="md"
              fullWidth
              align="left"
              placeholder="Pick a type"
              value={typeDefId}
              onChange={setTypeDefId}
              options={types.map((t) => ({ value: t.id, label: t.name }))}
            />
          )}
          <input
            type="text"
            value={name}
            aria-label="Deliverable name"
            onChange={(e) => setName(e.target.value)}
            placeholder={types.length ? "Or name it yourself" : "What do they owe?"}
            className="cc-field"
          />
          <input
            type="date"
            value={dueDate}
            aria-label="Due date"
            onChange={(e) => setDueDate(e.target.value)}
            className="cc-field"
          />
          <Button variant="primary" loading={busy} disabled={!typeDefId && !name.trim()} onClick={add}>Add deliverable</Button>
        </div>
      </ModalSection>
    </Modal>
  );
}
