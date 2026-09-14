# ai-daily-insights-mcp

A [Model Context Protocol](https://modelcontextprotocol.io) server for **[AI Daily Insights](https://www.aidailyinsights.cn)** — a daily AI briefing built for both humans and agents.

It lets any MCP-capable assistant (Claude Desktop, Claude Code, Cursor, …) list, read and search the daily AI news, fully structured — no HTML scraping.

## Aggregate usage and privacy (0.4.4+)

Each entered tool handler sends a best-effort background event to the configured `AI_DAILY_BASE_URL` (the public site by default). It contains only the tool name and package version: no arguments, search queries, results, session IDs or user identifiers. The hosting infrastructure still sees standard request metadata. Events include cached calls and errors, but exclude tool discovery and rejected input schemas. They are self-reported usage, not verified AI users.

Set `AI_DAILY_ANALYTICS=0` in the MCP server environment to disable these events. Data fetches still use the package/version User-Agent for HTTP attribution. Reporting never waits on the tool response path, has a 1.5-second timeout, at most 16 outstanding events and no retries; offline/shutdown/opt-out may undercount. Existing data caching is unchanged.

## Tools

| Tool | What it does |
| --- | --- |
| `get_latest()` | The newest issue with all its news items in one call. |
| `list_latest(limit=5)` | List recent issues: date, title, summary, tags, URLs. |
| `get_article(date)` | Fetch one issue (`YYYY-MM-DD`), parsed into news items `{index, title, signal, body}`. |
| `get_range(from, to, limit=14)` | Every issue in a date range (e.g. the past week), fetched in parallel. |
| `list_by_tag(tag, limit=10)` | Issues carrying a given tag (company/topic), matched case-insensitively. |
| `search(query, tag, limit=10)` | Full-text + tag search across all news items, in one server-side call. |

Data comes from the public JSON endpoints (`/index.json`, `/{date}.json`, `/search`) — the server is stateless and needs no API key. Responses are cached in-memory briefly (default 5 min, override with `AI_DAILY_CACHE_TTL_MS`) to avoid hammering the site on repeated calls.

## Use it

### Claude Code
```bash
claude mcp add ai-daily-insights -- npx -y ai-daily-insights-mcp
```

### Claude Desktop / Cursor (config file)
```json
{
  "mcpServers": {
    "ai-daily-insights": {
      "command": "npx",
      "args": ["-y", "ai-daily-insights-mcp"]
    }
  }
}
```

Then ask: *"用 ai-daily-insights 列出最近 5 天的 AI 资讯，挑 SpaceX 相关的讲讲。"*

## Config

| Env var | Default | Purpose |
| --- | --- | --- |
| `AI_DAILY_BASE_URL` | `https://www.aidailyinsights.cn` | Override the site origin (e.g. a preview deploy). |
| `AI_DAILY_CACHE_TTL_MS` | `300000` | In-memory cache TTL for fetched JSON, in milliseconds. |

## Develop

```bash
npm install
npm test
npm run inspect   # opens the MCP Inspector
```

Requires Node.js 20 or newer. Every tool declares explicit MCP safety annotations,
validates its inputs with Zod, and converts upstream failures into structured MCP
error results.

## License

MIT
