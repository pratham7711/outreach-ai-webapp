import { draftOutreach, validateOutreachGrounding, type EvidenceItem, type OutreachDraftInput } from "@/lib/ai/outreach/draftOutreach";
import type { LiveProfileRead } from "@/lib/creatorFinder/liveProfile";
import { SCOUT_MODEL, type ScoutAiClient } from "@/lib/creatorFinder/scoutAi";

/**
 * A personal first message to a prospect, from the shared grounded-draft code
 * (lib/ai/outreach/draftOutreach.ts): the model may cite only the evidence
 * built here from the live profile, and any sentence carrying a number that
 * isn't in that evidence is removed before the agency sees the draft. It never
 * sends; the agency edits it and sends it from its own account.
 */

const RECENT = 3;
const clip = (s: string, n: number) => (s.length > n ? `${s.slice(0, n - 1)}…` : s);
const day = (iso: string | null) => (iso ? ` (posted ${iso.slice(0, 10)})` : "");

export function draftEvidence(read: Extract<LiveProfileRead, { ok: true }>): EvidenceItem[] {
  const out: EvidenceItem[] = [];
  if (read.platform === "INSTAGRAM") {
    const p = read.instagram;
    if (p.name) out.push({ label: "Name on the profile", value: p.name });
    if (p.followers !== undefined) out.push({ label: "Instagram followers (Instagram's figure)", value: p.followers });
    if (p.biography) out.push({ label: "Bio", value: clip(p.biography, 300) });
    for (const m of p.media.filter((m) => m.caption?.trim()).slice(0, RECENT))
      out.push({ label: "A recent post's caption", value: `"${clip(m.caption as string, 200)}"${day(m.postedAt)}` });
  } else {
    const c = read.youtube;
    out.push({ label: "Channel name", value: c.title });
    if (c.subscribers !== undefined) out.push({ label: "YouTube subscribers (YouTube's figure)", value: c.subscribers });
    if (c.description) out.push({ label: "Channel description", value: clip(c.description, 300) });
    for (const v of c.recent.slice(0, RECENT)) out.push({ label: "A recent video's title", value: `"${clip(v.title, 200)}"${day(v.publishedAt)}` });
  }
  return out;
}

/**
 * Removes every sentence whose numbers aren't in the evidence, keeping line
 * breaks. Removing beats rewriting: the agency sees a shorter, true draft.
 */
export function dropUngroundedSentences(text: string, input: OutreachDraftInput): { text: string; dropped: number } {
  let dropped = 0;
  const lines = text.split("\n").map((line) =>
    line
      .split(/(?<=[.!?])\s+/)
      .filter((sentence) => {
        const ok = validateOutreachGrounding(sentence, input).ok;
        if (!ok) dropped++;
        return ok;
      })
      .join(" "),
  );
  return { text: lines.join("\n").replace(/\n{3,}/g, "\n\n").trim(), dropped };
}

export type FirstMessageDraft = { subject: string; body: string; dropped: number; model: string };

export async function draftFirstMessage(params: {
  client: ScoutAiClient;
  read: Extract<LiveProfileRead, { ok: true }>;
  handle: string;
  /** The agency's own usual message, filled in for this creator. */
  example: string;
  campaign?: { title: string; guidelines: string | null; requirements: string | null; joinUrl: string } | null;
}): Promise<FirstMessageDraft> {
  const { read, campaign } = params;
  const where = read.platform === "YOUTUBE" ? "a YouTube creator (by email)" : "an Instagram creator (by Instagram DM or email)";
  const brief = [
    `A music label wants to invite ${where} to make videos with its songs.`,
    "The label's own usual first message, for intent and tone only -- do not copy it word for word:",
    `<example>\n${clip(params.example.trim(), 1500)}\n</example>`,
    "Write a short, personal first message of 3-5 sentences. Mention one specific recent post or video from the evidence by what it is about.",
    "Write in the language the creator writes in, judging only from the evidence; if that isn't clear, write in English.",
    campaign
      ? `The invitation is to the campaign "${campaign.title}".${
          campaign.guidelines || campaign.requirements
            ? ` What the campaign asks for: ${clip([campaign.guidelines, campaign.requirements].filter(Boolean).join(" "), 600)}`
            : ""
        } A link to join is added under the message automatically, so do not write any URL.`
      : "Do not write any URL.",
  ].join("\n");

  const input: OutreachDraftInput = { handle: `@${params.handle}`, brief, evidence: draftEvidence(read) };
  const draft = await draftOutreach({ input, client: params.client, model: SCOUT_MODEL, effort: "low", maxTokens: 4000 });

  const body = dropUngroundedSentences(draft.body, input);
  const subjectOk = validateOutreachGrounding(draft.subject, input).ok;
  const withLink = campaign ? `${body.text}\n\n${campaign.joinUrl}` : body.text;
  return {
    subject: subjectOk ? draft.subject : "",
    body: withLink,
    dropped: body.dropped + (subjectOk ? 0 : 1),
    model: SCOUT_MODEL,
  };
}
