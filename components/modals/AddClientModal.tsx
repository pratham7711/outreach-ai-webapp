"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Input } from "@pratham7711/ui";
import { AlertCircle, Building2, Plus } from "lucide-react";
import { Modal, ModalNotice, ModalSection } from "@/components/ds/Modal";
import { Button } from "@/components/ds";
import { Field, FieldRow } from "@/components/ds/Field";

export default function AddClientModal({ onClose }: { onClose: () => void }) {
  const router = useRouter();
  const [loading, setLoading] = useState(false);
  /* Every non-ok response used to be dropped -- `if (res.ok)` and no else -- so
     a rejected logo URL or an expired session left the button doing nothing. */
  const [error, setError] = useState<string | null>(null);
  const [form, setForm] = useState({
    name: "",
    email: "",
    phone: "",
    logoUrl: "",
  });

  const canSubmit = form.name.trim() !== "";

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (loading || !canSubmit) return;
    setLoading(true);
    setError(null);
    try {
      const contact = {
        ...(form.email.trim() && { email: form.email.trim() }),
        ...(form.phone.trim() && { phone: form.phone.trim() }),
      };
      /* Omitted rather than sent, when both fields are blank. This used to
         stringify the empty object and store the literal "{}" on every client
         added without contact details -- present, non-null, and meaning
         nothing, so "has contact info" was true for all of them. */
      const contactInfo = Object.keys(contact).length > 0 ? JSON.stringify(contact) : undefined;
      const res = await fetch("/api/clients", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: form.name,
          logoUrl: form.logoUrl.trim() || undefined,
          contactInfo,
        }),
      });
      if (res.ok) {
        router.refresh();
        onClose();
        return;
      }
      const body = await res.json().catch(() => null);
      setError(
        body?.error ??
          (res.status === 401
            ? "Your session has expired. Sign in again and retry."
            : "Could not add that client.")
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
      icon={Building2}
      title="Add client"
      description="Add a company you run campaigns for. Only the name is required."
      size="md"
      dismissible={false}
      footer={
        <div className="cc-modal-footer">
          <Button variant="secondary" size="sm" onClick={onClose}>Cancel</Button>
          <Button
            type="submit"
            form="add-client-form"
            variant="primary"
            size="sm"
            loading={loading}
            disabled={!canSubmit}
            iconLeft={<Plus size={16} aria-hidden="true" />}
          >
            Add client
          </Button>
        </div>
      }
    >
      <form id="add-client-form" onSubmit={handleSubmit} noValidate>
        <ModalSection>
          <div className="cc-dialog-stack">
            {error && (
              <ModalNotice tone="danger" icon={AlertCircle}>
                {error}
              </ModalNotice>
            )}
            <Field label="Company Name" required>
              <Input
                value={form.name}
                onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))}
                placeholder="e.g. Sony Music"
              />
            </Field>
            <Field label="Logo URL">
              <Input
                inputMode="url"
                value={form.logoUrl}
                onChange={(e) => setForm((f) => ({ ...f, logoUrl: e.target.value }))}
                placeholder="https://..."
              />
            </Field>
          </div>
        </ModalSection>
        <ModalSection title="Contact" description="Optional.">
          <FieldRow>
            <Field label="Contact Email">
              <Input
                type="email"
                value={form.email}
                onChange={(e) => setForm((f) => ({ ...f, email: e.target.value }))}
                placeholder="contact@company.com"
              />
            </Field>
            <Field label="Contact Phone">
              <Input
                type="tel"
                value={form.phone}
                onChange={(e) => setForm((f) => ({ ...f, phone: e.target.value }))}
                placeholder="+1 (555) 000-0000"
              />
            </Field>
          </FieldRow>
        </ModalSection>
      </form>
    </Modal>
  );
}
