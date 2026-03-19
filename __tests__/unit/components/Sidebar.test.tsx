/**
 * @jest-environment jsdom
 *
 * Tests for the new dark-premium Sidebar (components/layout/Sidebar.tsx)
 * Updated to reflect the UI overhaul — "CampaignHub" brand, grouped nav sections.
 */
import { render, screen, fireEvent } from "@testing-library/react";
import { Sidebar } from "@/components/layout/Sidebar";

describe("Sidebar", () => {
  it("renders the CampaignHub brand name", () => {
    render(<Sidebar />);
    expect(screen.getByText("CampaignHub")).toBeInTheDocument();
  });

  it("renders all nav section headings", () => {
    render(<Sidebar />);
    expect(screen.getByText("OVERVIEW")).toBeInTheDocument();
    expect(screen.getByText("CAMPAIGNS")).toBeInTheDocument();
    expect(screen.getByText("CREATORS")).toBeInTheDocument();
    expect(screen.getByText("FINANCE")).toBeInTheDocument();
    expect(screen.getByText("TOOLS")).toBeInTheDocument();
  });

  it("renders core navigation links", () => {
    render(<Sidebar />);
    expect(screen.getAllByRole("link", { name: /Dashboard/i })[0]).toBeInTheDocument();
    expect(screen.getAllByRole("link", { name: /Campaigns/i })[0]).toBeInTheDocument();
    expect(screen.getAllByRole("link", { name: /Creators/i })[0]).toBeInTheDocument();
    expect(screen.getAllByRole("link", { name: /Payouts/i })[0]).toBeInTheDocument();
  });

  it("renders Activations and Calendar under CAMPAIGNS section", () => {
    render(<Sidebar />);
    expect(screen.getAllByRole("link", { name: /Activations/i })[0]).toBeInTheDocument();
    expect(screen.getAllByRole("link", { name: /Calendar/i })[0]).toBeInTheDocument();
  });

  it("renders Lists and Discovery under CREATORS section", () => {
    render(<Sidebar />);
    expect(screen.getAllByRole("link", { name: /Lists/i })[0]).toBeInTheDocument();
    expect(screen.getAllByRole("link", { name: /Discovery/i })[0]).toBeInTheDocument();
  });

  it("renders Reports and Media Kits under TOOLS section", () => {
    render(<Sidebar />);
    expect(screen.getAllByRole("link", { name: /Reports/i })[0]).toBeInTheDocument();
    expect(screen.getAllByRole("link", { name: /Media Kits/i })[0]).toBeInTheDocument();
  });

  it("renders Clients under FINANCE section", () => {
    render(<Sidebar />);
    expect(screen.getAllByRole("link", { name: /Clients/i })[0]).toBeInTheDocument();
  });

  it("links point to correct hrefs", () => {
    render(<Sidebar />);
    const campaignsLink = screen.getAllByRole("link", { name: /Campaigns/i })[0];
    expect(campaignsLink).toHaveAttribute("href", "/campaigns");
    const creatorsLink = screen.getAllByRole("link", { name: /Creators/i })[0];
    expect(creatorsLink).toHaveAttribute("href", "/creators");
    const payoutsLink = screen.getAllByRole("link", { name: /Payouts/i })[0];
    expect(payoutsLink).toHaveAttribute("href", "/payouts");
  });

  it("renders a sign-out button in the user section", () => {
    const { container } = render(<Sidebar />);
    // Sign-out uses an icon-only button (LogOut icon, no visible text)
    // Check that at least one button exists in the sidebar (collapse + sign-out)
    const buttons = screen.getAllByRole("button");
    expect(buttons.length).toBeGreaterThanOrEqual(1);
    // The LogOut icon SVG should be present
    const logoutIcon = container.querySelector(".lucide-log-out");
    expect(logoutIcon).toBeInTheDocument();
  });

  it("renders more than 8 navigation links total", () => {
    render(<Sidebar />);
    const links = screen.getAllByRole("link");
    expect(links.length).toBeGreaterThan(8);
  });

  it("does not crash when pathname is root", () => {
    // usePathname is mocked to return '/' in jest.setup.js
    expect(() => render(<Sidebar />)).not.toThrow();
  });
});
