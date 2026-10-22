#!/usr/bin/env node
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
import {
  getHarvestAttempt,
  listHarvestAttempts,
  listHarvestItems,
  listHarvestLogs,
  listHarvestRuns,
  reviewHarvests,
} from "./harvest.js";
import { getQcAnomaly, listQcAnomalies, listQcOffenders, reviewQc, suggestQcFills } from "./qc.js";
import { jsonTextResult } from "./result.js";

const server = new McpServer({
  name: "oceanops-ops",
  version: "0.2.0",
});

server.tool(
  "review_harvests",
  "Morning-style review of OceanOPS metadata harvest ingestion (LDL, VOTO ERDDAP, MFP cruises). Summarizes runs for a date and groups FAILED items by error. Ops only: not platform, passport, or ship search.",
  {
    date: z.string().optional().describe("Calendar day YYYY-MM-DD. Default today UTC. Sets both since and until."),
    since: z.string().optional().describe("Inclusive start day YYYY-MM-DD. Ignored if date is set."),
    until: z.string().optional().describe("Inclusive end day YYYY-MM-DD. Ignored if date is set."),
    harvesterCode: z
      .string()
      .optional()
      .describe("Harvester code such as ldl-wmdr, voto-erddap, or mfp-cruises"),
  },
  async (input) => jsonTextResult(() => reviewHarvests(input)),
);

server.tool(
  "list_harvest_runs",
  "List recent harvest ingestion runs (LDL, VOTO, MFP). Each row has derived status SUCCESS, PARTIAL, FAILED, or RUNNING.",
  {
    harvesterCode: z.string().optional().describe("Harvester code such as ldl-wmdr, voto-erddap, or mfp-cruises"),
    since: z.string().optional().describe("Inclusive start day YYYY-MM-DD"),
    until: z.string().optional().describe("Inclusive end day YYYY-MM-DD"),
    limit: z.number().int().min(1).max(200).optional(),
  },
  async (input) => jsonTextResult(() => listHarvestRuns(input)),
);

server.tool(
  "list_harvest_items",
  "List items in one harvest run. Filter by FAILED to inspect errors. itemKey is a WMO, passport id, or cruise key.",
  {
    runId: z.number().int().positive().describe("Harvest run id from list_harvest_runs"),
    status: z.enum(["ALL", "FAILED", "SUBMITTED", "PENDING"]).optional(),
    search: z.string().optional().describe("Match item key or error message"),
    limit: z.number().int().min(1).max(500).optional(),
  },
  async (input) => jsonTextResult(() => listHarvestItems(input)),
);

server.tool(
  "list_harvest_attempts",
  "List HTTP submit attempts for one harvest item. Use get_harvest_attempt for the response body and validation errors.",
  {
    itemId: z.number().int().positive(),
    runId: z.number().int().positive().optional(),
    limit: z.number().int().min(1).max(50).optional(),
  },
  async (input) => jsonTextResult(() => listHarvestAttempts(input)),
);

server.tool(
  "list_harvest_logs",
  "List harvest_log rows for a run, optionally one item. Newest first. Use for pipeline.start / submit.result / run.finish traces.",
  {
    runId: z.number().int().positive(),
    itemId: z.number().int().positive().optional(),
    limit: z.number().int().min(1).max(200).optional(),
  },
  async (input) => jsonTextResult(() => listHarvestLogs(input)),
);

server.tool(
  "get_harvest_attempt",
  "Fetch one harvest HTTP attempt, including truncated response body and parsed validation errors when the API returned a JSON 400.",
  {
    attemptId: z.number().int().positive(),
  },
  async (input) => jsonTextResult(() => getHarvestAttempt(input)),
);

server.tool(
  "review_qc",
  "Morning-style review of OceanOPS database QC anomalies (same data as oceanops-qc-dashboard). Current counts, day-over-day risers/fallers, and calculation errors. A non-zero count is a known data-quality issue, not a failed job.",
  {
    date: z.string().optional().describe("Calendar day YYYY-MM-DD. Default is the latest calculation."),
    category: z
      .string()
      .optional()
      .describe("Category such as Platform metadata, Program metadata, Deployment metadata, Sensors, or GTS identifiers"),
  },
  async (input) => jsonTextResult(() => reviewQc(input)),
);

server.tool(
  "list_qc_anomalies",
  "List QC anomaly checks with current count, previous count, and a short history. Filter by category or free text.",
  {
    category: z.string().optional().describe("Exact category name, for example Program metadata"),
    q: z.string().optional().describe("Match code, name, description, or category"),
    historyDays: z.number().int().min(1).max(366).optional().describe("History points to keep. Default 7."),
  },
  async (input) => jsonTextResult(() => listQcAnomalies(input)),
);

server.tool(
  "get_qc_anomaly",
  "Fetch one QC anomaly by stable code (for example programs_without_wigos_code), including daily history.",
  {
    code: z.string().describe("Anomaly code from list_qc_anomalies or review_qc"),
    historyDays: z.number().int().min(1).max(366).optional().describe("History points to keep. Default 90."),
  },
  async (input) => jsonTextResult(() => getQcAnomaly(input)),
);

server.tool(
  "list_qc_offenders",
  "List the records behind a QC count (programs, platforms, deployments, or GTS IDs). Paginated. Read-only. Requires GET /qc/anomalies/{code}/items on the API.",
  {
    code: z.string().describe("Anomaly code such as programs_without_wigos_code"),
    q: z.string().optional().describe("Match code, name, ref, WMO, or related text"),
    limit: z.number().int().min(1).max(100).optional(),
    offset: z.number().int().min(0).optional(),
  },
  async (input) => jsonTextResult(() => listQcOffenders(input)),
);

server.tool(
  "suggest_qc_fills",
  "Same offender list plus a proposed fill per row (WIGOS code, country, lead agency, model, swapped GTS dates). Does not write to OceanOPS. Review before applying.",
  {
    code: z.string().describe("Anomaly code such as programs_without_wigos_code"),
    q: z.string().optional(),
    limit: z.number().int().min(1).max(100).optional(),
    offset: z.number().int().min(0).optional(),
  },
  async (input) => jsonTextResult(() => suggestQcFills(input)),
);

const transport = new StdioServerTransport();
await server.connect(transport);
