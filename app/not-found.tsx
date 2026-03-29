import Link from "next/link";

export default function NotFound() {
  return (
    <div
      style={{
        minHeight: "100vh",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        background: "var(--cc-bg, #EFF0F8)",
        padding: 24,
      }}
    >
      <div style={{ textAlign: "center", maxWidth: 420 }}>
        <div
          style={{
            width: 80,
            height: 80,
            borderRadius: 20,
            background: "linear-gradient(135deg, #EEF2FF 0%, #E0E7FF 100%)",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            margin: "0 auto 24px",
            fontSize: 36,
          }}
        >
          404
        </div>
        <h1
          style={{
            fontSize: 28,
            fontWeight: 800,
            color: "var(--cc-text, #1C2048)",
            marginBottom: 8,
            letterSpacing: "-0.02em",
          }}
        >
          Page not found
        </h1>
        <p
          style={{
            fontSize: 15,
            color: "var(--cc-text-muted, #9097B4)",
            marginBottom: 32,
            lineHeight: 1.6,
          }}
        >
          The page you are looking for does not exist or has been moved.
        </p>
        <Link
          href="/dashboard"
          style={{
            display: "inline-flex",
            alignItems: "center",
            gap: 8,
            padding: "12px 24px",
            background: "var(--cc-primary, #5B5BD6)",
            color: "white",
            borderRadius: 10,
            fontSize: 14,
            fontWeight: 600,
            textDecoration: "none",
            transition: "background 0.15s",
          }}
        >
          Go to Dashboard
        </Link>
      </div>
    </div>
  );
}
