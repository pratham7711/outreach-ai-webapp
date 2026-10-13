import { waitUntil } from "@/lib/ops/waitUntil";

describe("waitUntil", () => {
  it("hands back the value of work that settles in time", async () => {
    await expect(waitUntil(Promise.resolve(7), Date.now() + 1_000)).resolves.toEqual({ settled: true, value: 7 });
  });

  it("stops waiting at the given time on work that never settles", async () => {
    const started = Date.now();
    const result = await waitUntil(new Promise<never>(() => {}), started + 30);
    expect(result).toEqual({ settled: false });
    expect(Date.now() - started).toBeLessThan(1_000);
  });

  it("passes a rejection through when it lands in time", async () => {
    await expect(waitUntil(Promise.reject(new Error("boom")), Date.now() + 1_000)).rejects.toThrow("boom");
  });

  it("does not leave a late rejection unhandled", async () => {
    const unhandled = jest.fn();
    process.on("unhandledRejection", unhandled);
    try {
      const late = new Promise<never>((_, reject) => setTimeout(() => reject(new Error("late")), 40));
      await expect(waitUntil(late, Date.now() + 5)).resolves.toEqual({ settled: false });
      await new Promise((r) => setTimeout(r, 80));
      expect(unhandled).not.toHaveBeenCalled();
    } finally {
      process.off("unhandledRejection", unhandled);
    }
  });
});
