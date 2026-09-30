export const PAGE_MAX = 20;
export const PAGE_DEFAULT = 10;

export function apiBase(): string {
  const raw = process.env.OCEANOPS_API_BASE ?? "https://www.ocean-ops.org/api/data";
  return raw.replace(/\/+$/, "");
}

export function authHeaders(): Record<string, string> {
  const id = process.env.OCEANOPS_API_ID?.trim();
  const token = process.env.OCEANOPS_API_TOKEN?.trim();
  if (!id || !token) return {};
  return {
    "X-OceanOPS-Metadata-ID": id,
    "X-OceanOPS-Metadata-Token": token,
  };
}

export function clampLimit(value: number | undefined, fallback = PAGE_DEFAULT): number {
  const n = value ?? fallback;
  if (!Number.isFinite(n)) return fallback;
  return Math.min(PAGE_MAX, Math.max(1, Math.trunc(n)));
}

export function clampOffset(value: number | undefined): number {
  const n = value ?? 0;
  if (!Number.isFinite(n) || n < 0) return 0;
  return Math.trunc(n);
}
