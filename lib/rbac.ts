export type UserRole = "OWNER" | "ADMIN" | "MANAGER" | "MEMBER" | "VIEWER";
export type PermissionOverrideMap = Record<string, boolean>;

export const PERMISSIONS: Record<UserRole, string[]> = {
  OWNER: ["*"],
  ADMIN: ["users:manage", "campaigns:*", "creators:*", "reports:*", "media_kits:*", "analytics:*", "payments:*", "settings:*"],
  MANAGER: ["campaigns:*", "creators:*", "reports:*", "media_kits:*", "analytics:read", "payments:read"],
  MEMBER: ["campaigns:create", "campaigns:edit_own", "campaigns:read", "creators:create", "creators:edit_own", "creators:read", "reports:read", "media_kits:read"],
  VIEWER: ["campaigns:read", "creators:read", "reports:read", "media_kits:read", "analytics:read"],
};

export function resolvePermissions(
  role: UserRole | string,
  overrides?: PermissionOverrideMap | null
): string[] {
  const basePermissions = [...(PERMISSIONS[role as UserRole] ?? [])];
  if (!overrides) return basePermissions;

  const granted = Object.entries(overrides)
    .filter(([, enabled]) => enabled)
    .map(([permission]) => permission);

  const denied = new Set(
    Object.entries(overrides)
      .filter(([, enabled]) => enabled === false)
      .map(([permission]) => permission)
  );

  return [...new Set([...basePermissions, ...granted])].filter((permission) => !denied.has(permission));
}

export function hasPermission(role: UserRole | string, permission: string): boolean {
  const perms = resolvePermissions(role);
  return perms.includes("*") ||
    perms.includes(permission) ||
    perms.includes(permission.split(":")[0] + ":*");
}
