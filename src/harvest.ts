import { oceanopsGet, OceanOpsError } from "./client.js";

const RUNS_MAX = 200;
const ITEMS_MAX = 500;
const ATTEMPTS_MAX = 50;
const LOGS_MAX = 200;
const BODY_MAX = 2000;

type Envelope<T> = { success?: boolean; data?: T; error?: string };

type RawRun = {
  id: number;
  harvester_code: string;
  environment: string;
  trigger: string;
  started_at: string;
  finished_at: string | null;
  items_total: number;
  items_submitted: number;
  items_failed: number;
};

type RawItem = {
  id: number;
  run_id: number;
  item_type: string;
  item_key: string;
  status: string;
  error_stage: string | null;
  error_message: string | null;
  started_at: string;
  finished_at: string | null;
  stats?: unknown;
  attempts_count: number;
  last_ok: boolean | null;
  last_http_status: number | null;
  last_duration_ms: number | null;
  last_attempt_finished_at: string | null;
  last_attempt_error_message: string | null;
};

type RawAttempt = {
  id: number;
  run_id: number;
  item_id: number;
  attempt_no: number;
  stage: string;
  started_at: string;
  finished_at: string | null;
  ok: boolean;
  http_status: number | null;
  request_url: string | null;
  duration_ms: number | null;
  error_message: string | null;
  request_headers?: unknown;
  response_body?: string | null;
};

type RawLog = {
  id: number;
  run_id: number;
  item_id: number | null;
  attempt_id: number | null;
  level: string;
  message: string;
  data: unknown;
  ts: string;
};

export type HarvestRunStatus = "RUNNING" | "SUCCESS" | "PARTIAL" | "FAILED";

export type HarvestRun = {
  id: number;
  harvesterCode: string;
  environment: string;
  trigger: string;
  status: HarvestRunStatus;
  startedAt: string;
  finishedAt: string | null;
  itemsTotal: number;
  itemsSubmitted: number;
  itemsFailed: number;
};

export type HarvestItem = {
  id: number;
  runId: number;
  itemType: string;
  itemKey: string;
  status: string;
  errorStage: string | null;
  errorMessage: string | null;
  startedAt: string;
  finishedAt: string | null;
  attemptsCount: number;
  lastOk: boolean | null;
  lastHttpStatus: number | null;
  lastDurationMs: number | null;
  lastAttemptFinishedAt: string | null;
  lastAttemptErrorMessage: string | null;
};

export async function listHarvestRuns(input: {
  harvesterCode?: string;
  since?: string;
  until?: string;
  limit?: number;
}) {
  const limit = clamp(input.limit, 20, RUNS_MAX);
  const fetchLimit = input.since || input.until || input.harvesterCode ? RUNS_MAX : limit;
  const rows = await harvestGet<RawRun[]>("/harvest/runs", { limit: fetchLimit });
  const items = rows
    .map(toRun)
    .filter((run) => {
      if (input.harvesterCode && run.harvesterCode !== input.harvesterCode) return false;
      return inDateRange(run.startedAt, input.since, input.until);
    })
    .slice(0, limit);

  return {
    limit,
    since: input.since,
    until: input.until,
    harvesterCode: input.harvesterCode,
    total: items.length,
    note: "Ingestion monitoring for passport/metadata harvests (LDL, VOTO, MFP), not platform search. total is the filtered page, not every historical run.",
    items,
  };
}

export async function listHarvestItems(input: {
  runId: number;
  status?: "ALL" | "FAILED" | "SUBMITTED" | "PENDING";
  search?: string;
  limit?: number;
}) {
  const limit = clamp(input.limit, 50, ITEMS_MAX);
  const status = input.status && input.status !== "ALL" ? input.status : undefined;
  const rows = await harvestGet<RawItem[]>(`/harvest/runs/${input.runId}/items`, {
    status,
    search: input.search,
    limit,
  });
  const items = rows.map(toItem);
  return {
    runId: input.runId,
    status: input.status ?? "ALL",
    search: input.search,
    limit,
    total: items.length,
    note: "Items in one harvest run. FAILED first in the API order. total is this page.",
    items,
  };
}

export async function listHarvestAttempts(input: { itemId: number; runId?: number; limit?: number }) {
  const limit = clamp(input.limit, 20, ATTEMPTS_MAX);
  const path =
    input.runId !== undefined
      ? `/harvest/runs/${input.runId}/items/${input.itemId}/attempts`
      : `/harvest/items/${input.itemId}/attempts`;
  const rows = await harvestGet<RawAttempt[]>(path, { limit });
  return {
    runId: input.runId,
    itemId: input.itemId,
    total: rows.length,
    items: rows.map((row) => toAttempt(row, false)),
  };
}

export async function listHarvestLogs(input: { runId: number; itemId?: number; limit?: number }) {
  const limit = clamp(input.limit, 50, LOGS_MAX);
  const rows = await harvestGet<RawLog[]>(`/harvest/runs/${input.runId}/logs`, {
    itemId: input.itemId,
    limit,
  });
  return {
    runId: input.runId,
    itemId: input.itemId,
    total: rows.length,
    items: rows.map(toLog),
  };
}

export async function getHarvestAttempt(input: { attemptId: number }) {
  const data = await harvestGet<RawAttempt[] | RawAttempt>(`/harvest/attempts/${input.attemptId}`);
  const row = Array.isArray(data) ? data[0] : data;
  if (!row) throw new OceanOpsError(`No harvest attempt ${input.attemptId}.`, 404);
  return { item: toAttempt(row, true) };
}

export async function reviewHarvests(input: { date?: string; since?: string; until?: string; harvesterCode?: string }) {
  const since = input.date ?? input.since ?? utcDate();
  const until = input.date ?? input.until ?? since;
  const listed = await listHarvestRuns({
    harvesterCode: input.harvesterCode,
    since,
    until,
    limit: RUNS_MAX,
  });
  const runs = listed.items;
  const problem = runs.filter((run) => run.status === "PARTIAL" || run.status === "FAILED" || run.status === "RUNNING");
  const failures = await Promise.all(
    problem.slice(0, 10).map(async (run) => {
      const failed = await listHarvestItems({ runId: run.id, status: "FAILED", limit: 100 });
      return {
        runId: run.id,
        harvesterCode: run.harvesterCode,
        status: run.status,
        itemsFailed: run.itemsFailed,
        groups: groupErrors(failed.items),
      };
    }),
  );

  const byStatus: Record<string, number> = {};
  for (const run of runs) {
    byStatus[run.status] = (byStatus[run.status] ?? 0) + 1;
  }

  return {
    since,
    until,
    harvesterCode: input.harvesterCode,
    runCount: runs.length,
    byStatus,
    runs,
    failures,
    note: "Harvest ingestion review. Use list_harvest_items or get_harvest_attempt for one failure. This is not platform or passport search.",
  };
}

function utcDate(value = new Date()): string {
  return value.toISOString().slice(0, 10);
}

function inDateRange(startedAt: string, since?: string, until?: string): boolean {
  const day = startedAt.slice(0, 10);
  if (since && day < since) return false;
  if (until && day > until) return false;
  return true;
}

function harvestRunStatus(run: {
  finishedAt: string | null;
  itemsFailed: number;
  itemsSubmitted: number;
}): HarvestRunStatus {
  if (!run.finishedAt) return "RUNNING";
  if (run.itemsFailed === 0) return "SUCCESS";
  if (run.itemsSubmitted === 0) return "FAILED";
  return "PARTIAL";
}

function toRun(row: RawRun): HarvestRun {
  const finishedAt = row.finished_at;
  const itemsSubmitted = Number(row.items_submitted ?? 0);
  const itemsFailed = Number(row.items_failed ?? 0);
  return {
    id: row.id,
    harvesterCode: row.harvester_code,
    environment: row.environment,
    trigger: row.trigger,
    status: harvestRunStatus({ finishedAt, itemsFailed, itemsSubmitted }),
    startedAt: row.started_at,
    finishedAt,
    itemsTotal: Number(row.items_total ?? 0),
    itemsSubmitted,
    itemsFailed,
  };
}

function toItem(row: RawItem): HarvestItem {
  return {
    id: row.id,
    runId: row.run_id,
    itemType: row.item_type,
    itemKey: row.item_key,
    status: row.status,
    errorStage: row.error_stage,
    errorMessage: row.error_message,
    startedAt: row.started_at,
    finishedAt: row.finished_at,
    attemptsCount: Number(row.attempts_count ?? 0),
    lastOk: row.last_ok,
    lastHttpStatus: row.last_http_status,
    lastDurationMs: row.last_duration_ms,
    lastAttemptFinishedAt: row.last_attempt_finished_at,
    lastAttemptErrorMessage: row.last_attempt_error_message,
  };
}

function toAttempt(row: RawAttempt, detailed: boolean) {
  const attempt = {
    id: row.id,
    runId: row.run_id,
    itemId: row.item_id,
    attemptNo: row.attempt_no,
    stage: row.stage,
    startedAt: row.started_at,
    finishedAt: row.finished_at,
    ok: row.ok,
    httpStatus: row.http_status,
    requestUrl: row.request_url,
    durationMs: row.duration_ms,
    errorMessage: row.error_message,
    requestHeaders: detailed ? parseJsonField(row.request_headers) : undefined,
    responseBody: detailed ? truncate(row.response_body, BODY_MAX) : undefined,
    validation: detailed ? parseValidation(row.response_body) : undefined,
  };
  if (!detailed) {
    delete attempt.requestHeaders;
    delete attempt.responseBody;
    delete attempt.validation;
  }
  return attempt;
}

function toLog(row: RawLog) {
  return {
    id: row.id,
    runId: row.run_id,
    itemId: row.item_id,
    attemptId: row.attempt_id,
    ts: row.ts,
    level: row.level,
    message: row.message,
    data: parseJsonField(row.data),
  };
}

function groupErrors(items: HarvestItem[]) {
  const groups = new Map<
    string,
    { error: string; stage: string | null; httpStatus: number | null; count: number; itemKeys: string[] }
  >();
  for (const item of items) {
    const error = (item.errorMessage || item.lastAttemptErrorMessage || "unknown error").slice(0, 180);
    const key = `${item.errorStage ?? ""}|${item.lastHttpStatus ?? ""}|${error}`;
    const existing = groups.get(key);
    if (existing) {
      existing.count += 1;
      if (existing.itemKeys.length < 12) existing.itemKeys.push(item.itemKey);
    } else {
      groups.set(key, {
        error,
        stage: item.errorStage,
        httpStatus: item.lastHttpStatus,
        count: 1,
        itemKeys: [item.itemKey],
      });
    }
  }
  return [...groups.values()].sort((a, b) => b.count - a.count);
}

function parseValidation(body: string | null | undefined): unknown {
  if (!body) return undefined;
  const parsed = parseJsonField(body);
  if (!parsed || typeof parsed !== "object") return undefined;
  const record = parsed as Record<string, unknown>;
  if (!record.errors && !record.message && !record.title) return undefined;
  return {
    title: record.title,
    message: record.message,
    status: record.status,
    errors: record.errors,
  };
}

function parseJsonField(value: unknown): unknown {
  if (typeof value !== "string") return value;
  const text = value.trim();
  if (!text || (text[0] !== "{" && text[0] !== "[")) return value;
  try {
    return JSON.parse(text);
  } catch {
    return value;
  }
}

function truncate(value: string | null | undefined, max: number): string | null {
  if (value == null) return null;
  if (value.length <= max) return value;
  return `${value.slice(0, max)}…(truncated)`;
}

function clamp(value: number | undefined, fallback: number, max: number): number {
  const n = value ?? fallback;
  if (!Number.isFinite(n)) return fallback;
  return Math.min(max, Math.max(1, Math.trunc(n)));
}

async function harvestGet<T>(path: string, query?: Record<string, string | number | undefined>): Promise<T> {
  const body = await oceanopsGet<Envelope<T>>(path, query);
  if (body && typeof body === "object" && body.success === false) {
    throw new OceanOpsError(body.error || `Harvest ${path} failed`);
  }
  if (body && typeof body === "object" && body.data !== undefined) return body.data;
  throw new OceanOpsError(`Harvest ${path} returned no data`);
}
