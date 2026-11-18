import { CORS_HEADERS, authorizationServerMetadata, preflight } from "@/lib/oauth/mcpOAuth";
import { requestOrigin } from "@/lib/oauth/requestOrigin";

export const dynamic = "force-dynamic";

/** RFC 8414 authorization server metadata. The issuer is this origin, so no path variant is needed. */
export async function GET() {
  return Response.json(authorizationServerMetadata(await requestOrigin()), {
    headers: { ...CORS_HEADERS, "cache-control": "public, max-age=3600" },
  });
}

export const OPTIONS = preflight;
