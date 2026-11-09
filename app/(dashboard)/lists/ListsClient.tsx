"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Plus, Users, ClipboardList, Star, ListPlus } from "lucide-react";
import { Card, EmptyState, Input } from "@pratham7711/ui";
import { Modal } from "@/components/ds/Modal";
import { PageHeader, Button, Field, ListToolbar, NoResults, StatusBadge, StatusTabs } from "@/components/ds";
import { LIST_STATUS_LABELS, type DecisionCounts, type ListStatus } from "@/lib/lists/approval";
import { LIST_TONE } from "@/components/lists/listTone";
import { formatDateAbs } from "@/lib/format";
import { toast } from "sonner";
import Link from "next/link";
import { action } from "@/lib/ui/actions";
import { noun } from "@/lib/ui/noun";

type List = {
  id: string;
  name: string;
  description: string | null;
  _count: { items: number };
  createdAt: string;
  /* Present only once the list-approval tables exist. */
  status?: ListStatus;
  counts?: DecisionCounts;
  isFavorite?: boolean;
  archived?: boolean;
};

const STATUS_FILTERS: { key: "ALL" | ListStatus; label: string }[] = [
  { key: "ALL", label: "All" },
  { key: "DRAFT", label: LIST_STATUS_LABELS.DRAFT },
  { key: "SHARED", label: LIST_STATUS_LABELS.SHARED },
  { key: "APPROVED", label: LIST_STATUS_LABELS.APPROVED },
  { key: "ARCHIVED", label: LIST_STATUS_LABELS.ARCHIVED },
];

export default function ListsClient({ lists, review = false }: { lists: List[]; review?: boolean }) {
  const router = useRouter();
  const [search, setSearch] = useState("");
  const [status, setStatus] = useState<"ALL" | ListStatus>("ALL");
  const [favorites, setFavorites] = useState<Record<string, boolean>>({});
  const [showCreate, setShowCreate] = useState(false);
  const [createForm, setCreateForm] = useState({ name: "", description: "" });
  const [creating, setCreating] = useState(false);

  const isFavorite = (l: List) => favorites[l.id] ?? Boolean(l.isFavorite);
  const isFiltered = search.trim() !== "" || status !== "ALL";
  const clearFilters = () => {
    setSearch("");
    setStatus("ALL");
  };
  // "All" leaves archived lists out; they have their own tab. Favourites pin to
  // the top, otherwise the server's newest-first order stands.
  const filtered = lists
    .filter(l => l.name.toLowerCase().includes(search.trim().toLowerCase()))
    .filter(l => !review || (status === "ALL" ? l.status !== "ARCHIVED" : l.status === status))
    .sort((a, b) => (review ? Number(isFavorite(b)) - Number(isFavorite(a)) : 0));

  const toggleFavorite = async (list: List) => {
    const next = !isFavorite(list);
    setFavorites(f => ({ ...f, [list.id]: next }));
    const res = await fetch(`/api/lists/${list.id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ isFavorite: next }),
    }).catch(() => null);
    if (!res?.ok) {
      setFavorites(f => ({ ...f, [list.id]: !next }));
      toast.error("Couldn't update the star");
    }
  };

  const handleCreate = async () => {
    if (!createForm.name.trim()) return;
    setCreating(true);
    try {
      const res = await fetch("/api/lists", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(createForm),
      });
      if (res.ok) {
        toast.success("List created");
        setShowCreate(false);
        setCreateForm({ name: "", description: "" });
        router.refresh();
      } else {
        toast.error("Failed to create list");
      }
    } finally { setCreating(false); }
  };

  return (
    <div className="rsp-page">
      <PageHeader
        title="Lists"
        subtitle="Organize creators into curated lists"
        actions={<Button variant="primary" iconLeft={<Plus size={15} />} onClick={() => setShowCreate(true)} {...action("new-list")}>New list</Button>}
        /* Only when the lists span more than one status: with every list a
           Draft, "Draft" was "All" under another name. A filter already chosen
           keeps the strip, so it can be cleared. */
        tabs={
          review && (status !== "ALL" || new Set(lists.map((l) => l.status)).size > 1) ? (
            <StatusTabs
              ariaLabel="Filter by list status"
              tabs={STATUS_FILTERS.map((t) => ({
                ...t,
                count: t.key === "ALL" ? lists.length : lists.filter((l) => l.status === t.key).length,
              }))}
              active={status}
              onChange={(k) => setStatus(k as "ALL" | ListStatus)}
            />
          ) : undefined
        }
      />

      <ListToolbar
        search={{ value: search, onChange: setSearch, placeholder: "Search lists", ariaLabel: "Search lists by name" }}
      />

      {lists.length === 0 ? (
        <EmptyState icon={<ClipboardList size={32} color="var(--cc-text-subtle)" />} title="No lists yet" description="Create your first list to organize creators"
          action={<Button variant="primary" iconLeft={<Plus size={16} />} onClick={() => setShowCreate(true)}>New list</Button>}
        />
      ) : filtered.length === 0 ? (
        <div className="cc-dt-card">
          <NoResults
            title={isFiltered ? undefined : "No active lists"}
            onClear={isFiltered ? clearFilters : undefined}
            description={
              isFiltered
                ? "No list matches this search or status. Clear the filters to see every list."
                : "Every list here is archived. Open the Archived tab to see them."
            }
          />
        </div>
      ) : (
        <div className="cc-stagger rsp-grid-3">
          {filtered.map((list) => (
            <div key={list.id} className="cc-list-card">
              <Link prefetch={false} href={`/lists/${list.id}`} className="cc-list-card-link">
                <Card variant="outlined" clickable>
                  <h3 className="cc-panel-title cc-list-card-title" data-starrable={review ? "" : undefined}>{list.name}</h3>
                  {list.status && (
                    <div className="cc-list-card-status">
                      <StatusBadge tone={LIST_TONE[list.status]}>{LIST_STATUS_LABELS[list.status]}</StatusBadge>
                      {list.counts && list.counts.total - list.counts.pending > 0 && (
                        <span>{list.counts.approved} approved · {list.counts.rejected} declined</span>
                      )}
                    </div>
                  )}
                  {list.description && <p className="cc-list-card-desc">{list.description}</p>}
                  <div className="cc-list-card-foot">
                    <span><Users size={14} aria-hidden /> {list._count.items} {noun(list._count.items, "creator")}</span>
                    <span>{formatDateAbs(list.createdAt)}</span>
                  </div>
                </Card>
              </Link>
              {review && (
                <button
                  type="button"
                  className="cc-icon-btn cc-star cc-list-card-star"
                  aria-pressed={isFavorite(list)}
                  aria-label={isFavorite(list) ? `Unstar ${list.name}` : `Star ${list.name}`}
                  onClick={() => toggleFavorite(list)}
                >
                  <Star size={16} aria-hidden />
                </button>
              )}
            </div>
          ))}
        </div>
      )}

      {showCreate && (
        <Modal
          open
          onClose={() => setShowCreate(false)}
          icon={ListPlus}
          title="New list"
          description="Organize creators into a curated list you can share with a brand."
          size="md"
          dismissible={false}
          footer={
            <div className="cc-modal-footer">
              <Button variant="secondary" size="sm" onClick={() => setShowCreate(false)}>Cancel</Button>
              <Button variant="primary" size="sm" loading={creating} disabled={!createForm.name.trim()} iconLeft={<Plus size={16} aria-hidden="true" />} onClick={handleCreate}>Create list</Button>
            </div>
          }
        >
          <form
            className="cc-dialog-stack"
            onSubmit={(e) => {
              e.preventDefault();
              if (!creating && createForm.name.trim()) handleCreate();
            }}
          >
            <Input label="List name" required value={createForm.name} onChange={e => setCreateForm(f => ({ ...f, name: e.target.value }))} placeholder="e.g. TikTok Creators Q2" />
            <Field label="Description" id="new-list-description">
              <textarea
                className="ui-textarea"
                value={createForm.description}
                onChange={e => setCreateForm(f => ({ ...f, description: e.target.value }))}
                rows={3}
                placeholder="What this list is for"
              />
            </Field>
          </form>
        </Modal>
      )}
    </div>
  );
}
