"use client";

import { useState } from "react";
import { AlertTriangle } from "lucide-react";
import { Input } from "@pratham7711/ui";
import { toast } from "sonner";
import { Button } from "@/components/ds";
import { platformLabel } from "@/lib/format";
import { handleProblemText, type HandleProblem } from "@/lib/creators/handleCheck";

export type FixableLink = { id: string; platform: string; handle: string; problem: HandleProblem };

/**
 * An account the platform could not find, with the way to correct it: the
 * handle as typed, with an @, or the profile link pasted from the app. Saving
 * queues it for the next hourly read, which is when the flag clears for good
 * or comes back.
 */
export default function HandleFix({ creatorId, link, onSaved }: { creatorId: string; link: FixableLink; onSaved: () => void }) {
  const [open, setOpen] = useState(false);
  const [value, setValue] = useState(link.handle);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const label = platformLabel(link.platform);

  const save = async (e: React.FormEvent) => {
    e.preventDefault();
    setSaving(true);
    setError(null);
    try {
      const res = await fetch(`/api/creators/${creatorId}/profile-links/${link.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ handle: value }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setError(data.error ?? "Couldn't save the handle. Try again.");
        return;
      }
      toast.success(`Saved. We'll look up @${data.link.handle} on ${label} within the hour.`);
      setOpen(false);
      onSaved();
    } catch {
      setError("The request didn't go through. The handle is unchanged.");
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="cc-handle-fix">
      <p className="cc-handle-fix-text">
        <AlertTriangle size={15} aria-hidden className="cc-handle-fix-icon" />
        <span>{handleProblemText(link.platform, link.handle, link.problem)}</span>
      </p>
      {open ? (
        <form className="cc-handle-fix-form" onSubmit={save}>
          <Input
            label={`Correct ${label} handle or profile link`}
            value={value}
            onChange={(e: React.ChangeEvent<HTMLInputElement>) => setValue(e.target.value)}
            autoFocus
            required
          />
          {error && (
            <p role="alert" className="cc-handle-fix-error">
              {error}
            </p>
          )}
          <div className="cc-handle-fix-actions">
            <Button type="submit" variant="primary" size="sm" loading={saving}>
              Save handle
            </Button>
            <Button
              type="button"
              variant="secondary"
              size="sm"
              onClick={() => {
                setOpen(false);
                setValue(link.handle);
                setError(null);
              }}
            >
              Cancel
            </Button>
          </div>
        </form>
      ) : (
        <Button type="button" variant="secondary" size="sm" onClick={() => setOpen(true)}>
          Fix {label} handle
        </Button>
      )}
    </div>
  );
}
