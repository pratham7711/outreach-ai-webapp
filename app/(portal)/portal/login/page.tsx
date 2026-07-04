"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Button, Input } from "@pratham7711/ui";
import { Eye, EyeOff } from "lucide-react";

export default function PortalLoginPage() {
  const router = useRouter();
  const [mode, setMode] = useState<"login" | "register">("login");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [form, setForm] = useState({ email: "", password: "", name: "", handle: "" });

  const set = (patch: Partial<typeof form>) => setForm(f => ({ ...f, ...patch }));

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    setError("");

    const endpoint = mode === "login" ? "/api/portal/auth/login" : "/api/portal/auth/register";
    const body = mode === "login"
      ? { email: form.email, password: form.password }
      : { email: form.email, password: form.password, name: form.name, handle: form.handle };

    try {
      const res = await fetch(endpoint, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      const data = await res.json();
      if (res.ok) {
        router.push("/portal/dashboard");
      } else {
        setError(data.error ?? "Something went wrong");
      }
    } catch {
      setError("Network error");
    } finally {
      setLoading(false);
    }
  };

  return (
    <div style={{
      minHeight: "100vh",
      display: "flex",
      alignItems: "center",
      justifyContent: "center",
      padding: "0 16px",
      background: "linear-gradient(135deg, #6C3EF4 0%, #4A8EF0 100%)",
    }}>
      <div style={{
        width: "100%",
        maxWidth: 420,
        background: "white",
        borderRadius: 16,
        padding: 32,
        boxShadow: "0 20px 60px rgba(0,0,0,0.15)",
      }}>
        <h1 style={{ fontSize: 24, fontWeight: 700, color: "var(--cc-text)", marginBottom: 4, textAlign: "center" }}>
          Creator Portal
        </h1>
        <p style={{ fontSize: 14, color: "var(--cc-text-muted)", marginBottom: 24, textAlign: "center" }}>
          {mode === "login" ? "Sign in to your creator account" : "Create your creator account"}
        </p>

        {error && (
          <div style={{ padding: "10px 14px", borderRadius: 8, background: "#FEE2E2", color: "#DC2626", fontSize: 13, marginBottom: 16 }}>
            {error}
          </div>
        )}

        <form onSubmit={handleSubmit} style={{ display: "flex", flexDirection: "column", gap: 16 }}>
          {mode === "register" && (
            <>
              <Input label="Full Name" value={form.name} onChange={(e) => set({ name: e.target.value })} placeholder="Your name" required />
              <Input label="Handle" value={form.handle} onChange={(e) => set({ handle: e.target.value })} placeholder="yourhandle (no spaces)" required />
            </>
          )}
          <Input label="Email" type="email" value={form.email} onChange={(e) => set({ email: e.target.value })} placeholder="creator@example.com" required />
          <div style={{ position: "relative" }}>
            <Input
              label="Password"
              type={showPassword ? "text" : "password"}
              value={form.password}
              onChange={(e) => set({ password: e.target.value })}
              placeholder={mode === "register" ? "Min 8 characters" : "Enter password"}
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
            {mode === "login" ? "Sign In" : "Create Account"}
          </Button>
        </form>

        <div style={{ textAlign: "center", marginTop: 20, fontSize: 14, color: "var(--cc-text-muted)" }}>
          {mode === "login" ? (
            <>
              Don&apos;t have an account?{" "}
              <button onClick={() => { setMode("register"); setError(""); }} style={{ color: "var(--cc-primary)", fontWeight: 600, background: "none", border: "none", cursor: "pointer" }}>
                Register
              </button>
            </>
          ) : (
            <>
              Already have an account?{" "}
              <button onClick={() => { setMode("login"); setError(""); }} style={{ color: "var(--cc-primary)", fontWeight: 600, background: "none", border: "none", cursor: "pointer" }}>
                Sign In
              </button>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
