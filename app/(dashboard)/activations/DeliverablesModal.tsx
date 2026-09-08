"use client";

import React, { useCallback, useEffect, useState } from "react";
import { Modal, Skeleton } from "@pratham7711/ui";
import { Dropdown, Button } from "@/components/ds";
import { Trash2 } from "lucide-react";
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
      title="Manage Deliverables"
      size="md"
      footer={
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", width: "100%" }}>
          <span style={{ fontSize: 13, color: "var(--cc-text-muted)" }}>
            {items === null ? "" : `${done} of ${items.length} complete`}
          </span>
          <Button variant="secondary" onClick={onClose}>Done</Button>
        </div>
      }
    >
      <p style={{ fontSize: 13, color: "var(--cc-text-muted)", marginBottom: 16 }}>
        What {creatorName} owes on this activation.
      </p>

      {items === null ? (
        <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
          {[1, 2].map((i) => <Skeleton key={i} height={44} borderRadius="10px" />)}
        </div>
      ) : items.length === 0 ? (
        <p style={{ fontSize: 14, color: "var(--cc-text-muted)", marginBottom: 16 }}>
          Nothing listed yet.
        </p>
      ) : (
        <ul style={{ listStyle: "none", margin: "0 0 16px", padding: 0, display: "flex", flexDirection: "column", gap: 8 }}>
          {items.map((d) => (
            <li
              key={d.id}
              style={{
                display: "flex", alignItems: "center", gap: 10, padding: "10px 12px",
                border: "1px solid var(--cc-border)", borderRadius: 10, background: "var(--cc-card)",
              }}
            >
              <input
                type="checkbox"
                checked={!!d.completedAt}
                disabled={busy}
                aria-label={`Mark ${d.name} complete`}
                onChange={(e) => patch(d.id, { completed: e.target.checked })}
                style={{ width: 16, height: 16, cursor: busy ? "default" : "pointer" }}
              />
              <div style={{ flex: 1, minWidth: 0 }}>
                <div
                  style={{
                    fontSize: 14, color: "var(--cc-text)",
                    textDecoration: d.completedAt ? "line-through" : "none",
                    opacity: d.completedAt ? 0.6 : 1,
                  }}
                >
                  {d.name}
                </div>
                <div style={{ fontSize: 12, color: "var(--cc-text-muted)" }}>
                  {d.completedAt
                    ? `Completed ${formatDateAbs(d.completedAt)}`
                    : d.dueDate
                      ? `Due ${formatDateAbs(d.dueDate)}`
                      : "No due date"}
                </div>
              </div>
              <button
                type="button"
                aria-label={`Remove ${d.name}`}
                disabled={busy}
                onClick={() => remove(d.id)}
                style={{
                  background: "none", border: "none", cursor: busy ? "default" : "pointer",
                  color: "var(--cc-text-muted)", display: "inline-flex", padding: 4,
                }}
              >
                <Trash2 size={14} aria-hidden="true" />
              </button>
            </li>
          ))}
        </ul>
      )}

      <div style={{ borderTop: "1px solid var(--cc-border)", paddingTop: 16, display: "flex", flexDirection: "column", gap: 10 }}>
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
          style={fieldStyle}
        />
        <input
          type="date"
          value={dueDate}
          aria-label="Due date"
          onChange={(e) => setDueDate(e.target.value)}
          style={fieldStyle}
        />
        <Button variant="primary" loading={busy} onClick={add}>Add Deliverable</Button>
      </div>
    </Modal>
  );
}

const fieldStyle: React.CSSProperties = {
  width: "100%", padding: "10px 14px", borderRadius: 10, border: "1px solid var(--cc-border)",
  fontSize: 14, color: "var(--cc-text)", background: "var(--cc-card)",
  boxSizing: "border-box",
};
