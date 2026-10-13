/**
 * @jest-environment node
 *
 * The once-a-minute re-read of a signed-in user's row, remembered per instance.
 * The bound that matters is the security one: no answer is served past the TTL.
 */
jest.mock("@/lib/db", () => ({ db: { user: { findUnique: jest.fn() } } }));

import { db } from "@/lib/db";
import { ACCOUNT_CHECK_TTL_MS, forgetAccount, readAccount } from "@/lib/accountCheck";

const findUnique = (db as unknown as { user: { findUnique: jest.Mock } }).user.findUnique;
const row = (over: Record<string, unknown> = {}) => ({
  role: "ADMIN", isActive: true, campaignScope: "ALL", orgId: "org-1",
  email: "ada@acme.test", emailVerified: null, ...over,
});

beforeEach(() => {
  jest.clearAllMocks();
  forgetAccount();
});

describe("readAccount", () => {
  it("reads once and answers from memory inside the TTL", async () => {
    findUnique.mockResolvedValue(row());
    const t0 = Date.now();
    await readAccount("u-1", t0);
    const again = await readAccount("u-1", t0 + ACCOUNT_CHECK_TTL_MS - 1);
    expect(findUnique).toHaveBeenCalledTimes(1);
    expect(again.row).toMatchObject({ role: "ADMIN" });
  });

  it("re-reads at the TTL, so a demotion is seen within it", async () => {
    findUnique.mockResolvedValueOnce(row()).mockResolvedValueOnce(row({ role: "VIEWER" }));
    const first = await readAccount("u-1");
    const later = await readAccount("u-1", first.at + ACCOUNT_CHECK_TTL_MS);
    expect(findUnique).toHaveBeenCalledTimes(2);
    expect(later.row).toMatchObject({ role: "VIEWER" });
  });

  it("remembers a missing row as null rather than re-querying it", async () => {
    findUnique.mockResolvedValue(null);
    const first = await readAccount("gone");
    const second = await readAccount("gone", first.at + 1);
    expect(second.row).toBeNull();
    expect(findUnique).toHaveBeenCalledTimes(1);
  });

  it("keeps users apart", async () => {
    findUnique.mockImplementation(({ where }: { where: { id: string } }) => Promise.resolve(row({ orgId: `org-of-${where.id}` })));
    expect((await readAccount("a")).row?.orgId).toBe("org-of-a");
    expect((await readAccount("b")).row?.orgId).toBe("org-of-b");
  });

  it("forgets one user on request, so the next read is fresh", async () => {
    findUnique.mockResolvedValueOnce(row()).mockResolvedValueOnce(row({ emailVerified: new Date(0) }));
    await readAccount("u-1");
    forgetAccount("u-1");
    const fresh = await readAccount("u-1");
    expect(findUnique).toHaveBeenCalledTimes(2);
    expect(fresh.row?.emailVerified).toEqual(new Date(0));
  });

  it("lets a database error through and remembers nothing", async () => {
    findUnique.mockRejectedValueOnce(new Error("ECONNRESET")).mockResolvedValueOnce(row());
    await expect(readAccount("u-1")).rejects.toThrow("ECONNRESET");
    await expect(readAccount("u-1")).resolves.toMatchObject({ row: { role: "ADMIN" } });
  });
});
