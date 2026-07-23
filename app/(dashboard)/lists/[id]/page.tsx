"use client";
import { useState, useEffect, use } from "react";
import { useRouter } from "next/navigation";
import { ArrowLeft, ChevronRight, Plus, Trash2, Users, ClipboardList } from "lucide-react";
import Link from "next/link";
import { Card, Button, Badge, Avatar, EmptyState, Skeleton, Input } from "@pratham7711/ui";
import { toast } from "sonner";
import { formatCompact, stripAt, formatDateAbs } from "@/lib/format";

type CreatorItem = {
  id: string;
  addedAt: string;
  creator: {
    id: string; name: string; handle: string; platform: string;
    followersCount: number; averageViews: number;
  };
};

type ListDetail = {
  id: string;
  name: string;
  description: string | null;
  items: CreatorItem[];
  _count: { items: number };
};

function formatNumber(n: number) {
  return formatCompact(n);
}

export default function ListDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const router = useRouter();
  const [list, setList] = useState<ListDetail | null>(null);
  const [loading, setLoading] = useState(true);

  const fetchList = () => {
    setLoading(true);
    fetch(`/api/lists/${id}`)
      .then(r => r.json())
      .then(data => setList(data.error ? null : data))
      .finally(() => setLoading(false));
  };

  useEffect(() => { fetchList(); }, [id]);

  const handleRemoveCreator = async (itemId: string, creatorId: string) => {
    if (!confirm("Remove this creator from the list?")) return;
    try {
      const res = await fetch(`/api/lists/${id}/creators/${creatorId}`, { method: "DELETE" });
      if (res.ok) {
        toast.success("Creator removed");
        fetchList();
      } else {
        toast.error("Failed to remove");
      }
    } catch { toast.error("Network error"); }
  };

  const handleDeleteList = async () => {
    if (!confirm("Delete this entire list? This cannot be undone.")) return;
    try {
      const res = await fetch(`/api/lists/${id}`, { method: "DELETE" });
      if (res.ok) {
        toast.success("List deleted");
        router.push("/lists");
      } else {
        toast.error("Failed to delete");
      }
    } catch { toast.error("Network error"); }
  };

  if (loading) return (
    <div className="rsp-page" style={{ display: "flex", flexDirection: "column", gap: 24 }}>
      <Skeleton width="120px" height="16px" />
      <Skeleton width="300px" height="32px" />
      <Skeleton width="100%" height="400px" borderRadius="12px" />
    </div>
  );

  if (!list) return (
    <div className="rsp-page">
      <EmptyState icon={<ClipboardList size={32} color="var(--cc-text-subtle)" />} title="List not found" />
    </div>
  );

  return (
    <div className="rsp-page">
      {/* Breadcrumb */}
      <div style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 14, marginBottom: 24, color: "var(--cc-text-muted)" }}>
        <Link href="/lists" style={{ display: "flex", alignItems: "center", gap: 4, color: "var(--cc-text-muted)", textDecoration: "none" }}>
          <ArrowLeft size={16} /> Lists
        </Link>
        <ChevronRight size={12} />
        <span style={{ color: "var(--cc-text)" }}>{list.name}</span>
      </div>

      {/* Header */}
      <div className="rsp-header">
        <div>
          <h1 style={{ fontSize: 26, fontWeight: 700, color: "var(--cc-text)", marginBottom: 4 }}>{list.name}</h1>
          {list.description && <p style={{ fontSize: 14, color: "var(--cc-text-muted)" }}>{list.description}</p>}
          <div style={{ display: "flex", alignItems: "center", gap: 8, marginTop: 8, fontSize: 13, color: "var(--cc-text-muted)" }}>
            <Users size={14} /> {list._count.items} creators
          </div>
        </div>
        <div style={{ display: "flex", gap: 8 }}>
          <Button variant="danger" size="sm" iconLeft={<Trash2 size={14} />} onClick={handleDeleteList}>Delete List</Button>
        </div>
      </div>

      {/* Creators table */}
      {list.items.length === 0 ? (
        <EmptyState icon={<Users size={32} color="var(--cc-text-subtle)" />} title="No creators in this list" description="Add creators from the Discovery page or creator profiles." />
      ) : (
        <Card variant="solid" noPadding>
          <div className="rsp-table-wrap">
          <div style={{ minWidth: 640 }}>
          <div style={{ display: "grid", gridTemplateColumns: "1fr 120px 100px 100px 100px 60px", gap: 12, padding: "12px 24px", borderBottom: "1px solid var(--cc-border)", background: "var(--cc-bg)" }}>
            {["Creator", "Platform", "Followers", "Avg Views", "Added", ""].map(h => (
              <span key={h} style={{ fontSize: 11, fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.06em", color: "var(--cc-text-subtle)" }}>{h}</span>
            ))}
          </div>
          <div className="cc-stagger">
            {list.items.map((item, i) => (
              <div
                key={item.id}
                style={{ display: "grid", gridTemplateColumns: "1fr 120px 100px 100px 100px 60px", gap: 12, padding: "14px 24px", alignItems: "center", borderTop: i > 0 ? "1px solid var(--cc-border)" : undefined }}
                className="cc-table-row"
              >
                <Link href={`/creators/${item.creator.id}`} style={{ textDecoration: "none", display: "flex", alignItems: "center", gap: 12 }}>
                  <Avatar name={item.creator.name} size="sm" />
                  <div>
                    <p style={{ fontSize: 14, fontWeight: 600, color: "var(--cc-text)" }}>{item.creator.name}</p>
                    <p style={{ fontSize: 12, color: "var(--cc-text-muted)" }}>@{stripAt(item.creator.handle)}</p>
                  </div>
                </Link>
                <Badge variant="neutral">{item.creator.platform}</Badge>
                <span style={{ fontSize: 13, fontWeight: 600, color: "var(--cc-text)" }}>{formatNumber(item.creator.followersCount)}</span>
                <span style={{ fontSize: 13, color: "var(--cc-text-muted)" }}>{formatNumber(item.creator.averageViews)}</span>
                <span style={{ fontSize: 12, color: "var(--cc-text-muted)" }}>{formatDateAbs(item.addedAt)}</span>
                <button
                  onClick={() => handleRemoveCreator(item.id, item.creator.id)}
                  style={{ background: "none", border: "none", cursor: "pointer", color: "var(--cc-text-muted)", padding: 4 }}
                  title="Remove from list"
                >
                  <Trash2 size={14} />
                </button>
              </div>
            ))}
          </div>
          </div>
          </div>
        </Card>
      )}
    </div>
  );
}
