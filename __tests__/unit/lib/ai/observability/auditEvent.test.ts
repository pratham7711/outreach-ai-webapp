import {
  buildAuditEvent,
  redactValue,
  REDACTED,
  REDACTED_EMAIL,
  REDACTED_SSN,
  CIRCULAR,
} from "@/lib/ai/observability/auditEvent";
import type { RawToolCall } from "@/lib/ai/observability/auditEvent";

const ctx = { orgId: "org_real", userId: "user_1" };

describe("buildAuditEvent multi-tenancy", () => {
  it("takes orgId ONLY from ctx and ignores attacker-set raw.orgId", () => {
    const raw: RawToolCall = {
      tool: "sendEmail",
      orgId: "victim",
      userId: "spoofed",
      input: { to: "a@b.com" },
      status: "ok",
    };
    const event = buildAuditEvent(raw, ctx);
    expect(event.orgId).toBe("org_real");
    expect(event.orgId).not.toBe("victim");
    expect(event.userId).toBe("user_1");
  });

  it("never lets a raw.orgId leak even when ctx.userId is absent", () => {
    const event = buildAuditEvent(
      { tool: "t", orgId: "victim", input: {} },
      { orgId: "org_real" },
    );
    expect(event.orgId).toBe("org_real");
    expect(event.userId).toBeUndefined();
  });
});

describe("buildAuditEvent secret-key redaction", () => {
  it("redacts a password key at the top level", () => {
    const event = buildAuditEvent(
      { tool: "t", input: { password: "hunter2", user: "alice" } },
      ctx,
    );
    const input = event.input as Record<string, unknown>;
    expect(input.password).toBe(REDACTED);
    expect(input.user).toBe("alice");
  });

  it("redacts an apiKey and a token key at deep nesting", () => {
    const event = buildAuditEvent(
      {
        tool: "t",
        input: {
          level1: { level2: { apiKey: "abc", nested: { token: "xyz" } } },
        },
      },
      ctx,
    );
    const lvl2 = (
      (event.input as Record<string, Record<string, Record<string, unknown>>>)
        .level1.level2
    );
    expect(lvl2.apiKey).toBe(REDACTED);
    expect((lvl2.nested as Record<string, unknown>).token).toBe(REDACTED);
  });

  it("redacts api_key, authorization, cookie, ssn, creditCard, accessKey, privateKey, bearer keys", () => {
    const event = buildAuditEvent(
      {
        tool: "t",
        input: {
          api_key: "x",
          authorization: "y",
          cookie: "z",
          ssn: "111-22-3333",
          creditCard: "4111111111111111",
          accessKey: "a",
          privateKey: "b",
          bearer: "c",
        },
      },
      ctx,
    );
    const input = event.input as Record<string, unknown>;
    for (const k of [
      "api_key",
      "authorization",
      "cookie",
      "ssn",
      "creditCard",
      "accessKey",
      "privateKey",
      "bearer",
    ]) {
      expect(input[k]).toBe(REDACTED);
    }
  });
});

describe("buildAuditEvent value-level redaction", () => {
  it("redacts an email value regardless of key", () => {
    const event = buildAuditEvent(
      { tool: "t", input: { contact: "jane.doe@example.com" } },
      ctx,
    );
    expect((event.input as Record<string, unknown>).contact).toBe(
      REDACTED_EMAIL,
    );
  });

  it("redacts a JWT/bearer-like token value", () => {
    const jwt =
      "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJzdWIiOiIxMjM0NTY3ODkwIn0.dQw4w9WgXcQabcDEF";
    const event = buildAuditEvent(
      { tool: "t", input: { note: jwt } },
      ctx,
    );
    expect((event.input as Record<string, unknown>).note).toBe(REDACTED);
  });

  it("redacts a long hex/base64 secret value", () => {
    const hex = "a1b2c3d4e5f60718293a4b5c6d7e8f90";
    const event = buildAuditEvent(
      { tool: "t", input: { blob: hex } },
      ctx,
    );
    expect((event.input as Record<string, unknown>).blob).toBe(REDACTED);
  });

  it("redacts a card-like digit string value", () => {
    const event = buildAuditEvent(
      { tool: "t", input: { ref: "4111 1111 1111 1111" } },
      ctx,
    );
    expect((event.input as Record<string, unknown>).ref).toBe(REDACTED);
  });

  it("redacts a bare SSN value under a non-secret key", () => {
    const event = buildAuditEvent(
      { tool: "t", input: { note: "subject ssn is 111-22-3333 on file" } },
      ctx,
    );
    expect((event.input as Record<string, unknown>).note).toBe(REDACTED_SSN);
    expect(redactValue("111-22-3333")).toBe(REDACTED_SSN);
  });
});

describe("buildAuditEvent recursion and preservation", () => {
  it("recurses through arrays", () => {
    const event = buildAuditEvent(
      {
        tool: "t",
        input: {
          items: [{ password: "p" }, "team@corp.com", "safe-string"],
        },
      },
      ctx,
    );
    const items = (event.input as Record<string, unknown[]>).items;
    expect((items[0] as Record<string, unknown>).password).toBe(REDACTED);
    expect(items[1]).toBe(REDACTED_EMAIL);
    expect(items[2]).toBe("safe-string");
  });

  it("preserves a non-secret field like creatorName", () => {
    const event = buildAuditEvent(
      { tool: "t", input: { creatorName: "Ava Music", followers: 12000 } },
      ctx,
    );
    const input = event.input as Record<string, unknown>;
    expect(input.creatorName).toBe("Ava Music");
    expect(input.followers).toBe(12000);
  });
});

describe("buildAuditEvent robustness", () => {
  it("does not hang on a circular reference and emits [CIRCULAR]", () => {
    const cyclic: Record<string, unknown> = { name: "loop" };
    cyclic.self = cyclic;
    const event = buildAuditEvent(
      { tool: "t", input: cyclic },
      ctx,
    );
    const input = event.input as Record<string, unknown>;
    expect(input.name).toBe("loop");
    expect(input.self).toBe(CIRCULAR);
  });

  it("handles non-object input (string / number / null)", () => {
    expect(redactValue("plain")).toBe("plain");
    expect(redactValue("user@host.com")).toBe(REDACTED_EMAIL);
    expect(redactValue(42)).toBe(42);
    expect(redactValue(null)).toBeNull();
    expect(redactValue(undefined)).toBeUndefined();

    const event = buildAuditEvent({ tool: "t", input: "private@x.io" }, ctx);
    expect(event.input).toBe(REDACTED_EMAIL);
  });

  it("does not throw on functions, symbols, bigint and guards NaN/Infinity", () => {
    const event = buildAuditEvent(
      {
        tool: "t",
        input: {
          fn: () => 1,
          sym: Symbol("s"),
          big: BigInt(9),
          bad: Number.NaN,
          inf: Number.POSITIVE_INFINITY,
          keep: "ok",
        },
      },
      ctx,
    );
    const input = event.input as Record<string, unknown>;
    expect("fn" in input).toBe(false);
    expect("sym" in input).toBe(false);
    expect(input.big).toBe("9");
    expect(input.bad).toBeNull();
    expect(input.inf).toBeNull();
    expect(input.keep).toBe("ok");
  });

  it("is deterministic for the same input", () => {
    const raw: RawToolCall = {
      tool: "scoreCreator",
      orgId: "victim",
      input: { password: "p", email: "x@y.com", creatorName: "Bo" },
      output: { token: "t", score: 88 },
      status: "ok",
    };
    const a = buildAuditEvent(raw, ctx);
    const b = buildAuditEvent(raw, ctx);
    expect(a).toEqual(b);
  });

  it("derives status default and clones without mutating the source", () => {
    const raw: RawToolCall = {
      tool: "t",
      input: { password: "p", keep: "v" },
    };
    const event = buildAuditEvent(raw, ctx);
    expect(event.status).toBe("unknown");
    expect((raw.input as Record<string, unknown>).password).toBe("p");
    expect((event.input as Record<string, unknown>).password).toBe(REDACTED);
  });
});
