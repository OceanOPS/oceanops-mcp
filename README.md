# OceanOPS MCP

Two read-only [Model Context Protocol](https://modelcontextprotocol.io) servers for the public OceanOPS API. Both run locally over stdio and do not write to OceanOPS.

| Process | Entry | Audience |
|---|---|---|
| `oceanops` | `dist/index.js` | Catalogue: platforms, passports, ships, vocab |
| `oceanops-ops` | `dist/ops.js` | Ops: harvest ingestion and QC anomalies |

Keep them as separate MCP servers so a morning harvest or QC review does not see `search_platforms`, and a catalogue chat does not see ops tools. Same repo, same HTTP client. Harvest and QC are the first ops slices; later dataload / WIGOS tools belong on `oceanops-ops`.

## Catalogue tools (`oceanops`)

| Tool | What it calls |
|---|---|
| `search_platforms` | `POST /oceanjson/platforms/search` |
| `get_platform` | the same search, or a passport summary when only `ptfId` is known |
| `get_passport` | `POST /passports/search` (one document, summary unless `full` is true) |
| `search_ships` | `GET /ships` and `GET /ships/search` |
| `list_vocabulary` | `GET /vocab/{programs,countries,ptf-statuses,ptf-families,goos-observing-networks,ship-statuses,ship-types}` |

Pages are capped at 20 rows. Cruise search is not included: `GET /cruises` requires the Amrit gateway.

`get_passport` also returns a world-map image: an amber marker for the deployment and a red marker for the last position. `search_platforms` and `get_platform` include the same map when a latest position is present.

`search_platforms` accepts a `region`: `north-atlantic`, `south-atlantic`, `mediterranean`, `indian-ocean`, `western-north-pacific`, `arctic`, or `southern-ocean`. The server applies a fixed latest-position box, returns the full total and a count by status, and still lists at most 20 rows.

Codes such as `statusCode=operational`, `countryCode2=FR`, `programCode=argo-jamstec`, and `networkCode=argo` are resolved through the vocabulary before they are sent as database ids.

## Ops tools (`oceanops-ops`)

| Tool | What it calls |
|---|---|
| `review_harvests` | `GET /harvest/runs` plus failed items, grouped by error |
| `list_harvest_runs` | `GET /harvest/runs` |
| `list_harvest_items` | `GET /harvest/runs/{id}/items` |
| `list_harvest_attempts` | `GET /harvest/runs/{runId}/items/{itemId}/attempts` |
| `list_harvest_logs` | `GET /harvest/runs/{id}/logs` |
| `get_harvest_attempt` | `GET /harvest/attempts/{id}` |
| `review_qc` | `GET /qc/anomalies` — current counts, risers/fallers, calculation errors |
| `list_qc_anomalies` | `GET /qc/anomalies` |
| `get_qc_anomaly` | `GET /qc/anomalies` filtered by code |
| `list_qc_offenders` | `GET /qc/anomalies/{code}/items` |
| `suggest_qc_fills` | same items, plus a proposed value per row |

Harvest tools monitor metadata ingestion (LDL, VOTO ERDDAP, MFP cruises). `review_harvests` is the morning briefing: runs for a day, SUCCESS / PARTIAL / FAILED, and failed items grouped by error.

QC tools read the same daily anomaly counts as [oceanops-qc-dashboard](https://github.com/OceanOPS/oceanops-qc-dashboard). `review_qc` is the briefing. `list_qc_offenders` lists the programs, platforms, or GTS IDs behind a count. `suggest_qc_fills` adds a proposed value (network WIGOS code, agency country, swapped dates, …) and does **not** write. The items endpoint lives in `oceanops-api-main` and must be deployed for offender tools to work against prod.

## Run

```bash
cd oceanops-mcp
npm install
npm run build
```

Point any MCP client at the built servers. Each speaks stdio: the client starts the process and exchanges JSON-RPC on stdin and stdout.

```json
{
  "mcpServers": {
    "oceanops": {
      "command": "node",
      "args": ["/absolute/path/to/oceanops-mcp/dist/index.js"],
      "env": {
        "OCEANOPS_API_BASE": "https://www.ocean-ops.org/api/data"
      }
    },
    "oceanops-ops": {
      "command": "node",
      "args": ["/absolute/path/to/oceanops-mcp/dist/ops.js"],
      "env": {
        "OCEANOPS_API_BASE": "https://www.ocean-ops.org/api/data"
      }
    }
  }
}
```

Use an absolute path in `args`. Where this block lives depends on the client (project config or user settings). Restart or reload MCP servers after saving it.

The public endpoints used here need no token. To send an API id and token, add `OCEANOPS_API_ID` and `OCEANOPS_API_TOKEN` under `env`. They are sent as `X-OceanOPS-Metadata-ID` and `X-OceanOPS-Metadata-Token`.

Check the live API with `npm run smoke`.
