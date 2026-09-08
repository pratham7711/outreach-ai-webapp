/* Typed on the one thing it reads rather than on NextRequest, so the bare
   `Request` NextAuth hands `authorize` can be passed without a cast. Every
   existing NextRequest caller still satisfies it. */
export function getRequestIp(request: { headers: Headers }): string | null {
  const realIp = request.headers.get("x-real-ip");
  if (realIp?.trim()) return realIp.trim();

  const forwarded = request.headers.get("x-forwarded-for");
  if (forwarded) {
    const parts = forwarded.split(",").map((p) => p.trim()).filter(Boolean);
    const last = parts[parts.length - 1];
    if (last) return last;
  }

  return null;
}

