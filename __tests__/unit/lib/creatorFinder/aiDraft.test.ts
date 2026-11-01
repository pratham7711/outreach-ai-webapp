/**
 * @jest-environment node
 */
import { draftEvidence, draftFirstMessage, dropUngroundedSentences } from "@/lib/creatorFinder/aiDraft";
import type { LiveProfileRead } from "@/lib/creatorFinder/liveProfile";

const youtube: Extract<LiveProfileRead, { ok: true }> = {
  ok: true,
  platform: "YOUTUBE",
  readAt: "2026-11-01T00:00:00Z",
  contactRoutes: [],
  youtube: {
    channelId: "UC1234567890123456789012",
    handle: "phonkcars",
    title: "Phonk Cars",
    description: "Drift edits every week",
    thumbnailUrl: null,
    country: "BR",
    subscribers: 48200,
    recent: [{ id: "v1", title: "Supra drift at night", publishedAt: "2026-10-30T12:00:00Z", views: 9100 }],
  },
};

const instagram: Extract<LiveProfileRead, { ok: true }> = {
  ok: true,
  platform: "INSTAGRAM",
  readAt: "2026-11-01T00:00:00Z",
  contactRoutes: [],
  via: { username: "agency" },
  instagram: {
    username: "funk_daily",
    name: "Funk Daily",
    biography: "Passinho todo dia",
    website: null,
    profilePictureUrl: null,
    followers: 12000,
    media: [{ id: "m1", caption: "Passinho novo", mediaType: "VIDEO", permalink: null, thumbnailUrl: null, postedAt: "2026-10-29T00:00:00Z" }],
  },
};

describe("draftEvidence", () => {
  it("uses only the platform's own figures and the creator's own words", () => {
    expect(draftEvidence(youtube)).toEqual([
      { label: "Channel name", value: "Phonk Cars" },
      { label: "YouTube subscribers (YouTube's figure)", value: 48200 },
      { label: "Channel description", value: "Drift edits every week" },
      { label: "A recent video's title", value: '"Supra drift at night" (posted 2026-10-30)' },
    ]);
    expect(draftEvidence(instagram).map((e) => e.label)).toEqual([
      "Name on the profile",
      "Instagram followers (Instagram's figure)",
      "Bio",
      "A recent post's caption",
    ]);
  });

  it("leaves a hidden count out rather than writing 0", () => {
    const hidden = { ...youtube, youtube: { ...youtube.youtube, subscribers: undefined } };
    expect(draftEvidence(hidden).some((e) => e.label.includes("subscribers"))).toBe(false);
  });
});

describe("dropUngroundedSentences", () => {
  const input = { handle: "@x", brief: "b", evidence: [{ label: "Subscribers", value: 48200 }] };

  it("removes only the sentences with a number that isn't in the evidence", () => {
    const out = dropUngroundedSentences("Hi there! Your 48,200 subscribers love drift. You got 2M views last week.\nLet's talk.", input);
    expect(out.text).toBe("Hi there! Your 48,200 subscribers love drift.\nLet's talk.");
    expect(out.dropped).toBe(1);
  });
});

describe("draftFirstMessage", () => {
  const reply = (text: string) => jest.fn().mockResolvedValue({ content: [{ type: "text", text }] });

  it("asks Opus 5.5 at low effort, with the agency's example and the evidence", async () => {
    const create = reply("Collab?\nOi! Vi seu vídeo do Supra.");
    await draftFirstMessage({ client: { messages: { create } }, read: youtube, handle: "phonkcars", example: "Hi Phonk Cars! Paid collab?" });
    const args = create.mock.calls[0][0];
    expect(args.model).toBe("claude-opus-5-5");
    expect(args.output_config).toEqual({ effort: "low" });
    expect(args.messages[0].content).toContain("Hi Phonk Cars! Paid collab?");
    expect(args.messages[0].content).toContain("Supra drift at night");
    expect(args.messages[0].content).toContain("Do not write any URL.");
  });

  it("removes invented numbers and puts the campaign's join link under the message", async () => {
    const create = reply("Join our 50 creators\nLoved the Supra drift video. Over 3M fans listen to our songs.\nWant in?");
    const out = await draftFirstMessage({
      client: { messages: { create } },
      read: youtube,
      handle: "phonkcars",
      example: "Hi!",
      campaign: { title: "Drift Phonk Push", guidelines: "Use the sound", requirements: null, joinUrl: "http://localhost/portal/register?join=drift" },
    });
    expect(out.subject).toBe("");
    expect(out.body).toBe("Loved the Supra drift video.\nWant in?\n\nhttp://localhost/portal/register?join=drift");
    expect(out.dropped).toBe(2);
    expect(create.mock.calls[0][0].messages[0].content).toContain('the campaign "Drift Phonk Push"');
  });
});
