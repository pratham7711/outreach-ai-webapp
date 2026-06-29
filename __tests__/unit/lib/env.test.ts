import { getEnv } from "@/lib/env";

const VALID_KEY = Buffer.alloc(32, 7).toString("base64");
const SHORT_KEY = Buffer.alloc(16, 7).toString("base64");

const REQUIRED_KEYS = [
  "ANTHROPIC_API_KEY",
  "DATABASE_URL",
  "NEXTAUTH_SECRET",
  "TOKEN_ENCRYPTION_KEY",
  "YOUTUBE_API_KEY",
  "CRON_SECRET",
  "NODE_ENV",
];

function baseValidEnv(): Record<string, string> {
  return {
    ANTHROPIC_API_KEY: "sk-ant-test",
    DATABASE_URL: "postgresql://localhost:5432/db",
    NEXTAUTH_SECRET: "nextauth-secret-value",
    TOKEN_ENCRYPTION_KEY: VALID_KEY,
  };
}

describe("getEnv", () => {
  let saved: Record<string, string | undefined>;

  beforeEach(() => {
    saved = {};
    for (const key of REQUIRED_KEYS) {
      saved[key] = process.env[key];
      delete process.env[key];
    }
  });

  afterEach(() => {
    for (const key of REQUIRED_KEYS) {
      if (saved[key] === undefined) {
        delete process.env[key];
      } else {
        process.env[key] = saved[key];
      }
    }
  });

  it("parses a fully-valid env and returns typed values", () => {
    Object.assign(process.env, baseValidEnv(), { NODE_ENV: "production" });

    const env = getEnv();

    expect(env.ANTHROPIC_API_KEY).toBe("sk-ant-test");
    expect(env.DATABASE_URL).toBe("postgresql://localhost:5432/db");
    expect(env.NEXTAUTH_SECRET).toBe("nextauth-secret-value");
    expect(env.TOKEN_ENCRYPTION_KEY).toBe(VALID_KEY);
    expect(env.NODE_ENV).toBe("production");
    expect(env.YOUTUBE_API_KEY).toBeUndefined();
    expect(env.CRON_SECRET).toBeUndefined();
  });

  it("parses fresh on each call so process.env changes take effect", () => {
    Object.assign(process.env, baseValidEnv());
    expect(getEnv().ANTHROPIC_API_KEY).toBe("sk-ant-test");

    process.env.ANTHROPIC_API_KEY = "sk-ant-changed";
    expect(getEnv().ANTHROPIC_API_KEY).toBe("sk-ant-changed");
  });

  it("throws naming a missing required var", () => {
    const partial = baseValidEnv();
    delete partial.DATABASE_URL;
    Object.assign(process.env, partial);

    expect(() => getEnv()).toThrow(/DATABASE_URL/);
  });

  it("aggregates every failing variable name, not just the first", () => {
    const partial = baseValidEnv();
    delete partial.ANTHROPIC_API_KEY;
    delete partial.NEXTAUTH_SECRET;
    Object.assign(process.env, partial);

    let message = "";
    try {
      getEnv();
    } catch (e) {
      message = (e as Error).message;
    }

    expect(message).toContain("ANTHROPIC_API_KEY");
    expect(message).toContain("NEXTAUTH_SECRET");
  });

  it("throws naming TOKEN_ENCRYPTION_KEY when it is not 32 bytes", () => {
    Object.assign(process.env, baseValidEnv(), {
      TOKEN_ENCRYPTION_KEY: SHORT_KEY,
    });

    expect(() => getEnv()).toThrow(/TOKEN_ENCRYPTION_KEY/);
  });

  it("never leaks secret values in the error message", () => {
    Object.assign(process.env, baseValidEnv(), {
      TOKEN_ENCRYPTION_KEY: SHORT_KEY,
    });

    let message = "";
    try {
      getEnv();
    } catch (e) {
      message = (e as Error).message;
    }

    expect(message).not.toContain(SHORT_KEY);
    expect(message).not.toContain("sk-ant-test");
  });

  it("accepts absent optional vars", () => {
    Object.assign(process.env, baseValidEnv());
    delete process.env.YOUTUBE_API_KEY;
    delete process.env.CRON_SECRET;

    const env = getEnv();

    expect(env.YOUTUBE_API_KEY).toBeUndefined();
    expect(env.CRON_SECRET).toBeUndefined();
  });

  it("includes optional vars when present", () => {
    Object.assign(process.env, baseValidEnv(), {
      YOUTUBE_API_KEY: "yt-key",
      CRON_SECRET: "cron-secret",
    });

    const env = getEnv();

    expect(env.YOUTUBE_API_KEY).toBe("yt-key");
    expect(env.CRON_SECRET).toBe("cron-secret");
  });

  it("defaults NODE_ENV to development when unset", () => {
    Object.assign(process.env, baseValidEnv());

    expect(getEnv().NODE_ENV).toBe("development");
  });
});
