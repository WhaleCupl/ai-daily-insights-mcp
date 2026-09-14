// Best-effort aggregate usage only. No arguments, outputs, session/user IDs.
// A bounded background request counts cache hits without disabling data caching.
let pending = 0;
export function clientHeaders(version) {
  return {
    'user-agent': `ai-daily-insights-mcp/${version}`,
    ...(process.env.AI_DAILY_ANALYTICS_TEST === '1' ? { 'x-adi-mcp-test': '1' } : {}),
  };
}
export function reportToolUse(baseUrl, version, tool) {
  if (process.env.AI_DAILY_ANALYTICS === '0' || pending >= 16) return;
  pending++;
  // Never await this on the tool response path and never retry failed events.
  void Promise.resolve().then(() => fetch(`${baseUrl}/mcp-event`, {
    method: 'POST',
    headers: { ...clientHeaders(version), 'x-adi-mcp-tool': tool },
    signal: AbortSignal.timeout(1500),
    redirect: 'error',
  })).then(response => response.body?.cancel()).catch(() => {}).finally(() => { pending--; });
}
