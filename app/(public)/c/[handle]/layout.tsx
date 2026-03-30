export default function PublicProfileLayout({ children }: { children: React.ReactNode }) {
  return <div style={{ minHeight: "100vh", background: "var(--cc-bg)" }}>{children}</div>;
}
