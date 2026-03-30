import { Toaster } from "sonner";

export default function PortalLayout({ children }: { children: React.ReactNode }) {
  return (
    <div style={{ minHeight: "100vh", background: "var(--cc-bg)" }}>
      <Toaster richColors position="bottom-right" />
      {children}
    </div>
  );
}
