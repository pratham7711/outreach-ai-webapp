"use client";

import React, { useState } from "react";
import Link from "next/link";
import { Music, Plus } from "lucide-react";
import { Card, EmptyState, Input } from "@pratham7711/ui";
import { PageHeader, Button, Field, ListToolbar, NoResults } from "@/components/ds";
import { platformLabel, formatFull } from "@/lib/format";
import { asOfCaption } from "@/lib/dataAge";
import { imgSrc } from "@/lib/postMedia";
import { action } from "@/lib/ui/actions";

export type SongRow = {
  id: string;
  title: string;
  artist: string;
  coverUrl: string | null;
  releaseDate: string | null;
  campaignCount: number;
  activeCampaignCount: number;
  postCount: number;
  /** Null when none of the song's posts has a view count we hold. */
  totalViews: number | null;
  /** Videos whose views are known, of `videoCount` (each video once). */
  viewsKnown: number;
  videoCount: number;
  /** The newest reading behind totalViews. */
  viewsAsOf: string | null;
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
      s.title.toLowerCase().includes(search.trim().toLowerCase()) ||
      s.artist.toLowerCase().includes(search.trim().toLowerCase()),
  );

  async function handleCreate(e: React.FormEvent) {
    e.preventDefault();
    if (saving || !title.trim() || !artist.trim()) return;
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
          totalViews: null,
          viewsKnown: 0,
          videoCount: 0,
          viewsAsOf: null,
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
        actions={
          <Button variant="primary" iconLeft={<Plus size={16} />} onClick={() => setCreating((v) => !v)} {...action("add-song")}>
            Add song
          </Button>
        }
      />

      {creating && (
        <Card variant="outlined" className="cc-song-add">
          <form onSubmit={handleCreate} className="cc-song-add-form">
            <Field label="Title" required id="song-title">
              <Input value={title} onChange={(e) => setTitle(e.target.value)} placeholder="Song title" />
            </Field>
            <Field label="Artist" required id="song-artist">
              <Input value={artist} onChange={(e) => setArtist(e.target.value)} placeholder="Artist" />
            </Field>
            <div className="cc-song-add-actions">
              <Button variant="secondary" onClick={() => setCreating(false)}>
                Cancel
              </Button>
              <Button type="submit" variant="primary" loading={saving} disabled={!title.trim() || !artist.trim()}>
                Save song
              </Button>
            </div>
          </form>
          {error && <p className="cc-form-error" role="alert">{error}</p>}
        </Card>
      )}

      {songs.length > 0 && (
        <ListToolbar search={{ value: search, onChange: setSearch, placeholder: "Search songs", ariaLabel: "Search songs by title or artist" }} />
      )}

      {songs.length === 0 ? (
        <EmptyState
          icon={<Music size={32} color="var(--cc-text-subtle)" />}
          title="No songs yet"
          description="Add a release, then attach campaigns to it to see combined performance. Campaigns work fine without a song too."
        />
      ) : filtered.length === 0 ? (
        <div className="cc-dt-card">
          <NoResults onClear={() => setSearch("")} clearLabel="Clear search" description="No song title or artist matches that search." />
        </div>
      ) : (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3" style={{ gap: 20 }}>
          {filtered.map((s) => {
            const viewsNote = asOfCaption(s.viewsAsOf, { known: s.viewsKnown, total: s.videoCount, noun: "video", what: "views" });
            const cover = imgSrc(s.coverUrl, 104);
            return (
            <Link key={s.id} href={`/songs/${s.id}`} className="cc-list-card-link">
              <Card variant="outlined" clickable>
                <div style={{ display: "flex", gap: 14, marginBottom: 16 }}>
                  <div
                    aria-hidden="true"
                    style={{
                      width: 52, height: 52, borderRadius: 10, flexShrink: 0,
                      background: cover ? `url("${cover}") center/cover` : "var(--cc-bg)",
                      border: "1px solid var(--cc-border)",
                      display: "flex", alignItems: "center", justifyContent: "center",
                    }}
                  >
                    {!cover && <Music size={20} color="var(--cc-text-subtle)" />}
                  </div>
                  <div style={{ minWidth: 0 }}>
                    <p style={{ fontWeight: 700, fontSize: "var(--cc-t-16)", color: "var(--cc-text)", marginBottom: 2 }}>{s.title}</p>
                    <p style={{ fontSize: "var(--cc-t-13)", color: "var(--cc-text-muted)" }}>{s.artist}</p>
                  </div>
                </div>
                <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 10 }}>
                  <Stat
                    label="Views"
                    value={s.totalViews === null ? "—" : formatFull(s.totalViews)}
                    title={
                      s.totalViews !== null
                        ? viewsNote ?? undefined
                        : s.postCount === 0
                          ? "No posts yet, so there are no views to count"
                          : "None of this song's posts has a view count read yet"
                    }
                  />
                  <Stat label="Posts" value={String(s.postCount)} />
                  <Stat label="Campaigns" value={String(s.campaignCount)} />
                </div>
                {s.platforms.length > 0 && (
                  <p style={{ marginTop: 14, fontSize: "var(--cc-t-12)", color: "var(--cc-text-muted)" }}>
                    {s.platforms.map(platformLabel).join(" · ")}
                  </p>
                )}
              </Card>
            </Link>
            );
          })}
        </div>
      )}
    </div>
  );
}

function Stat({ label, value, title }: { label: string; value: string; title?: string }) {
  return (
    <div>
      <p className="cc-microlabel" style={{ marginBottom: 2 }}>
        {label}
      </p>
      <p className="cc-panel-title" title={title} style={{ fontVariantNumeric: "tabular-nums" }}>{value}</p>
    </div>
  );
}
