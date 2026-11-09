"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Input } from "@pratham7711/ui";
import { Modal, ModalNotice, ModalOption, ModalOptionList } from "@/components/ds/Modal";
import { AlertCircle, CheckCircle2, Download, ListPlus, ListTree, Minus, Plus, Tag, Trash2 } from "lucide-react";
import { toast } from "sonner";
import ExportMenu from "@/components/creators/ExportMenu";
import { TrackSelectedButton } from "@/components/creators/TrackCreators";
import { Button, Combobox, Dropdown, MoreMenu, useConfirm } from "@/components/ds";
import { formatFull } from "@/lib/format";

/**
 * The roster's bulk actions: save what is on screen as a list, tag it, or
 * download it. On ticked rows they live in a bar that appears with the
 * selection (RosterActions). On everything the filters match -- including the
 * pages not loaded, which the server resolves from the same query the page was
 * drawn from -- they live in the toolbar's ⋯ (RosterMenu). The bar used to be
 * on all the time, sticky over the last rows of the grid, saying how many
 * creators the page already said it held.
 */

export type RosterSelection = { mode: "filter" } | { mode: "ids"; ids: string[] } | { mode: "all" };

type Props = {
  total: number;
  selection: RosterSelection;
  query: string;
  suggestedName: string;
  tagOptions: string[];
  onClear: () => void;
};

function payloadFor(selection: RosterSelection, query: string) {
  return selection.mode === "ids" ? { creatorIds: selection.ids } : { query };
}

function selectionQuery(selection: RosterSelection, query: string) {
  return selection.mode === "ids" ? `ids=${selection.ids.map(encodeURIComponent).join(",")}` : query;
}

function exportHref(selection: RosterSelection, query: string, format: "xlsx" | "csv") {
  const qs = selectionQuery(selection, query);
  return `/api/creators/export?format=${format}${qs ? `&${qs}` : ""}`;
}

const plural = (n: number) => `${formatFull(n)} creator${n === 1 ? "" : "s"}`;

function BulkDialogs({
  dialog,
  onClose,
  count,
  selection,
  query,
  suggestedName,
  tagOptions,
}: {
  dialog: "list" | "tag" | null;
  onClose: () => void;
  count: number;
  selection: RosterSelection;
  query: string;
  suggestedName: string;
  tagOptions: string[];
}) {
  if (dialog === "list") {
    return <SaveAsListDialog count={count} payload={payloadFor(selection, query)} suggestedName={suggestedName} onClose={onClose} />;
  }
  if (dialog === "tag") {
    return (
      <TagDialog
        count={count}
        payload={payloadFor(selection, query)}
        heldTagsHref={`/api/creators/tags?${selectionQuery(selection, query)}`}
        tagOptions={tagOptions}
        onClose={onClose}
      />
    );
  }
  return null;
}

/** The bar for ticked creators. Nothing ticked, nothing drawn. */
export default function RosterActions({ total, selection, query, suggestedName, tagOptions, onClear }: Props) {
  const [dialog, setDialog] = useState<"list" | "tag" | null>(null);
  const count = selection.mode === "ids" ? selection.ids.length : total;

  if (!total || selection.mode === "filter") return null;

  const label = selection.mode === "ids" ? `${formatFull(count)} selected` : `All ${plural(total)} selected`;

  return (
    <>
      <div className="cc-roster-bar" role="region" aria-label="Bulk actions" data-picked="">
        <div className="cc-roster-bar-head">
          <span className="cc-roster-bar-count" aria-live="polite">
            {label}
          </span>
          <Button variant="ghost" size="sm" onClick={onClear}>
            Clear
          </Button>
        </div>
        <div className="cc-roster-bar-actions">
          <Button variant="secondary" size="sm" iconLeft={<ListPlus size={16} />} onClick={() => setDialog("list")}>
            Add to list
          </Button>
          <Button variant="secondary" size="sm" iconLeft={<Tag size={16} />} onClick={() => setDialog("tag")}>
            Tag
          </Button>
          <ExportMenu
            items={[
              { label: `Excel (.xlsx) · ${plural(count)}`, href: exportHref(selection, query, "xlsx") },
              { label: `CSV · ${plural(count)}`, href: exportHref(selection, query, "csv") },
            ]}
          />
          <TrackSelectedButton selection={payloadFor(selection, query)} count={count} />
          {selection.mode === "ids" && <DeleteSelectedButton ids={selection.ids} onDone={onClear} />}
        </div>
      </div>
      <BulkDialogs
        dialog={dialog}
        onClose={() => setDialog(null)}
        count={count}
        selection={selection}
        query={query}
        suggestedName={suggestedName}
        tagOptions={tagOptions}
      />
    </>
  );
}

/**
 * The same actions for everything the search and filters match, as the
 * toolbar's ⋯. The header's Track all is the tracking action here: tracking
 * "whatever this filter matches" from a second place would read as the same
 * button with a different count.
 */
export function RosterMenu({
  total,
  query,
  suggestedName,
  tagOptions,
}: {
  total: number;
  query: string;
  suggestedName: string;
  tagOptions: string[];
}) {
  const [dialog, setDialog] = useState<"list" | "tag" | null>(null);
  const selection: RosterSelection = { mode: "filter" };
  if (!total) return null;
  return (
    <>
      <MoreMenu
        label={`Actions for these ${plural(total)}`}
        items={[
          { label: `Save ${plural(total)} as a list`, icon: <ListPlus size={16} />, onClick: () => setDialog("list") },
          { label: `Tag ${plural(total)}`, icon: <Tag size={16} />, onClick: () => setDialog("tag") },
          { label: "Export to Excel (.xlsx)", icon: <Download size={16} />, href: exportHref(selection, query, "xlsx"), download: true },
          { label: "Export to CSV", icon: <Download size={16} />, href: exportHref(selection, query, "csv"), download: true },
        ]}
      />
      <BulkDialogs
        dialog={dialog}
        onClose={() => setDialog(null)}
        count={total}
        selection={selection}
        query={query}
        suggestedName={suggestedName}
        tagOptions={tagOptions}
      />
    </>
  );
}

/* Ticked rows only, never "all matching": see app/api/creators/delete. */
const MAX_BULK_DELETE = 500;

function DeleteSelectedButton({ ids, onDone }: { ids: string[]; onDone: () => void }) {
  const router = useRouter();
  const confirm = useConfirm();
  const [busy, setBusy] = useState(false);

  async function run() {
    if (ids.length > MAX_BULK_DELETE) {
      toast.error(`Delete up to ${formatFull(MAX_BULK_DELETE)} creators at a time. ${formatFull(ids.length)} are ticked.`);
      return;
    }
    /* Plural, so a written title rather than verb/subject's quoted name; the
       verb still gives it the delete glyph. */
    const ok = await confirm({
      title: `Delete ${plural(ids.length)}?`,
      verb: "delete",
      description:
        "They come off the roster and out of every list, and their profiles stop refreshing. " +
        "Their posts stay in the campaigns they ran in. This can't be undone.",
      confirmLabel: `Delete ${plural(ids.length)}`,
    });
    if (!ok) return;
    setBusy(true);
    const out = await send("/api/creators/delete", { creatorIds: ids });
    setBusy(false);
    if (!out.ok) {
      toast.error(out.error === "Forbidden" ? "Your role can't delete creators. Ask an admin or manager." : out.error);
      return;
    }
    const { deleted, requested } = out.data as { deleted: number; requested: number };
    const gone = requested - deleted;
    toast.success(`Deleted ${plural(deleted)}${gone ? `; ${formatFull(gone)} ${gone === 1 ? "was" : "were"} already gone` : ""}.`);
    onDone();
    router.refresh();
  }

  return (
    <Button variant="danger" size="sm" iconLeft={<Trash2 size={16} />} loading={busy} onClick={run}>
      Delete
    </Button>
  );
}

/* Native radios at the end of a dialog option row, in the brand colour. */
const RADIO = "m-0 size-4 cursor-pointer [accent-color:var(--cc-primary)]";

function DialogError({ error }: { error: string | null }) {
  return error ? (
    <ModalNotice tone="danger" icon={AlertCircle}>
      {error}
    </ModalNotice>
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
  const [listsFailed, setListsFailed] = useState(false);
  const [listId, setListId] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState<{ listId: string; name: string; added: number; skipped: number } | null>(null);

  /* Read on open rather than on picking "existing": that choice is offered
     only when there is a list to add to. If the read fails the choice stays,
     and picking it says the lists could not be loaded. */
  useEffect(() => {
    fetch("/api/lists")
      .then((r) => (r.ok ? r.json() : Promise.reject()))
      .then((d) => setLists(d.lists.map((l: any) => ({ id: l.id, name: l.name, count: l._count?.items ?? 0 }))))
      .catch(() => setListsFailed(true));
  }, []);
  const offerExisting = listsFailed || (lists?.length ?? 0) > 0;

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
      icon={done ? CheckCircle2 : ListPlus}
      tone={done ? "success" : "brand"}
      title={done ? "Saved" : `Save ${plural(count)} as a list`}
      description={
        done ? (
          <span role="status">
            Saved {plural(done.added)} to <strong className="cc-dialog__subject">{done.name}</strong>
            {done.skipped ? `; ${formatFull(done.skipped)} ${done.skipped === 1 ? "was" : "were"} already on it.` : "."}
          </span>
        ) : offerExisting ? (
          "Start a new list with them, or add them to one you already have."
        ) : (
          "Start a new list with them."
        )
      }
      size="sm"
      dismissible={done !== null}
      footer={
        <div className="cc-modal-footer">
          {done ? (
            <>
              <Button variant="secondary" size="sm" onClick={onClose}>
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
              <Button variant="secondary" size="sm" onClick={onClose}>
                Cancel
              </Button>
              <Button variant="primary" size="sm" loading={saving} disabled={!canSave} onClick={save}>
                Save {plural(count)}
              </Button>
            </>
          )}
        </div>
      }
    >
      {!done && (
        <div className="cc-dialog-stack">
          <DialogError error={error} />
          {offerExisting && (
            <div role="radiogroup" aria-label="Where to save">
              <ModalOptionList>
                <ModalOption
                  icon={ListPlus}
                  title="New list"
                  control={<input type="radio" className={RADIO} name="save-mode" checked={mode === "new"} onChange={() => setMode("new")} />}
                />
                <ModalOption
                  icon={ListTree}
                  title="Add to an existing list"
                  description="Anyone already on it is skipped."
                  control={<input type="radio" className={RADIO} name="save-mode" checked={mode === "existing"} onChange={() => setMode("existing")} />}
                />
              </ModalOptionList>
            </div>
          )}
          {mode === "new" ? (
            <Input label="List name" value={name} onChange={(e) => setName(e.target.value)} maxLength={200} autoFocus />
          ) : lists === null ? (
            <DialogError error="Couldn't load your lists." />
          ) : (
            <Dropdown
              ariaLabel="List"
              value={listId}
              onChange={setListId}
              placeholder="Choose a list…"
              options={lists.map((l) => ({ value: l.id, label: `${l.name} (${formatFull(l.count)})` }))}
              align="left"
              size="md"
              fullWidth
            />
          )}
        </div>
      )}
    </Modal>
  );
}

function TagDialog({
  count,
  payload,
  heldTagsHref,
  tagOptions,
  onClose,
}: {
  count: number;
  payload: object;
  /** GET for the tags the selected creators already carry. */
  heldTagsHref: string;
  tagOptions: string[];
  onClose: () => void;
}) {
  const router = useRouter();
  const [action, setAction] = useState<"add" | "remove">("add");
  const [tag, setTag] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState<string | null>(null);
  const [held, setHeld] = useState<string[] | null>(null);
  const [heldFailed, setHeldFailed] = useState(false);
  const clean = tag.trim();

  /* "Remove a tag" is offered only when a selected creator has one, and then
     suggests only the tags they carry. If the read fails, both choices stay
     and the suggestions are every tag in the workspace, as before. */
  useEffect(() => {
    fetch(heldTagsHref)
      .then((r) => (r.ok ? r.json() : Promise.reject()))
      .then((d: { tags?: string[] }) => setHeld(d.tags ?? []))
      .catch(() => setHeldFailed(true));
  }, [heldTagsHref]);
  const offerRemove = heldFailed || (held?.length ?? 0) > 0;
  const suggestions = action === "remove" && held ? held : tagOptions;

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
      icon={done ? CheckCircle2 : Tag}
      tone={done ? "success" : "brand"}
      title={done ? "Done" : `Tag ${plural(count)}`}
      description={
        done ? (
          <span role="status">{done}</span>
        ) : offerRemove ? (
          "Add one tag to all of them, or take one off."
        ) : (
          "Add one tag to all of them."
        )
      }
      size="sm"
      dismissible={done !== null}
      footer={
        <div className="cc-modal-footer">
          {done ? (
            <Button variant="primary" size="sm" onClick={onClose}>
              Close
            </Button>
          ) : (
            <>
              <Button variant="secondary" size="sm" onClick={onClose}>
                Cancel
              </Button>
              <Button variant="primary" size="sm" loading={saving} disabled={!clean} onClick={apply}>
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
      {!done && (
        <form
          className="cc-dialog-stack"
          onSubmit={(e) => {
            e.preventDefault();
            if (clean && !saving) apply();
          }}
        >
          <DialogError error={error} />
          {offerRemove && (
            <div role="radiogroup" aria-label="Add or remove">
              <ModalOptionList>
                <ModalOption
                  icon={Plus}
                  title="Add a tag"
                  control={<input type="radio" className={RADIO} name="tag-mode" checked={action === "add"} onChange={() => setAction("add")} />}
                />
                <ModalOption
                  icon={Minus}
                  title="Remove a tag"
                  control={<input type="radio" className={RADIO} name="tag-mode" checked={action === "remove"} onChange={() => setAction("remove")} />}
                />
              </ModalOptionList>
            </div>
          )}
          <Combobox
            label="Tag"
            value={tag}
            onChange={setTag}
            options={suggestions}
            placeholder={action === "remove" ? "Pick a tag to take off" : "Type a new tag or pick one"}
            maxLength={120}
            autoFocus
          />
        </form>
      )}
    </Modal>
  );
}
