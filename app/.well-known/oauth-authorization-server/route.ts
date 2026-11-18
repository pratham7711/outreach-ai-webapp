import { CORS_HEADERS, authorizationServerMetadata, preflight } from "@/lib/oauth/mcpOAuth";
import { originFromHeaders } from "@/lib/oauth/requestOrigin";

export const dynamic = "force-dynamic";

/** RFC 8414 authorization server metadata. The issuer is this origin, so no path variant is needed. */
export async function GET(req: Request) {
  return Response.json(authorizationServerMetadata(originFromHeaders(req.headers)), {
    headers: { ...CORS_HEADERS, "cache-control": "public, max-age=3600" },
  });
}

export const OPTIONS = preflight;
