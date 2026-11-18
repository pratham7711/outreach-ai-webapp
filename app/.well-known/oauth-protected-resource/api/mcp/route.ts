import { CORS_HEADERS, preflight, protectedResourceMetadata } from "@/lib/oauth/mcpOAuth";
import { originFromHeaders } from "@/lib/oauth/requestOrigin";

export const dynamic = "force-dynamic";

/** RFC 9728 metadata at the path-suffixed location, which MCP clients try first for /api/mcp. */
export async function GET(req: Request) {
  return Response.json(protectedResourceMetadata(originFromHeaders(req.headers)), {
    headers: { ...CORS_HEADERS, "cache-control": "public, max-age=3600" },
  });
}

export const OPTIONS = preflight;
