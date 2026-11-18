import { CORS_HEADERS, preflight, protectedResourceMetadata } from "@/lib/oauth/mcpOAuth";
import { originFromHeaders } from "@/lib/oauth/requestOrigin";

export const dynamic = "force-dynamic";

/** RFC 9728 protected resource metadata for the MCP endpoint, at the root path. */
export async function GET(req: Request) {
  return Response.json(protectedResourceMetadata(originFromHeaders(req.headers)), {
    headers: { ...CORS_HEADERS, "cache-control": "public, max-age=3600" },
  });
}

export const OPTIONS = preflight;
