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
const events = [];
const dataRequests = [];

before(async () => {
  api = createServer((request, response) => {
    if (request.url === '/mcp-event') {
      events.push(request.headers['x-adi-mcp-tool']);
      response.statusCode = 204;
      return response.end();
    }
    dataRequests.push({url:request.url, ua:request.headers['user-agent']});
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

test('six tools report usage; cached calls add events without data fetches', async () => {
  const waitFor = async predicate => {
    for(let i=0;i<100 && !predicate();i++) await new Promise(r=>setTimeout(r,10));
    assert.ok(predicate());
  };
  await waitFor(()=>cases.every(([name])=>events.includes(name)));
  const before = events.filter(name=>name==='list_latest').length;
  const fetches = dataRequests.length;
  await client.callTool({name:'list_latest',arguments:{limit:1}});
  await client.callTool({name:'list_latest',arguments:{limit:1}});
  await waitFor(()=>events.filter(name=>name==='list_latest').length===before+2);
  assert.equal(dataRequests.length,fetches);
  assert.ok(dataRequests.every(r=>r.ua==='ai-daily-insights-mcp/0.4.4'));
});
