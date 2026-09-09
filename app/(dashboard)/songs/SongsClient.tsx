"use client";

import React, { useState } from "react";
import Link from "next/link";
import { Music, Plus } from "lucide-react";
import { Card, EmptyState, Input } from "@pratham7711/ui";
import { PageHeader, Button } from "@/components/ds";
import { platformLabel, formatFull } from "@/lib/format";

export type SongRow = {
  id: string;
  title: string;
  artist: string;
  coverUrl: string | null;
  releaseDate: string | null;
  campaignCount: number;
  activeCampaignCount: number;
  postCount: number;
  totalViews: number;
  platforms: string[];
};

export default function SongsClient({ songs: initial }: { songs: SongRow[] }) {
  const [songs, setSongs] = useState(initial);
  const [search, setSearch] = useState("");
  const [creating, setCreating] = useState(false);
  const [title, setTitle] = useState("");
  const [artist, setArtist] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const filtered = songs.filter(
    (s) =>
      s.title.toLowerCase().includes(search.toLowerCase()) ||
      s.artist.toLowerCase().includes(search.toLowerCase()),
  );

  async function handleCreate(e: React.FormEvent) {
    e.preventDefault();
    setSaving(true);
    setError(null);
    try {
      const res = await fetch("/api/songs", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ title, artist }),
      });
      if (!res.ok) {
        setError("Could not save that song.");
        return;
      }
      const { song } = await res.json();
      setSongs((prev) => [
        {
          id: song.id,
          title: song.title,
          artist: song.artist,
          coverUrl: null,
          releaseDate: null,
          campaignCount: 0,
          activeCampaignCount: 0,
          postCount: 0,
          totalViews: 0,
          platforms: [],
        },
        ...prev,
      ]);
      setTitle("");
      setArtist("");
      setCreating(false);
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="rsp-page">
      <PageHeader
        title="Songs"
        subtitle="One release, every campaign promoting it, rolled up."
        actions={
          <Button variant="primary" iconLeft={<Plus size={15} />} size="sm" onClick={() => setCreating((v) => !v)}>
            Add Song
          </Button>
        }
      />

      {creating && (
        <Card variant="solid" style={{ padding: 20, marginBottom: 20 }}>
          <form onSubmit={handleCreate} style={{ display: "flex", gap: 12, flexWrap: "wrap", alignItems: "flex-end" }}>
            <div style={{ flex: 1, minWidth: 180 }}>
              <label htmlFor="song-title" style={{ display: "block", fontSize: 12, fontWeight: 600, color: "var(--cc-text-muted)", marginBottom: 6 }}>
                Title
              </label>
              <Input id="song-title" value={title} onChange={(e) => setTitle(e.target.value)} placeholder="Song title" required />
            </div>
            <div style={{ flex: 1, minWidth: 180 }}>
              <label htmlFor="song-artist" style={{ display: "block", fontSize: 12, fontWeight: 600, color: "var(--cc-text-muted)", marginBottom: 6 }}>
                Artist
              </label>
              <Input id="song-artist" value={artist} onChange={(e) => setArtist(e.target.value)} placeholder="Artist" required />
            </div>
            <Button type="submit" variant="primary" size="sm" disabled={saving || !title.trim() || !artist.trim()}>
              {saving ? "Saving…" : "Save"}
            </Button>
          </form>
          {error && <p style={{ marginTop: 10, fontSize: 13, color: "#DC2626" }}>{error}</p>}
        </Card>
      )}

      {songs.length > 0 && (
        <div style={{ marginBottom: 20, maxWidth: 360 }}>
          <Input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Search songs…" />
        </div>
      )}

      {filtered.length === 0 ? (
        <EmptyState
          icon={<Music size={32} color="var(--cc-text-subtle)" />}
          title={songs.length === 0 ? "No songs yet" : "No songs match that search"}
          description={
            songs.length === 0
              ? "Add a release, then attach campaigns to it to see combined performance. Campaigns work fine without a song too."
              : "Try a different title or artist."
          }
        />
      ) : (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3" style={{ gap: 20 }}>
          {filtered.map((s) => (
            <Link key={s.id} href={`/songs/${s.id}`} style={{ textDecoration: "none" }}>
              <Card variant="solid" className="ui-card-clickable" style={{ padding: 20 }}>
                <div style={{ display: "flex", gap: 14, marginBottom: 16 }}>
                  <div
                    aria-hidden="true"
                    style={{
                      width: 52, height: 52, borderRadius: 10, flexShrink: 0,
                      background: s.coverUrl ? `url(${s.coverUrl}) center/cover` : "var(--cc-bg)",
                      border: "1px solid var(--cc-border)",
                      display: "flex", alignItems: "center", justifyContent: "center",
                    }}
                  >
                    {!s.coverUrl && <Music size={20} color="var(--cc-text-subtle)" />}
                  </div>
                  <div style={{ minWidth: 0 }}>
                    <p style={{ fontWeight: 700, fontSize: 16, color: "var(--cc-text)", marginBottom: 2 }}>{s.title}</p>
                    <p style={{ fontSize: 13, color: "var(--cc-text-muted)" }}>{s.artist}</p>
                  </div>
                </div>
                <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 10 }}>
                  <Stat label="Views" value={formatFull(s.totalViews)} />
                  <Stat label="Posts" value={String(s.postCount)} />
                  <Stat label="Campaigns" value={String(s.campaignCount)} />
                </div>
                {s.platforms.length > 0 && (
                  <p style={{ marginTop: 14, fontSize: 12, color: "var(--cc-text-muted)" }}>
                    {s.platforms.map(platformLabel).join(" · ")}
                  </p>
                )}
              </Card>
            </Link>
          ))}
        </div>
      )}
    </div>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <p style={{ fontSize: 11, color: "var(--cc-text-subtle)", fontWeight: 600, textTransform: "uppercase", letterSpacing: "0.3px", marginBottom: 2 }}>
        {label}
      </p>
      <p style={{ fontWeight: 700, fontSize: 15, color: "var(--cc-text)", fontVariantNumeric: "tabular-nums" }}>{value}</p>
    </div>
  );
}
