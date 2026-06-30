import { NextRequest, NextResponse } from "next/server";
import { authenticateRequest } from "@/lib/authenticate";
import { getMcpToolDefinitions, executeMcpTool } from "@/lib/mcp/tools";

const SERVER_INFO = {
  name: "Outreach AI",
  version: "1.0.0",
};

const PROTOCOL_VERSION = "2025-03-26";

function jsonrpc(id: number | string | null, result: unknown) {
  return { jsonrpc: "2.0" as const, id, result };
}

function jsonrpcError(id: number | string | null, code: number, message: string) {
  return { jsonrpc: "2.0" as const, id, error: { code, message } };
}

export async function POST(req: NextRequest) {
  const authResult = await authenticateRequest(req);
  if (!authResult) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  let body: any;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json(jsonrpcError(null, -32700, "Parse error"), { status: 400 });
  }

  const { orgId } = authResult;

  // Handle single JSON-RPC message
  if (!body || typeof body !== "object") {
    return NextResponse.json(jsonrpcError(null, -32600, "Invalid Request"), { status: 400 });
  }

  const { method, params, id } = body;

  switch (method) {
    case "initialize": {
      return NextResponse.json(jsonrpc(id, {
        protocolVersion: PROTOCOL_VERSION,
        capabilities: { tools: { listChanged: false } },
        serverInfo: SERVER_INFO,
      }));
    }

    case "tools/list": {
      const tools = getMcpToolDefinitions();
      return NextResponse.json(jsonrpc(id, { tools }));
    }

    case "tools/call": {
      const { name, arguments: args } = params ?? {};
      if (!name) {
        return NextResponse.json(jsonrpcError(id, -32602, "Missing tool name"));
      }
      try {
        const result = await executeMcpTool(orgId, name, args ?? {});
        return NextResponse.json(jsonrpc(id, result));
      } catch (err: any) {
        return NextResponse.json(jsonrpcError(id, -32603, err?.message ?? "Tool execution failed"));
      }
    }

    case "notifications/initialized": {
      return new Response(null, { status: 202 });
    }

    default: {
      return NextResponse.json(jsonrpcError(id, -32601, `Method not found: ${method}`));
    }
  }
}

export async function GET() {
  return NextResponse.json({ service: "Outreach AI MCP", version: "1.0.0" });
}
