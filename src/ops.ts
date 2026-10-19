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
import { jsonTextResult } from "./result.js";

const server = new McpServer({
  name: "oceanops-ops",
  version: "0.1.0",
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

const transport = new StdioServerTransport();
await server.connect(transport);
