export function fullName(u?: { first_name?: string | null; last_name?: string | null } | null): string {
  return `${u?.first_name ?? ""} ${u?.last_name ?? ""}`.trim();
}

export function initialsOf(u?: { first_name?: string | null; last_name?: string | null } | null): string {
  return `${(u?.first_name ?? "?")[0] ?? ""}${(u?.last_name ?? "?")[0] ?? ""}`.toUpperCase();
}

/** Privacy-preserving display name for a counterparty ("Adaeze N."). */
export function shortName(u?: { first_name?: string | null; last_name?: string | null } | null): string {
  const f = u?.first_name?.trim() ?? "";
  const l = u?.last_name?.trim() ?? "";
  if (!f && !l) return "Routta user";
  return l ? `${f} ${l[0].toUpperCase()}.`.trim() : f;
}

/** Coerces a bigint/decimal DB value to a safe integer. */
export function toInt(v: unknown): number {
  const n = Number(v);
  return Number.isFinite(n) ? Math.round(n) : 0;
}
