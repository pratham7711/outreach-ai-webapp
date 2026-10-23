/**
 * Whether these bytes are a HEIC/HEIF picture, read from the file itself.
 *
 * The declared type is not enough: an iPhone photo saved or renamed as
 * `photo.jpg` arrives as image/jpeg with HEIC inside, and sharp cannot decode
 * those pixels (its libvips has no HEVC plugin; lib/media/loadImage decodes
 * them with libheif instead). The file starts with an ISO-BMFF `ftyp` box whose
 * major and compatible brands say what it is. AVIF shares the container and
 * carries `mif1` too, but sharp reads AVIF itself, so a brand list naming avif
 * is not HEIC.
 */
const HEIC_BRANDS = new Set(["heic", "heix", "heim", "heis", "hevc", "hevx", "hevm", "hevs", "mif1", "msf1"]);
const AVIF_BRANDS = new Set(["avif", "avis"]);

export function isHeifContainer(bytes: Uint8Array): boolean {
  if (bytes.byteLength < 16) return false;
  const ascii = (at: number) => String.fromCharCode(bytes[at], bytes[at + 1], bytes[at + 2], bytes[at + 3]);
  if (ascii(4) !== "ftyp") return false;
  const boxSize = ((bytes[0] << 24) | (bytes[1] << 16) | (bytes[2] << 8) | bytes[3]) >>> 0;
  const end = Math.min(bytes.byteLength, boxSize >= 16 ? boxSize : 16);
  /* The major brand at 8, the minor version at 12, compatible brands from 16. */
  const brands = [ascii(8)];
  for (let at = 16; at + 4 <= end; at += 4) brands.push(ascii(at));
  if (brands.some((b) => AVIF_BRANDS.has(b))) return false;
  return brands.some((b) => HEIC_BRANDS.has(b));
}
