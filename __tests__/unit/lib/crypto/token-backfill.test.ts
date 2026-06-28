import { randomBytes } from "crypto";
import { encrypt } from "@/lib/crypto/encrypt";
import { planReencrypt, findPlaintext } from "@/lib/crypto/token-backfill";

process.env.TOKEN_ENCRYPTION_KEY = randomBytes(32).toString("base64");

describe("token-backfill — planReencrypt", () => {
  it("encrypts a plaintext accessToken (no refresh)", () => {
    const plan = planReencrypt({ accessToken: "plain", refreshToken: null, orgId: "org-1" });
    expect(plan).not.toBeNull();
    expect(plan!.accessToken).toBeDefined();
    expect(plan!.refreshToken).toBeUndefined();
  });

  it("encrypts both tokens when both are plaintext", () => {
    const plan = planReencrypt({ accessToken: "a", refreshToken: "r", orgId: "org-1" });
    expect(plan!.accessToken).toBeDefined();
    expect(plan!.refreshToken).toBeDefined();
  });

  it("is idempotent — skips already-encrypted rows", () => {
    const plan = planReencrypt({
      accessToken: encrypt("a", "org-1"),
      refreshToken: encrypt("r", "org-1"),
      orgId: "org-1",
    });
    expect(plan).toBeNull();
  });

  it("only re-encrypts the plaintext side of a mixed row", () => {
    const plan = planReencrypt({
      accessToken: encrypt("a", "org-1"),
      refreshToken: "still-plain",
      orgId: "org-1",
    });
    expect(plan!.accessToken).toBeUndefined();
    expect(plan!.refreshToken).toBeDefined();
  });
});

describe("token-backfill — findPlaintext (CI guard)", () => {
  it("flags rows with a plaintext access or refresh token", () => {
    const enc = encrypt("a", "org-1");
    const rows = [
      { id: "ok", accessToken: enc, refreshToken: null },
      { id: "bad-access", accessToken: "plain", refreshToken: null },
      { id: "bad-refresh", accessToken: enc, refreshToken: "plain" },
    ];
    expect(findPlaintext(rows).sort()).toEqual(["bad-access", "bad-refresh"]);
  });

  it("passes when every token is encrypted", () => {
    const enc = encrypt("a", "org-1");
    const rows = [{ id: "ok", accessToken: enc, refreshToken: encrypt("r", "org-1") }];
    expect(findPlaintext(rows)).toEqual([]);
  });
});
