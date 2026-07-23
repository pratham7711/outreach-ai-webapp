"use client";

import { Suspense, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import Link from "next/link";
import { Button, Input } from "@pratham7711/ui";
import { Eye, EyeOff } from "lucide-react";

/**
 * Run the join funnel after successful auth when ?join=[slug] is present.
 * Lands on the campaign portal page with ?joined=1, else "My campaigns".
 */
async function runJoinAndRedirect(
  router: ReturnType<typeof useRouter>,
  joinSlug: string | null,
  inviteCode: string | null
) {
  if (!joinSlug) {
    router.push("/portal/dashboard");
    return;
  }
  try {
    const res = await fetch("/api/portal/campaigns/join", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ slug: joinSlug, ...(inviteCode ? { inviteCode } : {}) }),
    });
    if (res.ok) {
      router.push(`/portal/campaigns/${joinSlug}?joined=1`);
      return;
    }
    const data = await res.json().catch(() => ({}));
    router.push(
      `/portal/campaigns/${joinSlug}?joinError=${encodeURIComponent(data.error ?? "Could not join")}`
    );
  } catch {
    router.push(`/portal/campaigns/${joinSlug}?joinError=${encodeURIComponent("Network error")}`);
  }
}

function LoginInner() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const joinSlug = searchParams.get("join");
  const inviteCode = searchParams.get("invite");

  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [form, setForm] = useState({ email: "", password: "" });
  const set = (patch: Partial<typeof form>) => setForm((f) => ({ ...f, ...patch }));

  const registerHref = `/portal/register${
    joinSlug ? `?join=${encodeURIComponent(joinSlug)}${inviteCode ? `&invite=${encodeURIComponent(inviteCode)}` : ""}` : ""
  }`;

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
        await runJoinAndRedirect(router, joinSlug, inviteCode);
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
        alignItems: "center",
        justifyContent: "center",
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
          {joinSlug ? "Sign in to join this campaign" : "Sign in to your creator account"}
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
              style={{ position: "absolute", right: 12, top: 34, background: "none", border: "none", cursor: "pointer", color: "var(--cc-text-muted)" }}
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
