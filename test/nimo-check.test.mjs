import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { once } from "node:events";
import { createServer } from "node:http";
import { fileURLToPath } from "node:url";
import test from "node:test";

const cli = fileURLToPath(new URL("../bin/nimo-check.mjs", import.meta.url));

function runCli(args, extraEnv = {}) {
  const child = spawn(process.execPath, [cli, ...args], {
    env: { ...process.env, ...extraEnv },
  });
  let stdout = "";
  let stderr = "";
  child.stdout.setEncoding("utf8");
  child.stderr.setEncoding("utf8");
  child.stdout.on("data", (chunk) => { stdout += chunk; });
  child.stderr.on("data", (chunk) => { stderr += chunk; });
  return once(child, "close").then(([code, signal]) => ({ code, signal, stdout, stderr }));
}

test("rejects an infinite timeout", async () => {
  const result = await runCli(["https://example.com", "--timeout", "Infinity"]);

  assert.equal(result.code, 2);
  assert.match(result.stderr, /--timeout must be a positive finite number of seconds/);
});

test("applies the overall deadline to the initial request", async (t) => {
  const server = createServer(() => {});
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  t.after(() => {
    server.closeAllConnections();
    server.close();
  });
  const { port } = server.address();
  const started = performance.now();

  const result = await runCli(["https://example.com", "--timeout", "1"], {
    NIMO_TRY_MCP_URL: `http://127.0.0.1:${port}`,
  });
  const elapsed = performance.now() - started;

  assert.equal(result.code, 2);
  assert.match(result.stderr, /no result after 1 seconds/);
  assert.ok(elapsed >= 750, `exited too early after ${elapsed}ms`);
  assert.ok(elapsed < 3_000, `deadline was not enforced; exited after ${elapsed}ms`);
});

test("does not let a polling delay exceed the overall deadline", async (t) => {
  const server = createServer((_request, response) => {
    response.setHeader("content-type", "application/json");
    response.end(JSON.stringify({
      jsonrpc: "2.0",
      id: 1,
      result: {
        structuredContent: { status: "queued", jobId: "job-1", accessToken: "test-token" },
      },
    }));
  });
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  t.after(() => {
    server.closeAllConnections();
    server.close();
  });
  const { port } = server.address();
  const started = performance.now();

  const result = await runCli(["https://example.com", "--timeout", "1"], {
    NIMO_TRY_MCP_URL: `http://127.0.0.1:${port}`,
  });
  const elapsed = performance.now() - started;

  assert.equal(result.code, 2);
  assert.match(result.stderr, /no result after 1 seconds/);
  assert.ok(elapsed >= 750, `exited too early after ${elapsed}ms`);
  assert.ok(elapsed < 3_000, `polling delay exceeded the deadline; exited after ${elapsed}ms`);
});
