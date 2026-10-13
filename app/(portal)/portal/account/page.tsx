"use client";

import { useCallback, useEffect, useState, type CSSProperties, type FormEvent } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Button } from "@/components/ds";
import { BRAND } from "@/lib/brand";
import { Card, LoadFailed, Screen, SectionTitle, SkeletonBlock } from "@/components/portal/app/ui";
import { portalSignInHere } from "@/lib/callbackPath";

/* 16px text so a phone does not zoom into the field on focus, and 44px tall so
   it is an honest touch target. */
const fieldStyle: CSSProperties = {
  width: "100%",
  minHeight: 44,
  padding: "10px 12px",
  borderRadius: 10,
  border: "1px solid var(--cc-border)",
  background: "var(--cc-card)",
  color: "var(--cc-text)",
  fontSize: 16,
  boxSizing: "border-box",
};
const labelStyle: CSSProperties = { display: "block", fontSize: 13, fontWeight: 600, color: "var(--cc-text)", marginBottom: 6 };
const formStyle: CSSProperties = { display: "flex", flexDirection: "column", gap: 14 };

function Field({
  id,
  label,
  hint,
  children,
}: {
  id: string;
  label: string;
  hint?: string;
  children: React.ReactNode;
}) {
  return (
    <div>
      <label htmlFor={id} style={labelStyle}>
        {label}
      </label>
      {children}
      {hint && <p style={{ fontSize: 12, color: "var(--cc-text-muted)", margin: "6px 0 0" }}>{hint}</p>}
    </div>
  );
}

function ProfileForm({ initial }: { initial: { name: string; bio: string; email: string } }) {
  const [name, setName] = useState(initial.name);
  const [bio, setBio] = useState(initial.bio);
  const [saving, setSaving] = useState(false);

  /* Only name and bio. The handle is how agencies find the creator's roster
     row and the platform/niches/bank fields belong to screens that are parked,
     so this form never sends them. */
  const save = async (e: FormEvent) => {
    e.preventDefault();
    if (!name.trim()) {
      toast.error("Your name can't be empty");
      return;
    }
    setSaving(true);
    try {
      const res = await fetch("/api/portal/me", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: name.trim(), bio }),
      });
      const data = await res.json().catch(() => ({}));
      if (res.ok) toast.success("Saved");
      else toast.error(data.error ?? "Couldn't save");
    } catch {
      toast.error("Network error. Try again.");
    } finally {
      setSaving(false);
    }
  };

  return (
    <form onSubmit={save} style={formStyle}>
      <Field id="acct-email" label="Email" hint="The address you log in with.">
        <input id="acct-email" value={initial.email} readOnly style={{ ...fieldStyle, color: "var(--cc-text-muted)" }} />
      </Field>
      <Field id="acct-name" label="Name">
        <input id="acct-name" value={name} onChange={(e) => setName(e.target.value)} autoComplete="name" style={fieldStyle} />
      </Field>
      <Field id="acct-bio" label="Bio" hint="Agencies see this beside your campaign posts.">
        <textarea id="acct-bio" value={bio} onChange={(e) => setBio(e.target.value)} rows={3} style={{ ...fieldStyle, resize: "vertical" }} />
      </Field>
      <div>
        <Button type="submit" variant="primary" loading={saving}>
          Save
        </Button>
      </div>
    </form>
  );
}

function PasswordForm() {
  const [current, setCurrent] = useState("");
  const [next, setNext] = useState("");
  const [saving, setSaving] = useState(false);

  const change = async (e: FormEvent) => {
    e.preventDefault();
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
    <form onSubmit={change} style={formStyle}>
      <Field id="pw-current" label="Current password">
        <input id="pw-current" type="password" value={current} onChange={(e) => setCurrent(e.target.value)} autoComplete="current-password" style={fieldStyle} />
      </Field>
      <Field id="pw-new" label="New password" hint="At least 8 characters.">
        <input id="pw-new" type="password" value={next} onChange={(e) => setNext(e.target.value)} autoComplete="new-password" style={fieldStyle} />
      </Field>
      <div>
        <Button type="submit" variant="secondary" loading={saving} disabled={!current || !next}>
          Change password
        </Button>
      </div>
      <p style={{ fontSize: 13, color: "var(--cc-text-muted)", margin: 0 }}>
        Forgot it? There is no reset email. Write to{" "}
        <a href={`mailto:${BRAND.contactEmail}`} style={{ color: "var(--cc-primary)", textDecoration: "underline" }}>
          {BRAND.contactEmail}
        </a>{" "}
        from the address you sign in with.
      </p>
    </form>
  );
}

function DeleteAccount() {
  const router = useRouter();
  const [password, setPassword] = useState("");
  const [typed, setTyped] = useState("");
  const [deleting, setDeleting] = useState(false);

  const remove = async (e: FormEvent) => {
    e.preventDefault();
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

  return (
    <form onSubmit={remove} style={formStyle}>
      <div style={{ fontSize: 14, color: "var(--cc-text)", lineHeight: 1.55 }}>
        <p style={{ margin: "0 0 6px" }}>This deletes, straight away:</p>
        <ul style={{ margin: 0, paddingLeft: 18 }}>
          <li>your login,</li>
          <li>every account you connected, and our access to it,</li>
          <li>the numbers we read from those accounts.</li>
        </ul>
        <p style={{ margin: "8px 0 0" }}>
          Posts you submitted to a campaign stay with that campaign&apos;s agency, which holds its own records. See{" "}
          <a href="/data-deletion" style={{ color: "var(--cc-primary)", textDecoration: "underline" }}>
            how deletion works
          </a>
          .
        </p>
      </div>
      <Field id="del-password" label="Your password">
        <input id="del-password" type="password" value={password} onChange={(e) => setPassword(e.target.value)} autoComplete="current-password" style={fieldStyle} />
      </Field>
      <Field id="del-confirm" label='Type DELETE to confirm'>
        <input id="del-confirm" value={typed} onChange={(e) => setTyped(e.target.value)} autoCapitalize="characters" autoComplete="off" style={fieldStyle} />
      </Field>
      <div>
        <Button type="submit" variant="danger" loading={deleting} disabled={!password || typed !== "DELETE"}>
          Delete my account and data
        </Button>
      </div>
    </form>
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
    <Screen title="Account" subtitle="Your profile, password, and your data.">
      {failed && <LoadFailed what="your account" onRetry={load} />}
      {!me && !failed && <SkeletonBlock height={220} />}
      {me && (
        <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
          <Card>
            <SectionTitle>Profile</SectionTitle>
            <ProfileForm initial={me} />
          </Card>
          <Card>
            <SectionTitle>Password</SectionTitle>
            <PasswordForm />
          </Card>
          <Card>
            <SectionTitle>Log out</SectionTitle>
            <p style={{ fontSize: 14, color: "var(--cc-text-muted)", margin: "0 0 12px" }}>Logs you out on this device.</p>
            <Button variant="secondary" onClick={logout}>
              Log out
            </Button>
          </Card>
          <Card>
            <SectionTitle>Delete my account and data</SectionTitle>
            <DeleteAccount />
          </Card>
        </div>
      )}
    </Screen>
  );
}
