# OceanOPS MCP

Read-only [Model Context Protocol](https://modelcontextprotocol.io) server for the public OceanOPS API. It runs locally over stdio and does not write to OceanOPS.

## Tools

| Tool | What it calls |
|---|---|
| `search_platforms` | `POST /oceanjson/platforms/search` |
| `get_platform` | the same search, or a passport summary when only `ptfId` is known |
| `get_passport` | `POST /passports/search` (one document, summary unless `full` is true) |
| `search_ships` | `GET /ships` and `GET /ships/search` |
| `list_vocabulary` | `GET /vocab/{programs,countries,ptf-statuses,ptf-families,goos-observing-networks,ship-statuses,ship-types}` |

Pages are capped at 20 rows. Cruise search is not included: `GET /cruises` requires the Amrit gateway.

Codes such as `statusCode=operational`, `countryCode2=FR`, `programCode=argo-jamstec`, and `networkCode=argo` are resolved through the vocabulary before they are sent as database ids.

## Run

```bash
cd oceanops-mcp
npm install
npm run build
```

Point any MCP client at the built server. It speaks stdio: the client starts the process and exchanges JSON-RPC on stdin and stdout.

```json
{
  "mcpServers": {
    "oceanops": {
      "command": "node",
      "args": ["/absolute/path/to/oceanops-mcp/dist/index.js"],
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
