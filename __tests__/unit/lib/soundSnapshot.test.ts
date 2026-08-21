import { velocityBetween } from "@/lib/trackers/metrics";

// Stored as velocityScore on each snapshot when it is recorded.
describe("velocityBetween", () => {
  it("reads a doubling as 100", () => {
    expect(velocityBetween(1000, 2000)).toBe(100);
  });

  it("reads half that growth as 50", () => {
    expect(velocityBetween(1000, 1500)).toBe(50);
  });

  it("reads no movement as 0", () => {
    expect(velocityBetween(1000, 1000)).toBe(0);
  });

  it("goes negative when a count falls", () => {
    expect(velocityBetween(1000, 900)).toBe(-10);
  });

  it("treats the first non-zero reading as 100 rather than dividing by zero", () => {
    expect(velocityBetween(0, 5000)).toBe(100);
    expect(velocityBetween(0, 0)).toBe(0);
  });

  it("keeps two decimals instead of a float tail", () => {
    expect(velocityBetween(3, 4)).toBe(33.33);
  });
});
