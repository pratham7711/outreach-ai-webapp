import NewSidebar from "@/components/NewSidebar";

export default function DashboardLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex min-h-screen">
      <NewSidebar />
      <main className="flex-1 ml-60 min-h-screen" style={{ background: "var(--cc-bg)" }}>
        {children}
      </main>
    </div>
  );
}
