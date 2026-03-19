import { PERMISSIONS, hasPermission, type UserRole } from "@/lib/rbac";

describe("PERMISSIONS matrix", () => {
  it("defines all 5 roles", () => {
    expect(Object.keys(PERMISSIONS)).toEqual(["OWNER", "ADMIN", "MANAGER", "MEMBER", "VIEWER"]);
  });

  it("OWNER has wildcard permission", () => {
    expect(PERMISSIONS.OWNER).toContain("*");
  });

  it("VIEWER has only read permissions", () => {
    const viewerPerms = PERMISSIONS.VIEWER;
    for (const perm of viewerPerms) {
      expect(perm.endsWith(":read") || perm.endsWith(":*")).toBe(true);
    }
  });

  it("MEMBER cannot manage users", () => {
    expect(PERMISSIONS.MEMBER).not.toContain("users:manage");
  });

  it("ADMIN can manage users", () => {
    expect(PERMISSIONS.ADMIN).toContain("users:manage");
  });

  it("MANAGER cannot manage users", () => {
    expect(PERMISSIONS.MANAGER).not.toContain("users:manage");
  });

  it("MANAGER cannot manage settings", () => {
    expect(PERMISSIONS.MANAGER).not.toContain("settings:*");
  });

  it("ADMIN can manage settings", () => {
    expect(PERMISSIONS.ADMIN).toContain("settings:*");
  });
});

describe("hasPermission()", () => {
  // ─── OWNER (wildcard) ────────────────────────────────────────────
  describe("OWNER", () => {
    it("has access to everything via wildcard", () => {
      expect(hasPermission("OWNER", "campaigns:create")).toBe(true);
      expect(hasPermission("OWNER", "users:manage")).toBe(true);
      expect(hasPermission("OWNER", "settings:*")).toBe(true);
      expect(hasPermission("OWNER", "billing:delete")).toBe(true);
      expect(hasPermission("OWNER", "some_future_permission")).toBe(true);
    });
  });

  // ─── ADMIN ───────────────────────────────────────────────────────
  describe("ADMIN", () => {
    it("can manage users", () => {
      expect(hasPermission("ADMIN", "users:manage")).toBe(true);
    });

    it("has full campaign access via campaigns:*", () => {
      expect(hasPermission("ADMIN", "campaigns:create")).toBe(true);
      expect(hasPermission("ADMIN", "campaigns:read")).toBe(true);
      expect(hasPermission("ADMIN", "campaigns:delete")).toBe(true);
      expect(hasPermission("ADMIN", "campaigns:edit_own")).toBe(true);
    });

    it("has full creator access", () => {
      expect(hasPermission("ADMIN", "creators:create")).toBe(true);
      expect(hasPermission("ADMIN", "creators:delete")).toBe(true);
    });

    it("can manage settings", () => {
      expect(hasPermission("ADMIN", "settings:read")).toBe(true);
      expect(hasPermission("ADMIN", "settings:update")).toBe(true);
    });

    it("cannot do billing (not in permissions)", () => {
      expect(hasPermission("ADMIN", "billing:delete")).toBe(false);
    });
  });

  // ─── MANAGER ─────────────────────────────────────────────────────
  describe("MANAGER", () => {
    it("has full campaign access", () => {
      expect(hasPermission("MANAGER", "campaigns:create")).toBe(true);
      expect(hasPermission("MANAGER", "campaigns:delete")).toBe(true);
    });

    it("can read analytics", () => {
      expect(hasPermission("MANAGER", "analytics:read")).toBe(true);
    });

    it("cannot write analytics", () => {
      expect(hasPermission("MANAGER", "analytics:create")).toBe(false);
    });

    it("cannot manage users", () => {
      expect(hasPermission("MANAGER", "users:manage")).toBe(false);
    });

    it("cannot manage settings", () => {
      expect(hasPermission("MANAGER", "settings:read")).toBe(false);
    });

    it("can read payments", () => {
      expect(hasPermission("MANAGER", "payments:read")).toBe(true);
    });

    it("cannot create payments", () => {
      expect(hasPermission("MANAGER", "payments:create")).toBe(false);
    });
  });

  // ─── MEMBER ──────────────────────────────────────────────────────
  describe("MEMBER", () => {
    it("can create campaigns", () => {
      expect(hasPermission("MEMBER", "campaigns:create")).toBe(true);
    });

    it("can read campaigns", () => {
      expect(hasPermission("MEMBER", "campaigns:read")).toBe(true);
    });

    it("cannot delete campaigns", () => {
      expect(hasPermission("MEMBER", "campaigns:delete")).toBe(false);
    });

    it("can create creators", () => {
      expect(hasPermission("MEMBER", "creators:create")).toBe(true);
    });

    it("cannot delete creators", () => {
      expect(hasPermission("MEMBER", "creators:delete")).toBe(false);
    });

    it("can read reports and media kits", () => {
      expect(hasPermission("MEMBER", "reports:read")).toBe(true);
      expect(hasPermission("MEMBER", "media_kits:read")).toBe(true);
    });

    it("cannot create reports", () => {
      expect(hasPermission("MEMBER", "reports:create")).toBe(false);
    });

    it("cannot manage users", () => {
      expect(hasPermission("MEMBER", "users:manage")).toBe(false);
    });
  });

  // ─── VIEWER ──────────────────────────────────────────────────────
  describe("VIEWER", () => {
    it("can read campaigns and creators", () => {
      expect(hasPermission("VIEWER", "campaigns:read")).toBe(true);
      expect(hasPermission("VIEWER", "creators:read")).toBe(true);
    });

    it("cannot create anything", () => {
      expect(hasPermission("VIEWER", "campaigns:create")).toBe(false);
      expect(hasPermission("VIEWER", "creators:create")).toBe(false);
      expect(hasPermission("VIEWER", "reports:create")).toBe(false);
    });

    it("cannot delete anything", () => {
      expect(hasPermission("VIEWER", "campaigns:delete")).toBe(false);
      expect(hasPermission("VIEWER", "creators:delete")).toBe(false);
    });

    it("can read analytics", () => {
      expect(hasPermission("VIEWER", "analytics:read")).toBe(true);
    });

    it("cannot write analytics", () => {
      expect(hasPermission("VIEWER", "analytics:write")).toBe(false);
    });
  });

  // ─── Unknown roles ────────────────────────────────────────────────
  describe("unknown role", () => {
    it("returns false for any permission", () => {
      expect(hasPermission("SUPERUSER" as UserRole, "campaigns:read")).toBe(false);
      expect(hasPermission("" as UserRole, "*")).toBe(false);
      expect(hasPermission("unknown" as UserRole, "campaigns:create")).toBe(false);
    });
  });

  // ─── Wildcard namespace matching ─────────────────────────────────
  describe("namespace wildcard matching", () => {
    it("campaigns:* grants access to any campaigns: permission", () => {
      // ADMIN has campaigns:*
      expect(hasPermission("ADMIN", "campaigns:anything_here")).toBe(true);
      expect(hasPermission("ADMIN", "campaigns:super_custom_action")).toBe(true);
    });

    it("exact permission match works without wildcard", () => {
      // MEMBER has campaigns:create explicitly
      expect(hasPermission("MEMBER", "campaigns:create")).toBe(true);
    });
  });
});
