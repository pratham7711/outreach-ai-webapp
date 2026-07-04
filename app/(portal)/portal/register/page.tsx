"use client";

import { Suspense, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import Link from "next/link";
import { Button, Input } from "@pratham7711/ui";
import { Eye, EyeOff } from "lucide-react";

/**
 * Run the join funnel after successful auth when ?join=[slug] is present.
 * Lands on the campaign portal page with ?joined=1, else the dashboard.
 */
async function runJoinAndRedirect(
  router: ReturnType<typeof useRouter>,
  joinSlug: string | null,
  inviteCode: string | null
) {
  if (!joinSlug) {
    router.push("/portal/campaigns");
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
    // Joined-auth succeeded but join failed (deadline/invite/private) — surface on the campaign page.
    const data = await res.json().catch(() => ({}));
    router.push(
      `/portal/campaigns/${joinSlug}?joinError=${encodeURIComponent(data.error ?? "Could not join")}`
    );
  } catch {
    router.push(`/portal/campaigns/${joinSlug}?joinError=${encodeURIComponent("Network error")}`);
  }
}

function RegisterInner() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const joinSlug = searchParams.get("join");
  const inviteCode = searchParams.get("invite");

  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [form, setForm] = useState({ email: "", password: "", name: "", handle: "" });
  const set = (patch: Partial<typeof form>) => setForm((f) => ({ ...f, ...patch }));

  const loginHref = `/portal/login${
    joinSlug ? `?join=${encodeURIComponent(joinSlug)}${inviteCode ? `&invite=${encodeURIComponent(inviteCode)}` : ""}` : ""
  }`;

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    setError("");
    try {
      const res = await fetch("/api/portal/auth/register", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          email: form.email,
          password: form.password,
          name: form.name,
          handle: form.handle,
        }),
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
        minHeight: "100vh",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        padding: "0 16px",
        background: "linear-gradient(135deg, #6C3EF4 0%, #4A8EF0 100%)",
      }}
    >
      <div
        style={{
          width: "100%",
          maxWidth: 420,
          background: "white",
          borderRadius: 16,
          padding: 32,
          boxShadow: "0 20px 60px rgba(0,0,0,0.15)",
        }}
      >
        <h1 style={{ fontSize: 24, fontWeight: 700, color: "var(--cc-text)", marginBottom: 4, textAlign: "center" }}>
          Create your creator account
        </h1>
        <p style={{ fontSize: 14, color: "var(--cc-text-muted)", marginBottom: 24, textAlign: "center" }}>
          {joinSlug ? "Sign up to join this campaign" : "Join the marketplace and start earning"}
        </p>

        {error && (
          <div style={{ padding: "10px 14px", borderRadius: 8, background: "#FEE2E2", color: "#DC2626", fontSize: 13, marginBottom: 16 }}>
            {error}
          </div>
        )}

        <form onSubmit={handleSubmit} style={{ display: "flex", flexDirection: "column", gap: 16 }}>
          <Input label="Full Name" value={form.name} onChange={(e) => set({ name: e.target.value })} placeholder="Your name" required />
          <Input label="Handle" value={form.handle} onChange={(e) => set({ handle: e.target.value })} placeholder="yourhandle (no spaces)" required />
          <Input label="Email" type="email" value={form.email} onChange={(e) => set({ email: e.target.value })} placeholder="creator@example.com" required />
          <div style={{ position: "relative" }}>
            <Input
              label="Password"
              type={showPassword ? "text" : "password"}
              value={form.password}
              onChange={(e) => set({ password: e.target.value })}
              placeholder="Min 8 characters"
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
            Create Account
          </Button>
        </form>

        <div style={{ textAlign: "center", marginTop: 20, fontSize: 14, color: "var(--cc-text-muted)" }}>
          Already have an account?{" "}
          <Link href={loginHref} style={{ color: "var(--cc-primary)", fontWeight: 600, textDecoration: "none" }}>
            Sign In
          </Link>
        </div>
      </div>
    </div>
  );
}

export default function PortalRegisterPage() {
  return (
    <Suspense fallback={null}>
      <RegisterInner />
    </Suspense>
  );
}
