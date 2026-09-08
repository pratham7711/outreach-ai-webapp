import { explicitSslMode } from "@/lib/dbUrl";

describe("explicitSslMode", () => {
  it("names the mode pg already applies, so the cold-start warning goes away", () => {
    expect(explicitSslMode("postgresql://u:p@h/db?sslmode=require&channel_binding=require")).toBe(
      "postgresql://u:p@h/db?sslmode=verify-full&channel_binding=require",
    );
    expect(explicitSslMode("postgresql://u:p@h/db?sslmode=require")).toBe(
      "postgresql://u:p@h/db?sslmode=verify-full",
    );
    expect(explicitSslMode("postgresql://u:p@h/db?a=1&sslmode=prefer")).toBe(
      "postgresql://u:p@h/db?a=1&sslmode=verify-full",
    );
  });

  it("leaves every other URL alone", () => {
    for (const url of [
      "postgresql://u:p@h/db?sslmode=verify-full",
      "postgresql://u:p@h/db?sslmode=disable",
      "postgresql://u:p@h/db",
      // a password that happens to contain the word is not a query parameter
      "postgresql://u:sslmode=require@h/db",
    ]) {
      expect(explicitSslMode(url)).toBe(url);
    }
    expect(explicitSslMode(undefined)).toBeUndefined();
  });
});
