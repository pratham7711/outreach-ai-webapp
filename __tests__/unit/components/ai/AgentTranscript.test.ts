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
  AgentTranscript,
  type AgentTranscriptStep,
} from "@/components/ai/AgentTranscript";

const baseSteps: AgentTranscriptStep[] = [
  { id: "s1", role: "user", kind: "message", text: "Find five fitness creators" },
  { id: "s2", role: "assistant", kind: "message", text: "Searching the roster now" },
  { id: "s3", role: "tool", kind: "tool_use", toolName: "search_creators" },
  { id: "s4", role: "tool", kind: "tool_result", status: "ok", text: "Found 5 creators" },
];

function html(props: Parameters<typeof AgentTranscript>[0]): string {
  return renderToStaticMarkup(createElement(AgentTranscript, props));
}

describe("AgentTranscript", () => {
  it("renders the default title and the steps list container", () => {
    const markup = html({ steps: baseSteps });
    expect(markup).toContain("Agent run");
    expect(markup).toContain('data-testid="transcript-steps"');
  });

  it("renders a custom title when provided", () => {
    const markup = html({ steps: baseSteps, title: "Outreach run #42" });
    expect(markup).toContain("Outreach run #42");
    expect(markup).not.toContain(">Agent run<");
  });

  it("renders each step's text in the given order without sorting", () => {
    const markup = html({ steps: baseSteps });
    const userIdx = markup.indexOf("Find five fitness creators");
    const assistantIdx = markup.indexOf("Searching the roster now");
    const resultIdx = markup.indexOf("Found 5 creators");
    expect(userIdx).toBeGreaterThan(-1);
    expect(assistantIdx).toBeGreaterThan(userIdx);
    expect(resultIdx).toBeGreaterThan(assistantIdx);
  });

  it("shows role labels as visible text including the tool name", () => {
    const markup = html({ steps: baseSteps });
    expect(markup).toContain("You");
    expect(markup).toContain("Agent");
    expect(markup).toContain("Tool: search_creators");
  });

  it("renders a tool_use row that surfaces the tool name", () => {
    const markup = html({
      steps: [{ id: "t", role: "tool", kind: "tool_use", toolName: "send_email" }],
    });
    expect(markup).toContain('data-kind="tool_use"');
    expect(markup).toContain("Tool: send_email");
  });

  it("renders a tool_result status as text for ok, error, and pending", () => {
    const ok = html({ steps: [{ id: "r", role: "tool", kind: "tool_result", status: "ok" }] });
    expect(ok).toContain('data-testid="transcript-status"');
    expect(ok).toContain(">OK<");

    const error = html({
      steps: [{ id: "r", role: "tool", kind: "tool_result", status: "error" }],
    });
    expect(error).toContain(">Error<");
    expect(error).toContain('data-variant="danger"');

    const pending = html({
      steps: [{ id: "r", role: "tool", kind: "tool_result", status: "pending" }],
    });
    expect(pending).toContain(">Pending<");
  });

  it("renders the awaiting-approval marker as text and never an approve button", () => {
    const markup = html({
      steps: [{ id: "a", role: "assistant", kind: "awaiting_approval", text: "Needs human sign-off" }],
    });
    expect(markup).toContain('data-testid="awaiting-approval"');
    expect(markup).toContain("Awaiting approval");
    expect(markup).not.toContain("<button");
    expect(markup.toLowerCase()).not.toContain("onclick");
  });

  it("contains no actionable approve, execute, or send control anywhere", () => {
    const markup = html({
      steps: [
        { id: "a", role: "assistant", kind: "awaiting_approval", text: "Approve to send the email" },
        { id: "b", role: "tool", kind: "tool_use", toolName: "send_email" },
      ],
    });
    expect(markup).not.toContain("<button");
    expect(markup.toLowerCase()).not.toContain("onclick");
    expect(markup).not.toContain('role="button"');
  });

  it("preserves multi-line message text via line splitting, not raw html", () => {
    const markup = html({
      steps: [{ id: "m", role: "assistant", kind: "message", text: "line one\nline two\nline three" }],
    });
    expect(markup).toContain("line one");
    expect(markup).toContain("line two");
    expect(markup).toContain("line three");
    const blocks = markup.match(/<span style="display:block">/g) || [];
    expect(blocks.length).toBeGreaterThanOrEqual(3);
  });

  it("tolerates missing text, toolName, and status without throwing", () => {
    expect(() =>
      html({
        steps: [
          { id: "x", role: "tool", kind: "tool_use" },
          { id: "y", role: "tool", kind: "tool_result" },
          { id: "z", role: "assistant", kind: "message" },
        ],
      }),
    ).not.toThrow();
    const markup = html({
      steps: [{ id: "y", role: "tool", kind: "tool_result" }],
    });
    expect(markup).not.toContain("NaN");
    expect(markup).not.toContain("undefined");
    expect(markup).toContain(">Pending<");
  });

  it("renders a role=status empty state with the default label when steps is empty", () => {
    const markup = html({ steps: [] });
    expect(markup).toContain('data-testid="transcript-empty"');
    expect(markup).toContain('role="status"');
    expect(markup).toContain("No agent activity yet");
    expect(markup).not.toContain('data-testid="transcript-steps"');
  });

  it("renders a custom empty label when provided", () => {
    const markup = html({ steps: [], emptyLabel: "This run has no turns yet" });
    expect(markup).toContain("This run has no turns yet");
    expect(markup).not.toContain("No agent activity yet");
  });

  it("contains no hardcoded hex colors in the component source", () => {
    const source = readFileSync(
      join(__dirname, "../../../../components/ai/AgentTranscript.tsx"),
      "utf8",
    );
    expect(source).not.toMatch(/#[0-9a-fA-F]{3,6}/);
  });
});
