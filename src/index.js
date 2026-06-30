#!/usr/bin/env node
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { z } from 'zod';

const VERSION = '0.4.0';
const BASE_URL = (process.env.AI_DAILY_BASE_URL || 'https://www.aidailyinsights.cn').replace(/\/$/, '');
// 缓存存活时间：站点每天更新、偶尔编辑，5 分钟足够新鲜又能挡住连续调用的重复请求。
const CACHE_TTL_MS = Number(process.env.AI_DAILY_CACHE_TTL_MS || 5 * 60 * 1000);

// --- 带 TTL 的内存缓存 ------------------------------------------------------
// 同一路径在 TTL 内只打一次站点；并发请求共享同一个 in-flight Promise，避免重复抓取。
const cache = new Map(); // path -> { expires, promise }

async function getJson(path, { noCache = false } = {}) {
  const now = Date.now();
  const hit = cache.get(path);
  if (!noCache && hit && hit.expires > now) return hit.promise;

  const promise = (async () => {
    const res = await fetch(`${BASE_URL}${path}`, { headers: { accept: 'application/json' } });
    if (!res.ok) throw new Error(`GET ${path} failed: ${res.status} ${res.statusText}`);
    return res.json();
  })();

  // 失败不要把坏 Promise 留在缓存里，否则会把错误也缓存 TTL 这么久。
  promise.catch(() => cache.delete(path));
  if (!noCache) cache.set(path, { expires: now + CACHE_TTL_MS, promise });
  return promise;
}

const json = (data) => ({ content: [{ type: 'text', text: JSON.stringify(data, null, 2) }] });
const slimPost = (p) => ({
  date: p.date,
  title: p.title,
  summary: p.summary,
  tags: p.tags,
  url: p.url,
  json: p.json,
  itemCount: p.itemCount,
});

const server = new McpServer(
  { name: 'ai-daily-insights', version: VERSION },
  {
    instructions: [
      'AI Daily Insights — a Chinese daily AI news briefing, structured for agents.',
      'Each "issue" is one day and contains ~10 news items; each item has {index, title, signal, body} where "signal" is the one-line takeaway.',
      '',
      'When the user asks about recent AI news, AI industry developments, or this briefing, use these tools instead of scraping the website:',
      "- get_latest(): the most common case — today's / the newest issue with all its news items in one call.",
      '- list_latest(limit): browse recent issues (one entry per day) without their full bodies.',
      '- get_article(date): one specific issue by date (YYYY-MM-DD).',
      '- get_range(from, to): all issues within a date range (e.g. the past week).',
      '- list_by_tag(tag, limit): issues carrying a given tag (company/topic).',
      '- search(query, tag): full-text + tag search across all news items in one server-side call.',
      '',
      'Always cite the article date and URL.',
    ].join('\n'),
  }
);

// --- list_latest -----------------------------------------------------------
server.registerTool(
  'list_latest',
  {
    title: 'List latest issues',
    description:
      'List the most recent AI Daily Insights issues (date, title, one-line summary, tags, URLs). Start here to discover what is available.',
    inputSchema: {
      limit: z.number().int().min(1).max(50).default(5).describe('How many recent issues to return (default 5).'),
    },
  },
  async ({ limit }) => {
    const index = await getJson('/index.json');
    const posts = (index.posts || []).slice(0, limit).map(slimPost);
    return json({ site: index.site, updated: index.updated, count: posts.length, posts });
  }
);

// --- get_latest ------------------------------------------------------------
server.registerTool(
  'get_latest',
  {
    title: 'Get the latest issue (structured)',
    description:
      "Fetch the most recent issue, parsed into structured news items {index, title, signal, body}. Use this when the user asks for today's / the latest AI news and does not give a date.",
    inputSchema: {},
  },
  async () => {
    const index = await getJson('/index.json');
    const newest = (index.posts || [])[0];
    if (!newest) return json({ error: 'no issues available' });
    return json(await getJson(`/${newest.date}.json`));
  }
);

// --- get_article -----------------------------------------------------------
server.registerTool(
  'get_article',
  {
    title: 'Get one issue (structured)',
    description:
      'Fetch a single daily issue by date, parsed into structured news items: each item has index, title, signal (the one-line judgment) and body. Date format: YYYY-MM-DD.',
    inputSchema: {
      date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).describe('Issue date, e.g. 2026-06-24.'),
    },
  },
  async ({ date }) => json(await getJson(`/${date}.json`))
);

// --- get_range -------------------------------------------------------------
server.registerTool(
  'get_range',
  {
    title: 'Get issues in a date range (structured)',
    description:
      'Fetch every issue whose date falls within [from, to] (inclusive), each parsed into structured news items. Use for "the past week", "between X and Y", etc. Dates are YYYY-MM-DD. Issues are fetched in parallel.',
    inputSchema: {
      from: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).describe('Start date (inclusive), e.g. 2026-06-24.'),
      to: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).describe('End date (inclusive), e.g. 2026-06-30.'),
      limit: z.number().int().min(1).max(31).default(14).describe('Max issues to return (default 14).'),
    },
  },
  async ({ from, to, limit }) => {
    const [lo, hi] = from <= to ? [from, to] : [to, from];
    const index = await getJson('/index.json');
    const dates = (index.posts || []).map((p) => p.date).filter((d) => d >= lo && d <= hi).slice(0, limit);
    const issues = await Promise.all(dates.map((d) => getJson(`/${d}.json`).catch(() => null)));
    return json({ from: lo, to: hi, count: issues.filter(Boolean).length, issues: issues.filter(Boolean) });
  }
);

// --- list_by_tag -----------------------------------------------------------
server.registerTool(
  'list_by_tag',
  {
    title: 'List issues by tag',
    description:
      'List issues that carry a given tag (e.g. a company or topic like "OpenAI", "融资", "芯片"). Returns issue-level entries; use search() to find specific news items by keyword.',
    inputSchema: {
      tag: z.string().min(1).describe('Tag to filter by, matched case-insensitively.'),
      limit: z.number().int().min(1).max(50).default(10).describe('Max issues to return (default 10).'),
    },
  },
  async ({ tag, limit }) => {
    const index = await getJson('/index.json');
    const t = tag.toLowerCase();
    const posts = (index.posts || [])
      .filter((p) => (p.tags || []).some((x) => String(x).toLowerCase() === t))
      .slice(0, limit)
      .map(slimPost);
    return json({ tag, count: posts.length, posts });
  }
);

// --- search ----------------------------------------------------------------
server.registerTool(
  'search',
  {
    title: 'Search across issues',
    description:
      'Full-text + tag search across all news items. Provide a keyword query, a tag, or both. Returns matching items with date, title, signal and a short snippet. Backed by the site search endpoint (one call); falls back to the flat index if unavailable.',
    inputSchema: {
      query: z.string().default('').describe('Keyword or phrase. Optional if tag is given.'),
      tag: z.string().default('').describe('Restrict to items whose issue carries this tag. Optional.'),
      limit: z.number().int().min(1).max(50).default(10).describe('Max matching items (default 10).'),
    },
  },
  async ({ query, tag, limit }) => {
    const q = (query || '').trim();
    const tg = (tag || '').trim();
    if (!q && !tg) return json({ error: 'provide at least one of: query, tag' });

    // 首选服务端 /search（一次调用、站点侧过滤）。失败再退回本地扫 /search-index.json。
    const params = new URLSearchParams();
    if (q) params.set('q', q);
    if (tg) params.set('tag', tg);
    params.set('limit', String(limit));
    try {
      const data = await getJson(`/search?${params.toString()}`, { noCache: true });
      if (data && data.ok) return json({ query: q || null, tag: tg || null, count: data.count, results: data.results });
    } catch {
      /* 老版本站点没有 /search，走下面的兜底 */
    }
    return json(await localSearch(q, tg, limit));
  }
);

// 兜底：直接下载扁平索引，在本地过滤（仅当服务端 /search 不可用时）。
async function localSearch(q, tg, limit) {
  const ql = q.toLowerCase();
  const tgl = tg.toLowerCase();
  let index;
  try {
    index = await getJson('/search-index.json');
  } catch (err) {
    return { error: `search unavailable: ${err.message}` };
  }
  const results = [];
  for (const item of index.items || []) {
    if (tg && !(item.tags || []).some((x) => String(x).toLowerCase() === tgl)) continue;
    let snippet = item.signal || (item.body || '').slice(0, 120);
    if (q) {
      const hay = `${item.title}\n${item.signal || ''}\n${item.body || ''}`;
      const at = hay.toLowerCase().indexOf(ql);
      if (at === -1) continue;
      snippet = hay.slice(Math.max(0, at - 40), at + 120).replace(/\s+/g, ' ').trim();
    }
    results.push({ date: item.date, index: item.index, title: item.title, signal: item.signal, tags: item.tags, snippet, url: `${item.url}#${item.index}` });
    if (results.length >= limit) break;
  }
  return { query: q || null, tag: tg || null, count: results.length, results };
}

// 启动提示：只写到 stderr，绝不碰 stdout（stdout 专供 MCP JSON 协议）。
function printBanner() {
  const lines = [
    '',
    `┌─ AI Daily Insights · MCP Server v${VERSION} ` + '─'.repeat(14),
    '│ ✅ 已启动，正在等待 AI 客户端连接（stdio 模式）。',
    '│',
    '│ 这是给 AI 用的接口，不是直接给人看的——',
    '│ 看到这段就说明它已正常运行，保持窗口开着即可。',
    '│',
    '│ 可用工具: get_latest · list_latest · get_article',
    '│           get_range · list_by_tag · search',
    `│ 数据源:   ${BASE_URL}`,
    '│ 接入文档: https://www.aidailyinsights.cn/qa/',
    '│ 退出:     Ctrl + C',
    '└' + '─'.repeat(54),
    '',
  ];
  process.stderr.write(lines.join('\n') + '\n');
}

const transport = new StdioServerTransport();
await server.connect(transport);
printBanner();
