import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { once } from "node:events";
import { fileURLToPath } from "node:url";
import { createServer } from "node:http";
import test from "node:test";

const CLI = fileURLToPath(new URL("../bin/nimo-check.mjs", import.meta.url));

function runCli(args, endpoint) {
  const child = spawn(process.execPath, [CLI, ...args], {
    env: { ...process.env, NIMO_TRY_MCP_URL: endpoint },
    stdio: ["ignore", "pipe", "pipe"],
  });
  let stdout = "";
  let stderr = "";
  child.stdout.setEncoding("utf8").on("data", (chunk) => { stdout += chunk; });
  child.stderr.setEncoding("utf8").on("data", (chunk) => { stderr += chunk; });
  return once(child, "close").then(([code, signal]) => ({ code, signal, stdout, stderr }));
}

test("rejects non-finite and non-positive timeouts", async () => {
  for (const value of ["Infinity", "NaN", "0", "-1"]) {
    const result = await runCli(["https://example.com", "--timeout", value]);
    assert.equal(result.code, 2, value);
    assert.match(result.stderr, /--timeout must be a positive finite number of seconds/);
  }
});

test("timeout is an overall deadline while waiting to poll", async (t) => {
  let requestCount = 0;
  const server = createServer((_request, response) => {
    requestCount++;
    response.writeHead(200, { "content-type": "application/json" });
    response.end(JSON.stringify({
      jsonrpc: "2.0",
      id: requestCount,
      result: {
        content: [{ type: "text", text: JSON.stringify({ status: "queued", jobId: "job", accessToken: "token" }) }],
      },
    }));
  });
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  t.after(() => server.close());

  const address = server.address();
  const started = Date.now();
  const result = await runCli(
    ["https://example.com", "--timeout", "0.2"],
    `http://127.0.0.1:${address.port}`,
  );
  const elapsed = Date.now() - started;

  assert.equal(result.code, 2);
  assert.match(result.stderr, /no result after 0\.2 seconds/);
  assert.equal(requestCount, 1, "must not start a poll after the deadline");
  assert.ok(elapsed < 1_500, `expected a prompt timeout, took ${elapsed}ms`);
});

test("timeout aborts an in-flight request", async (t) => {
  const server = createServer(() => {});
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  t.after(() => {
    server.closeAllConnections();
    server.close();
  });

  const address = server.address();
  const started = Date.now();
  const result = await runCli(
    ["https://example.com", "--timeout", "0.2"],
    `http://127.0.0.1:${address.port}`,
  );
  const elapsed = Date.now() - started;

  assert.equal(result.code, 2);
  assert.match(result.stderr, /no result after 0\.2 seconds/);
  assert.ok(elapsed < 1_500, `expected a prompt timeout, took ${elapsed}ms`);
});
