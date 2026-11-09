"use client";

import React from "react";
import type { LucideIcon } from "lucide-react";
import { SectionCard } from "./SectionCard";
import { Button } from "./Button";

/**
 * A settings form: one card, the fields in a single readable column
 * (36rem, labels above, 24px between fields), and a footer with Cancel and
 * Save on the right.
 *
 *   const dirty = useDirty(saved, form);
 *   <SettingsForm icon={Building2} title="Workspace" dirty={dirty} saving={saving}
 *     onSubmit={save} onCancel={() => setForm(saved)}>
 *     <Field label="Organization name" required><Input ... /></Field>
 *   </SettingsForm>
 *
 * Save is the form's submit button, so Enter in a field saves too. Both
 * buttons wait for `dirty`; Save also waits out `saving` and `invalid` (a
 * required field left blank). `readOnly` -- a seat that may look but not
 * change -- drops the footer altogether rather than showing two dead buttons.
 *
 * Autosaving pages (a switch that saves as it flips) do not use this; they
 * say once, under the section title, that changes save on their own.
 */

export type SettingsFormProps = {
  icon?: LucideIcon;
  title: string;
  description?: string;
  /** Something differs from what was loaded (useDirty). */
  dirty: boolean;
  saving?: boolean;
  /** A field is in error, so the form cannot be saved yet. */
  invalid?: boolean;
  readOnly?: boolean;
  onSubmit: () => void;
  /** Put the fields back to what was loaded. */
  onCancel: () => void;
  saveLabel?: string;
  /** Left of the buttons: "Saved", or what went wrong with the last save. */
  status?: React.ReactNode;
  className?: string;
  children: React.ReactNode;
};

export function SettingsForm({
  icon,
  title,
  description,
  dirty,
  saving = false,
  invalid = false,
  readOnly = false,
  onSubmit,
  onCancel,
  saveLabel = "Save changes",
  status,
  className,
  children,
}: SettingsFormProps) {
  const canSave = dirty && !saving && !invalid && !readOnly;
  return (
    <SectionCard
      icon={icon}
      title={title}
      description={description}
      padded={false}
      className={`cc-settings-card${className ? ` ${className}` : ""}`}
    >
      <form
        className="cc-settings-form"
        onSubmit={(e) => {
          e.preventDefault();
          if (canSave) onSubmit();
        }}
      >
        <div className="cc-settings-form__fields">{children}</div>
        {!readOnly && (
          <div className="cc-settings-form__foot">
            <div className="cc-settings-form__status" aria-live="polite">
              {status}
            </div>
            <Button variant="secondary" type="button" disabled={!dirty || saving} onClick={onCancel}>
              Cancel
            </Button>
            <Button variant="primary" type="submit" disabled={!canSave} loading={saving}>
              {saveLabel}
            </Button>
          </div>
        )}
      </form>
    </SectionCard>
  );
}
