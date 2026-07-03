describe("CI gate verification (deliberate failure — will be reverted)", () => {
  it("fails on purpose to prove the merge gate blocks broken tests", () => {
    expect(1).toBe(2);
  });
});
