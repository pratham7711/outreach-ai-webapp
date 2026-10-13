"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Modal, Input } from "@pratham7711/ui";
import { ListPlus, Tag } from "lucide-react";
import ExportMenu from "@/components/creators/ExportMenu";
import { TrackSelectedButton } from "@/components/creators/TrackCreators";
import { Button } from "@/components/ds";
import { formatFull } from "@/lib/format";

/**
 * The roster's bulk actions: save what is on screen as a list, tag it, or
 * download it. They act on the ticked rows when there are any, and otherwise
 * on everything the filters match -- including the pages not loaded -- which
 * the server resolves from the same query the page was drawn from.
 */

export type RosterSelection = { mode: "filter" } | { mode: "ids"; ids: string[] } | { mode: "all" };

type Props = {
  total: number;
  filtered: boolean;
  selection: RosterSelection;
  query: string;
  suggestedName: string;
  tagOptions: string[];
  onClear: () => void;
};

function payloadFor(selection: RosterSelection, query: string) {
  return selection.mode === "ids" ? { creatorIds: selection.ids } : { query };
}

function exportHref(selection: RosterSelection, query: string, format: "xlsx" | "csv") {
  const qs = selection.mode === "ids" ? `ids=${selection.ids.map(encodeURIComponent).join(",")}` : query;
  return `/api/creators/export?format=${format}${qs ? `&${qs}` : ""}`;
}

const plural = (n: number) => `${formatFull(n)} creator${n === 1 ? "" : "s"}`;

export default function RosterActions({ total, filtered, selection, query, suggestedName, tagOptions, onClear }: Props) {
  const [dialog, setDialog] = useState<"list" | "tag" | null>(null);
  const count = selection.mode === "ids" ? selection.ids.length : total;
  const picked = selection.mode !== "filter";

  if (!total) return null;

  const label =
    selection.mode === "ids"
      ? `${formatFull(count)} selected`
      : selection.mode === "all"
        ? `All ${plural(total)} selected`
        : `${plural(total)}${filtered ? " match" : ""}`;

  return (
    <>
      <div className="cc-roster-bar" role="region" aria-label="Bulk actions" data-picked={picked || undefined}>
        <div className="cc-roster-bar-head">
          <span className="cc-roster-bar-count" aria-live="polite">
            {label}
          </span>
          {picked && (
            <Button variant="ghost" size="sm" onClick={onClear}>
              Clear
            </Button>
          )}
        </div>
        <div className="cc-roster-bar-actions">
          <Button variant="secondary" size="sm" iconLeft={<ListPlus size={15} />} onClick={() => setDialog("list")}>
            {picked ? "Add to list" : "Save as list"}
          </Button>
          <Button variant="secondary" size="sm" iconLeft={<Tag size={15} />} onClick={() => setDialog("tag")}>
            {picked ? "Tag" : "Tag all"}
          </Button>
          <ExportMenu
            items={[
              { label: `Excel (.xlsx) · ${plural(count)}`, href: exportHref(selection, query, "xlsx") },
              { label: `CSV · ${plural(count)}`, href: exportHref(selection, query, "csv") },
            ]}
          />
          {/* Only on a selection: with nothing ticked, the header's Track all
              is the action, and tracking "whatever this filter matches" from
              here would read as the same button with a different count. */}
          {picked && <TrackSelectedButton selection={payloadFor(selection, query)} count={count} />}
        </div>
      </div>

      {dialog === "list" && (
        <SaveAsListDialog
          count={count}
          payload={payloadFor(selection, query)}
          suggestedName={suggestedName}
          onClose={() => setDialog(null)}
        />
      )}
      {dialog === "tag" && (
        <TagDialog count={count} payload={payloadFor(selection, query)} tagOptions={tagOptions} onClose={() => setDialog(null)} />
      )}
    </>
  );
}

function DialogError({ error }: { error: string | null }) {
  return error ? (
    <div role="alert" className="cc-import-alert">
      {error}
    </div>
  ) : null;
}

async function send(url: string, body: unknown): Promise<{ ok: true; data: any } | { ok: false; error: string }> {
  try {
    const res = await fetch(url, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
    const data = await res.json().catch(() => null);
    if (res.ok) return { ok: true, data };
    return { ok: false, error: data?.error ?? (res.status === 401 ? "Your session has expired. Sign in again and retry." : "That didn't work.") };
  } catch {
    return { ok: false, error: "Could not reach the server. Check your connection and try again." };
  }
}

function SaveAsListDialog({
  count,
  payload,
  suggestedName,
  onClose,
}: {
  count: number;
  payload: object;
  suggestedName: string;
  onClose: () => void;
}) {
  const [mode, setMode] = useState<"new" | "existing">("new");
  const [name, setName] = useState(suggestedName);
  const [lists, setLists] = useState<{ id: string; name: string; count: number }[] | null>(null);
  const [listId, setListId] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState<{ listId: string; name: string; added: number; skipped: number } | null>(null);

  useEffect(() => {
    if (mode !== "existing" || lists) return;
    fetch("/api/lists")
      .then((r) => (r.ok ? r.json() : Promise.reject()))
      .then((d) => setLists(d.lists.map((l: any) => ({ id: l.id, name: l.name, count: l._count?.items ?? 0 }))))
      .catch(() => setError("Couldn't load your lists."));
  }, [mode, lists]);

  const canSave = mode === "new" ? name.trim().length > 0 : Boolean(listId);

  async function save() {
    setSaving(true);
    setError(null);
    const out = await send("/api/lists/from-roster", { ...payload, ...(mode === "new" ? { name: name.trim() } : { listId }) });
    setSaving(false);
    if (out.ok) setDone(out.data);
    else setError(out.error);
  }

  return (
    <Modal
      open
      onClose={onClose}
      title={done ? "Saved" : `Save ${plural(count)} as a list`}
      size="sm"
      footer={
        <div className="cc-modal-footer">
          {done ? (
            <>
              <Button variant="secondary" onClick={onClose}>
                Close
              </Button>
              {/* A link dressed as the library's Button, so it needs the size
                  class the Button would have added itself: without ui-btn-md
                  it had no padding and "Open list" touched both edges. */}
              <Link href={`/lists/${done.listId}`} className="ui-btn ui-btn-primary ui-btn-md" data-cc-slot="primary">
                Open list
              </Link>
            </>
          ) : (
            <>
              <Button variant="secondary" onClick={onClose}>
                Cancel
              </Button>
              <Button variant="primary" loading={saving} disabled={!canSave} onClick={save}>
                Save {plural(count)}
              </Button>
            </>
          )}
        </div>
      }
    >
      <div className="cc-import">
        <DialogError error={error} />
        {done ? (
          <p className="cc-import-lead" role="status">
            Saved {plural(done.added)} to <strong>{done.name}</strong>
            {done.skipped ? `; ${formatFull(done.skipped)} ${done.skipped === 1 ? "was" : "were"} already on it.` : "."}
          </p>
        ) : (
          <>
            <div className="cc-roster-choice" role="radiogroup" aria-label="Where to save">
              <label>
                <input type="radio" name="save-mode" checked={mode === "new"} onChange={() => setMode("new")} /> New list
              </label>
              <label>
                <input type="radio" name="save-mode" checked={mode === "existing"} onChange={() => setMode("existing")} /> Add to an existing list
              </label>
            </div>
            {mode === "new" ? (
              <Input label="List name" value={name} onChange={(e) => setName(e.target.value)} maxLength={200} autoFocus />
            ) : lists === null ? (
              <p className="cc-import-hint">Loading your lists…</p>
            ) : lists.length === 0 ? (
              <p className="cc-import-hint">You have no lists yet. Save this as a new one instead.</p>
            ) : (
              <select className="cc-import-select" aria-label="List" value={listId} onChange={(e) => setListId(e.target.value)}>
                <option value="">Choose a list…</option>
                {lists.map((l) => (
                  <option key={l.id} value={l.id}>
                    {l.name} ({formatFull(l.count)})
                  </option>
                ))}
              </select>
            )}
          </>
        )}
      </div>
    </Modal>
  );
}

function TagDialog({
  count,
  payload,
  tagOptions,
  onClose,
}: {
  count: number;
  payload: object;
  tagOptions: string[];
  onClose: () => void;
}) {
  const router = useRouter();
  const [action, setAction] = useState<"add" | "remove">("add");
  const [tag, setTag] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState<string | null>(null);
  const clean = tag.trim();

  async function apply() {
    setSaving(true);
    setError(null);
    const out = await send("/api/creators/tags", { ...payload, tag: clean, action });
    setSaving(false);
    if (!out.ok) return setError(out.error);
    const { changed, requested, tag: saved } = out.data;
    const unchanged = requested - changed;
    setDone(
      action === "add"
        ? `Tagged ${plural(changed)} “${saved}”${unchanged ? `; ${formatFull(unchanged)} already had it` : ""}.`
        : `Removed “${saved}” from ${plural(changed)}${unchanged ? `; ${formatFull(unchanged)} didn't have it` : ""}.`,
    );
    router.refresh();
  }

  return (
    <Modal
      open
      onClose={onClose}
      title={done ? "Done" : `Tag ${plural(count)}`}
      size="sm"
      footer={
        <div className="cc-modal-footer">
          {done ? (
            <Button variant="primary" onClick={onClose}>
              Close
            </Button>
          ) : (
            <>
              <Button variant="secondary" onClick={onClose}>
                Cancel
              </Button>
              <Button variant="primary" loading={saving} disabled={!clean} onClick={apply}>
                {clean
                  ? action === "add"
                    ? `Add “${clean}” to ${plural(count)}`
                    : `Remove “${clean}” from ${plural(count)}`
                  : action === "add"
                    ? "Add tag"
                    : "Remove tag"}
              </Button>
            </>
          )}
        </div>
      }
    >
      <div className="cc-import">
        <DialogError error={error} />
        {done ? (
          <p className="cc-import-lead" role="status">
            {done}
          </p>
        ) : (
          <>
            <div className="cc-roster-choice" role="radiogroup" aria-label="Add or remove">
              <label>
                <input type="radio" name="tag-mode" checked={action === "add"} onChange={() => setAction("add")} /> Add a tag
              </label>
              <label>
                <input type="radio" name="tag-mode" checked={action === "remove"} onChange={() => setAction("remove")} /> Remove a tag
              </label>
            </div>
            <Input label="Tag" value={tag} onChange={(e) => setTag(e.target.value)} list="roster-tag-options" maxLength={120} autoFocus />
            <datalist id="roster-tag-options">
              {tagOptions.map((t) => (
                <option key={t} value={t} />
              ))}
            </datalist>
          </>
        )}
      </div>
    </Modal>
  );
}
