"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";
import { ClipboardList, Pencil } from "lucide-react";
import { PageHeader, Field, SettingsForm } from "@/components/ds";
import { useDirty } from "@/lib/useDirty";
import { PlanDetailsFields, PlanFeatureList, enabledCount, featureKeys, planDraft, type PlanDraft } from "./planFields";

type PlanFormProps = {
  initial?: {
    id: string;
    name: string;
    description: string | null;
    features: Record<string, boolean>;
    isCustom: boolean;
  };
};

/**
 * The page form for a plan, at /plans/new and /plans/<id>. /plans itself edits
 * plans in a dialog; this is the same set of fields (planFields) for a direct
 * link, framed like every settings form: a card with Cancel and Save at its
 * foot. Save waits for the required name on a new plan and for a change on an
 * existing one; Cancel puts the form back to how it was loaded.
 */
export default function PlanForm({ initial }: PlanFormProps) {
  const router = useRouter();
  const isEdit = !!initial;

  const [saved, setSaved] = useState<PlanDraft>(() => planDraft(initial));
  const [draft, setDraft] = useState<PlanDraft>(saved);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const dirty = useDirty(saved, draft);

  async function save() {
    if (!draft.name.trim()) return;
    setSaving(true);
    setError(null);
    try {
      const url = isEdit ? `/api/plans/${initial.id}` : "/api/plans";
      const method = isEdit ? "PATCH" : "POST";
      const res = await fetch(url, {
        method,
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: draft.name.trim(),
          description: draft.description.trim() || null,
          features: draft.features,
          isCustom: draft.isCustom,
        }),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => null);
        setError(data?.error?.formErrors?.[0] ?? "Couldn't save the plan. Nothing was changed.");
        return;
      }
      setSaved(draft);
      router.push("/plans");
      router.refresh();
    } catch {
      setError("The request didn't go through. Nothing was changed.");
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="rsp-page page-enter">
      <PageHeader
        title={isEdit ? "Edit plan" : "New plan"}
        back={{ href: "/plans", label: "Plans" }}
        subtitle={isEdit ? "Update the plan's name, description and features." : "Create a plan and choose its features."}
      />

      {/* A reading measure wide, starting on the gutter with the title. */}
      <div style={{ maxWidth: "36rem" }}>
        <SettingsForm
          icon={isEdit ? Pencil : ClipboardList}
          title="Plan"
          description="Name the plan and choose which features clients on it can use."
          dirty={dirty}
          saving={saving}
          invalid={!draft.name.trim()}
          onSubmit={save}
          onCancel={() => {
            setDraft(saved);
            setError(null);
          }}
          saveLabel={isEdit ? "Save changes" : "Create plan"}
          status={error ? <span className="cc-form-error" role="alert">{error}</span> : null}
        >
          <PlanDetailsFields draft={draft} onChange={setDraft} />
          <Field label="Feature access" group helper={`${enabledCount(draft)} of ${featureKeys.length} on`}>
            <PlanFeatureList draft={draft} onChange={setDraft} />
          </Field>
        </SettingsForm>
      </div>
    </div>
  );
}
