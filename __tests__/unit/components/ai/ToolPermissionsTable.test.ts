import "./messageChannelPolyfill";
import { renderToStaticMarkup } from "react-dom/server";
import { createElement } from "react";
import { readFileSync } from "fs";
import { join } from "path";

jest.mock(
  "@pratham7711/ui",
  () => {
    const { createElement: h } = require("react");
    return {
      Card: ({ children, variant, clickable, noPadding, ...rest }: Record<string, unknown>) =>
        h("div", { "data-testid": "card", ...rest }, children as never),
      Badge: ({ children, variant, size, outlined, dot, ...rest }: Record<string, unknown>) =>
        h("span", { "data-testid": "badge", "data-variant": variant, ...rest }, children as never),
    };
  },
  { virtual: true },
);

import {
  ToolPermissionsTable,
  type ToolPermissionsTableProps,
  type ToolDescriptor,
} from "@/components/ai/ToolPermissionsTable";

const tools: ToolDescriptor[] = [
  {
    name: "send_dm",
    description: "Send a direct message to a creator",
    annotations: { permission: "write", requiresApproval: true, audit: true, readOnlyHint: false },
  },
  {
    name: "get_creator",
    description: "Look up a creator profile",
    annotations: { permission: "read", requiresApproval: false, audit: false, readOnlyHint: true },
  },
  {
    name: "issue_payout",
    description: "Send a payout to a creator",
    annotations: { permission: "financial", requiresApproval: true, audit: true, readOnlyHint: false },
  },
  {
    name: "draft_brief",
    description: "Draft a campaign brief",
    annotations: { permission: "write", requiresApproval: false, audit: true, readOnlyHint: false },
  },
];

const baseProps: ToolPermissionsTableProps = { tools };

function html(props: ToolPermissionsTableProps): string {
  return renderToStaticMarkup(createElement(ToolPermissionsTable, props));
}

describe("ToolPermissionsTable", () => {
  it("renders one row per tool with name and permission text", () => {
    const markup = html(baseProps);
    const rows = markup.split('data-testid="tools-row"').length - 1;
    expect(rows).toBe(4);
    expect(markup).toContain("send_dm");
    expect(markup).toContain("get_creator");
    expect(markup).toContain("financial");
    expect(markup).toContain("read");
  });

  it("sorts rows by tool name", () => {
    const markup = html(baseProps);
    const draft = markup.indexOf("draft_brief");
    const get = markup.indexOf("get_creator");
    const issue = markup.indexOf("issue_payout");
    const send = markup.indexOf("send_dm");
    expect(draft).toBeLessThan(get);
    expect(get).toBeLessThan(issue);
    expect(issue).toBeLessThan(send);
  });

  it("marks an approval-required tool with the words 'Approval required' and a danger badge", () => {
    const markup = html(baseProps);
    expect(markup).toContain(">Approval required<");
    expect(markup).toContain('data-variant="danger"');
    expect(markup).toContain('aria-label="Access: Approval required"');
  });

  it("marks a read-only tool with the word 'Read-only' and a success badge", () => {
    const markup = html(baseProps);
    expect(markup).toContain(">Read-only<");
    expect(markup).toContain('data-variant="success"');
    expect(markup).toContain('aria-label="Access: Read-only"');
  });

  it("marks a write (non-approval, non-readonly) tool with the word 'Write'", () => {
    const markup = html({
      tools: [
        {
          name: "draft_brief",
          description: "Draft a campaign brief",
          annotations: { permission: "write", requiresApproval: false, audit: true, readOnlyHint: false },
        },
      ],
    });
    expect(markup).toContain(">Write<");
    expect(markup).toContain('data-variant="warning"');
    expect(markup).not.toContain(">Approval required<");
    expect(markup).not.toContain(">Read-only<");
  });

  it("shows audit state as the words 'Audited' and 'Not audited'", () => {
    const markup = html(baseProps);
    expect(markup).toContain("Audited");
    expect(markup).toContain("Not audited");
    expect(markup).toContain('aria-label="Audit: Audited"');
    expect(markup).toContain('aria-label="Audit: Not audited"');
  });

  it("renders a summary line counting approval-required tools as text", () => {
    const markup = html(baseProps);
    expect(markup).toContain("4 tools · 2 require approval");
    expect(markup).toContain('aria-label="4 tools, 2 require approval"');
  });

  it("does not mutate the input tools array", () => {
    const input: ToolDescriptor[] = [
      {
        name: "send_dm",
        description: "Send a DM",
        annotations: { permission: "write", requiresApproval: true, audit: true, readOnlyHint: false },
      },
      {
        name: "get_creator",
        description: "Look up a creator",
        annotations: { permission: "read", requiresApproval: false, audit: false, readOnlyHint: true },
      },
    ];
    const snapshot = [...input];
    html({ tools: input });
    expect(input).toEqual(snapshot);
    expect(input[0]).toBe(snapshot[0]);
    expect(input[1]).toBe(snapshot[1]);
    expect(input[0].name).toBe("send_dm");
    expect(input[1].name).toBe("get_creator");
  });

  it("renders an accessible role=status empty state when there are no tools", () => {
    const markup = html({ tools: [] });
    expect(markup).toContain('role="status"');
    expect(markup).toContain('data-testid="tools-empty"');
    expect(markup).toContain("No tools registered");
    expect(markup).not.toContain('data-testid="tools-row"');
  });

  it("uses a custom empty label when provided", () => {
    const markup = html({ tools: [], emptyLabel: "No MCP tools connected" });
    expect(markup).toContain("No MCP tools connected");
    expect(markup).toContain('role="status"');
  });

  it("contains no hardcoded hex colors in the component source", () => {
    const source = readFileSync(
      join(__dirname, "../../../../components/ai/ToolPermissionsTable.tsx"),
      "utf8",
    );
    expect(source).not.toMatch(/#[0-9a-fA-F]{3,6}/);
  });
});
