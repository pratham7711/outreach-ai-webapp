"use client";
import { Button, Card } from "@pratham7711/ui";
import { Link2 } from "lucide-react";

const INTEGRATIONS = [
  { name: "TikTok", description: "Import creator profiles and analytics from TikTok.", icon: "🎵", connected: true },
  { name: "Instagram", description: "Sync Instagram creator data and engagement metrics.", icon: "📸", connected: false },
  { name: "YouTube", description: "Connect YouTube channels and track video performance.", icon: "▶️", connected: false },
  { name: "Spotify", description: "Track music streams and artist analytics.", icon: "🎧", connected: true },
  { name: "PayPal", description: "Process creator payouts via PayPal.", icon: "💳", connected: true },
  { name: "Venmo", description: "Send payments to creators through Venmo.", icon: "💸", connected: false },
];

export default function ConnectionsPage() {
  return (
    <div className="p-8">
      <div className="flex items-center justify-between mb-8">
        <div>
          <h1 style={{ fontSize: 26, fontWeight: 900, color: "var(--cc-text)" }}>Connections</h1>
          <p style={{ fontSize: 14, color: "var(--cc-text-muted)", marginTop: 4 }}>Connect your platforms and payment providers</p>
        </div>
      </div>

      <div className="grid md:grid-cols-2 lg:grid-cols-3 gap-4">
        {INTEGRATIONS.map(int => (
          <Card key={int.name} variant="glass" className="p-6" style={{ background: "var(--cc-card)", border: "1px solid var(--cc-border)", borderRadius: 16 }}>
            <div className="flex items-start justify-between mb-4">
              <div className="w-12 h-12 rounded-xl flex items-center justify-center text-2xl" style={{ background: "#F3F4F6" }}>
                {int.icon}
              </div>
              {int.connected && (
                <span className="flex items-center gap-1.5 text-xs font-medium" style={{ color: "#22c55e" }}>
                  <span className="h-2 w-2 rounded-full" style={{ background: "#22c55e" }} />
                  Connected
                </span>
              )}
            </div>
            <h3 style={{ fontWeight: 800, fontSize: 16, color: "var(--cc-text)", marginBottom: 4 }}>{int.name}</h3>
            <p style={{ fontSize: 13, color: "var(--cc-text-muted)", lineHeight: 1.5, marginBottom: 16 }}>{int.description}</p>
            {int.connected ? (
              <Button variant="ghost" fullWidth>Disconnect</Button>
            ) : (
              <Button variant="primary" fullWidth>Connect</Button>
            )}
          </Card>
        ))}
      </div>
    </div>
  );
}
