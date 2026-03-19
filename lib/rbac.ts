export type UserRole = "OWNER" | "ADMIN" | "MANAGER" | "MEMBER" | "VIEWER";

export const PERMISSIONS: Record<UserRole, string[]> = {
  OWNER: ["*"],
  ADMIN: ["users:manage", "campaigns:*", "creators:*", "reports:*", "media_kits:*", "analytics:*", "payments:*", "settings:*"],
  MANAGER: ["campaigns:*", "creators:*", "reports:*", "media_kits:*", "analytics:read", "payments:read"],
  MEMBER: ["campaigns:create", "campaigns:edit_own", "campaigns:read", "creators:create", "creators:edit_own", "creators:read", "reports:read", "media_kits:read"],
  VIEWER: ["campaigns:read", "creators:read", "reports:read", "media_kits:read", "analytics:read"],
};

export function hasPermission(role: UserRole | string, permission: string): boolean {
  const perms = PERMISSIONS[role as UserRole] ?? [];
  return perms.includes("*") ||
    perms.includes(permission) ||
    perms.includes(permission.split(":")[0] + ":*");
}
