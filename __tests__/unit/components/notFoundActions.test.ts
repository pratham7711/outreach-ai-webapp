/**
 * The 404 page said "Go to Dashboard" to everyone, so a logged-out visitor on a
 * dead public link was sent to the agency app and a creator out of the portal.
 */
import { notFoundActions } from "@/components/errors/NotFoundActions";

const nobody = { agency: false, creator: false };

describe("notFoundActions", () => {
  it("sends a signed-in agency user to the dashboard", () => {
    expect(notFoundActions("/campaigns/x/y", { agency: true, creator: false }).primary.href).toBe("/dashboard");
  });

  it("keeps a creator inside the portal", () => {
    expect(notFoundActions("/portal/nope", { agency: false, creator: true }).primary.href).toBe("/portal/dashboard");
    expect(notFoundActions("/portal/nope", nobody).primary.href).toBe("/portal/login");
  });

  it("answers the portal by path even for someone signed in to the agency app", () => {
    expect(notFoundActions("/portal/nope", { agency: true, creator: false }).primary.href).toBe("/portal/login");
  });

  it("does not mistake a path that merely starts with the letters for the portal", () => {
    expect(notFoundActions("/portals", { agency: true, creator: false }).primary.href).toBe("/dashboard");
  });

  it("offers a logged-out visitor the home page and a way to sign in", () => {
    const { primary, secondary } = notFoundActions("/c/no-such-handle", nobody);
    expect(primary.href).toBe("/");
    expect(secondary).toEqual({ href: "/login", label: "Sign in" });
  });

  it("sends a creator who is off the portal back to it", () => {
    expect(notFoundActions("/invite/bad", { agency: false, creator: true }).primary.href).toBe("/portal/dashboard");
  });
});
