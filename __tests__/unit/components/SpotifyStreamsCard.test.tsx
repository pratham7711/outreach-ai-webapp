/**
 * @jest-environment jsdom
 *
 * The Spotify card's line saying where its track came from: the dashboard
 * says it, the share report never does.
 */
import { render, screen } from "@testing-library/react";

jest.mock("@pratham7711/ui", () => ({ Card: ({ children }: { children: React.ReactNode }) => <div>{children}</div> }), { virtual: true });

import { SpotifyStreamsCard } from "@/components/campaigns/SpotifyStreamsCard";
import type { CampaignStreams } from "@/lib/songs/streams";

const streams = (over: Partial<CampaignStreams> = {}): CampaignStreams => ({
  songTitle: "Neon Skyline",
  track: { id: "4uLU6hMCjMI75M1A2tKUQC", url: "https://open.spotify.com/track/4uLU6hMCjMI75M1A2tKUQC", name: "Thriller", artists: "Michael Jackson" },
  trackSource: "matched",
  totalPlays: 1_000_000,
  latestDay: "2026-10-24",
  lastDay: null,
  sinceFirst: null,
  daily: [],
  plays: [],
  note: null,
  ...over,
});

it("says a linked track was linked on the campaign", () => {
  render(<SpotifyStreamsCard streams={streams({ trackSource: "linked" })} />);
  expect(screen.getByTestId("spotify-track-source")).toHaveTextContent("Linked on the campaign");
});

it("says a found track was matched by title and artist", () => {
  render(<SpotifyStreamsCard streams={streams({ trackSource: "matched" })} />);
  expect(screen.getByTestId("spotify-track-source")).toHaveTextContent("Matched by title and artist");
});

it("says nothing about it on the share report, even if it were sent", () => {
  render(<SpotifyStreamsCard streams={streams({ trackSource: "linked" })} variant="report" />);
  expect(screen.getByText("Thriller")).toBeInTheDocument();
  expect(screen.queryByTestId("spotify-track-source")).toBeNull();
  expect(screen.queryByText(/Linked on the campaign|Matched by title and artist/)).toBeNull();
});

it("shows the note, with where the link goes, when there is no figure", () => {
  render(
    <SpotifyStreamsCard
      streams={streams({
        track: null,
        trackSource: null,
        totalPlays: null,
        latestDay: null,
        note: "No Spotify track found with this song's title and artist (or ISRC). Add the Spotify link in the campaign's audio settings.",
      })}
    />
  );
  expect(screen.getByText(/Add the Spotify link in the campaign's audio settings\./)).toBeInTheDocument();
  expect(screen.queryByTestId("spotify-track-source")).toBeNull();
});
