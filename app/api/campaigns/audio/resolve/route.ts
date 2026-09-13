import { NextResponse } from "next/server";
import { z } from "zod";
import { auth } from "@/lib/auth";
import { identifyAudioLink } from "@/lib/campaigns/audioLink";
import { readOneTikTokAudioUsage } from "@/lib/platforms/tiktokAudioUsage";

/**
 * What a pasted sound link points at, without attaching it to anything.
 *
 * The setup stepper shows the operator what it found before it writes -- a
 * short TikTok link is opaque until it is followed, so "Continue" used to mean
 * "attach whatever this turns out to be". identifyAudioLink is the same
 * resolution the PATCH runs and it writes nothing, so this is that call with a
 * session check in front of it.
 *
 * Read-only and org-agnostic on purpose: it resolves a public URL and touches
 * no row, so there is nothing here to scope by orgId. The session check is to
 * keep link-expansion from being a free service to the internet.
 */
const bodySchema = z.object({ url: z.string().trim().min(1).max(2048) });

export async function POST(req: Request) {
  const session = await auth();
  if (!session?.user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const parsed = bodySchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json({ error: "invalid_body", message: "Paste a sound link." }, { status: 400 });
  }

  const result = await identifyAudioLink(parsed.data.url);
  if (!result.ok) {
    return NextResponse.json({ error: result.reason, message: result.message }, { status: 400 });
  }

  /* The artwork, read here rather than left to the nightly job.
     Campaign.thumbnailUrl used to be a field somebody typed a URL into, and
     since the wizard stopped asking for one every new campaign fell back to
     its initials -- which is what a campaign called "Practise" showing "PR"
     is. The cover belongs to the sound the campaign is already naming, so the
     import reads it now and hands it back for the form to keep.

     readOneTikTokAudioUsage is the shared ladder: one embed fetch on a healthy
     read, and a sandbox only if that came back empty -- which is what makes it
     affordable on a button press. It is TikTok-only; an Instagram audio link
     resolves to an id with no page we can read, so it comes back without
     artwork rather than paying a timeout to find that out again. */
  const stats =
    result.audio.platform === "TIKTOK"
      ? await readOneTikTokAudioUsage(result.audio.tiktokSoundId).catch(() => null)
      : null;
  const reading = stats?.ok ? stats.stats : null;

  return NextResponse.json({
    platform: result.audio.platform,
    soundId: result.audio.tiktokSoundId,
    /* Whatever the URL slug spells out. The embed carries the artist and the
       cover but never the track title, so this stays the label to confirm
       against. */
    provisionalTitle: result.audio.provisionalTitle ?? null,
    artist: reading?.artist ?? null,
    coverImageUrl: reading?.coverImageUrl ?? null,
    usesCount: reading?.usesCount ?? null,
  });
}
