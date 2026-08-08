import { NextResponse } from "next/server";
import { z } from "zod";

export const MAX_PAGE_SIZE = 100;

export const pageParam = z.coerce.number().int().min(1).default(1);

export function pageSizeParam(defaultSize = 20, max = MAX_PAGE_SIZE) {
  return z.coerce.number().int().min(1).max(max).default(defaultSize);
}

export const dateParam = z.coerce.date();

export const moneyParam = z.coerce.number().nonnegative();

export const countParam = z.coerce.number().int().nonnegative();

export function queryObject(searchParams: URLSearchParams): Record<string, string> {
  return Object.fromEntries(
    [...searchParams.entries()].filter(([, value]) => value !== ""),
  );
}

export function invalidInput(error: z.ZodError): NextResponse {
  return NextResponse.json(
    { error: "Invalid input", details: error.flatten() },
    { status: 400 },
  );
}

export function parseQuery<T extends z.ZodType>(
  schema: T,
  searchParams: URLSearchParams,
): { ok: true; data: z.infer<T> } | { ok: false; response: NextResponse } {
  const parsed = schema.safeParse(queryObject(searchParams));
  if (!parsed.success) return { ok: false, response: invalidInput(parsed.error) };
  return { ok: true, data: parsed.data };
}
