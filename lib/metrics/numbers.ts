export function roundMoney(value: number): number {
  if (!Number.isFinite(value)) return 0;
  const magnitude = Math.round((Math.abs(value) + Number.EPSILON) * 100) / 100;
  return value < 0 ? -magnitude : magnitude;
}

export function toCount(value: number | null | undefined): number {
  return typeof value === "number" && Number.isFinite(value) ? value : 0;
}

export function toFiniteOrNull(value: number | null | undefined): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}
