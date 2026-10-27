import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { createServer } from "node:http";
import { once } from "node:events";
import test from "node:test";

const job = {
  status: "complete",
  url: "https://example.com",
  report: { metrics: { performanceScore: 91 } },
};

async function runCli(contentType, responseBody) {
  const server = createServer((request, response) => {
    request.resume();
    response.writeHead(200, { "content-type": contentType });
    response.end(responseBody);
  });
  server.listen(0, "127.0.0.1");
  await once(server, "listening");

  const endpoint = `http://127.0.0.1:${server.address().port}`;
  const child = spawn(process.execPath, ["bin/nimo-check.mjs", job.url, "--json"], {
    cwd: new URL("..", import.meta.url),
    env: { ...process.env, NIMO_TRY_MCP_URL: endpoint },
  });
  let stdout = "";
  let stderr = "";
  child.stdout.setEncoding("utf8").on("data", (chunk) => { stdout += chunk; });
  child.stderr.setEncoding("utf8").on("data", (chunk) => { stderr += chunk; });
  const [exitCode] = await once(child, "close");
  server.close();
  await once(server, "close");
  return { exitCode, stdout, stderr };
}

for (const [name, contentType, body] of [
  ["JSON", "application/json; charset=utf-8", JSON.stringify({ jsonrpc: "2.0", id: 1, result: { structuredContent: job } })],
  ["SSE", "text/event-stream; charset=utf-8", `event: message\ndata: ${JSON.stringify({ jsonrpc: "2.0", id: 1, result: { structuredContent: job } })}\n\n`],
]) {
  test(`accepts the same tool result as ${name}`, async () => {
    const result = await runCli(contentType, body);
    assert.equal(result.exitCode, 0, result.stderr);
    assert.deepEqual(JSON.parse(result.stdout), {
      ok: true,
      url: job.url,
      device: null,
      measuredAt: null,
      score: 91,
      lcpMs: null,
      cls: null,
      inpMs: null,
      ttfbMs: null,
      summary: null,
      fixes: [],
    });
  });
}

test("rejects a malformed SSE response", async () => {
  const result = await runCli("text/event-stream", "event: message\ndata: not-json\n\n");
  assert.equal(result.exitCode, 2);
  assert.match(result.stderr, /nimo answered with HTTP 200/);
});
