"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Input } from "@pratham7711/ui";
import { AlertCircle, RefreshCw, UserPlus } from "lucide-react";
import { Modal, ModalNotice } from "@/components/ds/Modal";
import { Dropdown, Button } from "@/components/ds";
import { Field, FieldRow } from "@/components/ds/Field";
import { formatFull } from "@/lib/format";
import { platformLabel } from "@/lib/platforms/registry";

/* The platforms POST /api/creators accepts, named the way the rest of the app
   names them. */
const PLATFORM_OPTIONS = ["INSTAGRAM", "TIKTOK", "YOUTUBE", "TWITTER"].map((value) => ({
  value,
  label: platformLabel(value),
}));

type AddLookup =
  | { ok: true; followersCount: number; postsCount: number; via: { username: string } | null }
  | { ok: false; reason: string };

function lookupMessage(lookup: AddLookup): { tone: "success" | "info"; text: string } {
  if (!lookup.ok) {
    return {
      tone: "info",
      text: "Creator added. Instagram could not be read just now; the next scheduled read will try again.",
    };
  }
  const figures = `${formatFull(lookup.followersCount)} followers · ${formatFull(lookup.postsCount)} posts`;
  return {
    tone: "success",
    text: lookup.via
      ? `Creator added: ${figures}, via your Instagram Business account (@${lookup.via.username})`
      : `Creator added: ${figures}`,
  };
}

export default function AddCreatorModal({ onClose }: { onClose: () => void }) {
  const router = useRouter();
  const [loading, setLoading] = useState(false);
  /* The route answers 409 on a duplicate handle, 400 with zod details on a bad
     field and 401 when the session has gone. All three used to be dropped on
     the floor -- `if (res.ok)` and no else -- so the button looked broken. */
  const [error, setError] = useState<string | null>(null);
  /* No follower or view fields (Pratham, 2026-10-13: "there should be no
     manual share entry"). A figure somebody typed in sits beside measured ones
     with nothing to tell them apart, and it never updates; the route ignores
     them now even if a client still sends them. */
  const [form, setForm] = useState({
    name: "",
    handle: "",
    platform: "INSTAGRAM",
    rate: "",
  });

  /* Add waits for the two required fields; the route would 400 without them. */
  const canSubmit = form.name.trim() !== "" && form.handle.trim() !== "";

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (loading || !canSubmit) return;

    setLoading(true);
    setError(null);
    try {
      const res = await fetch("/api/creators", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: form.name,
          handle: form.handle,
          platform: form.platform,
          rate: form.rate ? Number(form.rate) : undefined,
        }),
      });
      if (res.ok) {
        const created = (await res.json().catch(() => null)) as { lookup?: AddLookup } | null;
        if (created?.lookup) {
          const { tone, text } = lookupMessage(created.lookup);
          if (tone === "success") toast.success(text);
          else toast.info(text);
        }
        router.refresh();
        onClose();
        return;
      }
      const body = await res.json().catch(() => null);
      setError(
        body?.error ??
          (res.status === 401
            ? "Your session has expired. Sign in again and retry."
            : "Could not add that creator.")
      );
    } catch {
      setError("Could not reach the server. Check your connection and try again.");
    } finally {
      setLoading(false);
    }
  };

  return (
    <Modal
      open={true}
      onClose={onClose}
      icon={UserPlus}
      title="Add creator"
      description="Add someone to your roster by name and handle."
      size="md"
      dismissible={false}
      footer={
        <div className="cc-modal-footer">
          <Button variant="secondary" size="sm" onClick={onClose}>Cancel</Button>
          <Button
            type="submit"
            form="add-creator-form"
            variant="primary"
            size="sm"
            loading={loading}
            disabled={!canSubmit}
            iconLeft={<UserPlus size={16} aria-hidden="true" />}
          >
            Add creator
          </Button>
        </div>
      }
    >
      <form id="add-creator-form" onSubmit={handleSubmit} className="cc-dialog-stack" noValidate>
        {error && (
          <ModalNotice tone="danger" icon={AlertCircle}>
            {error}
          </ModalNotice>
        )}
        <Field label="Name" required>
          <Input
            value={form.name}
            onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))}
            placeholder="e.g. Blessing Jolie"
          />
        </Field>
        <FieldRow>
          <Field label="Handle" required>
            <Input
              value={form.handle}
              onChange={(e) => setForm((f) => ({ ...f, handle: e.target.value }))}
              placeholder="@username"
            />
          </Field>
          <Field label="Platform">
            <Dropdown
              id="creator-platform"
              align="left"
              fullWidth
              value={form.platform}
              onChange={(v) => setForm((f) => ({ ...f, platform: v }))}
              options={PLATFORM_OPTIONS}
            />
          </Field>
        </FieldRow>
        <Field label="Rate per Post (USD)">
          <Input
            type="number"
            inputMode="decimal"
            value={form.rate}
            onChange={(e) => setForm((f) => ({ ...f, rate: e.target.value }))}
            placeholder="e.g. 5000"
          />
        </Field>
        <ModalNotice tone="neutral" icon={RefreshCw}>
          Followers and views are read from the platform, so there is nothing to type here. They show
          &ldquo;&mdash;&rdquo; until the first read.
        </ModalNotice>
      </form>
    </Modal>
  );
}
