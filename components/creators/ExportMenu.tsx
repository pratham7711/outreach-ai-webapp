"use client";

import { useEffect, useRef, useState } from "react";
import { Download } from "lucide-react";
import { Button } from "@/components/ds";

/** "Export" with one download per format. Plain links, so the browser does the saving. */
export default function ExportMenu({ items, align = "up" }: { items: { label: string; href: string }[]; align?: "up" | "down" }) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const close = (e: MouseEvent) => {
      if (!ref.current?.contains(e.target as Node)) setOpen(false);
    };
    const esc = (e: KeyboardEvent) => e.key === "Escape" && setOpen(false);
    document.addEventListener("mousedown", close);
    document.addEventListener("keydown", esc);
    return () => {
      document.removeEventListener("mousedown", close);
      document.removeEventListener("keydown", esc);
    };
  }, [open]);

  return (
    <div className="cc-roster-export" ref={ref}>
      <Button
        variant="secondary"
        size="sm"
        iconLeft={<Download size={15} />}
        aria-expanded={open}
        aria-haspopup="menu"
        onClick={() => setOpen((o) => !o)}
      >
        Export
      </Button>
      {open && (
        <div className="cc-roster-export-menu" role="menu" data-align={align}>
          {items.map((item) => (
            <a key={item.href} role="menuitem" href={item.href} download onClick={() => setOpen(false)}>
              {item.label}
            </a>
          ))}
        </div>
      )}
    </div>
  );
}
