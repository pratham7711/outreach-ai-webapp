import { NextRequest, NextResponse } from "next/server";
import { authenticateRequest } from "@/lib/authenticate";
import { getMcpToolDefinitions, executeMcpTool } from "@/lib/mcp/tools";
import { getOrgEntitlements, hasOrgFeature } from "@/lib/entitlements";
import { API_ACCESS_FEATURE } from "@/lib/featureKeys";
import { rateLimit } from "@/lib/rateLimit";
import { createLogger } from "@/lib/observability/logger";
import { BRAND } from "@/lib/brand";

const logger = createLogger({ context: { route: "api/mcp" } });

const SERVER_INFO = {
  name: BRAND.name,
  title: `${BRAND.name} campaigns`,
  version: "1.0.0",
};

/* Newest first. A client asks for one version; it gets that one if we speak it,
   and our newest if we do not, which is what the spec tells the client to
   expect and lets it decide whether to continue. Pinning a single version --
   what this route did -- answered "2025-03-26" to a 2025-06-18 client and to a
   client that sent no version at all. */
const SUPPORTED_PROTOCOL_VERSIONS = ["2025-06-18", "2025-03-26", "2024-11-05"];
const LATEST_PROTOCOL_VERSION = SUPPORTED_PROTOCOL_VERSIONS[0];

/* What an agent should know before its first call, carried in the handshake so
   it does not have to infer it from the data. The null rule is the one thing
   that changes an answer: a model that reads 0 as "no likes" will report a
   campaign as failing when the truth is that nobody has measured it yet. */
const INSTRUCTIONS = [
  `${BRAND.name} tracks influencer campaigns: campaigns hold posts, posts belong to creators, and each post's counters are read from TikTok, Instagram and YouTube.`,
  "A counter that no platform read has returned is null, never 0. Every post carries `measured`, the counters actually read, and `notMeasuredReason` when the last read came back empty. Never present a null as a zero, and say a figure is unmeasured rather than reporting it as absent performance.",
  "Totals and engagement rates are computed over measured posts only, and each one reports the sample it used.",
  "Start from list_campaigns, then get_campaign_performance or list_posts. refresh_campaign spends a shared platform allowance and is limited to once every 30 minutes per campaign; call get_refresh_status first.",
].join("\n\n");

/* refresh_campaign paces its platform requests, so a large campaign takes
   minutes. Without this the function is killed at Vercel's 60s default
   part-way through a run that has already spent the campaign's thirty-minute
   allowance -- the agent gets a timeout and the person clicking Refresh Data
   gets told to wait, for a run neither of them received the result of. The
   HTTP refresh route carries the same 300. */
export const maxDuration = 300;

/* Per org, not per key: an org that mints a second key has not been given a
   second allowance. Well above any interactive agent's rate, and far below what
   it takes to walk the whole post table. */
const CALLS_PER_MINUTE = 120;

type Id = number | string | null;

function jsonrpc(id: Id, result: unknown) {
  return { jsonrpc: "2.0" as const, id, result };
}

function jsonrpcError(id: Id, code: number, message: string) {
  return { jsonrpc: "2.0" as const, id, error: { code, message } };
}

function negotiateVersion(requested: unknown): string {
  return typeof requested === "string" && SUPPORTED_PROTOCOL_VERSIONS.includes(requested)
    ? requested
    : LATEST_PROTOCOL_VERSION;
}

async function handleMessage(orgId: string, message: any): Promise<object | null> {
  if (!message || typeof message !== "object" || Array.isArray(message)) {
    return jsonrpcError(null, -32600, "Invalid Request");
  }

  const { method, params, id } = message;
  /* A notification has no id and the spec forbids answering it at all --
     returning "Method not found" for notifications/cancelled is a protocol
     violation that some clients surface to the user as a server error. */
  const isNotification = id === undefined || typeof method !== "string";

  if (typeof method !== "string") {
    return isNotification ? null : jsonrpcError(id ?? null, -32600, "Invalid Request");
  }
  if (method.startsWith("notifications/")) return null;

  switch (method) {
    case "initialize":
      return jsonrpc(id, {
        protocolVersion: negotiateVersion(params?.protocolVersion),
        capabilities: { tools: { listChanged: false } },
        serverInfo: SERVER_INFO,
        instructions: INSTRUCTIONS,
      });

    case "ping":
      return jsonrpc(id, {});

    case "tools/list":
      return jsonrpc(id, { tools: getMcpToolDefinitions() });

    case "tools/call": {
      const { name, arguments: args } = params ?? {};
      if (!name) return jsonrpcError(id, -32602, "Missing tool name");
      try {
        return jsonrpc(id, await executeMcpTool(orgId, name, args ?? {}));
      } catch (err: any) {
        const message = err?.message ?? "Tool execution failed";
        /* An unknown tool never reached a tool, so it is a protocol error. A
           tool that ran and failed is reported inside the result, where the
           model can read it and choose another call. */
        if (typeof message === "string" && message.startsWith("Unknown tool")) {
          return jsonrpcError(id, -32602, message);
        }
        logger.error("mcp.tool_failed", { tool: name, message });
        return jsonrpc(id, {
          content: [{ type: "text", text: JSON.stringify({ error: message }) }],
          structuredContent: { error: message },
          isError: true,
        });
      }
    }

    default:
      return isNotification ? null : jsonrpcError(id, -32601, `Method not found: ${method}`);
  }
}

export async function POST(req: NextRequest) {
  const authResult = await authenticateRequest(req);
  if (!authResult) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const entitlements = await getOrgEntitlements(authResult.orgId);
  if (!hasOrgFeature(entitlements, API_ACCESS_FEATURE)) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const { orgId } = authResult;

  const limit = rateLimit({ key: `mcp:${orgId}`, limit: CALLS_PER_MINUTE, windowMs: 60_000 });
  if (!limit.allowed) {
    return NextResponse.json(
      jsonrpcError(null, -32000, `Rate limit reached. Retry in ${limit.retryAfterSeconds}s.`),
      { status: 429, headers: { "Retry-After": String(limit.retryAfterSeconds) } }
    );
  }

  let body: any;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json(jsonrpcError(null, -32700, "Parse error"), { status: 400 });
  }

  const protocolHeader = {
    "MCP-Protocol-Version": negotiateVersion(req.headers.get("mcp-protocol-version")),
  };

  /* Batches were part of the protocol until 2025-06-18 removed them, and a
     client speaking an older version may still send one. Answering each message
     costs nothing and refusing the array outright looks like a dead server. */
  if (Array.isArray(body)) {
    if (body.length === 0) {
      return NextResponse.json(jsonrpcError(null, -32600, "Invalid Request"), { status: 400 });
    }
    const replies = (await Promise.all(body.map((msg) => handleMessage(orgId, msg)))).filter(
      (reply): reply is object => reply !== null
    );
    if (replies.length === 0) return new Response(null, { status: 202, headers: protocolHeader });
    return NextResponse.json(replies, { headers: protocolHeader });
  }

  const reply = await handleMessage(orgId, body);
  if (reply === null) return new Response(null, { status: 202, headers: protocolHeader });
  return NextResponse.json(reply, { headers: protocolHeader });
}

/* The spec's answer for a Streamable HTTP endpoint that does not offer a
   server-initiated SSE stream. This used to return 200 with a service banner,
   which tells a client opening a stream that it got one -- and it then waits
   for events that will never come. */
export async function GET() {
  return NextResponse.json(
    {
      service: `${BRAND.name} MCP`,
      version: SERVER_INFO.version,
      protocolVersions: SUPPORTED_PROTOCOL_VERSIONS,
      error: "This MCP endpoint does not offer an SSE stream. Send JSON-RPC over POST.",
    },
    { status: 405, headers: { Allow: "POST" } }
  );
}

export async function DELETE() {
  return NextResponse.json(
    { error: "This MCP endpoint is stateless. There is no session to end." },
    { status: 405, headers: { Allow: "POST" } }
  );
}
