"use client";
import { useState, useEffect } from "react";
import { Card, Button, Input, Skeleton } from "@pratham7711/ui";
import { Building2, Palette, Landmark, Globe, Save } from "lucide-react";

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
  bankAccountName: string | null;
  bankAccountNumber: string | null;
  bankIFSC: string | null;
  bankSwift: string | null;
  bankRoutingNumber: string | null;
  createdAt: string;
};

const CURRENCIES = ["USD", "EUR", "GBP", "INR"];
const TIMEZONES = ["UTC", "Asia/Kolkata", "America/New_York", "America/Los_Angeles", "Europe/London", "Europe/Paris", "Asia/Tokyo", "Asia/Singapore", "Australia/Sydney"];

function SectionHeader({ icon: Icon, title, description }: { icon: React.ElementType; title: string; description: string }) {
  return (
    <div style={{ display: "flex", alignItems: "center", gap: 12, marginBottom: 20 }}>
      <div style={{ width: 40, height: 40, borderRadius: 10, background: "rgba(91,91,214,0.08)", display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0 }}>
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

  // Form state
  const [name, setName] = useState("");
  const [brandName, setBrandName] = useState("");
  const [timezone, setTimezone] = useState("UTC");
  const [currency, setCurrency] = useState("USD");
  const [logoUrl, setLogoUrl] = useState("");
  const [faviconUrl, setFaviconUrl] = useState("");
  const [customDomain, setCustomDomain] = useState("");
  const [primaryColor, setPrimaryColor] = useState("#5B5BD6");
  const [secondaryColor, setSecondaryColor] = useState("#1E1B4B");
  const [accentColor, setAccentColor] = useState("#F59E0B");
  const [fontFamily, setFontFamily] = useState("Inter");
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
          background: "#059669", color: "white", padding: "10px 18px",
          borderRadius: 8, fontSize: 14, fontWeight: 500,
          boxShadow: "0 4px 12px rgba(0,0,0,0.15)",
        }}>
          {toast}
        </div>
      )}

      <div className="rsp-header">
        <div>
          <h1 style={{ fontSize: 26, fontWeight: 700, color: "var(--cc-text)", marginBottom: 4 }}>Organization Profile</h1>
          <p style={{ fontSize: 14, color: "var(--cc-text-muted)" }}>Manage your workspace settings, branding, and bank details</p>
        </div>
        <Button variant="primary" onClick={save} disabled={saving || loading}>
          <Save size={14} style={{ marginRight: 6 }} />
          {saving ? "Saving…" : "Save Changes"}
        </Button>
      </div>

      {error && (
        <div style={{ background: "#FEE2E2", border: "1px solid #FECACA", borderRadius: 8, padding: "12px 16px", marginBottom: 20, fontSize: 13, color: "#DC2626" }}>
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
                <Input value={name} onChange={e => setName(e.target.value)} placeholder="Acme Inc." />
              </FormRow>
              <FormRow label="Brand Name">
                <Input value={brandName} onChange={e => setBrandName(e.target.value)} placeholder="Optional display name" />
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
                <select
                  value={timezone}
                  onChange={e => setTimezone(e.target.value)}
                  style={{ width: "100%", padding: "8px 12px", borderRadius: 8, border: "1px solid var(--cc-border)", fontSize: 13, color: "var(--cc-text)", background: "var(--cc-card)", outline: "none" }}
                >
                  {TIMEZONES.map(tz => <option key={tz} value={tz}>{tz}</option>)}
                </select>
              </FormRow>
              <FormRow label="Default Currency">
                <select
                  value={currency}
                  onChange={e => setCurrency(e.target.value)}
                  style={{ width: "100%", padding: "8px 12px", borderRadius: 8, border: "1px solid var(--cc-border)", fontSize: 13, color: "var(--cc-text)", background: "var(--cc-card)", outline: "none" }}
                >
                  {CURRENCIES.map(c => <option key={c} value={c}>{c}</option>)}
                </select>
              </FormRow>
              <FormRow label="Current Plan">
                <div style={{ display: "flex", alignItems: "center", gap: 8, paddingTop: 6 }}>
                  <span style={{ fontSize: 12, fontWeight: 600, padding: "3px 10px", borderRadius: 12, background: "#EEF2FF", color: "#4F46E5", textTransform: "capitalize" }}>
                    {org?.plan ?? "starter"}
                  </span>
                  {org?.planExpiresAt && (
                    <span style={{ fontSize: 12, color: "var(--cc-text-muted)" }}>
                      Expires {new Date(org.planExpiresAt).toLocaleDateString()}
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
                  <Input value={logoUrl} onChange={e => setLogoUrl(e.target.value)} placeholder="https://..." style={{ flex: 1 }} />
                  {logoUrl && <img src={logoUrl} alt="Logo preview" style={{ width: 40, height: 40, borderRadius: 8, objectFit: "cover", border: "1px solid var(--cc-border)" }} onError={e => (e.currentTarget.style.display = "none")} />}
                </div>
              </FormRow>
              <FormRow label="Favicon URL">
                <Input value={faviconUrl} onChange={e => setFaviconUrl(e.target.value)} placeholder="https://..." />
              </FormRow>
              <FormRow label="Custom Domain">
                <Input value={customDomain} onChange={e => setCustomDomain(e.target.value)} placeholder="app.yourdomain.com" />
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
                      style={{ width: 40, height: 36, borderRadius: 6, border: "1px solid var(--cc-border)", cursor: "pointer", padding: 2, background: "var(--cc-card)" }}
                    />
                    <Input
                      value={value}
                      onChange={e => set(e.target.value)}
                      placeholder="#5B5BD6"
                      style={{ width: 120 }}
                    />
                    <div style={{ width: 28, height: 28, borderRadius: 6, background: value, border: "1px solid var(--cc-border)" }} />
                  </div>
                </FormRow>
              ))}
              <FormRow label="Font Family">
                <Input value={fontFamily} onChange={e => setFontFamily(e.target.value)} placeholder="Inter" />
              </FormRow>
            </div>
          </Card>

          {/* Bank Details */}
          <Card variant="outlined" style={{ padding: 24 }}>
            <SectionHeader icon={Landmark} title="Bank Details" description="Used for payouts and financial reports" />
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

        </div>
      )}
    </div>
  );
}
