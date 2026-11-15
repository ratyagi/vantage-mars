# Vantage MCP server

Lets an AI assistant (Claude Desktop, Claude Code or any MCP client) call the Vantage terrain checks directly. Zero dependencies: plain Node 20+, MCP over stdio. It runs offline on the local 1 m terrain window, which is the use case: on Mars, ground support is minutes away by radio, so an onboard assistant has to answer from local data.

## Tools

| Tool | What it answers |
|---|---|
| `terrain_info` | Terrain window, coordinates, default scene (habitat, rover, landmarks, Curiosity route), sources. |
| `eva_check` | At a point (by `sol`, `route_m` or `x`/`y`): what is in view, slope, fastest walk home, start-back margin, sun, dust and radio, plus a list of HOLD and CAUTION issues. |
| `radio_plan` | Radio line-of-sight coverage along the route, longest outage, best relay sites. |
| `line_of_sight` | Can A see B, with clearance and where it is blocked. |
| `plan_route` | Slope-limited route between two points that prefers keeping the habitat in view. |

## Connect

Claude Desktop, `claude_desktop_config.json`:

```json
{
  "mcpServers": {
    "vantage-mars": { "command": "node", "args": ["/absolute/path/to/vantage-mars/mcp/server.mjs"] }
  }
}
```

Claude Code: `claude mcp add vantage-mars -- node /absolute/path/to/vantage-mars/mcp/server.mjs`

Needs `web/data/dem.f32` (see the main README).

## Example questions

- "Where was Curiosity on sol 4748, and could a walking astronaut there see the habitat?"
- "During a dust storm with tau 4 and a 20 minute shelter limit, is sol 4748 safe to walk to?"
- "Where should we park a radio relay for this route?"
- "Plan a walk from the sol 4634 stop to the sol 4839 stop under 20 degrees of slope."

Same caveats as the app: predictions from a terrain model with labeled assumptions, advisory only, not a radiation or link-budget model.
