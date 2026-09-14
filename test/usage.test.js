import test from 'node:test';
import assert from 'node:assert/strict';
import { reportToolUse } from '../src/usage.js';
const tick = () => new Promise(resolve => setImmediate(resolve));
test('events are bodyless, nonblocking, bounded, optional, and failure tolerant', async () => {
  const original = globalThis.fetch;
  const old = process.env.AI_DAILY_ANALYTICS;
  const calls = [];
  globalThis.fetch = async (url, options) => { calls.push({url,options}); throw new Error('offline'); };
  try {
    process.env.AI_DAILY_ANALYTICS = '1';
    for(let i=0;i<30;i++) assert.equal(reportToolUse('http://localhost:1234','0.4.4','search'),undefined);
    await tick();
    assert.equal(calls.length,16);
    assert.equal(calls[0].url,'http://localhost:1234/mcp-event');
    assert.equal(calls[0].options.body,undefined);
    assert.equal(calls[0].options.headers['x-adi-mcp-tool'],'search');
    process.env.AI_DAILY_ANALYTICS = '0';
    reportToolUse('http://localhost:1234','0.4.4','search');
    await tick();
    assert.equal(calls.length,16);
  } finally {
    globalThis.fetch = original;
    if(old === undefined) delete process.env.AI_DAILY_ANALYTICS; else process.env.AI_DAILY_ANALYTICS = old;
  }
});
