"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Folder, FolderOpen, Pencil, Trash2, Plus, Check, X } from "lucide-react";
import { Modal, Button, Input } from "@pratham7711/ui";
import { UNFILED } from "@/lib/listFilters";

export type FolderOption = { id: string; name: string; campaigns: number };

/**
 * CreatorCore's `Folders 📁` control, which we had no equivalent for at all.
 *
 * Selecting a folder filters the campaigns list through the URL, like every
 * other filter on the page, so a folder view survives a refresh and can be
 * pasted to a colleague. The list is flat: Folder.parentFolderId exists in the
 * schema but the reference's own control is a flat list, and a tree buys nothing
 * until someone has enough folders to nest.
 *
 * Deleting says what it will do, because the honest answer is reassuring: the
 * campaigns stay and only lose the label.
 */
export default function FoldersPanel({
  open,
  onClose,
  folders,
  unfiled,
  total,
  selected,
  onSelect,
}: {
  open: boolean;
  onClose: () => void;
  folders: FolderOption[];
  unfiled: number;
  total: number;
  selected?: string;
  onSelect: (folderId: string | null) => void;
}) {
  const router = useRouter();
  const [name, setName] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [renaming, setRenaming] = useState<string | null>(null);
  const [renameValue, setRenameValue] = useState("");
  const [confirmingDelete, setConfirmingDelete] = useState<string | null>(null);

  async function send(url: string, method: string, body?: unknown) {
    setBusy(true);
    setError(null);
    try {
      const res = await fetch(url, {
        method,
        ...(body ? { headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) } : {}),
      });
      if (!res.ok) {
        const payload = await res.json().catch(() => ({}));
        throw new Error(payload.error ?? `Request failed (${res.status})`);
      }
      router.refresh();
      return true;
    } catch (e) {
      setError(e instanceof Error ? e.message : "Something went wrong");
      return false;
    } finally {
      setBusy(false);
    }
  }

  const rowStyle = (active: boolean): React.CSSProperties => ({
    display: "flex",
    alignItems: "center",
    gap: 10,
    width: "100%",
    padding: "9px 10px",
    borderRadius: 8,
    border: "1px solid",
    borderColor: active ? "var(--cc-primary)" : "transparent",
    background: active ? "color-mix(in srgb, var(--cc-primary) 8%, transparent)" : "transparent",
    textAlign: "left",
    cursor: "pointer",
    color: "var(--cc-text)",
    fontSize: 14,
  });

  const countStyle: React.CSSProperties = {
    marginLeft: "auto",
    fontSize: 12,
    fontWeight: 600,
    color: "var(--cc-text-muted)",
    fontVariantNumeric: "tabular-nums",
  };

  return (
    <Modal open={open} onClose={onClose} title="Folders" size="sm">
      <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
        <button type="button" style={rowStyle(!selected)} onClick={() => { onSelect(null); onClose(); }}>
          <FolderOpen size={16} color="var(--cc-text-muted)" />
          All campaigns
          <span style={countStyle}>{total}</span>
        </button>

        {/* Without this, a campaign filed by mistake is only findable by scrolling
            the whole list looking for the one without a folder. */}
        <button
          type="button"
          style={rowStyle(selected === UNFILED)}
          onClick={() => { onSelect(UNFILED); onClose(); }}
        >
          <Folder size={16} color="var(--cc-text-subtle)" />
          Unfiled
          <span style={countStyle}>{unfiled}</span>
        </button>

        {folders.length > 0 && (
          <div style={{ height: 1, background: "var(--cc-border)", margin: "6px 0" }} />
        )}

        {folders.map((folder) =>
          renaming === folder.id ? (
            <div key={folder.id} style={{ display: "flex", gap: 6, alignItems: "center", padding: "4px 0" }}>
              <Input
                value={renameValue}
                onChange={(e) => setRenameValue(e.target.value)}
                placeholder="Folder name"
                autoFocus
              />
              <Button
                variant="primary"
                size="sm"
                disabled={busy || !renameValue.trim()}
                onClick={async () => {
                  if (await send(`/api/folders/${folder.id}`, "PATCH", { name: renameValue.trim() })) {
                    setRenaming(null);
                  }
                }}
                aria-label="Save folder name"
              >
                <Check size={14} />
              </Button>
              <Button variant="ghost" size="sm" onClick={() => setRenaming(null)} aria-label="Cancel rename">
                <X size={14} />
              </Button>
            </div>
          ) : (
            <div key={folder.id} style={{ display: "flex", alignItems: "center", gap: 4 }}>
              <button
                type="button"
                style={{ ...rowStyle(selected === folder.id), flex: 1, minWidth: 0 }}
                onClick={() => { onSelect(folder.id); onClose(); }}
              >
                <Folder size={16} color="var(--cc-primary)" />
                <span style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                  {folder.name}
                </span>
                <span style={countStyle}>{folder.campaigns}</span>
              </button>
              <button
                type="button"
                aria-label={`Rename ${folder.name}`}
                onClick={() => { setRenaming(folder.id); setRenameValue(folder.name); setConfirmingDelete(null); }}
                style={{ background: "none", border: "none", cursor: "pointer", padding: 6, color: "var(--cc-text-muted)" }}
              >
                <Pencil size={14} />
              </button>
              <button
                type="button"
                aria-label={`Delete ${folder.name}`}
                onClick={() => setConfirmingDelete(folder.id)}
                style={{ background: "none", border: "none", cursor: "pointer", padding: 6, color: "#DC2626" }}
              >
                <Trash2 size={14} />
              </button>
            </div>
          )
        )}

        {confirmingDelete && (
          <div
            style={{
              border: "1px solid var(--cc-border)", borderRadius: 8, padding: 12,
              background: "var(--cc-bg)", fontSize: 13, color: "var(--cc-text)",
              display: "flex", flexDirection: "column", gap: 10, marginTop: 4,
            }}
          >
            <span>
              {(() => {
                const folder = folders.find((f) => f.id === confirmingDelete);
                const n = folder?.campaigns ?? 0;
                if (n === 0) return `Delete “${folder?.name}”? It has no campaigns in it.`;
                return `Delete “${folder?.name}”? The ${n} ${
                  n === 1 ? "campaign" : "campaigns"
                } in it ${n === 1 ? "is" : "are"} kept — ${
                  n === 1 ? "it" : "they"
                } just stop${n === 1 ? "s" : ""} being filed here.`;
              })()}
            </span>
            <div style={{ display: "flex", gap: 8 }}>
              <Button
                variant="danger"
                size="sm"
                disabled={busy}
                onClick={async () => {
                  const id = confirmingDelete;
                  if (await send(`/api/folders/${id}`, "DELETE")) {
                    setConfirmingDelete(null);
                    if (selected === id) onSelect(null);
                  }
                }}
              >
                Delete folder
              </Button>
              <Button variant="secondary" size="sm" onClick={() => setConfirmingDelete(null)}>
                Keep it
              </Button>
            </div>
          </div>
        )}

        <div style={{ height: 1, background: "var(--cc-border)", margin: "8px 0 4px" }} />

        <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
          <Input
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="New folder name"
          />
          <Button
            variant="primary"
            size="sm"
            iconLeft={<Plus size={14} />}
            disabled={busy || !name.trim()}
            onClick={async () => {
              if (await send("/api/folders", "POST", { name: name.trim() })) setName("");
            }}
          >
            Create
          </Button>
        </div>

        {error && (
          <span style={{ fontSize: 12, color: "#DC2626" }} role="alert">
            {error}
          </span>
        )}
      </div>
    </Modal>
  );
}
