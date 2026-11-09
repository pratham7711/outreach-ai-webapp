"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { Plus, Folder, FolderPlus, Copy, EyeOff, Trash2 } from "lucide-react";
import { Input, EmptyState } from "@pratham7711/ui";
import { Modal } from "@/components/ds/Modal";
import { formatDateAbs, formatFull } from "@/lib/format";
import {
  Button,
  DataTable,
  FeatureState,
  Field,
  LoadError,
  MoreMenu,
  PageHeader,
  StatusBadge,
  useConfirm,
  type DataTableColumn,
} from "@/components/ds";
import { action } from "@/lib/ui/actions";
import { toast } from "sonner";
import { MEDIA_KITS_WIDTHS } from "./columns";

interface MediaKit {
  id: string;
  title: string;
  slug: string;
  shareToken: string;
  isPublic: boolean;
  creatorIds: string[];
  createdAt: string;
}

export default function MediaKitsPage() {
  const confirm = useConfirm();
  const [kits, setKits] = useState<MediaKit[]>([]);
  const [loading, setLoading] = useState(true);
  const [featureDisabled, setFeatureDisabled] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [open, setOpen] = useState(false);
  const [title, setTitle] = useState("");
  const [creating, setCreating] = useState(false);

  async function fetchKits() {
    try {
      const res = await fetch("/api/media-kits");
      if (res.status === 403) {
        setFeatureDisabled(true);
        setError(null);
        setKits([]);
        setLoading(false);
        return;
      }
      if (res.ok) {
        setFeatureDisabled(false);
        setError(null);
        setKits(await res.json());
      } else {
        setError("We couldn't load media kits right now.");
      }
    } catch {
      setError("We couldn't load media kits right now.");
    }
    setLoading(false);
  }

  useEffect(() => { fetchKits(); }, []);

  async function createKit(e: React.FormEvent) {
    e.preventDefault();
    if (!title.trim()) return;
    setCreating(true);
    try {
      const res = await fetch("/api/media-kits", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ title, creatorIds: [] }),
      });
      if (res.status === 403) {
        setFeatureDisabled(true);
        setError(null);
        setOpen(false);
        setCreating(false);
        return;
      }
      if (res.ok) {
        setTitle("");
        setOpen(false);
        await fetchKits();
      } else {
        toast.error("We couldn't create that media kit right now.");
      }
    } catch {
      toast.error("We couldn't create that media kit right now.");
    }
    setCreating(false);
  }

  const [copiedToken, setCopiedToken] = useState<string | null>(null);

  /* A failed create, share or delete used to set the page error, which swapped
     the whole table for "Media kits couldn't load". The kits had loaded; only
     the one action failed, so it is reported as a toast and the table stays. */
  async function togglePublic(kit: MediaKit) {
    try {
      const res = await fetch(`/api/media-kits/${kit.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ isPublic: !kit.isPublic }),
      });
      if (res.status === 403) {
        setFeatureDisabled(true);
        setError(null);
        return;
      }
      if (!res.ok) {
        toast.error("We couldn't change that media kit's visibility right now.");
        return;
      }
      await fetchKits();
    } catch {
      toast.error("We couldn't change that media kit's visibility right now.");
    }
  }

  async function copyShareLink(token: string) {
    const url = `${window.location.origin}/share/${token}`;
    try {
      await navigator.clipboard.writeText(url);
    } catch {
      window.prompt("Copy this share link:", url);
    }
    setCopiedToken(token);
    setTimeout(() => setCopiedToken(null), 2000);
  }

  async function deleteKit(id: string, title: string) {
    const ok = await confirm({
      verb: "delete",
      subject: title,
      description: "Anyone holding a share link to this kit will no longer be able to open it. This can't be undone.",
    });
    if (!ok) return;
    try {
      const res = await fetch(`/api/media-kits/${id}`, { method: "DELETE" });
      if (res.status === 403) {
        setFeatureDisabled(true);
        setError(null);
        return;
      }
      if (!res.ok) {
        toast.error("We couldn't delete that media kit right now.");
        return;
      }
      await fetchKits();
    } catch {
      toast.error("We couldn't delete that media kit right now.");
    }
  }

  const columns: DataTableColumn<MediaKit>[] = [
    {
      key: "title",
      header: "Title",
      minWidth: 220,
      truncate: (k) => k.title,
      render: (k) => <span style={{ fontWeight: "var(--cc-fw-medium)" }}>{k.title}</span>,
    },
    {
      key: "creators",
      header: "Creators",
      width: MEDIA_KITS_WIDTHS.creators,
      align: "right",
      render: (k) => formatFull(k.creatorIds.length),
    },
    {
      key: "created",
      header: "Created",
      width: MEDIA_KITS_WIDTHS.created,
      render: (k) => formatDateAbs(k.createdAt),
    },
    {
      key: "visibility",
      header: "Visibility",
      width: MEDIA_KITS_WIDTHS.visibility,
      render: (k) => <StatusBadge tone={k.isPublic ? "success" : "neutral"}>{k.isPublic ? "Public" : "Private"}</StatusBadge>,
    },
    {
      key: "actions",
      header: "Actions",
      hideHeader: true,
      width: MEDIA_KITS_WIDTHS.actions,
      align: "right",
      render: (k) => (
        <span style={{ display: "inline-flex", alignItems: "center", justifyContent: "flex-end", gap: 8 }}>
          {/* The share token has existed on every kit since the model was
              added and was rendered nowhere, so a "Public" kit had no public
              address anyone could be given. A shared kit's one button copies
              that address; a private kit's shares it. */}
          {k.isPublic ? (
            <Button variant="secondary" size="sm" iconLeft={<Copy size={14} aria-hidden="true" />} onClick={() => copyShareLink(k.shareToken)}>
              {copiedToken === k.shareToken ? "Copied" : "Copy link"}
            </Button>
          ) : (
            <Button variant="secondary" size="sm" onClick={() => togglePublic(k)} title="Make this kit shareable by link">
              Share
            </Button>
          )}
          <MoreMenu
            size="sm"
            label={`More actions for ${k.title}`}
            items={[
              ...(k.isPublic
                ? [{ label: "Stop sharing media kit", icon: <EyeOff size={16} aria-hidden="true" />, onClick: () => togglePublic(k) }]
                : []),
              { label: "Delete media kit", icon: <Trash2 size={16} aria-hidden="true" />, danger: true, onClick: () => deleteKit(k.id, k.title) },
            ]}
          />
        </span>
      ),
    },
  ];

  return (
    <div className="rsp-page">
      <PageHeader
        title="Media Kits"
        subtitle="Build and share creator media kits"
        actions={
          <Button variant="primary" iconLeft={<Plus size={16} aria-hidden="true" />} onClick={() => setOpen(true)} {...action("new-media-kit")}>
            New media kit
          </Button>
        }
      />

      {featureDisabled ? (
        <FeatureState
          kind="locked"
          title="Media kits are turned off"
          body="Enable the media kits feature in Billing to create and manage shareable media kits."
          action={
            <Link href="/settings/billing" className="ui-btn ui-btn-secondary ui-btn-sm" data-cc-slot="secondary">
              Open Billing
            </Link>
          }
        />
      ) : error ? (
        <LoadError
          title="Media kits couldn't load"
          description={error}
          onRetry={() => {
            setError(null);
            setLoading(true);
            fetchKits();
          }}
          retrying={loading}
        />
      ) : (
        <DataTable
          caption="Media kits"
          columns={columns}
          rows={kits}
          rowKey={(k) => k.id}
          loading={loading}
          skeletonRows={4}
          empty={
            <EmptyState
              icon={<Folder size={32} color="var(--cc-text-subtle)" />}
              title="No media kits yet"
              description="Create a media kit to share creator profiles."
              action={
                <Button variant="primary" iconLeft={<Plus size={16} aria-hidden="true" />} onClick={() => setOpen(true)}>
                  New media kit
                </Button>
              }
            />
          }
        />
      )}

      <Modal
        open={open}
        onClose={() => setOpen(false)}
        icon={FolderPlus}
        tone="brand"
        title="New media kit"
        description="Name the kit. It starts private; you can share it by link from the list."
        size="sm"
        dismissible={false}
        footer={
          <div className="cc-modal-footer">
            <Button variant="secondary" size="sm" onClick={() => setOpen(false)}>Cancel</Button>
            <Button
              variant="primary"
              size="sm"
              loading={creating}
              disabled={!title.trim()}
              onClick={() => {
                document.getElementById("kit-form")?.dispatchEvent(
                  new Event("submit", { cancelable: true, bubbles: true })
                );
              }}
            >
              Create
            </Button>
          </div>
        }
      >
        <form onSubmit={createKit} id="kit-form" noValidate>
          <Field label="Title" required>
            <Input
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              placeholder="Summer campaign kit"
            />
          </Field>
        </form>
      </Modal>
    </div>
  );
}
