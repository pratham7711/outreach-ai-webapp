import { encrypt, decrypt, isEncrypted } from "@/lib/crypto/encrypt";
import { randomBytes } from "crypto";

const KEY_A = randomBytes(32).toString("base64");
const KEY_B = randomBytes(32).toString("base64");

function setKey(k: string) {
  process.env.TOKEN_ENCRYPTION_KEY = k;
}

describe("lib/crypto/encrypt — AES-256-GCM token crypto", () => {
  beforeEach(() => setKey(KEY_A));

  it("round-trips ASCII tokens", () => {
    const s = "ya29.a0AfH6SMB-secret-access-token";
    expect(decrypt(encrypt(s))).toBe(s);
  });

  it("round-trips unicode, empty, and long strings", () => {
    for (const s of ["", "🔐 café — naïve", "x".repeat(5000)]) {
      expect(decrypt(encrypt(s))).toBe(s);
    }
  });

  it("uses a random IV — same input yields different ciphertext, both decrypt equal", () => {
    const s = "same-token";
    const a = encrypt(s);
    const b = encrypt(s);
    expect(a).not.toBe(b);
    expect(decrypt(a)).toBe(s);
    expect(decrypt(b)).toBe(s);
  });

  it("never embeds plaintext and is detectable via isEncrypted()", () => {
    const s = "plaintext-token";
    const enc = encrypt(s);
    expect(enc).not.toContain(s);
    expect(enc.startsWith("enc:v1:")).toBe(true);
    expect(isEncrypted(enc)).toBe(true);
    expect(isEncrypted(s)).toBe(false);
    expect(isEncrypted("ya29.real-looking-but-plain")).toBe(false);
  });

  it("detects tampering — mutating the ciphertext throws", () => {
    const enc = encrypt("token");
    const parts = enc.split(":");
    const ct = Buffer.from(parts[4], "base64");
    ct[0] = ct[0] ^ 0xff;
    parts[4] = ct.toString("base64");
    expect(() => decrypt(parts.join(":"))).toThrow();
  });

  it("fails closed on the wrong key", () => {
    const enc = encrypt("token");
    setKey(KEY_B);
    expect(() => decrypt(enc)).toThrow();
  });

  it("rejects a key that is not 32 bytes", () => {
    setKey(randomBytes(16).toString("base64"));
    expect(() => encrypt("token")).toThrow(/32 bytes/);
  });

  it("rejects a missing key", () => {
    delete process.env.TOKEN_ENCRYPTION_KEY;
    expect(() => encrypt("token")).toThrow(/TOKEN_ENCRYPTION_KEY/);
  });

  it("rejects malformed payloads on decrypt", () => {
    expect(() => decrypt("not-an-encrypted-token")).toThrow();
    expect(() => decrypt("enc:v1:only:three")).toThrow();
    expect(() => decrypt("enc:v1:!!!!:!!!!:!!!!")).toThrow();
  });

  it("rejects a wrong-length IV or auth tag (no truncated-tag forgery)", () => {
    const parts = encrypt("token").split(":");
    const badIv = [...parts];
    badIv[2] = randomBytes(8).toString("base64");
    expect(() => decrypt(badIv.join(":"))).toThrow();
    const badTag = [...parts];
    badTag[3] = randomBytes(4).toString("base64");
    expect(() => decrypt(badTag.join(":"))).toThrow();
  });

  it("detects a bit-flip in the IV or tag segment", () => {
    for (const seg of [2, 3]) {
      const parts = encrypt("token").split(":");
      const b = Buffer.from(parts[seg], "base64");
      b[0] = b[0] ^ 0xff;
      parts[seg] = b.toString("base64");
      expect(() => decrypt(parts.join(":"))).toThrow();
    }
  });

  it("binds AAD context — decrypt fails unless the same context is supplied", () => {
    const s = "scoped-token";
    const enc = encrypt(s, "org_123");
    expect(decrypt(enc, "org_123")).toBe(s);
    expect(() => decrypt(enc)).toThrow();
    expect(() => decrypt(enc, "org_456")).toThrow();
  });

  it("rejects non-string plaintext", () => {
    expect(() => encrypt(null as unknown as string)).toThrow(/string/);
    expect(() => encrypt(undefined as unknown as string)).toThrow(/string/);
  });

  it("rejects an all-zero key", () => {
    setKey(Buffer.alloc(32).toString("base64"));
    expect(() => encrypt("token")).toThrow(/all-zero/);
  });
});
