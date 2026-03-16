"use client";
import { Button, Card } from "@pratham7711/ui";
import { Plus, Users, Share2 } from "lucide-react";

type List = {
  id: string;
  name: string;
  description: string | null;
  _count: { items: number };
  createdAt: string;
};

const GRADIENTS = [
  "from-blue-500 to-cyan-500",
  "from-purple-500 to-pink-500",
  "from-green-500 to-teal-500",
  "from-orange-500 to-red-500",
];

export default function ListsClient({ lists }: { lists: List[] }) {
  return (
    <div className="p-8">
      <div className="flex items-center justify-between mb-8">
        <div>
          <h1 style={{ fontSize: 26, fontWeight: 900, color: "var(--cc-text)" }}>Creator Lists</h1>
          <p style={{ fontSize: 14, color: "var(--cc-text-muted)", marginTop: 4 }}>Organize creators into curated lists</p>
        </div>
        <Button variant="primary" iconLeft={<Plus size={16} />}>New List</Button>
      </div>

      <div className="grid md:grid-cols-2 lg:grid-cols-3 gap-4">
        {lists.map((list, i) => (
          <Card key={list.id} variant="glass" className="overflow-hidden" style={{ background: "var(--cc-surface)", border: "1px solid var(--cc-border)", borderRadius: 16 }}>
            <div className={`h-2 bg-gradient-to-r ${GRADIENTS[i % GRADIENTS.length]}`} />
            <div className="p-5">
              <h3 style={{ fontWeight: 800, fontSize: 15, color: "var(--cc-text)", marginBottom: 8 }}>{list.name}</h3>
              <div className="flex items-center gap-4" style={{ fontSize: 12, color: "var(--cc-text-muted)" }}>
                <span className="flex items-center gap-1"><Users size={13} /> {list._count.items} creators</span>
              </div>
              <div className="flex items-center justify-between mt-4 pt-4" style={{ borderTop: "1px solid var(--cc-border)" }}>
                <div className="flex -space-x-2">
                  {Array.from({ length: Math.min(list._count.items, 4) }).map((_, j) => (
                    <div key={j} className="w-7 h-7 rounded-full bg-gradient-to-br from-blue-500 to-purple-600 flex items-center justify-center text-white text-[8px] font-bold" style={{ border: "2px solid var(--cc-surface)" }}>
                      {String.fromCharCode(65 + j)}
                    </div>
                  ))}
                  {list._count.items > 4 && (
                    <div className="w-7 h-7 rounded-full flex items-center justify-center text-[9px]" style={{ background: "var(--cc-surface-2)", color: "var(--cc-text-muted)", border: "2px solid var(--cc-surface)" }}>
                      +{list._count.items - 4}
                    </div>
                  )}
                </div>
                <button className="p-2 rounded-lg transition-all" style={{ color: "var(--cc-text-muted)" }}>
                  <Share2 size={14} />
                </button>
              </div>
            </div>
          </Card>
        ))}

        <div className="flex flex-col items-center justify-center py-12 rounded-2xl cursor-pointer transition-all min-h-[200px]" style={{ border: "2px dashed var(--cc-border)" }}>
          <div className="w-12 h-12 rounded-2xl flex items-center justify-center mb-3" style={{ background: "var(--cc-surface-2)" }}>
            <Plus size={20} style={{ color: "var(--cc-text-muted)" }} />
          </div>
          <p style={{ fontSize: 14, fontWeight: 500, color: "var(--cc-text-muted)" }}>Create a new list</p>
        </div>
      </div>
    </div>
  );
}
