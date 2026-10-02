"use client";
import { useState, useEffect } from "react";
import { Card, Input, Skeleton } from "@pratham7711/ui";
import { Building2, Type, Globe, Save } from "lucide-react";
import { formatDateAbs } from "@/lib/format";
import { PLATFORM_DEFAULT_BRANDING } from "@/lib/brandingDefaults";
import { PageHeader, Dropdown, Button } from "@/components/ds";

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

const CURRENCIES = ["USD", "EUR", "GBP", "INR"];
const TIMEZONES = ["UTC", "Asia/Kolkata", "America/New_York", "America/Los_Angeles", "Europe/London", "Europe/Paris", "Asia/Tokyo", "Asia/Singapore", "Australia/Sydney"];

function SectionHeader({ icon: Icon, title, description }: { icon: React.ElementType; title: string; description: string }) {
  return (
    <div style={{ display: "flex", alignItems: "center", gap: 12, marginBottom: 20 }}>
      <div style={{ width: 40, height: 40, borderRadius: 10, background: "var(--cc-primary-light)", display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0 }}>
        <Icon size={18} color="var(--cc-primary)" />
      </div>
      <div>
        <h2 style={{ fontSize: "var(--cc-t-15)", fontWeight: 700, color: "var(--cc-text)", margin: 0 }}>{title}</h2>
        <p style={{ fontSize: "var(--cc-t-13)", color: "var(--cc-text-muted)", margin: 0 }}>{description}</p>
      </div>
    </div>
  );
}

function FormRow({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="settings-form-row" style={{ display: "grid", gap: 8, alignItems: "start", paddingBottom: 16, borderBottom: "1px solid var(--cc-border)" }}>
      <label style={{ fontSize: "var(--cc-t-13)", fontWeight: 500, color: "var(--cc-text)" }}>{label}</label>
      <div style={{ minWidth: 0 }}>{children}</div>
    </div>
  );
}

export default function OrgProfilePage() {
  const [org, setOrg] = useState<OrgProfile | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [toast, setToast] = useState<string | null>(null);
  /* settings:manage, decided by /api/org rather than guessed here. PATCH
     refuses without it, so an editable form for a member who cannot save is a
     promise the API will not keep. */
  const [canManage, setCanManage] = useState(false);

  // Form state
  const [name, setName] = useState("");
  const [brandName, setBrandName] = useState("");
  const [timezone, setTimezone] = useState("UTC");
  const [currency, setCurrency] = useState("USD");
  const [logoUrl, setLogoUrl] = useState("");
  const [faviconUrl, setFaviconUrl] = useState("");
  const [fontFamily, setFontFamily] = useState<string>(PLATFORM_DEFAULT_BRANDING.fontFamily);
  const isDefaultFont = fontFamily === PLATFORM_DEFAULT_BRANDING.fontFamily;


  useEffect(() => {
    fetch("/api/org")
      .then(r => r.json())
      .then((data: OrgProfile) => {
        setOrg(data);
        setCanManage(data.canManageSettings === true);
        setName(data.name);
        setBrandName(data.brandName ?? "");
        setTimezone(data.timezone);
        setCurrency(data.currency);
        setLogoUrl(data.logoUrl ?? "");
        setFaviconUrl(data.faviconUrl ?? "");
        setFontFamily(data.fontFamily);
      })
      .catch(() => setError("Failed to load profile"))
      .finally(() => setLoading(false));
  }, []);

  const save = async () => {
    if (!canManage) return;
    setSaving(true);
    setError(null);
    try {
      const res = await fetch("/api/org", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: name || undefined,
          brandName: brandName || null,
          timezone,
          currency,
          logoUrl: logoUrl || null,
          faviconUrl: faviconUrl || null,
          fontFamily,
          /* Bank details, the custom domain and the three brand colours left
             this form in October 2026 (nothing reads any of them now -- the
             themes own the app's colours). Not sending them is what keeps the
             stored values: /api/org writes only the keys it receives. */
        }),
      });
      if (!res.ok) {
        const data = await res.json();
        throw new Error(data.error ?? "Save failed");
      }
      setToast("Profile saved");
      setTimeout(() => setToast(null), 3000);
    } catch (e: any) {
      setError(e.message);
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="rsp-page page-enter">
      <style>{`@media(min-width:768px){.settings-form-row{grid-template-columns:200px 1fr;gap:16px}.settings-form-row>label{padding-top:8px}}`}</style>
      {/* Toast */}
      {toast && (
        <div style={{
          position: "fixed", top: 20, right: 20, zIndex: 9999,
          background: "var(--cc-success)", color: "var(--cc-on-primary)", padding: "10px 18px",
          borderRadius: 8, fontSize: "var(--cc-t-14)", fontWeight: 500,
          boxShadow: "0 4px 12px color-mix(in srgb, var(--cc-shadow-ink) 15%, transparent)",
        }}>
          {toast}
        </div>
      )}

      <PageHeader
        title="Organization Profile"
        subtitle={
          canManage
            ? "Manage your workspace settings and branding"
            : "Your workspace settings. Only an owner or admin can change them."
        }
        actions={
          canManage ? (
            <Button variant="primary" onClick={save} disabled={saving || loading}>
              <Save size={14} style={{ marginRight: 6 }} />
              {saving ? "Saving…" : "Save Changes"}
            </Button>
          ) : null
        }
      />

      {error && (
        <div style={{ background: "color-mix(in srgb, var(--cc-danger) 14%, transparent)", border: "1px solid color-mix(in srgb, var(--cc-danger) 30%, transparent)", borderRadius: 8, padding: "12px 16px", marginBottom: 20, fontSize: "var(--cc-t-13)", color: "var(--cc-danger-ink)" }}>
          {error}
        </div>
      )}

      {loading ? (
        <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
          <Skeleton width="100%" height="200px" borderRadius="12px" />
          <Skeleton width="100%" height="200px" borderRadius="12px" />
          <Skeleton width="100%" height="200px" borderRadius="12px" />
        </div>
      ) : (
        <div style={{ display: "flex", flexDirection: "column", gap: 24 }}>

          {/* General */}
          <Card variant="outlined" style={{ padding: 24 }}>
            <SectionHeader icon={Building2} title="General" description="Basic organization details" />
            <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
              <FormRow label="Organization Name">
                <Input value={name} onChange={e => setName(e.target.value)} placeholder="Acme Inc." disabled={!canManage} />
              </FormRow>
              <FormRow label="Brand Name">
                <Input value={brandName} onChange={e => setBrandName(e.target.value)} placeholder="Optional display name" disabled={!canManage} />
              </FormRow>
              <FormRow label="Subdomain">
                <div style={{ display: "flex", alignItems: "center", gap: 8, paddingTop: 8 }}>
                  <span style={{ fontSize: "var(--cc-t-13)", color: "var(--cc-text-muted)", background: "var(--cc-bg)", border: "1px solid var(--cc-border)", borderRadius: 6, padding: "7px 12px" }}>
                    {org?.subdomain ?? "—"}
                  </span>
                  <span style={{ fontSize: "var(--cc-t-12)", color: "var(--cc-text-muted)" }}>Read-only</span>
                </div>
              </FormRow>
              <FormRow label="Timezone">
                <Dropdown
                  ariaLabel="Timezone"
                  align="left"
                  fullWidth
                  value={timezone}
                  onChange={setTimezone}
                  disabled={!canManage}
                  options={TIMEZONES.map(tz => ({ value: tz, label: tz }))}
                />
              </FormRow>
              <FormRow label="Default Currency">
                <Dropdown
                  ariaLabel="Default currency"
                  align="left"
                  fullWidth
                  value={currency}
                  onChange={setCurrency}
                  disabled={!canManage}
                  options={CURRENCIES.map(c => ({ value: c, label: c }))}
                />
              </FormRow>
              <FormRow label="Current Plan">
                <div style={{ display: "flex", alignItems: "center", gap: 8, paddingTop: 6 }}>
                  <span style={{ fontSize: "var(--cc-t-12)", fontWeight: "var(--cc-fw-strong)", padding: "3px 10px", borderRadius: 12, background: "var(--cc-primary-light)", color: "var(--cc-primary)", textTransform: "capitalize" }}>
                    {org?.plan ?? "starter"}
                  </span>
                  {org?.planExpiresAt && (
                    <span style={{ fontSize: "var(--cc-t-12)", color: "var(--cc-text-muted)" }}>
                      Expires {formatDateAbs(org.planExpiresAt)}
                    </span>
                  )}
                </div>
              </FormRow>
            </div>
          </Card>

          {/* Domain & Assets */}
          <Card variant="outlined" style={{ padding: 24 }}>
            <SectionHeader icon={Globe} title="Domain & Assets" description="Logo and favicon" />
            <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
              <FormRow label="Logo URL">
                <div style={{ display: "flex", gap: 12, alignItems: "center" }}>
                  <Input value={logoUrl} onChange={e => setLogoUrl(e.target.value)} placeholder="https://..." style={{ flex: 1 }} disabled={!canManage} />
                  {logoUrl && <img src={logoUrl} alt="Logo preview" style={{ width: 40, height: 40, borderRadius: 8, objectFit: "cover", border: "1px solid var(--cc-border)" }} onError={e => (e.currentTarget.style.display = "none")} />}
                </div>
              </FormRow>
              <FormRow label="Favicon URL">
                <Input value={faviconUrl} onChange={e => setFaviconUrl(e.target.value)} placeholder="https://..." disabled={!canManage} />
              </FormRow>
            </div>
          </Card>

          {/* Branding */}
          <Card variant="outlined" style={{ padding: 24 }}>
            <SectionHeader icon={Type} title="Branding" description="The typeface your workspace uses" />
            <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
              <FormRow label="Font Family">
                <Input value={fontFamily} onChange={e => setFontFamily(e.target.value)} placeholder="Inter" disabled={!canManage} />
              </FormRow>
              <div style={{ display: "flex", alignItems: "center", gap: 12, flexWrap: "wrap", borderTop: "1px solid var(--cc-border)", paddingTop: 16 }}>
                <Button
                  variant="secondary"
                  size="sm"
                  type="button"
                  disabled={isDefaultFont || !canManage}
                  onClick={() => setFontFamily(PLATFORM_DEFAULT_BRANDING.fontFamily)}
                >
                  Reset to default
                </Button>
                <span style={{ fontSize: "var(--cc-t-12)", color: "var(--cc-text-muted)" }}>
                  {isDefaultFont
                    ? "Using the default font."
                    : "Restores the default font. Save to apply."}
                </span>
              </div>
            </div>
          </Card>


        </div>
      )}
    </div>
  );
}
