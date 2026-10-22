import { oceanopsGet, OceanOpsError } from "./client.js";

const HISTORY_LIST_DEFAULT = 7;
const HISTORY_GET_DEFAULT = 90;
const HISTORY_MAX = 366;

type AnomalyStatus = "success" | "error";

type RawCount = {
  date: string;
  value: number | null;
  status: AnomalyStatus;
  calculatedAt: string;
  durationMs: number | null;
  errorMessage: string | null;
};

type RawAnomaly = {
  id: number;
  code: string;
  name: string;
  description: string | null;
  category: string | null;
  displayOrder: number;
  current: RawCount | null;
  history: RawCount[];
};

export type QcCount = {
  date: string;
  value: number | null;
  status: AnomalyStatus;
  calculatedAt: string;
  durationMs: number | null;
  errorMessage: string | null;
};

export type QcAnomaly = {
  id: number;
  code: string;
  name: string;
  description: string | null;
  category: string | null;
  displayOrder: number;
  current: QcCount | null;
  previous: QcCount | null;
  delta: number | null;
  history?: QcCount[];
};

export async function listQcAnomalies(input: {
  category?: string;
  q?: string;
  historyDays?: number;
} = {}) {
  const historyDays = clamp(input.historyDays, HISTORY_LIST_DEFAULT, HISTORY_MAX);
  const items = (await loadAnomalies())
    .filter((item) => matchesCategory(item, input.category) && matchesQuery(item, input.q))
    .map((item) => toAnomaly(item, historyDays));

  return {
    category: input.category,
    q: input.q,
    historyDays,
    total: items.length,
    note: "Database anomaly counts from GET /qc/anomalies (QC dashboard). Not harvest ingestion and not platform search.",
    items,
  };
}

export async function getQcAnomaly(input: { code: string; historyDays?: number }) {
  const code = input.code.trim();
  const historyDays = clamp(input.historyDays, HISTORY_GET_DEFAULT, HISTORY_MAX);
  const row = (await loadAnomalies()).find((item) => item.code === code);
  if (!row) throw new OceanOpsError(`No QC anomaly with code ${code}.`, 404);
  return {
    historyDays,
    item: toAnomaly(row, historyDays),
  };
}

export async function listQcOffenders(input: { code: string; q?: string; limit?: number; offset?: number }) {
  const code = input.code.trim();
  const limit = clamp(input.limit, 20, 100);
  const offset = Math.max(0, Math.trunc(input.offset ?? 0));
  const body = await oceanopsGet<Envelope<RawOffenderPage>>(`/qc/anomalies/${encodeURIComponent(code)}/items`, {
    q: input.q,
    limit,
    offset,
  });
  const page = unwrapPage(body, code);
  const items = (page.items ?? []).map(camelKeys);
  return {
    code: page.code ?? code,
    entity: page.entity,
    limit: page.limit ?? limit,
    offset: page.offset ?? offset,
    total: Number(page.total ?? items.length),
    q: input.q,
    note: "Records matching the QC count SQL. Read-only. Use suggest_qc_fills for proposed values. Does not write to OceanOPS.",
    items,
  };
}

export async function suggestQcFills(input: { code: string; q?: string; limit?: number; offset?: number }) {
  const listed = await listQcOffenders(input);
  const items = listed.items.map((item) => ({
    ...item,
    fill: proposeFill(listed.code, item),
  }));
  const proposed = items.filter((item) => item.fill).length;
  return {
    ...listed,
    proposed,
    skipped: items.length - proposed,
    items,
    note: "Proposed fills only. Nothing is written. Review each row, then apply in the dashboard or API. Use list_qc_offenders for the raw list.",
  };
}

export async function reviewQc(input: { date?: string; category?: string } = {}) {
  const rows = (await loadAnomalies()).filter((item) => matchesCategory(item, input.category));
  const items = rows.map((row) => snapshot(row, input.date));
  const errors = items.filter((item) => item.current?.status === "error" || !item.current);
  const risers = items
    .filter((item) => (item.delta ?? 0) > 0)
    .sort((a, b) => (b.delta ?? 0) - (a.delta ?? 0));
  const fallers = items
    .filter((item) => (item.delta ?? 0) < 0)
    .sort((a, b) => (a.delta ?? 0) - (b.delta ?? 0));

  const byCategory: Record<string, { count: number; total: number; errors: number }> = {};
  for (const item of items) {
    const category = item.category ?? "Uncategorised";
    const bucket = byCategory[category] ?? { count: 0, total: 0, errors: 0 };
    bucket.count += 1;
    bucket.total += item.current?.value ?? 0;
    if (item.current?.status === "error" || !item.current) bucket.errors += 1;
    byCategory[category] = bucket;
  }

  const calculatedAt = items
    .map((item) => item.current?.calculatedAt)
    .filter((value): value is string => Boolean(value))
    .sort()
    .at(-1);

  return {
    date: input.date ?? items[0]?.current?.date,
    category: input.category,
    calculatedAt,
    anomalyCount: items.length,
    calculationErrors: errors.length,
    rising: risers.length,
    falling: fallers.length,
    byCategory,
    errors: errors.map(brief),
    risers: risers.map(brief),
    fallers: fallers.map(brief),
    items: items.map(brief),
    note: "QC anomaly review from the daily pg_cron counts. A non-zero value is a known data-quality count, not a failed job. Use get_qc_anomaly for history. This is not harvest or platform search.",
  };
}

async function loadAnomalies(): Promise<RawAnomaly[]> {
  const body = await oceanopsGet<RawAnomaly[] | { data?: RawAnomaly[]; success?: boolean; error?: string }>(
    "/qc/anomalies",
  );
  if (Array.isArray(body)) return body;
  if (body && typeof body === "object" && body.success === false) {
    throw new OceanOpsError(body.error || "QC anomalies request failed");
  }
  if (body && typeof body === "object" && Array.isArray(body.data)) return body.data;
  throw new OceanOpsError("QC /qc/anomalies returned no data");
}

function snapshot(row: RawAnomaly, date?: string): QcAnomaly {
  const history = (row.history ?? []).map(toCount);
  const current = date
    ? (history.find((point) => point.date === date) ?? null)
    : row.current
      ? toCount(row.current)
      : (history.at(-1) ?? null);
  const previous = previousPoint(history, current);
  return {
    id: row.id,
    code: row.code,
    name: row.name,
    description: row.description,
    category: row.category,
    displayOrder: row.displayOrder,
    current,
    previous,
    delta: delta(current, previous),
  };
}

function toAnomaly(row: RawAnomaly, historyDays: number): QcAnomaly {
  const item = snapshot(row);
  item.history = (row.history ?? []).map(toCount).slice(-historyDays);
  return item;
}

function brief(item: QcAnomaly) {
  return {
    code: item.code,
    name: item.name,
    category: item.category,
    value: item.current?.value ?? null,
    status: item.current?.status ?? "missing",
    date: item.current?.date,
    previous: item.previous?.value ?? null,
    delta: item.delta,
    errorMessage: item.current?.errorMessage ?? null,
  };
}

function previousPoint(history: QcCount[], current: QcCount | null): QcCount | null {
  if (!current) return history.length >= 2 ? history[history.length - 2] : null;
  const index = history.findIndex((point) => point.date === current.date);
  if (index > 0) return history[index - 1];
  if (index === -1 && history.length > 0 && history[history.length - 1].date !== current.date) {
    return history[history.length - 1];
  }
  return null;
}

function delta(current: QcCount | null, previous: QcCount | null): number | null {
  if (current?.value == null || previous?.value == null) return null;
  return current.value - previous.value;
}

function toCount(row: RawCount): QcCount {
  return {
    date: row.date,
    value: row.value,
    status: row.status,
    calculatedAt: row.calculatedAt,
    durationMs: row.durationMs,
    errorMessage: row.errorMessage,
  };
}

function matchesCategory(item: RawAnomaly, category?: string): boolean {
  if (!category) return true;
  return (item.category ?? "").toLowerCase() === category.trim().toLowerCase();
}

function matchesQuery(item: RawAnomaly, q?: string): boolean {
  if (!q) return true;
  const needle = q.trim().toLowerCase();
  return [item.code, item.name, item.description, item.category]
    .filter(Boolean)
    .some((value) => String(value).toLowerCase().includes(needle));
}

function clamp(value: number | undefined, fallback: number, max: number): number {
  const n = value ?? fallback;
  if (!Number.isFinite(n)) return fallback;
  return Math.min(max, Math.max(1, Math.trunc(n)));
}

type Envelope<T> = { success?: boolean; data?: T; error?: string };

type RawOffenderPage = {
  code?: string;
  entity?: string;
  limit?: number;
  offset?: number;
  total?: number;
  items?: Array<Record<string, unknown>>;
};

function unwrapPage(body: Envelope<RawOffenderPage> | RawOffenderPage, code: string): RawOffenderPage {
  if (body && typeof body === "object" && "success" in body) {
    if (body.success === false) throw new OceanOpsError(body.error || `QC items for ${code} failed`);
    if (body.data) return body.data;
  }
  if (body && typeof body === "object" && "items" in body) return body as RawOffenderPage;
  throw new OceanOpsError(`QC /qc/anomalies/${code}/items returned no data`);
}

function camelKeys(row: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(row)) {
    const camel = key.replace(/_([a-z])/g, (_, letter: string) => letter.toUpperCase());
    out[camel] = value;
  }
  return out;
}

function proposeFill(code: string, item: Record<string, unknown>): { field: string; value: unknown; reason: string; confidence: "high" | "medium" | "low" } | null {
  if (code === "programs_without_wigos_code" && item.suggestedWigosCode) {
    return {
      field: "wigosCode",
      value: item.suggestedWigosCode,
      reason: `Copy network WIGOS code from ${item.networkName ?? "the program network"}`,
      confidence: "medium",
    };
  }
  if (code === "programs_without_country" && item.suggestedCountry) {
    return {
      field: "country",
      value: item.suggestedCountry,
      reason: `Use country of related agency ${item.relatedAgency ?? ""}`.trim(),
      confidence: "medium",
    };
  }
  if (code === "programs_without_lead_agency" && item.suggestedAgency) {
    return {
      field: "leadAgency",
      value: item.suggestedAgencyCode ?? item.suggestedAgency,
      reason: `Promote existing linked agency ${item.suggestedAgency} to lead`,
      confidence: "high",
    };
  }
  if (code === "programs_without_description" && item.name) {
    return {
      field: "description",
      value: item.networkName ? `${item.name} (${item.networkName})` : String(item.name),
      reason: "Draft description from program and network names — edit before saving",
      confidence: "low",
    };
  }
  if (code === "platforms_without_model" && item.suggestedModel) {
    return {
      field: "model",
      value: item.suggestedModel,
      reason: `Use the program default model for ${item.programCode ?? "the program"}`,
      confidence: "medium",
    };
  }
  if (code === "gts_ids_with_inverted_timestamps" && item.suggestedStartDate && item.suggestedEndDate) {
    return {
      field: "dates",
      value: { startDate: item.suggestedStartDate, endDate: item.suggestedEndDate },
      reason: "Swap start_date and end_date so the range is chronological",
      confidence: "high",
    };
  }
  if (code === "platforms_with_multiple_open_gts_ids" && item.suggestedKeepGtsId) {
    return {
      field: "openGtsIds",
      value: { keep: item.suggestedKeepGtsId, close: String(item.gtsIds ?? "") },
      reason: `Keep ${item.suggestedKeepGtsId} open and set an end date on the other open GTS IDs`,
      confidence: "low",
    };
  }
  return null;
}
