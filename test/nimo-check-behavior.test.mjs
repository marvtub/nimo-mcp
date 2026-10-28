import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { createServer } from "node:http";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { test } from "node:test";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);
const cli = fileURLToPath(new URL("../bin/nimo-check.mjs", import.meta.url));
const handle = { jobId: "a".repeat(64), accessToken: "b".repeat(64) };
const url = "https://example.test/page";
const start = { name: "check_website", arguments: { url } };
const poll = { name: "get_check", arguments: handle };
const testOptions = { timeout: 20_000 };

function job(status, extra = {}) {
  return {
    ...handle,
    status,
    saveUrl: `https://example.test/first-check#jobId=${handle.jobId}&accessToken=${handle.accessToken}`,
    nextStep: status === "completed" ? "Explain the result." : status === "failed" ? "The check failed." : "Wait before polling.",
    retention: "Fixture results expire after 24 hours.",
    ...extra,
  };
}

function report(score = 92) {
  return job("completed", {
    url,
    device: "mobile",
    measuredAt: "2026-10-27T12:00:00.000Z",
    report: {
      metrics: { performanceScore: score, lcp: 1800, cls: 0.04, inp: 120, ttfb: 350 },
      summary: "The page is fast.",
      primaryFinding: { title: "Compress the hero image" },
      recommendations: [{ title: "Cache static files" }],
    },
  });
}

// Assert the whole wire request on EVERY call, including both polling calls.
// A bad method, tool, extra/missing argument, id, jobId or token is never served
// a successful fixture. Keep assertion errors in the test process, not in an
// uncaught async HTTP handler or in the CLI's output.
async function endpoint(t, plan) {
  const requests = [];
  const errors = [];
  const sockets = new Set();
  const server = createServer(async (req, res) => {
    let request;
    try {
      let body = "";
      for await (const chunk of req) {
        body += chunk;
        assert.ok(body.length <= 16_384, "request too large");
      }
      request = JSON.parse(body);
      const index = requests.length;
      requests.push(request);
      const step = plan[index];
      assert.ok(step, "unexpected extra RPC call");
      assert.equal(req.method, "POST");
      assert.equal(req.headers["content-type"], "application/json");
      assert.deepEqual(request, {
        jsonrpc: "2.0", id: step.id ?? 1, method: "tools/call", params: step.params,
      });
      // Close fixture connections explicitly: a five-second keep-alive expiry
      // can race the five-second polling interval in Node 18's HTTP client.
      res.writeHead(step.httpStatus ?? 200, { "content-type": "application/json", connection: "close" });
      res.end(step.raw ?? JSON.stringify({
        jsonrpc: "2.0", id: request.id,
        ...(step.error ? { error: step.error } : { result: step.result ?? { structuredContent: step.data } }),
      }));
    } catch (error) {
      errors.push(error);
      if (!res.headersSent) res.writeHead(400, { "content-type": "application/json", connection: "close" });
      res.end(JSON.stringify({ jsonrpc: "2.0", id: request?.id ?? null, error: { code: -32602, message: "Fixture rejected RPC contract" } }));
    }
  });
  server.requestTimeout = 2_000;
  server.headersTimeout = 2_000;
  server.setTimeout(2_000, (socket) => socket.destroy());
  server.on("connection", (socket) => {
    sockets.add(socket);
    socket.on("close", () => sockets.delete(socket));
  });
  t.after(async () => {
    for (const socket of sockets) socket.destroy();
    await new Promise((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
  });
  await new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", resolve);
  });
  return {
    url: `http://127.0.0.1:${server.address().port}`,
    assertRequests() {
      assert.equal(errors.length, 0, errors.map((error) => error.message).join("\n"));
      assert.equal(requests.length, plan.length, "all planned RPC calls must occur");
    },
  };
}

async function run(mock, args = [url, "--json"], files = {}) {
  // No ambient tokens, NODE_OPTIONS, proxy configuration or GitHub files enter
  // CLI children. Only the file-output test passes its own temporary paths.
  const env = { NIMO_TRY_MCP_URL: mock.url };
  if (files.output) env.GITHUB_OUTPUT = files.output;
  if (files.summary) env.GITHUB_STEP_SUMMARY = files.summary;
  try {
    return { code: 0, ...await execFileAsync(process.execPath, [cli, ...args], {
      env, timeout: 15_000, killSignal: "SIGKILL", maxBuffer: 256 * 1024,
    }) };
  } catch (error) {
    if (error.killed || error.signal || typeof error.code !== "number") throw error;
    return { code: error.code, stdout: error.stdout, stderr: error.stderr };
  }
}

function assertPrivate(result) {
  for (const value of Object.values(handle)) assert.ok(!(result.stdout + result.stderr).includes(value));
}

function assertScore(result, code, score) {
  assert.equal(result.code, code, result.stderr);
  assert.equal(result.stderr, "");
  assert.equal(JSON.parse(result.stdout).score, score);
  assertPrivate(result);
}

test("behavior: help and invalid arguments never call the endpoint", testOptions, async (t) => {
  const mock = await endpoint(t, []);
  const help = await run(mock, ["--help"]);
  assert.equal(help.code, 0);
  assert.match(help.stdout, /^Usage: nimo-check/);
  assert.equal(help.stderr, "");
  for (const args of [[], [url, "--min-score", "101"], [url, "--unknown"], [url, "--timeout", "0"]]) {
    const result = await run(mock, args);
    assert.equal(result.code, 2);
    assert.equal(result.stdout, "");
    assert.match(result.stderr, /^nimo-check:/);
  }
  mock.assertRequests();
});

test("behavior: JSON result, exact threshold and isolated GitHub files", testOptions, async (t) => {
  const mock = await endpoint(t, [{ params: start, data: report() }]);
  const directory = await mkdtemp(join(tmpdir(), "nimo-check-behavior-"));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const output = join(directory, "output"), summary = join(directory, "summary");
  const result = await run(mock, [url, "--min-score", "92", "--json"], { output, summary });
  assertScore(result, 0, 92);
  assert.deepEqual(JSON.parse(result.stdout), {
    ok: true, url, device: "mobile", measuredAt: "2026-10-27T12:00:00.000Z",
    score: 92, lcpMs: 1800, cls: 0.04, inpMs: 120, ttfbMs: 350,
    summary: "The page is fast.", fixes: ["Compress the hero image", "Cache static files"],
  });
  const outputText = await readFile(output, "utf8");
  const summaryText = await readFile(summary, "utf8");
  assert.equal(outputText, "score=92\nlcp-ms=1800\ncls=0.04\nttfb-ms=350\n");
  assert.match(summaryText, /\| Performance score \| 92 \| good \|/);
  assertPrivate({ stdout: outputText, stderr: summaryText });
  mock.assertRequests();
});

test("behavior: low and absent scores fail the requested minimum", testOptions, async (t) => {
  const mock = await endpoint(t, [{ params: start, data: report(49) }, { params: start, data: report(null) }]);
  for (const score of [49, null]) {
    const result = await run(mock, [url, "--min-score", "50", "--json"]);
    assertScore(result, 1, score);
    assert.equal(JSON.parse(result.stdout).ok, false);
  }
  mock.assertRequests();
});

test("behavior: failed result has no report or URL; RPC errors exit 2", testOptions, async (t) => {
  const mock = await endpoint(t, [
    { params: start, data: job("failed", { error: "The page did not load" }) },
    { params: start, error: { code: -32000, message: "Service unavailable" } },
  ]);
  const failed = await run(mock);
  assert.equal(failed.code, 1);
  assert.equal(failed.stderr, "");
  assert.deepEqual(JSON.parse(failed.stdout), { url, ok: false, error: "The page did not load" });
  assertPrivate(failed);
  const rpcError = await run(mock);
  assert.equal(rpcError.code, 2);
  assert.equal(rpcError.stdout, "");
  assert.match(rpcError.stderr, /Service unavailable/);
  assertPrivate(rpcError);
  mock.assertRequests();
});

test("behavior: queued -> running -> completed preserves exact private handle on every poll", testOptions, async (t) => {
  const mock = await endpoint(t, [
    { params: start, data: job("queued") },
    { id: 2, params: poll, data: job("running") },
    { id: 3, params: poll, data: report() },
  ]);
  const result = await run(mock, [url, "--timeout", "13", "--json"]);
  assertScore(result, 0, 92);
  mock.assertRequests();
});

test("behavior: a queued check can fail on an authorized poll", testOptions, async (t) => {
  const mock = await endpoint(t, [
    { params: start, data: job("queued") },
    { id: 2, params: poll, data: job("failed", { error: "The page did not load" }) },
  ]);
  const result = await run(mock, [url, "--timeout", "8", "--json"]);
  assert.equal(result.code, 1);
  assert.equal(result.stderr, "");
  assert.deepEqual(JSON.parse(result.stdout), { url, ok: false, error: "The page did not load" });
  assertPrivate(result);
  mock.assertRequests();
});

test("behavior: text output and text-only MCP result fallback", testOptions, async (t) => {
  const mock = await endpoint(t, [
    { params: start, data: report() },
    { params: start, result: { content: [{ type: "text", text: JSON.stringify(report()) }] } },
  ]);
  const text = await run(mock, [url]);
  assert.equal(text.code, 0);
  assert.match(text.stdout, /Performance score\s+92\s+good/);
  assert.match(text.stdout, /Compress the hero image/);
  assert.match(text.stderr, /^Checking\n$/);
  assertPrivate(text);
  assertScore(await run(mock), 0, 92);
  mock.assertRequests();
});

test("behavior: HTTP, MCP tool, malformed and empty response errors", testOptions, async (t) => {
  const mock = await endpoint(t, [
    { params: start, httpStatus: 429, raw: JSON.stringify({ error: "Fixture limit reached" }) },
    { params: start, result: { isError: true, content: [{ type: "text", text: JSON.stringify({ error: "Fixture tool error" }) }] } },
    { params: start, raw: "not JSON" },
    { params: start, result: { content: [] } },
  ]);
  for (const message of [/Fixture limit reached/, /Fixture tool error/, /HTTP 200/, /empty result/]) {
    const result = await run(mock);
    assert.equal(result.code, 2);
    assert.equal(result.stdout, "");
    assert.match(result.stderr, message);
    assertPrivate(result);
  }
  mock.assertRequests();
});
