import { encrypt, isEncrypted } from "@/lib/crypto/encrypt";

export interface TokenRow {
  accessToken: string;
  refreshToken: string | null;
  orgId: string;
}

export function planReencrypt(
  row: TokenRow,
): { accessToken?: string; refreshToken?: string } | null {
  const data: { accessToken?: string; refreshToken?: string } = {};
  if (!isEncrypted(row.accessToken)) {
    data.accessToken = encrypt(row.accessToken, row.orgId);
  }
  if (row.refreshToken && !isEncrypted(row.refreshToken)) {
    data.refreshToken = encrypt(row.refreshToken, row.orgId);
  }
  return Object.keys(data).length > 0 ? data : null;
}

export function findPlaintext(
  rows: { id: string; accessToken: string; refreshToken: string | null }[],
): string[] {
  const bad: string[] = [];
  for (const r of rows) {
    if (!isEncrypted(r.accessToken)) bad.push(r.id);
    else if (r.refreshToken && !isEncrypted(r.refreshToken)) bad.push(r.id);
  }
  return bad;
}
