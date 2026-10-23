/**
 * Getting a campaign picture ready and saving it (components/campaigns/ThumbnailDrop).
 *
 * The form used to stop any picture the browser could not shrink with "That
 * file could not be read as a picture." -- on the Edit tab, for SVG logos, TIFFs,
 * a HEIC saved as .jpg, and PNGs. The server reads all of those, so now the
 * browser shrinks what it can and the file itself goes otherwise, and a file the
 * server cannot read in its shrunk form is sent again as it is.
 */
jest.mock("@/components/ds", () => ({ Button: () => null }));

import { randomFillSync } from "node:crypto";
import { gunzipSync } from "node:zlib";
import { CompressionStream as NodeCompressionStream, ReadableStream as NodeReadableStream } from "node:stream/web";
import { prepareThumbnail, uploadCampaignThumbnail } from "@/components/campaigns/ThumbnailDrop";

const MB = 1024 * 1024;
const g = globalThis as unknown as { createImageBitmap: jest.Mock; fetch: jest.Mock };

function file(name: string, type: string, size = 2048): File {
  return new File([new Uint8Array(size)], name, { type });
}

let toBlobResult: Blob | null;
let drawn: { width: number; height: number } | null;

beforeEach(() => {
  g.createImageBitmap = jest.fn().mockRejectedValue(new DOMException("The source image could not be decoded.", "InvalidStateError"));
  URL.createObjectURL = jest.fn(() => "blob:preview");
  URL.revokeObjectURL = jest.fn();
  toBlobResult = new Blob([new Uint8Array(900)], { type: "image/webp" });
  drawn = null;
  jest.spyOn(HTMLCanvasElement.prototype, "getContext").mockImplementation(function (this: HTMLCanvasElement) {
    const canvas = this;
    return { drawImage: () => { drawn = { width: canvas.width, height: canvas.height }; } } as unknown as CanvasRenderingContext2D;
  } as never);
  jest.spyOn(HTMLCanvasElement.prototype, "toBlob").mockImplementation((cb: BlobCallback) => cb(toBlobResult));
});

afterEach(() => jest.restoreAllMocks());

describe("prepareThumbnail, when the browser cannot decode the picture", () => {
  it.each([
    ["logo.svg", "image/svg+xml"],
    ["scan.tiff", "image/tiff"],
    ["IMG_0042.jpg", "image/jpeg"],
    ["design.png", "image/png"],
  ])("sends %s as it is, with its own type, for the server to read", async (name, type) => {
    const out = await prepareThumbnail(file(name, type));
    expect(out.ok).toBe(true);
    if (!out.ok) return;
    expect(out.picture.blob.type).toBe(type);
    expect(out.picture.blob.size).toBe(2048);
    expect(out.picture.fallback).toBeNull();
  });

  it("sends a HEIC as image/heic, and a picture with no type at all as bytes for the server to sniff", async () => {
    const heic = await prepareThumbnail(file("IMG_0042.HEIC", ""));
    expect(heic.ok && heic.picture.blob.type).toBe("image/heic");
    const svg = await prepareThumbnail(file("logo.svg", ""));
    expect(svg.ok && svg.picture.blob.type).toBe("application/octet-stream");
  });

  it("refuses one over the server's 4 MB cap where the browser cannot pack it, saying what to do instead", async () => {
    expect(await prepareThumbnail(file("scan.tiff", "image/tiff", 4 * MB + 1))).toEqual({
      ok: false,
      error: "That picture is over 4 MB and this browser cannot shrink it. Save it as a JPG or PNG and try again.",
    });
  });

  it("still refuses a file that is not a picture at all, before sending anything", async () => {
    expect(await prepareThumbnail(file("brief.pdf", "application/pdf"))).toEqual({
      ok: false,
      error: "Choose a picture file, such as a JPG, PNG, HEIC or SVG.",
    });
  });
});

describe("prepareThumbnail, for a file over 4 MB the browser cannot decode", () => {
  const g2 = globalThis as unknown as { CompressionStream?: unknown; Response?: unknown };

  /* jsdom has no CompressionStream, Response or File.stream; Node's are the same web streams. */
  function streamable(name: string, type: string, bytes: Uint8Array<ArrayBuffer>): File {
    const f = new File([bytes], name, { type });
    return Object.assign(f, {
      stream: () => new NodeReadableStream({ start(c) { c.enqueue(bytes); c.close(); } }),
    });
  }
  let sent: Uint8Array[];

  beforeEach(() => {
    sent = [];
    g2.CompressionStream = NodeCompressionStream;
    g2.Response = class {
      constructor(private body: ReadableStream<Uint8Array<ArrayBuffer>>) {}
      async blob() {
        const reader = this.body.getReader();
        const parts: Uint8Array<ArrayBuffer>[] = [];
        for (let r = await reader.read(); !r.done; r = await reader.read()) parts.push(r.value);
        sent = parts;
        return new Blob(parts);
      }
    };
  });
  afterEach(() => {
    delete g2.CompressionStream;
    delete g2.Response;
  });

  it("sends it gzipped when that brings it under the cap, as a large TIFF does", async () => {
    const tiff = new Uint8Array(9 * MB).fill(7);
    const out = await prepareThumbnail(streamable("scan.tiff", "image/tiff", tiff));
    expect(out.ok).toBe(true);
    if (!out.ok) return;
    expect(out.picture.gzipped).toBe(true);
    expect(out.picture.blob.type).toBe("image/tiff");
    expect(out.picture.blob.size).toBeLessThan(MB);
    expect(gunzipSync(Buffer.concat(sent)).equals(Buffer.from(tiff))).toBe(true);
  });

  it("still refuses one that stays over the cap gzipped, such as one already compressed", async () => {
    const noise = randomFillSync(new Uint8Array(5 * MB));
    expect(await prepareThumbnail(streamable("noise.tiff", "image/tiff", noise))).toEqual({
      ok: false,
      error: "That picture is over 4 MB and this browser cannot shrink it. Save it as a JPG or PNG and try again.",
    });
  });
});

describe("prepareThumbnail, when the browser can decode it", () => {
  beforeEach(() => {
    g.createImageBitmap = jest.fn().mockResolvedValue({ width: 4000, height: 2000, close: jest.fn() });
  });

  it("sends a 1024px WebP, with the file itself kept as the fallback", async () => {
    const out = await prepareThumbnail(file("photo.png", "image/png", 3 * MB));
    expect(drawn).toEqual({ width: 1024, height: 512 });
    expect(out.ok).toBe(true);
    if (!out.ok) return;
    expect(out.picture.blob.type).toBe("image/webp");
    expect(out.picture.fallback?.type).toBe("image/png");
  });

  it("shrinks a picture over 4 MB, which then has no fallback", async () => {
    const out = await prepareThumbnail(file("photo.jpg", "image/jpeg", 12 * MB));
    expect(out.ok && out.picture.blob.type).toBe("image/webp");
    expect(out.ok && out.picture.fallback).toBeNull();
  });

  it("sends the file itself when the browser decodes it but cannot encode the WebP", async () => {
    toBlobResult = null;
    const out = await prepareThumbnail(file("design.png", "image/png"));
    expect(out.ok && out.picture.blob.type).toBe("image/png");
  });
});

describe("uploadCampaignThumbnail", () => {
  const webp = new Blob(["w"], { type: "image/webp" });
  const png = new Blob(["p"], { type: "image/png" });
  const answer = (status: number, body: unknown) => Promise.resolve({ ok: status < 300, status, json: () => Promise.resolve(body) });

  it("sends the file itself when the server cannot read the shrunk one", async () => {
    g.fetch = jest.fn()
      .mockReturnValueOnce(answer(422, { error: "That file could not be read as a picture." }))
      .mockReturnValueOnce(answer(200, { thumbnailUrl: "/api/campaigns/c1/thumbnail?upload=ab" }));
    expect(await uploadCampaignThumbnail("c1", { blob: webp, fallback: png })).toEqual({ ok: true, thumbnailUrl: "/api/campaigns/c1/thumbnail?upload=ab" });
    expect(g.fetch).toHaveBeenCalledTimes(2);
    expect(g.fetch.mock.calls[1][1].headers["Content-Type"]).toBe("image/png");
  });

  it("does not resend on a refusal that has nothing to do with the picture", async () => {
    g.fetch = jest.fn().mockReturnValue(answer(403, { error: "Forbidden" }));
    expect(await uploadCampaignThumbnail("c1", { blob: webp, fallback: png })).toEqual({ ok: false, error: "Forbidden" });
    expect(g.fetch).toHaveBeenCalledTimes(1);
  });

  it("tells the server a gzipped picture is packed", async () => {
    g.fetch = jest.fn().mockReturnValue(answer(200, { thumbnailUrl: "/api/campaigns/c1/thumbnail?upload=cd" }));
    await uploadCampaignThumbnail("c1", { blob: png, fallback: null, gzipped: true });
    expect(g.fetch.mock.calls[0][1].headers["X-Picture-Encoding"]).toBe("gzip");
    await uploadCampaignThumbnail("c1", { blob: png, fallback: null });
    expect(g.fetch.mock.calls[1][1].headers["X-Picture-Encoding"]).toBeUndefined();
  });

  it("reports the server's words when there is nothing else to send", async () => {
    g.fetch = jest.fn().mockReturnValue(answer(422, { error: "That file could not be read as a picture." }));
    expect(await uploadCampaignThumbnail("c1", { blob: png, fallback: null })).toEqual({ ok: false, error: "That file could not be read as a picture." });
  });
});
