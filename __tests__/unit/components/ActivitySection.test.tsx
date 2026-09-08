/**
 * @jest-environment jsdom
 */
import { render, screen, within } from "@testing-library/react";

jest.mock("@pratham7711/ui", () => ({
  Badge: ({ children }: any) => <span>{children}</span>,
}), { virtual: true });

import { ActivitySection } from "@/app/(dashboard)/dashboard/sections/ActivitySection";
import type { ActivityEvent, Campaign } from "@/app/(dashboard)/dashboard/types";

const CAMPAIGNS: Campaign[] = [
  {
    id: "c1",
    title: "Summer Drop",
    status: "IN_PROGRESS",
    client: { name: "Acme" },
    updatedAt: "2026-09-01T10:00:00.000Z",
  },
];

const EVENTS: ActivityEvent[] = [
  {
    id: "a1",
    action: "negotiation.approve",
    entityType: "NegotiationOffer",
    entityId: "n1",
    entityLabel: "Summer Drop — @dancer",
    actorEmail: "admin@demo.com",
    createdAt: "2026-09-07T09:00:00.000Z",
  },
  {
    id: "a2",
    action: "campaign.create",
    entityType: "campaign",
    entityId: "c1",
    entityLabel: "Autumn Push",
    actorEmail: null,
    createdAt: "2026-09-06T09:00:00.000Z",
  },
];

function feed() {
  // The second SectionCard; the first is "Recent campaigns".
  return screen.getByText("Activity feed").closest("section, div")!;
}

describe("ActivitySection — the activity feed", () => {
  it("renders the audit events, not the campaigns from the card above", () => {
    render(<ActivitySection recentCampaigns={CAMPAIGNS} recentEvents={EVENTS} />);

    expect(screen.getByText("Offer Accepted — Summer Drop — @dancer")).toBeInTheDocument();
    expect(screen.getByText("Campaign Created — Autumn Push")).toBeInTheDocument();
    // The old feed re-listed the campaign and called it a status change.
    expect(screen.queryByText(/is now/i)).not.toBeInTheDocument();
  });

  it("links an event whose entity has a reachable route, and only that one", () => {
    render(<ActivitySection recentCampaigns={CAMPAIGNS} recentEvents={EVENTS} />);

    const created = screen.getByRole("link", { name: "Campaign Created — Autumn Push" });
    expect(created).toHaveAttribute("href", "/campaigns/c1");
    // A NegotiationOffer's page is nested under a campaign the row does not name.
    expect(
      screen.queryByRole("link", { name: "Offer Accepted — Summer Drop — @dancer" })
    ).not.toBeInTheDocument();
  });

  it("names the actor when the row has one", () => {
    render(<ActivitySection recentCampaigns={CAMPAIGNS} recentEvents={EVENTS} />);
    expect(screen.getByText(/admin@demo\.com/)).toBeInTheDocument();
  });

  it("says there is no activity rather than falling back to the campaign list", () => {
    render(<ActivitySection recentCampaigns={CAMPAIGNS} recentEvents={[]} />);
    expect(screen.getByText("No recent activity")).toBeInTheDocument();
    // The campaigns card above still renders its row.
    expect(within(feed()).queryByText("is now")).not.toBeInTheDocument();
  });
});
