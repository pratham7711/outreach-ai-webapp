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

import { AuditEventTimeline, type AuditEventTimelineProps } from "@/components/ai/AuditEventTimeline";

const baseProps: AuditEventTimelineProps = {
  events: [
    {
      tool: "send_email",
      orgId: "org_secret_tenant_123",
      userId: "user_42",
      status: "ok",
      input: { to: "[REDACTED_EMAIL]", subject: "Hello" },
      output: { messageId: "m1" },
    },
    {
      tool: "lookup_creator",
      orgId: "org_secret_tenant_123",
      status: "denied",
      input: { ssn: "[REDACTED_SSN]" },
      output: { error: "permission denied" },
    },
    {
      tool: "fetch_profile",
      orgId: "org_secret_tenant_123",
      userId: "user_7",
      status: "pending",
      input: { id: "c9" },
      output: null,
    },
  ],
};

function html(props: AuditEventTimelineProps): string {
  return renderToStaticMarkup(createElement(AuditEventTimeline, props));
}

describe("AuditEventTimeline", () => {
  it("renders an event row per event with tool name, status badge, and actor", () => {
    const markup = html(baseProps);
    expect(markup).toContain("send_email");
    expect(markup).toContain("lookup_creator");
    expect(markup).toContain("fetch_profile");
    expect(markup).toContain(">Success<");
    expect(markup).toContain('data-variant="success"');
    expect(markup).toContain("user_42");
  });

  it("renders the actor as system when userId is absent", () => {
    const markup = html({
      events: [
        {
          tool: "lookup_creator",
          orgId: "org_x",
          status: "ok",
          input: {},
          output: {},
        },
      ],
    });
    expect(markup).toContain(">system<");
  });

  it("maps denied/error/failed to a danger status badge", () => {
    const denied = html({
      events: [{ tool: "t", orgId: "o", status: "denied", input: {}, output: {} }],
    });
    expect(denied).toContain(">Denied<");
    expect(denied).toContain('data-variant="danger"');

    const error = html({
      events: [{ tool: "t", orgId: "o", status: "error", input: {}, output: {} }],
    });
    expect(error).toContain(">Error<");
    expect(error).toContain('data-variant="danger"');

    const failed = html({
      events: [{ tool: "t", orgId: "o", status: "failed", input: {}, output: {} }],
    });
    expect(failed).toContain(">Failed<");
    expect(failed).toContain('data-variant="danger"');
  });

  it("fail-closed: an unknown status resolves to a warning Unknown badge, never Success", () => {
    const markup = html({
      events: [{ tool: "t", orgId: "o", status: "pending", input: {}, output: {} }],
    });
    expect(markup).toContain(">Unknown<");
    expect(markup).toContain('data-variant="warning"');
    expect(markup).not.toContain(">Success<");
  });

  it("fail-closed: an empty status resolves to Unknown, not Success", () => {
    const markup = html({
      events: [{ tool: "t", orgId: "o", status: "", input: {}, output: {} }],
    });
    expect(markup).toContain(">Unknown<");
    expect(markup).toContain('data-variant="warning"');
  });

  it("renders events in the given order", () => {
    const markup = html(baseProps);
    const first = markup.indexOf("send_email");
    const second = markup.indexOf("lookup_creator");
    const third = markup.indexOf("fetch_profile");
    expect(first).toBeLessThan(second);
    expect(second).toBeLessThan(third);
  });

  it("never renders orgId in the UI", () => {
    const markup = html(baseProps);
    expect(markup).not.toContain("org_secret_tenant_123");
  });

  it("displays redaction sentinels verbatim without un-redacting them", () => {
    const markup = html(baseProps);
    expect(markup).toContain("[REDACTED_EMAIL]");
    expect(markup).toContain("[REDACTED_SSN]");
  });

  it("guards JSON.stringify so a circular/unserializable payload never throws", () => {
    const circular: Record<string, unknown> = {};
    circular.self = circular;
    expect(() =>
      html({
        events: [{ tool: "t", orgId: "o", status: "ok", input: circular, output: circular }],
      }),
    ).not.toThrow();
    const markup = html({
      events: [{ tool: "t", orgId: "o", status: "ok", input: circular, output: circular }],
    });
    expect(markup).toContain("(unserializable)");
  });

  it("guards a non-finite numeric payload so the preview never prints raw NaN or Infinity", () => {
    const markup = html({
      events: [
        { tool: "t", orgId: "o", status: "ok", input: Number.NaN, output: Number.POSITIVE_INFINITY },
      ],
    });
    expect(markup).not.toContain("NaN");
    expect(markup).not.toContain("Infinity");
    expect(markup).toContain("—");
  });

  it("renders a muted dash for a null or undefined payload rather than the literal null/undefined", () => {
    const markup = html({
      events: [
        { tool: "t", orgId: "o", status: "ok", input: null, output: undefined },
      ],
    });
    expect(markup).toContain("—");
    expect(markup).not.toContain(">null<");
    expect(markup).not.toContain(">undefined<");
  });

  it("truncates an overlong preview to a short length", () => {
    const long = "x".repeat(500);
    const markup = html({
      events: [{ tool: "t", orgId: "o", status: "ok", input: long, output: long }],
    });
    expect(markup).not.toContain("x".repeat(200));
    expect(markup).toContain("…");
  });

  it("renders the role=status empty state when there are no events", () => {
    const markup = html({ events: [] });
    expect(markup).toContain('data-testid="audit-timeline-empty"');
    expect(markup).toContain('role="status"');
    expect(markup).toContain("No audit events recorded");
    expect(markup).not.toContain('data-testid="audit-timeline"');
  });

  it("guards a missing or non-array events prop and shows the empty state without throwing", () => {
    const missing = html({
      events: undefined as unknown as AuditEventTimelineProps["events"],
    });
    expect(missing).toContain("No audit events recorded");
    expect(missing).toContain('role="status"');

    const garbage = html({
      events: "not-an-array" as unknown as AuditEventTimelineProps["events"],
    });
    expect(garbage).toContain("No audit events recorded");
  });

  it("contains no hardcoded hex colors in the component source", () => {
    const source = readFileSync(
      join(__dirname, "../../../../components/ai/AuditEventTimeline.tsx"),
      "utf8",
    );
    expect(source).not.toMatch(/#[0-9a-fA-F]{3,6}/);
  });
});
