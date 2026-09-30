import { authHeaders, apiBase } from "./config.js";

export class OceanOpsError extends Error {
  constructor(
    message: string,
    readonly status?: number,
  ) {
    super(message);
    this.name = "OceanOpsError";
  }
}

export async function oceanopsGet<T>(path: string, query?: Record<string, string | number | undefined>): Promise<T> {
  const url = new URL(`${apiBase()}${path}`);
  if (query) {
    for (const [key, value] of Object.entries(query)) {
      if (value !== undefined && value !== "") url.searchParams.set(key, String(value));
    }
  }
  return request<T>(url, { method: "GET" });
}

export async function oceanopsPost<T>(path: string, body: unknown): Promise<T> {
  const url = new URL(`${apiBase()}${path}`);
  return request<T>(url, {
    method: "POST",
    body: JSON.stringify(body),
  });
}

async function request<T>(url: URL, init: RequestInit): Promise<T> {
  const response = await fetch(url, {
    ...init,
    headers: {
      Accept: "application/json",
      "Content-Type": "application/json",
      ...authHeaders(),
      ...init.headers,
    },
    signal: AbortSignal.timeout(20_000),
  });

  const text = await response.text();
  if (!response.ok) {
    throw new OceanOpsError(
      `OceanOPS ${response.status} ${response.statusText} for ${url.pathname}${text ? `: ${text.slice(0, 300)}` : ""}`,
      response.status,
    );
  }

  if (!text) return {} as T;
  try {
    return JSON.parse(text) as T;
  } catch {
    throw new OceanOpsError(`OceanOPS returned non-JSON for ${url.pathname}`);
  }
}
