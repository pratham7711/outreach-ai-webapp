"use client";
import { useCallback, useEffect, useState } from "react";
import { Input } from "@pratham7711/ui";
import { Building2 } from "lucide-react";
import { toast } from "sonner";
import { formatDateAbs } from "@/lib/format";
import { PLATFORM_DEFAULT_BRANDING } from "@/lib/brandingDefaults";
import { useDirty } from "@/lib/useDirty";
import { PageHeader, Dropdown, LoadError, Field, FieldRow, SettingsForm, Skeleton } from "@/components/ds";

type OrgProfile = {
  id: string;
  name: string;
  subdomain: string;
  brandName: string | null;
  timezone: string;
  currency: string;
  plan: string;
  planExpiresAt: string | null;
  logoUrl: string | null;
  faviconUrl: string | null;
  fontFamily: string;
  createdAt: string;
  canManageSettings?: boolean;
};

/* What this form edits, as the inputs hold it. The snapshot of it taken on
   load (and after each save) is what Cancel restores and what "dirty" is
   measured against. */
type ProfileForm = {
  name: string;
  brandName: string;
  timezone: string;
  currency: string;
  logoUrl: string;
  faviconUrl: string;
  fontFamily: string;
};

const CURRENCIES = ["USD", "EUR", "GBP", "INR"];
const TIMEZONES = ["UTC", "Asia/Kolkata", "America/New_York", "America/Los_Angeles", "Europe/London", "Europe/Paris", "Asia/Tokyo", "Asia/Singapore", "Australia/Sydney"];
const DEFAULT_FONT = PLATFORM_DEFAULT_BRANDING.fontFamily;

const toForm = (o: OrgProfile): ProfileForm => ({
  name: o.name,
  brandName: o.brandName ?? "",
  timezone: o.timezone,
  currency: o.currency,
  logoUrl: o.logoUrl ?? "",
  faviconUrl: o.faviconUrl ?? "",
  fontFamily: o.fontFamily,
});

const EMPTY: ProfileForm = {
  name: "",
  brandName: "",
  timezone: "UTC",
  currency: "USD",
  logoUrl: "",
  faviconUrl: "",
  fontFamily: DEFAULT_FONT,
};

const titleCase = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);

export default function OrgProfilePage() {
  const [org, setOrg] = useState<OrgProfile | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadFailed, setLoadFailed] = useState(false);
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  /* settings:manage, decided by /api/org rather than guessed here. PATCH
     refuses without it, so an editable form for a member who cannot save is a
     promise the API will not keep. */
  const [canManage, setCanManage] = useState(false);

  const [saved, setSaved] = useState<ProfileForm | null>(null);
  const [form, setForm] = useState<ProfileForm>(EMPTY);
  const dirty = useDirty(saved, form);
  const set = <K extends keyof ProfileForm>(key: K, value: ProfileForm[K]) => {
    setForm((f) => ({ ...f, [key]: value }));
    setSaveError(null);
  };

  /* The logo preview hides itself for the URL that failed to load, and comes
     back as soon as the URL changes. */
  const [brokenLogo, setBrokenLogo] = useState<string | null>(null);

  const load = useCallback(() => {
    setLoading(true);
    setLoadFailed(false);
    fetch("/api/org")
      .then((r) => {
        if (!r.ok) throw new Error(String(r.status));
        return r.json();
      })
      .then((data: OrgProfile) => {
        const loaded = toForm(data);
        setOrg(data);
        setCanManage(data.canManageSettings === true);
        setSaved(loaded);
        setForm(loaded);
      })
      .catch(() => setLoadFailed(true))
      .finally(() => setLoading(false));
  }, []);

  useEffect(load, [load]);

  const nameError = saved && !form.name.trim() ? "Enter the organization's name." : undefined;
  const isDefaultFont = form.fontFamily === DEFAULT_FONT;

  const save = async () => {
    if (!canManage || !dirty || nameError) return;
    const sent = form;
    setSaving(true);
    setSaveError(null);
    try {
      const res = await fetch("/api/org", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: sent.name,
          brandName: sent.brandName || null,
          timezone: sent.timezone,
          currency: sent.currency,
          logoUrl: sent.logoUrl || null,
          faviconUrl: sent.faviconUrl || null,
          fontFamily: sent.fontFamily,
          /* Bank details, the custom domain and the three brand colours left
             this form in October 2026 (nothing reads any of them now -- the
             themes own the app's colours). Not sending them is what keeps the
             stored values: /api/org writes only the keys it receives. */
        }),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(data.error ?? "The profile couldn't be saved. Try again.");
      }
      setSaved(sent);
      toast.success("Profile saved");
    } catch (e) {
      setSaveError(e instanceof Error ? e.message : "The profile couldn't be saved. Try again.");
    } finally {
      setSaving(false);
    }
  };

  const readOnly = !canManage;

  return (
    <div className="rsp-page page-enter">
      <PageHeader
        title="Profile"
        subtitle={
          canManage
            ? "Your organization's name, regional defaults and branding."
            : "Your workspace settings. Only an owner or admin can change them."
        }
      />

      {loading ? (
        <Skeleton width="100%" height={560} radius="var(--cc-r-card)" />
      ) : loadFailed || !org ? (
        <LoadError title="Couldn't load the profile" onRetry={load} />
      ) : (
        <SettingsForm
          icon={Building2}
          title="Workspace"
          description="Name, regional defaults and branding"
          dirty={dirty}
          saving={saving}
          invalid={Boolean(nameError)}
          readOnly={readOnly}
          onSubmit={save}
          onCancel={() => {
            if (saved) setForm(saved);
            setSaveError(null);
          }}
          status={saveError ? <span className="cc-form-error" role="alert">{saveError}</span> : null}
        >
          <Field label="Organization name" required error={nameError}>
            <Input
              value={form.name}
              onChange={(e) => set("name", e.target.value)}
              placeholder="Acme Inc."
              maxLength={100}
              disabled={readOnly}
            />
          </Field>
          <Field label="Brand name">
            <Input
              value={form.brandName}
              onChange={(e) => set("brandName", e.target.value)}
              placeholder="Optional display name"
              maxLength={100}
              disabled={readOnly}
            />
          </Field>
          <FieldRow>
            <Field label="Subdomain">
              <Input value={org.subdomain} readOnly />
            </Field>
            <Field
              label="Plan"
              helper={org.planExpiresAt ? `Expires ${formatDateAbs(org.planExpiresAt)}` : undefined}
            >
              <Input value={titleCase(org.plan ?? "starter")} readOnly />
            </Field>
          </FieldRow>
          <FieldRow>
            <Field label="Timezone">
              <Dropdown
                align="left"
                fullWidth
                value={form.timezone}
                onChange={(v) => set("timezone", v)}
                disabled={readOnly}
                options={TIMEZONES.map((tz) => ({ value: tz, label: tz }))}
              />
            </Field>
            <Field label="Default currency">
              <Dropdown
                align="left"
                fullWidth
                value={form.currency}
                onChange={(v) => set("currency", v)}
                disabled={readOnly}
                options={CURRENCIES.map((c) => ({ value: c, label: c }))}
              />
            </Field>
          </FieldRow>
          <Field label="Logo URL">
            <Input
              inputMode="url"
              value={form.logoUrl}
              onChange={(e) => set("logoUrl", e.target.value)}
              placeholder="https://..."
              disabled={readOnly}
              iconRight={
                form.logoUrl && brokenLogo !== form.logoUrl ? (
                  <img
                    src={form.logoUrl}
                    alt=""
                    className="cc-field-preview"
                    onError={() => setBrokenLogo(form.logoUrl)}
                  />
                ) : undefined
              }
            />
          </Field>
          <Field label="Favicon URL">
            <Input
              inputMode="url"
              value={form.faviconUrl}
              onChange={(e) => set("faviconUrl", e.target.value)}
              placeholder="https://..."
              disabled={readOnly}
            />
          </Field>
          <Field
            label="Font family"
            helper={
              isDefaultFont ? (
                "Using the default font."
              ) : (
                <>
                  The default is {DEFAULT_FONT}.{" "}
                  {!readOnly && (
                    <button
                      type="button"
                      className="cc-form-help__action"
                      onClick={() => set("fontFamily", DEFAULT_FONT)}
                    >
                      Use the default
                    </button>
                  )}
                </>
              )
            }
          >
            <Input
              value={form.fontFamily}
              onChange={(e) => set("fontFamily", e.target.value)}
              placeholder={DEFAULT_FONT}
              maxLength={100}
              disabled={readOnly}
            />
          </Field>
        </SettingsForm>
      )}
    </div>
  );
}
