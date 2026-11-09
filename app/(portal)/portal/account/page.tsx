"use client";

import { useCallback, useEffect, useState, type FormEvent } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Input, Textarea } from "@pratham7711/ui";
import { KeyRound, LogOut, Trash2, UserRound } from "lucide-react";
import { Button, Field, SectionCard, SettingsForm } from "@/components/ds";
import { useDirty } from "@/lib/useDirty";
import { BRAND } from "@/lib/brand";
import { LoadFailed, Screen, SkeletonBlock } from "@/components/portal/app/ui";
import { portalSignInHere } from "@/lib/callbackPath";

type ProfileFields = { name: string; bio: string };

function ProfileForm({ initial }: { initial: { name: string; bio: string; email: string } }) {
  const [saved, setSaved] = useState<ProfileFields>({ name: initial.name, bio: initial.bio });
  const [form, setForm] = useState<ProfileFields>({ name: initial.name, bio: initial.bio });
  const [saving, setSaving] = useState(false);
  const dirty = useDirty(saved, form);
  const nameMissing = !form.name.trim();

  /* Only name and bio. The handle is how agencies find the creator's roster
     row and the platform/niches/bank fields belong to screens that are parked,
     so this form never sends them. */
  const save = async () => {
    if (nameMissing) return;
    setSaving(true);
    const next = { name: form.name.trim(), bio: form.bio };
    try {
      const res = await fetch("/api/portal/me", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: next.name, bio: next.bio }),
      });
      const data = await res.json().catch(() => ({}));
      if (res.ok) {
        setSaved(next);
        setForm(next);
        toast.success("Saved");
      } else toast.error(data.error ?? "Couldn't save");
    } catch {
      toast.error("Network error. Try again.");
    } finally {
      setSaving(false);
    }
  };

  return (
    <SettingsForm
      icon={UserRound}
      title="Profile"
      dirty={dirty}
      saving={saving}
      invalid={nameMissing}
      onSubmit={save}
      onCancel={() => setForm(saved)}
    >
      <Field label="Email">
        <Input id="acct-email" value={initial.email} readOnly />
      </Field>
      <Field label="Name" required error={dirty && nameMissing ? "Your name can't be empty" : undefined}>
        <Input id="acct-name" value={form.name} onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))} autoComplete="name" />
      </Field>
      <Field label="Bio" helper="Agencies see this beside your campaign posts.">
        <Textarea id="acct-bio" value={form.bio} onChange={(e) => setForm((f) => ({ ...f, bio: e.target.value }))} rows={3} />
      </Field>
    </SettingsForm>
  );
}

function PasswordForm() {
  const [current, setCurrent] = useState("");
  const [next, setNext] = useState("");
  const [saving, setSaving] = useState(false);

  const change = async () => {
    if (next.length < 8) {
      toast.error("Your new password needs at least 8 characters.");
      return;
    }
    setSaving(true);
    try {
      const res = await fetch("/api/portal/account/password", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ currentPassword: current, newPassword: next }),
      });
      const data = await res.json().catch(() => ({}));
      if (res.ok) {
        toast.success("Password changed. Other devices have been logged out.");
        setCurrent("");
        setNext("");
      } else {
        toast.error(data.error ?? "Couldn't change the password");
      }
    } catch {
      toast.error("Network error. Try again.");
    } finally {
      setSaving(false);
    }
  };

  return (
    <SettingsForm
      icon={KeyRound}
      title="Password"
      dirty={!!current || !!next}
      saving={saving}
      invalid={!current || !next}
      onSubmit={change}
      onCancel={() => {
        setCurrent("");
        setNext("");
      }}
      saveLabel="Change password"
    >
      <Field label="Current password" required>
        <Input id="pw-current" type="password" value={current} onChange={(e) => setCurrent(e.target.value)} autoComplete="current-password" />
      </Field>
      <Field label="New password" required helper="At least 8 characters.">
        <Input id="pw-new" type="password" value={next} onChange={(e) => setNext(e.target.value)} autoComplete="new-password" />
      </Field>
      <ForgotPassword />
    </SettingsForm>
  );
}

function ForgotPassword() {
  const [open, setOpen] = useState(false);
  return (
    <div>
      <button
        type="button"
        className="rsp-touch"
        aria-expanded={open}
        aria-controls="forgot-password"
        onClick={() => setOpen((o) => !o)}
        style={{ padding: 0, border: "none", background: "none", cursor: "pointer", fontSize: 13, fontWeight: 600, color: "var(--cc-primary)" }}
      >
        Forgot your password?
      </button>
      {open && (
        <p id="forgot-password" className="cc-form-help" style={{ margin: "6px 0 0" }}>
          Email{" "}
          <a href={`mailto:${BRAND.contactEmail}`} style={{ color: "var(--cc-primary)", textDecoration: "underline" }}>
            {BRAND.contactEmail}
          </a>{" "}
          from the address you sign in with.
        </p>
      )}
    </div>
  );
}

function DeleteAccount() {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [password, setPassword] = useState("");
  const [typed, setTyped] = useState("");
  const [deleting, setDeleting] = useState(false);

  const remove = async (e: FormEvent) => {
    e.preventDefault();
    if (!password || typed !== "DELETE") return;
    setDeleting(true);
    try {
      const res = await fetch("/api/portal/account/delete", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ password, confirm: typed }),
      });
      const data = await res.json().catch(() => ({}));
      if (res.ok) {
        toast.success("Your account and connected data are deleted.");
        router.push("/portal/login");
        return;
      }
      toast.error(data.error ?? "Couldn't delete your account");
    } catch {
      toast.error("Network error. Try again.");
    } finally {
      setDeleting(false);
    }
  };

  if (!open) {
    return (
      <SectionCard
        icon={Trash2}
        title="Delete my account and data"
        padded={false}
        action={
          <Button variant="secondary" onClick={() => setOpen(true)}>
            Delete…
          </Button>
        }
      >
        {null}
      </SectionCard>
    );
  }

  return (
    <SectionCard icon={Trash2} title="Delete my account and data" padded={false} className="cc-settings-card">
      <form onSubmit={remove} className="cc-settings-form">
        <div className="cc-settings-form__fields">
          <p className="cc-form-help" style={{ margin: 0 }}>
            Deletes your login, connected accounts and their numbers, straight away. Campaign posts stay with the agency.{" "}
            <a href="/data-deletion" style={{ color: "var(--cc-primary)", textDecoration: "underline" }}>
              How deletion works
            </a>
          </p>
          <Field label="Your password" required>
            <Input id="del-password" type="password" value={password} onChange={(e) => setPassword(e.target.value)} autoComplete="current-password" />
          </Field>
          <Field label="Type DELETE to confirm" required>
            <Input id="del-confirm" value={typed} onChange={(e) => setTyped(e.target.value)} autoCapitalize="characters" autoComplete="off" />
          </Field>
        </div>
        <div className="cc-settings-form__foot">
          <Button type="button" variant="ghost" onClick={() => setOpen(false)}>
            Cancel
          </Button>
          <Button type="submit" variant="danger" loading={deleting} disabled={!password || typed !== "DELETE"}>
            Delete my account and data
          </Button>
        </div>
      </form>
    </SectionCard>
  );
}

/**
 * Account: profile, password, log out, and delete. No money and no bank
 * details -- payouts are parked (SHOW_MONEY) and their fields are not shown or
 * cleared here.
 */
export default function AccountPage() {
  const router = useRouter();
  const [me, setMe] = useState<{ name: string; bio: string; email: string } | null>(null);
  const [failed, setFailed] = useState(false);

  const load = useCallback(async () => {
    setFailed(false);
    try {
      const res = await fetch("/api/portal/me");
      if (res.status === 401) {
        router.push(portalSignInHere());
        return;
      }
      if (!res.ok) throw new Error("me");
      const data = await res.json();
      setMe({ name: data.name ?? "", bio: data.bio ?? "", email: data.email ?? "" });
    } catch {
      setFailed(true);
    }
  }, [router]);

  useEffect(() => {
    load();
  }, [load]);

  const logout = async () => {
    await fetch("/api/portal/auth/logout", { method: "POST" }).catch(() => {});
    router.push("/portal/login");
  };

  return (
    <Screen title="Account">
      {failed && <LoadFailed what="your account" onRetry={load} />}
      {!me && !failed && <SkeletonBlock height={220} />}
      {me && (
        <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
          <ProfileForm initial={me} />
          <PasswordForm />
          <SectionCard
            icon={LogOut}
            title="Log out"
            padded={false}
            action={
              <Button variant="secondary" onClick={logout}>
                Log out
              </Button>
            }
          >
            {null}
          </SectionCard>
          <DeleteAccount />
        </div>
      )}
    </Screen>
  );
}
