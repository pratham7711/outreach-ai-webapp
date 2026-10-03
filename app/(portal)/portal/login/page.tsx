"use client";

import { Suspense, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import Link from "next/link";
import { LegalLinks } from "@/components/LegalLinks";
import { Input } from "@pratham7711/ui";
import { Button } from "@/components/ds";
import { Eye, EyeOff } from "lucide-react";
import { errandQuery, landingAfterAuth, readAuthErrand } from "@/lib/portal/afterAuth";

function LoginInner() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const errand = readAuthErrand(searchParams);

  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [form, setForm] = useState({ email: "", password: "" });
  const set = (patch: Partial<typeof form>) => setForm((f) => ({ ...f, ...patch }));

  const registerHref = `/portal/register${errandQuery(errand)}`;

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    setError("");
    try {
      const res = await fetch("/api/portal/auth/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(form),
      });
      const data = await res.json();
      if (res.ok) {
        router.push(await landingAfterAuth(errand, "/portal/dashboard"));
      } else {
        setError(data.error ?? "Something went wrong");
        setLoading(false);
      }
    } catch {
      setError("Network error");
      setLoading(false);
    }
  };

  return (
    <div
      style={{
        minHeight: "100dvh",
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        justifyContent: "center",
        gap: 16,
        padding: "40px 16px",
        background: "var(--cc-bg)",
      }}
    >
      <div
        style={{
          width: "100%",
          maxWidth: 420,
          background: "var(--cc-card)",
          border: "1px solid var(--cc-border)",
          borderRadius: 20,
          padding: 32,
          boxShadow: "var(--ui-shadow-lg)",
        }}
      >
        <h1 style={{ fontSize: 24, fontWeight: 700, color: "var(--cc-text)", marginBottom: 4, textAlign: "center" }}>
          Creator Portal
        </h1>
        <p style={{ fontSize: 14, color: "var(--cc-text-muted)", marginBottom: 24, textAlign: "center" }}>
          {errand.invitation
            ? "Log in to accept your invitation"
            : errand.join
              ? "Sign in to join this campaign"
              : errand.connect
                ? "Sign in to see the accounts you connected"
                : "Sign in to your creator account"}
        </p>

        {error && (
          <div style={{ padding: "10px 14px", borderRadius: 8, background: "color-mix(in srgb, var(--cc-danger) 12%, transparent)", color: "var(--cc-danger)", fontSize: 13, marginBottom: 16 }}>
            {error}
          </div>
        )}

        <form onSubmit={handleSubmit} style={{ display: "flex", flexDirection: "column", gap: 16 }}>
          <Input label="Email" type="email" value={form.email} onChange={(e) => set({ email: e.target.value })} placeholder="creator@example.com" required />
          <div style={{ position: "relative" }}>
            <Input
              label="Password"
              type={showPassword ? "text" : "password"}
              value={form.password}
              onChange={(e) => set({ password: e.target.value })}
              placeholder="Enter password"
              required
            />
            <button
              type="button"
              onClick={() => setShowPassword(!showPassword)}
              aria-label={showPassword ? "Hide password" : "Show password"}
              style={{ position: "absolute", right: 12, bottom: 19, transform: "translateY(50%)", padding: 4, display: "flex", alignItems: "center", background: "none", border: "none", cursor: "pointer", color: "var(--cc-text-muted)" }}
            >
              {showPassword ? <EyeOff size={16} /> : <Eye size={16} />}
            </button>
          </div>
          <Button variant="primary" loading={loading} style={{ width: "100%", marginTop: 8 }}>
            Sign In
          </Button>
        </form>

        <div style={{ textAlign: "center", marginTop: 20, fontSize: 14, color: "var(--cc-text-muted)" }}>
          Don&apos;t have an account?{" "}
          <Link href={registerHref} style={{ color: "var(--cc-primary)", fontWeight: 600, textDecoration: "none" }}>
            Register
          </Link>
        </div>
      </div>
      <LegalLinks />
    </div>
  );
}

export default function PortalLoginPage() {
  return (
    <Suspense fallback={null}>
      <LoginInner />
    </Suspense>
  );
}
