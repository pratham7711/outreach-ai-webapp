import { z } from "zod";

const requiredString = (name: string) =>
  z
    .string({ error: `${name} is required` })
    .min(1, { error: `${name} is required` });

const tokenEncryptionKey = z
  .string({ error: "TOKEN_ENCRYPTION_KEY is required" })
  .min(1, { error: "TOKEN_ENCRYPTION_KEY is required" })
  .refine((v) => Buffer.from(v, "base64").length === 32, {
    error: "TOKEN_ENCRYPTION_KEY must base64-decode to exactly 32 bytes",
  });

const envSchema = z.object({
  ANTHROPIC_API_KEY: requiredString("ANTHROPIC_API_KEY"),
  DATABASE_URL: requiredString("DATABASE_URL"),
  NEXTAUTH_SECRET: requiredString("NEXTAUTH_SECRET"),
  TOKEN_ENCRYPTION_KEY: tokenEncryptionKey,
  YOUTUBE_API_KEY: z.string().optional(),
  CRON_SECRET: z.string().optional(),
  NODE_ENV: z
    .enum(["development", "test", "production"])
    .default("development"),
});

export type Env = z.infer<typeof envSchema>;

function failingVariableNames(error: z.ZodError): string[] {
  const names = new Set<string>();
  for (const issue of error.issues) {
    const key = issue.path[0];
    if (typeof key === "string") {
      names.add(key);
    }
  }
  return Array.from(names);
}

export function getEnv(): Env {
  const result = envSchema.safeParse(process.env);
  if (!result.success) {
    const names = failingVariableNames(result.error);
    throw new Error(
      `Invalid environment configuration. Check these variables: ${names.join(", ")}`,
    );
  }
  return result.data;
}
