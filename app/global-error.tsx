"use client";

/**
 * The last resort: this replaces the root layout, so it is what remains when the
 * layout itself throws. It renders its own <html> and <body> and imports
 * nothing -- no stylesheet, no component library, no icons -- because any of
 * those could be the reason we are here.
 *
 * Which is also why the colours are literals rather than var(--cc-*): globals.css
 * is loaded by the root layout, and the root layout by definition did not run.
 * They are the light and dark values from globals.css copied out, carried in a
 * <style> tag so this page still follows the reader's theme. If the palette
 * changes, this file does not follow automatically -- the trade for a page that
 * cannot depend on anything.
 */
const CSS = `
  :root { --ge-bg:#F7F7F5; --ge-card:#FFFFFF; --ge-border:#E4E3DD; --ge-text:#0B0B0B; --ge-muted:#52514E; --ge-primary:#2A78D6; }
  @media (prefers-color-scheme: dark) {
    :root { --ge-bg:#0D0D0D; --ge-card:#1A1A19; --ge-border:#2C2C2A; --ge-text:#FFFFFF; --ge-muted:#C3C2B7; --ge-primary:#3987E5; }
  }
  body {
    margin:0; min-height:100vh; display:flex; align-items:center; justify-content:center;
    padding:24px; background:var(--ge-bg); color:var(--ge-text);
    font-family:system-ui,-apple-system,"Segoe UI",Roboto,Helvetica,Arial,sans-serif;
  }
  .ge-card { background:var(--ge-card); border:1px solid var(--ge-border); border-radius:16px;
             padding:48px 32px; max-width:420px; text-align:center; }
  .ge-card h1 { font-size:20px; font-weight:700; margin:0 0 8px; }
  .ge-card p { font-size:14px; color:var(--ge-muted); margin:0; line-height:1.6; }
  .ge-id { font-size:12px !important; font-family:ui-monospace,monospace; margin-top:16px !important; opacity:.7; }
  .ge-btn { margin-top:24px; background:var(--ge-primary); color:#fff; border:none; border-radius:8px;
            padding:9px 16px; font-size:14px; font-weight:600; cursor:pointer; }
`;

export default function GlobalError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  return (
    <html lang="en">
      <body>
        <style dangerouslySetInnerHTML={{ __html: CSS }} />
        <div className="ge-card">
          <h1>Something went wrong</h1>
          <p>The app failed to start. Reloading usually works.</p>
          {error.digest && <p className="ge-id">Error ID: {error.digest}</p>}
          <button className="ge-btn" onClick={reset}>
            Try again
          </button>
        </div>
      </body>
    </html>
  );
}
