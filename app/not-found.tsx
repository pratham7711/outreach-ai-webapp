import { auth } from "@/lib/auth";
import { getCreatorSession } from "@/lib/creator-auth";
import { NotFoundActions } from "@/components/errors/NotFoundActions";

/* Who is asking decides where the button goes (see NotFoundActions). A 404 must
   render even when the session store is unreachable, so either read failing
   counts as signed out rather than turning the 404 into a 500. */
async function signedIn() {
  const [agency, creator] = await Promise.all([
    auth().then((s) => Boolean(s?.user)).catch(() => false),
    getCreatorSession().then(Boolean).catch(() => false),
  ]);
  return { agency, creator };
}

export default async function NotFound() {
  const { agency, creator } = await signedIn();
  return (
    <div
      style={{
        minHeight: "100vh",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        background: "var(--cc-bg)",
        padding: 24,
      }}
    >
      <div style={{ textAlign: "center", maxWidth: 420 }}>
        <div
          style={{
            width: 80,
            height: 80,
            borderRadius: 20,
            background: "linear-gradient(135deg, var(--cc-accent-bg) 0%, var(--cc-primary-medium) 100%)",
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
            color: "var(--cc-text)",
            marginBottom: 8,
            letterSpacing: "-0.02em",
          }}
        >
          Page not found
        </h1>
        <p
          style={{
            fontSize: 15,
            color: "var(--cc-text-muted)",
            marginBottom: 32,
            lineHeight: 1.6,
          }}
        >
          The page you are looking for does not exist or has been moved.
        </p>
        <NotFoundActions agency={agency} creator={creator} />
      </div>
    </div>
  );
}
