#!/usr/bin/env node
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { z } from 'zod';

const BASE_URL = (process.env.AI_DAILY_BASE_URL || 'https://www.aidailyinsights.cn').replace(/\/$/, '');

async function getJson(path) {
  const res = await fetch(`${BASE_URL}${path}`, {
    headers: { accept: 'application/json' },
  });
  if (!res.ok) {
    throw new Error(`GET ${path} failed: ${res.status} ${res.statusText}`);
  }
  return res.json();
}

const json = (data) => ({
  content: [{ type: 'text', text: JSON.stringify(data, null, 2) }],
});

const server = new McpServer({
  name: 'ai-daily-insights',
  version: '0.1.0',
});

// --- list_latest -----------------------------------------------------------
server.registerTool(
  'list_latest',
  {
    title: 'List latest issues',
    description:
      'List the most recent AI Daily Insights issues (date, title, one-line summary, tags, URLs). Start here to discover what is available.',
    inputSchema: {
      limit: z
        .number()
        .int()
        .min(1)
        .max(50)
        .default(5)
        .describe('How many recent issues to return (default 5).'),
    },
  },
  async ({ limit }) => {
    const index = await getJson('/index.json');
    const posts = (index.posts || []).slice(0, limit).map((p) => ({
      date: p.date,
      title: p.title,
      summary: p.summary,
      tags: p.tags,
      url: p.url,
      json: p.json,
      itemCount: p.itemCount,
    }));
    return json({ site: index.site, updated: index.updated, count: posts.length, posts });
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
      date: z
        .string()
        .regex(/^\d{4}-\d{2}-\d{2}$/)
        .describe('Issue date, e.g. 2026-06-24.'),
    },
  },
  async ({ date }) => {
    const article = await getJson(`/${date}.json`);
    return json(article);
  }
);

// --- search ----------------------------------------------------------------
server.registerTool(
  'search',
  {
    title: 'Search across issues',
    description:
      'Search all issues for a keyword across titles, summaries and the body of every news item. Returns matching items with their date, title, signal and a short snippet.',
    inputSchema: {
      query: z.string().min(1).describe('Keyword or phrase to search for.'),
      limit: z
        .number()
        .int()
        .min(1)
        .max(50)
        .default(10)
        .describe('Max number of matching items to return (default 10).'),
    },
  },
  async ({ query, limit }) => {
    const index = await getJson('/index.json');
    const q = query.toLowerCase();
    const results = [];

    for (const post of index.posts || []) {
      let article;
      try {
        article = await getJson(`/${post.date}.json`);
      } catch {
        continue;
      }
      for (const item of article.items || []) {
        const hay = `${item.title}\n${item.signal || ''}\n${item.body || ''}`.toLowerCase();
        if (hay.includes(q)) {
          const at = hay.indexOf(q);
          const raw = `${item.title}\n${item.signal || ''}\n${item.body || ''}`;
          const snippet = raw.slice(Math.max(0, at - 40), at + 120).replace(/\s+/g, ' ').trim();
          results.push({
            date: post.date,
            index: item.index,
            title: item.title,
            signal: item.signal,
            snippet,
            url: `${post.url}#${item.index}`,
          });
          if (results.length >= limit) break;
        }
      }
      if (results.length >= limit) break;
    }

    return json({ query, count: results.length, results });
  }
);

const transport = new StdioServerTransport();
await server.connect(transport);
