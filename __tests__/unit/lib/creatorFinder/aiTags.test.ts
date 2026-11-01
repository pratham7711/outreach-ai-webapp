/**
 * @jest-environment node
 */
import { checkSignals, readProfileSignals, buildTagsPrompt, inputDigest, readStoredTags, ScoutAiAnswerError } from "@/lib/creatorFinder/aiTags";
import type { ProfileSource } from "@/lib/creatorFinder/liveProfile";

const sources: ProfileSource[] = [
  { id: "bio", label: "Bio", text: "Edits de carro 🚗 | São Paulo\nParcerias: contato.edits arroba gmail ponto com\nWhats +55 11 98765-4321", at: null },
  { id: "post:1", label: "Post caption", text: "Mandelão no grau com o Civic 🔥 #funkautomotivo", at: "2026-10-28T10:00:00Z" },
];

const tag = (kind: string, label: string, source: string, quote: string) => ({ kind, label, source, quote }) as never;
const contact = (kind: string, value: string, source: string, quote: string) => ({ kind, value, source, quote }) as never;

describe("checkSignals keeps only what the profile itself says", () => {
  it("keeps a tag whose quote is in the source it names, whatever the spacing or case", () => {
    const out = checkSignals({ tags: [tag("content", "Car Edits", "bio", "edits  de CARRO")], contacts: [] }, sources);
    expect(out.tags).toEqual([{ kind: "content", label: "car edits", source: "bio", quote: "edits  de CARRO" }]);
    expect(out.dropped).toBe(0);
  });

  it("drops a quote that isn't in that source, or names a source that doesn't exist", () => {
    const out = checkSignals(
      {
        tags: [
          tag("content", "anime edits", "bio", "anime edits"),
          tag("city", "são paulo", "post:1", "São Paulo"),
          tag("language", "portuguese", "post:9", "Mandelão no grau"),
        ],
        contacts: [],
      },
      sources,
    );
    expect(out.tags).toEqual([]);
    expect(out.dropped).toBe(3);
  });

  it("never lets a number through as a label", () => {
    const out = checkSignals({ tags: [tag("content", "100k followers", "bio", "Edits de carro")], contacts: [] }, sources);
    expect(out.tags).toEqual([]);
  });

  it("leaves out a tag the agency already marked wrong, and duplicates", () => {
    const out = checkSignals(
      { tags: [tag("content", "car edits", "bio", "Edits de carro"), tag("content", "Car edits", "post:1", "Civic"), tag("city", "são paulo", "bio", "São Paulo")], contacts: [] },
      sources,
      [{ kind: "city", label: "São Paulo" }],
    );
    expect(out.tags.map((t) => t.label)).toEqual(["car edits"]);
  });

  it("accepts an email rewritten from 'arroba … ponto com' only when every piece is in the quote", () => {
    const ok = checkSignals({ tags: [], contacts: [contact("email", "contato.edits@gmail.com", "bio", "contato.edits arroba gmail ponto com")] }, sources);
    expect(ok.contacts).toHaveLength(1);
    const invented = checkSignals({ tags: [], contacts: [contact("email", "booking@carlabel.com", "bio", "contato.edits arroba gmail ponto com")] }, sources);
    expect(invented.contacts).toEqual([]);
    expect(invented.dropped).toBe(1);
  });

  it("accepts a phone or WhatsApp number only when its digits are in the quote", () => {
    const out = checkSignals(
      {
        tags: [],
        contacts: [contact("whatsapp", "+5511987654321", "bio", "Whats +55 11 98765-4321"), contact("phone", "+5511900000000", "bio", "Whats +55 11 98765-4321")],
      },
      sources,
    );
    expect(out.contacts.map((c) => c.value)).toEqual(["+5511987654321"]);
  });
});

describe("readProfileSignals", () => {
  const answer = (text: string, stop_reason = "end_turn") => ({ content: [{ type: "text", text }], stop_reason });

  it("asks Opus 5.5 for schema-shaped JSON and checks what comes back", async () => {
    const create = jest.fn().mockResolvedValue(
      answer(JSON.stringify({ tags: [tag("content", "car edits", "bio", "Edits de carro")], contacts: [contact("email", "x@y.com", "bio", "nope")] })),
    );
    const out = await readProfileSignals({ client: { messages: { create } }, sources, platform: "INSTAGRAM" });
    const args = create.mock.calls[0][0];
    expect(args.model).toBe("claude-opus-5-5");
    expect(args.output_config.format.type).toBe("json_schema");
    expect(args.messages[0].content).toContain('<source id="post:1" kind="Post caption" date="2026-10-28">');
    expect(out.tags).toHaveLength(1);
    expect(out.contacts).toEqual([]);
    expect(out.dropped).toBe(1);
  });

  it("makes no call for a profile with no text", async () => {
    const create = jest.fn();
    expect(await readProfileSignals({ client: { messages: { create } }, sources: [], platform: "YOUTUBE" })).toEqual({ tags: [], contacts: [], dropped: 0 });
    expect(create).not.toHaveBeenCalled();
  });

  it("refuses a refusal, a cut-off answer, or an answer that isn't the shape", async () => {
    for (const reply of [answer("", "refusal"), answer("{", "max_tokens"), answer("not json"), answer(JSON.stringify({ tags: "x" }))]) {
      const create = jest.fn().mockResolvedValue(reply);
      await expect(readProfileSignals({ client: { messages: { create } }, sources, platform: "YOUTUBE" })).rejects.toBeInstanceOf(ScoutAiAnswerError);
    }
  });
});

describe("what is kept", () => {
  it("digests the exact input instead of storing it", () => {
    expect(inputDigest(sources)).toMatch(/^[0-9a-f]{64}$/);
    expect(inputDigest(sources)).not.toBe(inputDigest([{ ...sources[0], text: "changed" }, sources[1]]));
    expect(buildTagsPrompt(sources, "YOUTUBE")).toContain("Platform: YouTube");
  });

  it("reads a malformed stored column as no tags", () => {
    expect(readStoredTags(null)).toBeNull();
    expect(readStoredTags({ tags: "x" })).toBeNull();
    expect(readStoredTags({ tags: [{ kind: "content", label: "dance", source: "bio" }, { kind: "nope", label: "x" }] })?.tags).toEqual([
      { kind: "content", label: "dance", source: "bio" },
    ]);
  });
});
