import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { after, before, test } from 'node:test';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';

const issue = {
  date: '2026-09-13',
  title: 'AI Daily Insights test issue',
  items: [{ index: 1, title: 'Test item', signal: 'Test signal', body: 'Test body' }],
};
const post = {
  date: issue.date,
  title: issue.title,
  summary: 'Summary',
  tags: ['OpenAI'],
  url: `https://www.aidailyinsights.cn/${issue.date}/`,
  json: `/${issue.date}.json`,
  itemCount: 1,
};

let api;
let client;

before(async () => {
  api = createServer((request, response) => {
    response.setHeader('content-type', 'application/json');
    if (request.url === '/index.json') return response.end(JSON.stringify({ site: 'test', updated: issue.date, posts: [post] }));
    if (request.url === `/${issue.date}.json`) return response.end(JSON.stringify(issue));
    if (request.url?.startsWith('/search?')) {
      return response.end(JSON.stringify({ ok: true, count: 1, results: [issue.items[0]] }));
    }
    if (request.url === '/search-index.json') {
      return response.end(JSON.stringify({ items: [{ ...issue.items[0], ...post }] }));
    }
    response.statusCode = 404;
    return response.end(JSON.stringify({ error: 'not found' }));
  });
  await new Promise((resolve) => api.listen(0, '127.0.0.1', resolve));
  const { port } = api.address();
  const transport = new StdioClientTransport({
    command: process.execPath,
    args: ['src/index.js'],
    env: { ...process.env, AI_DAILY_BASE_URL: `http://127.0.0.1:${port}` },
    stderr: 'pipe',
  });
  client = new Client({ name: 'ai-daily-insights-test', version: '1.0.0' });
  await client.connect(transport);
});

after(async () => {
  await client?.close();
  await new Promise((resolve, reject) => api?.close((error) => (error ? reject(error) : resolve())));
});

test('declares six fully annotated tools with input schemas', async () => {
  const { tools } = await client.listTools();
  assert.equal(tools.length, 6);
  for (const tool of tools) {
    assert.deepEqual(tool.annotations, {
      readOnlyHint: true,
      destructiveHint: false,
      idempotentHint: true,
      openWorldHint: true,
    });
    assert.equal(tool.inputSchema.type, 'object');
  }
});

const cases = [
  ['list_latest', { limit: 1 }],
  ['get_latest', {}],
  ['get_article', { date: issue.date }],
  ['get_range', { from: issue.date, to: issue.date, limit: 1 }],
  ['list_by_tag', { tag: 'OpenAI', limit: 1 }],
  ['search', { query: 'Test', limit: 1 }],
];

for (const [name, args] of cases) {
  test(`${name} returns JSON content`, async () => {
    const result = await client.callTool({ name, arguments: args });
    assert.notEqual(result.isError, true);
    assert.doesNotThrow(() => JSON.parse(result.content[0].text));
  });
}

test('upstream failures become structured MCP errors', async () => {
  const result = await client.callTool({ name: 'get_article', arguments: { date: '2026-09-12' } });
  assert.equal(result.isError, true);
  assert.match(result.content[0].text, /GET \/2026-09-12\.json failed: 404/);
});
