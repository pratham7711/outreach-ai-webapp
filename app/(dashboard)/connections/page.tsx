"use client";
import { Button, Card, Badge } from "@pratham7711/ui";

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
    <div className="cc-page-content">
      <div style={{ marginBottom: 32, display: "flex", justifyContent: "space-between", alignItems: "flex-start" }}>
        <div>
          <h1 style={{ fontSize: 26, fontWeight: 700, color: "var(--cc-text)", marginBottom: 4 }}>Connections</h1>
          <p style={{ fontSize: 14, color: "var(--cc-text-muted)" }}>Connect your platforms and payment providers</p>
        </div>
      </div>

      <div className="cc-stagger" style={{ display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: 16 }}>
        {INTEGRATIONS.map((int) => (
          <Card key={int.name} variant="outlined" style={{ padding: 24 }}>
            <div style={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between", marginBottom: 16 }}>
              <div style={{ width: 48, height: 48, borderRadius: 12, display: "flex", alignItems: "center", justifyContent: "center", fontSize: 24, background: "var(--cc-hover-bg)" }}>
                {int.icon}
              </div>
              {int.connected && (
                <Badge variant="success" size="sm" dot>Connected</Badge>
              )}
            </div>
            <h3 style={{ fontWeight: 700, fontSize: 16, color: "var(--cc-text)", marginBottom: 4 }}>{int.name}</h3>
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
