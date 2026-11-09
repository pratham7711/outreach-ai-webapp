"use client";

import React, { cloneElement, isValidElement, useId } from "react";
import { Input, Textarea } from "@pratham7711/ui";

/**
 * One form field: a label above the control, a red asterisk when it is
 * required, and one line under it for help or for the error.
 *
 * The asterisk is drawn by CSS (`.cc-form-label[data-required]::after`) with
 * empty alternative text, so it is neither in the label's text nor in the
 * control's accessible name -- `required`/aria-required already says it, and
 * getByLabelText("Handle") still finds the field.
 *
 *   <Field label="Handle" required error={handleError}>
 *     <Input value={handle} onChange={...} />
 *   </Field>
 *
 * The control is the single child. Field gives it an id (keeping one it
 * already has), so the label focuses it and names it; points its
 * aria-describedby at the help or error line; sets aria-invalid while there
 * is an error; and marks it required -- the real `required` attribute on a
 * native or library input, so the browser holds the submit too, and
 * aria-required on anything else (Dropdown, EntityPicker, CreatorSelect).
 *
 * `group` is for a control made of several inputs (a checkbox list, a from/to
 * pair): the label becomes the name of a role="group" wrapper instead of a
 * <label for>, and each input keeps its own aria-label.
 *
 * Labels are 14/500 in the ink, 4px over the field; the library's own
 * `<Input label>` is styled identically in globals.css, so an unmigrated form
 * does not look different -- it only lacks the asterisk wiring and the help
 * slot.
 */

export type FieldProps = {
  label: React.ReactNode;
  required?: boolean;
  /** One line under the field. Replaced by `error` while there is one. */
  helper?: React.ReactNode;
  /** The problem and the way out, e.g. "Enter a handle, like @maya". */
  error?: React.ReactNode;
  /** Used when the child has no id of its own. */
  id?: string;
  /** Label a group of inputs rather than one control. */
  group?: boolean;
  className?: string;
  children: React.ReactNode;
};

const NATIVE_REQUIRED = new Set<unknown>(["input", "textarea", "select", Input, Textarea]);

export function Field({ label, required, helper, error, id, group, className, children }: FieldProps) {
  const auto = useId();
  const child = !group && isValidElement<Record<string, unknown>>(children) ? children : null;
  const childId = child && typeof child.props.id === "string" ? child.props.id : undefined;
  const controlId = childId ?? id ?? `field${auto.replace(/[^a-zA-Z0-9_-]/g, "")}`;
  const labelId = `${controlId}-label`;
  const hasError = Boolean(error);
  const noteId = hasError ? `${controlId}-error` : helper ? `${controlId}-help` : undefined;

  const note = hasError ? (
    <p id={noteId} className="cc-form-error" role="alert">
      {error}
    </p>
  ) : helper ? (
    <p id={noteId} className="cc-form-help">
      {helper}
    </p>
  ) : null;

  if (!child) {
    return (
      <div
        className={`cc-form-field${className ? ` ${className}` : ""}`}
        role="group"
        aria-labelledby={labelId}
        aria-describedby={noteId}
      >
        <span id={labelId} className="cc-form-label" data-required={required || undefined}>
          {label}
        </span>
        {children}
        {note}
      </div>
    );
  }

  const ownDescribedBy = typeof child.props["aria-describedby"] === "string" ? child.props["aria-describedby"] : "";
  const describedBy = [ownDescribedBy, noteId].filter(Boolean).join(" ") || undefined;
  const requiredProps = required
    ? NATIVE_REQUIRED.has(child.type)
      ? { required: true }
      : { "aria-required": true }
    : {};

  const control = cloneElement(child, {
    id: controlId,
    "aria-describedby": describedBy,
    ...(hasError ? { "aria-invalid": true } : {}),
    ...requiredProps,
  });

  return (
    <div className={`cc-form-field${className ? ` ${className}` : ""}`}>
      <label id={labelId} htmlFor={controlId} className="cc-form-label" data-required={required || undefined}>
        {label}
      </label>
      {control}
      {note}
    </div>
  );
}

/** Fields side by side on wide screens, stacked when there is no room. */
export function FieldRow({ children }: { children: React.ReactNode }) {
  return <div className="cc-form-row">{children}</div>;
}
