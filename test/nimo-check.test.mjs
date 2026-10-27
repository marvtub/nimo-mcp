import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { once } from "node:events";
import { createServer } from "node:http";
import test from "node:test";

const result = {
  jsonrpc: "2.0",
  id: 1,
  result: {
    structuredContent: {
      status: "completed",
      url: "https://example.com",
      report: { metrics: { performanceScore: 95 } },
    },
  },
};

async function runCli(endpoint) {
  const child = spawn(process.execPath, ["bin/nimo-check.mjs", "https://example.com", "--json"], {
    cwd: new URL("..", import.meta.url),
    env: { ...process.env, NIMO_TRY_MCP_URL: endpoint },
  });
  let stdout = "";
  let stderr = "";
  child.stdout.setEncoding("utf8").on("data", (chunk) => { stdout += chunk; });
  child.stderr.setEncoding("utf8").on("data", (chunk) => { stderr += chunk; });
  const [code] = await once(child, "close");
  return { code, stdout, stderr };
}

test("accepts JSON and event-stream tool responses", async (t) => {
  const requests = [];
  const server = createServer((req, res) => {
    requests.push(req.headers.accept);
    if (req.url === "/events") {
      res.writeHead(200, { "content-type": "text/event-stream" });
      res.end(`event: message\ndata: ${JSON.stringify(result)}\n\n`);
    } else {
      res.writeHead(200, { "content-type": "application/json" });
      res.end(JSON.stringify(result));
    }
  });
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  t.after(() => server.close());

  const { port } = server.address();
  for (const path of ["json", "events"]) {
    const response = await runCli(`http://127.0.0.1:${port}/${path}`);
    assert.equal(response.code, 0, response.stderr);
    assert.equal(JSON.parse(response.stdout).score, 95);
  }
  assert.deepEqual(requests, [
    "application/json, text/event-stream",
    "application/json, text/event-stream",
  ]);
});
