import { createCipheriv, createDecipheriv, randomBytes } from "crypto";

const VERSION = "v1";
const PREFIX = `enc:${VERSION}:`;
const AAD_BASE = `enc:${VERSION}`;
const ALGORITHM = "aes-256-gcm";
const IV_BYTES = 12;
const TAG_BYTES = 16;
const KEY_BYTES = 32;

function loadKey(): Buffer {
  const raw = process.env.TOKEN_ENCRYPTION_KEY;
  if (!raw) {
    throw new Error(
      "TOKEN_ENCRYPTION_KEY is not set; cannot encrypt or decrypt tokens.",
    );
  }
  const key = Buffer.from(raw, "base64");
  if (key.length !== KEY_BYTES) {
    throw new Error(
      `TOKEN_ENCRYPTION_KEY must decode to ${KEY_BYTES} bytes (got ${key.length}); generate one with: openssl rand -base64 32`,
    );
  }
  if (key.every((b) => b === 0)) {
    throw new Error("TOKEN_ENCRYPTION_KEY must not be all-zero.");
  }
  return key;
}

function aad(context?: string): Buffer {
  return Buffer.from(context ? `${AAD_BASE}:${context}` : AAD_BASE, "utf8");
}

export function encrypt(plaintext: string, context?: string): string {
  if (typeof plaintext !== "string") {
    throw new Error("encrypt: plaintext must be a string.");
  }
  const iv = randomBytes(IV_BYTES);
  const cipher = createCipheriv(ALGORITHM, loadKey(), iv);
  cipher.setAAD(aad(context));
  const ciphertext = Buffer.concat([
    cipher.update(plaintext, "utf8"),
    cipher.final(),
  ]);
  const tag = cipher.getAuthTag();
  return `${PREFIX}${iv.toString("base64")}:${tag.toString("base64")}:${ciphertext.toString("base64")}`;
}

export function decrypt(payload: string, context?: string): string {
  if (!isEncrypted(payload)) {
    throw new Error("decrypt: payload is not a valid enc:v1 token.");
  }
  const [, , ivB64, tagB64, ctB64] = payload.split(":");
  const iv = Buffer.from(ivB64, "base64");
  const tag = Buffer.from(tagB64, "base64");
  if (iv.length !== IV_BYTES || tag.length !== TAG_BYTES) {
    throw new Error("decrypt: malformed token (bad IV or auth-tag length).");
  }
  const decipher = createDecipheriv(ALGORITHM, loadKey(), iv);
  decipher.setAuthTag(tag);
  decipher.setAAD(aad(context));
  const plaintext = Buffer.concat([
    decipher.update(Buffer.from(ctB64, "base64")),
    decipher.final(),
  ]);
  return plaintext.toString("utf8");
}

export function isEncrypted(value: unknown): boolean {
  return (
    typeof value === "string" &&
    value.startsWith(PREFIX) &&
    value.split(":").length === 5
  );
}
