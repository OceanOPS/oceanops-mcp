#!/usr/bin/env node
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
import { OceanOpsError } from "./client.js";
import { markersFrom, renderWorldMap } from "./map.js";
import {
  VOCABULARIES,
  getPassport,
  getPlatform,
  listVocabulary,
  searchPlatforms,
  searchShips,
} from "./oceanops.js";

const server = new McpServer({
  name: "oceanops",
  version: "0.1.0",
});

const vocabulary = z.enum([
  "programs",
  "countries",
  "ptf-statuses",
  "ptf-families",
  "goos-observing-networks",
  "ship-statuses",
  "ship-types",
]);

server.tool(
  "search_platforms",
  "Search OceanOPS platforms. Returns at most 20 rows and, when positions are known, a world-map image with a marker for each latest position. statusCode, programCode, countryCode2, and networkCode are vocabulary codes (for example statusCode=operational, networkCode=argo), not display names. ref is a prefix; exactRef is exact. Use list_vocabulary when a code is unknown.",
  {
    wmoId: z.string().optional().describe("WMO platform identifier"),
    wigosId: z.string().optional().describe("WIGOS identifier"),
    ref: z.string().optional().describe("Platform reference prefix"),
    exactRef: z.string().optional().describe("Exact platform reference"),
    internalId: z.string().optional().describe("OceanOPS internal identifier"),
    name: z.string().optional().describe("Platform name prefix"),
    statusCode: z.string().optional().describe("Platform status code, such as operational or closed"),
    programCode: z.string().optional().describe("Supervising program code, such as argo-jamstec"),
    countryCode2: z.string().optional().describe("ISO 3166-1 alpha-2 country code, such as FR"),
    networkCode: z.string().optional().describe("GOOS observing network code, such as argo"),
    deplDateFrom: z.string().optional().describe("Deployment date from, YYYY-MM-DD"),
    deplDateTo: z.string().optional().describe("Deployment date to, YYYY-MM-DD"),
    limit: z.number().int().min(1).max(20).optional(),
    offset: z.number().int().min(0).optional(),
  },
  async (input) => jsonResult(() => searchPlatforms(input)),
);

server.tool(
  "get_platform",
  "Fetch one OceanOPS platform by a single identifier: ptfId, wmoId, wigosId, or ref. Includes a world-map image when a position is known.",
  {
    ptfId: z.number().int().positive().optional().describe("OceanOPS platform database id"),
    wmoId: z.string().optional(),
    wigosId: z.string().optional(),
    ref: z.string().optional().describe("Exact platform reference"),
  },
  async (input) =>
    jsonResult(async () => {
      const provided = [input.ptfId, input.wmoId, input.wigosId, input.ref].filter((value) => value !== undefined && value !== "");
      if (provided.length !== 1) {
        throw new OceanOpsError("Provide exactly one of ptfId, wmoId, wigosId, or ref.");
      }
      return getPlatform(input);
    }),
);

server.tool(
  "get_passport",
  "Fetch one OceanOPS platform passport. Returns a short summary unless full is true, plus a world-map image marking the deployment and the last position. Provide exactly one of ptfId, wmoId, wigosId, or internalId. This does not download the full catalogue.",
  {
    ptfId: z.number().int().positive().optional(),
    wmoId: z.string().optional(),
    wigosId: z.string().optional(),
    internalId: z.string().optional(),
    full: z.boolean().optional().describe("Include the full passport document. Default false."),
  },
  async (input) =>
    jsonResult(async () => {
      const provided = [input.ptfId, input.wmoId, input.wigosId, input.internalId].filter(
        (value) => value !== undefined && value !== "",
      );
      if (provided.length !== 1) {
        throw new OceanOpsError("Provide exactly one of ptfId, wmoId, wigosId, or internalId.");
      }
      return getPassport(input);
    }),
);

server.tool(
  "search_ships",
  "Search OceanOPS ships. A name-only query uses typeahead and returns id plus name. imo, type, country, and status use the ship list. At most 20 rows.",
  {
    name: z.string().optional(),
    imo: z.string().optional(),
    type: z.string().optional().describe("Ship type code or name accepted by the ship list filter"),
    country: z.string().optional(),
    status: z.string().optional(),
    limit: z.number().int().min(1).max(20).optional(),
    offset: z.number().int().min(0).optional(),
  },
  async (input) => jsonResult(() => searchShips(input)),
);

server.tool(
  "list_vocabulary",
  `List an OceanOPS vocabulary so later searches can use stable codes and ids. Vocabularies: ${Object.keys(VOCABULARIES).join(", ")}.`,
  {
    vocabulary,
    q: z.string().optional().describe("Free-text search within the vocabulary"),
    limit: z.number().int().min(1).max(20).optional(),
    offset: z.number().int().min(0).optional(),
  },
  async (input) => jsonResult(() => listVocabulary(input)),
);

async function jsonResult(work: () => Promise<unknown>) {
  try {
    const value = await work();
    const content: Array<
      { type: "text"; text: string } | { type: "image"; data: string; mimeType: "image/png" }
    > = [{ type: "text", text: JSON.stringify(value, null, 2) }];
    const markers = markersFrom(value);
    if (markers.length > 0) {
      const png = await renderWorldMap(markers);
      if (png) content.push({ type: "image", data: png, mimeType: "image/png" });
    }
    return { content };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return { content: [{ type: "text" as const, text: message }], isError: true };
  }
}

const transport = new StdioServerTransport();
await server.connect(transport);
