import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { createServer } from "node:http";
import { once } from "node:events";
import test from "node:test";

const job = {
  status: "completed",
  url: "https://example.com",
  report: { metrics: { performanceScore: 91 } },
};

const testOptions = { timeout: 8_000 };

async function runCli(contentType, responseBody) {
  const sockets = new Set();
  const server = createServer((request, response) => {
    request.resume();
    response.writeHead(200, { "content-type": contentType });
    response.end(responseBody);
  });
  server.on("connection", (socket) => {
    sockets.add(socket);
    socket.on("close", () => sockets.delete(socket));
  });
  let child;
  try {
    server.listen(0, "127.0.0.1");
    await once(server, "listening");

    const endpoint = `http://127.0.0.1:${server.address().port}`;
    child = spawn(process.execPath, ["bin/nimo-check.mjs", job.url, "--json"], {
      cwd: new URL("..", import.meta.url),
      // Never inherit real runner output files, credentials or NODE_OPTIONS.
      env: { NIMO_TRY_MCP_URL: endpoint },
      stdio: ["ignore", "pipe", "pipe"],
      timeout: 5_000,
      killSignal: "SIGKILL",
    });
    let stdout = "";
    let stderr = "";
    child.stdout.setEncoding("utf8").on("data", (chunk) => { stdout += chunk; });
    child.stderr.setEncoding("utf8").on("data", (chunk) => { stderr += chunk; });
    const [exitCode, signal] = await once(child, "close");
    assert.equal(signal, null, "CLI was killed or exceeded the five-second test guard");
    return { exitCode, stdout, stderr };
  } finally {
    if (child && child.exitCode === null && child.signalCode === null) {
      child.kill("SIGKILL");
      await once(child, "close");
    }
    for (const socket of sockets) socket.destroy();
    await new Promise((resolve) => server.close(resolve));
  }
}

for (const [name, contentType, body] of [
  ["JSON", "application/json; charset=utf-8", JSON.stringify({ jsonrpc: "2.0", id: 1, result: { structuredContent: job } })],
  ["SSE", "text/event-stream; charset=utf-8", `event: message\ndata: ${JSON.stringify({ jsonrpc: "2.0", id: 1, result: { structuredContent: job } })}\n\n`],
]) {
  test(`accepts the same tool result as ${name}`, testOptions, async () => {
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

test("rejects a malformed SSE response", testOptions, async () => {
  const result = await runCli("text/event-stream", "event: message\ndata: not-json\n\n");
  assert.equal(result.exitCode, 2);
  assert.match(result.stderr, /nimo answered with HTTP 200/);
});
