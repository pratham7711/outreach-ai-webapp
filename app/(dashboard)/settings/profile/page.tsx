"use client";
import { useState, useEffect } from "react";
import { Card, Input, Skeleton } from "@pratham7711/ui";
import { Building2, Palette, Landmark, Globe, Save } from "lucide-react";
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
  customDomain: string | null;
  primaryColor: string;
  secondaryColor: string;
  accentColor: string;
  fontFamily: string;
  /* Absent unless the viewer has settings:manage — /api/org leaves the bank
     block out of its SELECT for everyone else rather than fetching it and
     trimming the response. */
  bankAccountName?: string | null;
  bankAccountNumber?: string | null;
  bankIFSC?: string | null;
  bankSwift?: string | null;
  bankRoutingNumber?: string | null;
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
        <h2 style={{ fontSize: 15, fontWeight: 700, color: "var(--cc-text)", margin: 0 }}>{title}</h2>
        <p style={{ fontSize: 13, color: "var(--cc-text-muted)", margin: 0 }}>{description}</p>
      </div>
    </div>
  );
}

function FormRow({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="settings-form-row" style={{ display: "grid", gap: 8, alignItems: "start", paddingBottom: 16, borderBottom: "1px solid var(--cc-border)" }}>
      <label style={{ fontSize: 13, fontWeight: 500, color: "var(--cc-text)" }}>{label}</label>
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
  const [customDomain, setCustomDomain] = useState("");
  const [primaryColor, setPrimaryColor] = useState<string>(PLATFORM_DEFAULT_BRANDING.primaryColor);
  const [secondaryColor, setSecondaryColor] = useState<string>(PLATFORM_DEFAULT_BRANDING.secondaryColor);
  const [accentColor, setAccentColor] = useState<string>(PLATFORM_DEFAULT_BRANDING.accentColor);
  const [fontFamily, setFontFamily] = useState<string>(PLATFORM_DEFAULT_BRANDING.fontFamily);
  const isDefaultBranding =
    primaryColor === PLATFORM_DEFAULT_BRANDING.primaryColor &&
    secondaryColor === PLATFORM_DEFAULT_BRANDING.secondaryColor &&
    accentColor === PLATFORM_DEFAULT_BRANDING.accentColor &&
    fontFamily === PLATFORM_DEFAULT_BRANDING.fontFamily;

  const [bankAccountName, setBankAccountName] = useState("");
  const [bankAccountNumber, setBankAccountNumber] = useState("");
  const [bankIFSC, setBankIFSC] = useState("");
  const [bankSwift, setBankSwift] = useState("");
  const [bankRoutingNumber, setBankRoutingNumber] = useState("");

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
        setCustomDomain(data.customDomain ?? "");
        setPrimaryColor(data.primaryColor);
        setSecondaryColor(data.secondaryColor);
        setAccentColor(data.accentColor);
        setFontFamily(data.fontFamily);
        setBankAccountName(data.bankAccountName ?? "");
        setBankAccountNumber(data.bankAccountNumber ?? "");
        setBankIFSC(data.bankIFSC ?? "");
        setBankSwift(data.bankSwift ?? "");
        setBankRoutingNumber(data.bankRoutingNumber ?? "");
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
          customDomain: customDomain || null,
          primaryColor,
          secondaryColor,
          accentColor,
          fontFamily,
          bankAccountName: bankAccountName || null,
          bankAccountNumber: bankAccountNumber || null,
          bankIFSC: bankIFSC || null,
          bankSwift: bankSwift || null,
          bankRoutingNumber: bankRoutingNumber || null,
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
          background: "var(--cc-success)", color: "white", padding: "10px 18px",
          borderRadius: 8, fontSize: 14, fontWeight: 500,
          boxShadow: "0 4px 12px rgba(0,0,0,0.15)",
        }}>
          {toast}
        </div>
      )}

      <PageHeader
        title="Organization Profile"
        subtitle={
          canManage
            ? "Manage your workspace settings, branding, and bank details"
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
        <div style={{ background: "color-mix(in srgb, var(--cc-danger) 14%, transparent)", border: "1px solid color-mix(in srgb, var(--cc-danger) 30%, transparent)", borderRadius: 8, padding: "12px 16px", marginBottom: 20, fontSize: 13, color: "var(--cc-danger)" }}>
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
                  <span style={{ fontSize: 13, color: "var(--cc-text-muted)", background: "var(--cc-bg)", border: "1px solid var(--cc-border)", borderRadius: 6, padding: "7px 12px" }}>
                    {org?.subdomain ?? "—"}
                  </span>
                  <span style={{ fontSize: 12, color: "var(--cc-text-muted)" }}>Read-only</span>
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
                  <span style={{ fontSize: 12, fontWeight: 600, padding: "3px 10px", borderRadius: 12, background: "var(--cc-primary-light)", color: "var(--cc-primary)", textTransform: "capitalize" }}>
                    {org?.plan ?? "starter"}
                  </span>
                  {org?.planExpiresAt && (
                    <span style={{ fontSize: 12, color: "var(--cc-text-muted)" }}>
                      Expires {formatDateAbs(org.planExpiresAt)}
                    </span>
                  )}
                </div>
              </FormRow>
            </div>
          </Card>

          {/* Domain & Assets */}
          <Card variant="outlined" style={{ padding: 24 }}>
            <SectionHeader icon={Globe} title="Domain & Assets" description="Logo, favicon, and custom domain" />
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
              {/* Disabled, not removed. Organization.customDomain is written by
                  this form and read by nothing: no route, no middleware, no
                  tenant resolution. An editable box for a setting that does
                  nothing is a promise the product does not keep. The value
                  already stored is preserved — it is still sent on save. */}
              <FormRow label="Custom Domain">
                <Input
                  value={customDomain}
                  onChange={e => setCustomDomain(e.target.value)}
                  placeholder="app.yourdomain.com"
                  disabled
                  aria-describedby="custom-domain-note"
                />
                <p id="custom-domain-note" style={{ fontSize: 12, color: "var(--cc-text-muted)", marginTop: 6 }}>
                  Not available yet — nothing serves the app from a custom domain today.
                  Any value already saved here is kept.
                </p>
              </FormRow>
            </div>
          </Card>

          {/* Branding */}
          <Card variant="outlined" style={{ padding: 24 }}>
            <SectionHeader icon={Palette} title="Branding" description="Colors and typography for your workspace" />
            <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
              {[
                { label: "Primary Color", value: primaryColor, set: setPrimaryColor },
                { label: "Secondary Color", value: secondaryColor, set: setSecondaryColor },
                { label: "Accent Color", value: accentColor, set: setAccentColor },
              ].map(({ label, value, set }) => (
                <FormRow key={label} label={label}>
                  <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
                    <input
                      type="color"
                      value={value}
                      onChange={e => set(e.target.value)}
                      aria-label={label}
                      disabled={!canManage}
                      style={{ width: 40, height: 36, borderRadius: 6, border: "1px solid var(--cc-border)", cursor: "pointer", padding: 2, background: "var(--cc-card)" }}
                    />
                    <Input
                      value={value}
                      onChange={e => set(e.target.value)}
                      placeholder="#5B5BD6"
                      style={{ width: 120 }}
                      disabled={!canManage}
                    />
                    <div style={{ width: 28, height: 28, borderRadius: 6, background: value, border: "1px solid var(--cc-border)" }} />
                  </div>
                </FormRow>
              ))}
              <FormRow label="Font Family">
                <Input value={fontFamily} onChange={e => setFontFamily(e.target.value)} placeholder="Inter" disabled={!canManage} />
              </FormRow>
              <div style={{ display: "flex", alignItems: "center", gap: 12, flexWrap: "wrap", borderTop: "1px solid var(--cc-border)", paddingTop: 16 }}>
                <Button
                  variant="secondary"
                  size="sm"
                  type="button"
                  disabled={isDefaultBranding || !canManage}
                  onClick={() => {
                    setPrimaryColor(PLATFORM_DEFAULT_BRANDING.primaryColor);
                    setSecondaryColor(PLATFORM_DEFAULT_BRANDING.secondaryColor);
                    setAccentColor(PLATFORM_DEFAULT_BRANDING.accentColor);
                    setFontFamily(PLATFORM_DEFAULT_BRANDING.fontFamily);
                  }}
                >
                  Reset to default
                </Button>
                <span style={{ fontSize: 12, color: "var(--cc-text-muted)" }}>
                  {isDefaultBranding
                    ? "Using the default palette."
                    : "Restores the default palette. Save to apply."}
                </span>
              </div>
            </div>
          </Card>

          {/* Bank Details. Owner/admin only — /api/org does not even SELECT
              these columns for anyone else, so there is nothing to render. */}
          {canManage && (
          <Card variant="outlined" style={{ padding: 24 }}>
            {/* The description used to say "Used for payouts and financial
                reports". These five columns are written here and read back by
                /api/org and this form only — no invoice, report or payout
                surface touches them. Say where they actually go, which is
                nowhere yet. */}
            <SectionHeader
              icon={Landmark}
              title="Bank Details"
              description="Your organization's own account, for invoices — coming soon"
            />
            <p style={{ fontSize: 12, color: "var(--cc-text-muted)", margin: "-8px 0 16px" }}>
              Stored for when invoicing lands. Nothing displays these today. Creator
              payout details are separate — each creator enters their own in the creator
              portal.
            </p>
            <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
              <FormRow label="Account Name">
                <Input value={bankAccountName} onChange={e => setBankAccountName(e.target.value)} placeholder="Account holder name" />
              </FormRow>
              <FormRow label="Account Number">
                <Input value={bankAccountNumber} onChange={e => setBankAccountNumber(e.target.value)} placeholder="•••• •••• ••••" type="password" />
              </FormRow>
              <FormRow label="IFSC Code">
                <Input value={bankIFSC} onChange={e => setBankIFSC(e.target.value)} placeholder="SBIN0001234" />
              </FormRow>
              <FormRow label="SWIFT / BIC">
                <Input value={bankSwift} onChange={e => setBankSwift(e.target.value)} placeholder="SBININBB" />
              </FormRow>
              <FormRow label="Routing Number">
                <Input value={bankRoutingNumber} onChange={e => setBankRoutingNumber(e.target.value)} placeholder="For US wire transfers" />
              </FormRow>
            </div>
          </Card>
          )}

        </div>
      )}
    </div>
  );
}
