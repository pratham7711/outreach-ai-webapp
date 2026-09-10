import { encrypt, decrypt } from "@/lib/crypto/encrypt";
import {
  TOKEN_AAD_ORG,
  TOKEN_AAD_ROW,
  TOKEN_AAD_SELECT,
  TokenAadError,
  needsReseal,
  tokenAadFor,
} from "@/lib/crypto/tokenContext";

describe("tokenAadFor", () => {
  it("uses the row's own id once the row is sealed with it", () => {
    expect(
      tokenAadFor({ id: "csa-1", tokenAad: TOKEN_AAD_ROW, legacyAadOrgId: "org-1" }),
    ).toBe("csa-1");
  });

  it("uses the captured orgId for a row still on the legacy scheme", () => {
    expect(
      tokenAadFor({ id: "csa-1", tokenAad: TOKEN_AAD_ORG, legacyAadOrgId: "org-1" }),
    ).toBe("org-1");
  });

  it("treats a null marker as the legacy scheme, which is what pre-column rows carry", () => {
    expect(tokenAadFor({ id: "csa-1", tokenAad: null, legacyAadOrgId: "org-1" })).toBe(
      "org-1",
    );
  });

  it("throws on a legacy row with no captured orgId rather than guessing", () => {
    // The whole point of the marker column: AES-GCM cannot tell a wrong AAD
    // from a corrupt ciphertext, so a silent fallback here would hide a
    // backfill that missed rows.
    expect(() => tokenAadFor({ id: "csa-1", tokenAad: null, legacyAadOrgId: null })).toThrow(
      TokenAadError,
    );
    expect(() =>
      tokenAadFor({ id: "csa-1", tokenAad: TOKEN_AAD_ORG, legacyAadOrgId: null }),
    ).toThrow(/legacyAadOrgId/);
  });

  it("throws on an unrecognised marker", () => {
    expect(() =>
      tokenAadFor({ id: "csa-1", tokenAad: "creatorUser", legacyAadOrgId: "org-1" }),
    ).toThrow(/unknown tokenAad/);
  });

  it("names the row in every error, because the caller only has the row", () => {
    expect(() => tokenAadFor({ id: "csa-42", tokenAad: "nope", legacyAadOrgId: null })).toThrow(
      /csa-42/,
    );
  });
});

describe("needsReseal", () => {
  it("is true for every row not yet sealed with its own id", () => {
    expect(needsReseal({ tokenAad: null })).toBe(true);
    expect(needsReseal({ tokenAad: TOKEN_AAD_ORG })).toBe(true);
    expect(needsReseal({ tokenAad: TOKEN_AAD_ROW })).toBe(false);
  });
});

describe("TOKEN_AAD_SELECT", () => {
  it("selects everything tokenAadFor reads", () => {
    // A read path that selects the ciphertext without these three cannot open
    // it, and the failure surfaces as a permanent needsReconnect.
    expect(Object.keys(TOKEN_AAD_SELECT).sort()).toEqual([
      "id",
      "legacyAadOrgId",
      "tokenAad",
    ]);
  });
});

describe("round-tripping a real token through both schemes", () => {
  const KEY = process.env.TOKEN_ENCRYPTION_KEY;
  beforeAll(() => {
    process.env.TOKEN_ENCRYPTION_KEY = Buffer.alloc(32, 7).toString("base64");
  });
  afterAll(() => {
    if (KEY === undefined) delete process.env.TOKEN_ENCRYPTION_KEY;
    else process.env.TOKEN_ENCRYPTION_KEY = KEY;
  });

  it("opens a legacy row with the org context and a resealed row with its id", () => {
    const legacy = { id: "csa-1", tokenAad: null, legacyAadOrgId: "org-1" };
    const sealed = encrypt("access-token", tokenAadFor(legacy));
    expect(decrypt(sealed, tokenAadFor(legacy))).toBe("access-token");

    const resealedRow = { ...legacy, tokenAad: TOKEN_AAD_ROW };
    const resealed = encrypt("access-token", tokenAadFor(resealedRow));
    expect(decrypt(resealed, tokenAadFor(resealedRow))).toBe("access-token");
  });

  it("refuses to open a resealed row with the legacy context", () => {
    // This is the regression that would read as "every creator must reconnect".
    const row = { id: "csa-1", tokenAad: TOKEN_AAD_ROW, legacyAadOrgId: "org-1" };
    const resealed = encrypt("access-token", tokenAadFor(row));
    expect(() => decrypt(resealed, "org-1")).toThrow();
  });

  it("refuses to open one row's ciphertext under another row's id", () => {
    // What keeps the row-id AAD a real binding rather than no binding at all.
    const row = { id: "csa-1", tokenAad: TOKEN_AAD_ROW, legacyAadOrgId: null };
    const sealed = encrypt("access-token", tokenAadFor(row));
    expect(() =>
      decrypt(sealed, tokenAadFor({ id: "csa-2", tokenAad: TOKEN_AAD_ROW, legacyAadOrgId: null })),
    ).toThrow();
  });
});
