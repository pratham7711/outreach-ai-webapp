import "./messageChannelPolyfill";
import { readFileSync } from "fs";
import { join } from "path";
import { renderToStaticMarkup } from "react-dom/server";
import { createElement } from "react";

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

import { AgentConsole, type AgentConsoleProps } from "@/components/ai/AgentConsole";

function html(props: AgentConsoleProps): string {
  return renderToStaticMarkup(createElement(AgentConsole, props));
}

describe("AgentConsole", () => {
  it("renders the goal and finalText for a completed result and does NOT render the approval panel", () => {
    const markup = html({
      goal: "Draft an outreach email to the creator",
      result: { status: "completed", finalText: "All done, the draft is ready." },
    });
    expect(markup).toContain("Draft an outreach email to the creator");
    expect(markup).toContain("All done, the draft is ready.");
    expect(markup).not.toContain('data-testid="approval-panel"');
  });

  it("renders the approval panel with the pending tool name, input, and Approve and Reject affordances when awaiting approval", () => {
    const markup = html({
      goal: "Send the campaign brief",
      result: {
        status: "awaiting_approval",
        finalText: "Ready to send.",
        pendingApproval: { tool: "send_email", input: { to: "creator@example.com", subject: "Hello" } },
      },
    });
    expect(markup).toContain('data-testid="approval-panel"');
    expect(markup).toContain("send_email");
    expect(markup).toContain("creator@example.com");
    expect(markup).toContain("subject");
    expect(markup).toContain("Approve");
    expect(markup).toContain("Reject");
    expect(markup).toContain('aria-label="Approve pending action"');
    expect(markup).toContain('aria-label="Reject pending action"');
  });

  it("renders the step-limit notice for a max_steps result", () => {
    const markup = html({
      goal: "Build the campaign",
      result: { status: "max_steps", finalText: "Stopped early." },
    });
    expect(markup).toContain('data-testid="max-steps-notice"');
    expect(markup).toContain("Reached step limit");
  });

  it("renders transcript rows with role and text when a transcript is provided", () => {
    const markup = html({
      goal: "Plan the outreach",
      result: { status: "completed", finalText: "Plan complete." },
      transcript: [
        { role: "user", text: "Find five creators in the indie pop niche" },
        { role: "assistant", text: "Searching the roster now" },
      ],
    });
    expect(markup).toContain('data-testid="agent-transcript"');
    expect(markup).toContain("Find five creators in the indie pop niche");
    expect(markup).toContain("Searching the roster now");
    expect(markup).toContain("user");
    expect(markup).toContain("assistant");
  });

  it("omits the transcript list when no transcript is provided", () => {
    const markup = html({
      goal: "Quick check",
      result: { status: "completed", finalText: "Done." },
    });
    expect(markup).not.toContain('data-testid="agent-transcript"');
  });

  it("renders neither the approval panel nor the max-steps notice for a completed result", () => {
    const markup = html({
      goal: "Summarize the campaign",
      result: { status: "completed", finalText: "Summary ready." },
    });
    expect(markup).not.toContain('data-testid="approval-panel"');
    expect(markup).not.toContain('data-testid="max-steps-notice"');
  });

  it("contains no hardcoded hex colors in the component source", () => {
    const source = readFileSync(
      join(__dirname, "..", "..", "..", "..", "components", "ai", "AgentConsole.tsx"),
      "utf8",
    );
    expect(source).not.toMatch(/#[0-9a-fA-F]{3,6}/);
  });
});
