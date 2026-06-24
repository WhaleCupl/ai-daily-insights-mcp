# ai-daily-insights-mcp

A [Model Context Protocol](https://modelcontextprotocol.io) server for **[AI Daily Insights](https://www.aidailyinsights.cn)** — a daily AI briefing built for both humans and agents.

It lets any MCP-capable assistant (Claude Desktop, Claude Code, Cursor, …) list, read and search the daily AI news, fully structured — no HTML scraping.

## Tools

| Tool | What it does |
| --- | --- |
| `list_latest(limit=5)` | List recent issues: date, title, summary, tags, URLs. |
| `get_article(date)` | Fetch one issue (`YYYY-MM-DD`), parsed into news items `{index, title, signal, body}`. |
| `search(query, limit=10)` | Keyword search across every issue's titles and bodies. |

Data comes from the public JSON endpoints (`/index.json`, `/{date}.json`) — the server is stateless and needs no API key.

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

## Develop

```bash
npm install
npm run inspect   # opens the MCP Inspector
```

## License

MIT
