/**
 * @jest-environment node
 *
 * Telling a HEIC from its bytes (lib/media/heifSniff). An iPhone photo saved as
 * photo.jpg is declared image/jpeg, and only the ftyp box says it is HEIC.
 */
import { readFileSync } from "node:fs";
import path from "node:path";
import { isHeifContainer } from "@/lib/media/heifSniff";

function ftyp(major: string, compatible: string[]): Uint8Array {
  const size = 16 + compatible.length * 4;
  const buf = Buffer.alloc(size + 8);
  buf.writeUInt32BE(size, 0);
  buf.write("ftyp", 4, "latin1");
  buf.write(major, 8, "latin1");
  compatible.forEach((b, i) => buf.write(b, 16 + i * 4, "latin1"));
  buf.write("meta", size + 4, "latin1");
  return buf;
}

describe("isHeifContainer", () => {
  it("knows an iPhone HEIC saved under a .jpg name", () => {
    const bytes = readFileSync(path.join(__dirname, "../../fixtures/heic-saved-as.jpg"));
    expect(isHeifContainer(bytes)).toBe(true);
  });

  it("knows HEIC by its major brand, or by a compatible brand under mif1", () => {
    expect(isHeifContainer(ftyp("heic", ["mif1", "heic"]))).toBe(true);
    expect(isHeifContainer(ftyp("heix", []))).toBe(true);
    expect(isHeifContainer(ftyp("mif1", ["heic"]))).toBe(true);
  });

  it("leaves AVIF to sharp, though it shares the container and the mif1 brand", () => {
    expect(isHeifContainer(ftyp("avif", ["mif1", "miaf"]))).toBe(false);
    expect(isHeifContainer(ftyp("mif1", ["avif", "miaf"]))).toBe(false);
  });

  it("says no to other pictures, to video in the same container, and to short input", () => {
    expect(isHeifContainer(Buffer.from("\x89PNG\r\n\x1a\n0000000000000000", "latin1"))).toBe(false);
    expect(isHeifContainer(Buffer.from("\xff\xd8\xff\xe0000000000000000000", "latin1"))).toBe(false);
    expect(isHeifContainer(Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"/>'))).toBe(false);
    expect(isHeifContainer(ftyp("isom", ["iso2", "mp41"]))).toBe(false);
    expect(isHeifContainer(Buffer.from("ftyp"))).toBe(false);
  });
});
