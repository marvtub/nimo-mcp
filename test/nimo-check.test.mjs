import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { createServer } from "node:http";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { after, before, test } from "node:test";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);
const cli = fileURLToPath(new URL("../bin/nimo-check.mjs", import.meta.url));

let endpoint;
let server;
const polls = new Map();

function report(url, score = 92) {
  return {
    status: "complete",
    url,
    device: "mobile",
    measuredAt: "2026-10-27T12:00:00.000Z",
    report: {
      metrics: { performanceScore: score, lcp: 1800, cls: 0.04, inp: 120, ttfb: 350 },
      summary: "The page is fast.",
      primaryFinding: { title: "Compress the hero image" },
      recommendations: [{ title: "Cache static files" }],
    },
  };
}

function responseFor(request) {
  const { name, arguments: args } = request.params;
  if (name === "check_website") {
    if (args.url.endsWith("/request-error")) {
      return { jsonrpc: "2.0", id: request.id, error: { code: -32000, message: "Service unavailable" } };
    }
    if (args.url.endsWith("/failed")) {
      return { jsonrpc: "2.0", id: request.id, result: { structuredContent: {
        status: "failed", url: args.url, error: "The page did not load",
      } } };
    }
    if (args.url.endsWith("/poll") || args.url.endsWith("/timeout")) {
      const jobId = args.url.endsWith("/poll") ? "poll" : "timeout";
      polls.set(jobId, 0);
      return { jsonrpc: "2.0", id: request.id, result: { structuredContent: {
        status: "queued", jobId, accessToken: "test-only-token",
      } } };
    }
    const score = args.url.endsWith("/low-score") ? 49 : 92;
    return { jsonrpc: "2.0", id: request.id, result: { structuredContent: report(args.url, score) } };
  }

  const { jobId } = args;
  polls.set(jobId, (polls.get(jobId) ?? 0) + 1);
  const data = jobId === "poll" ? report("https://example.test/poll") : {
    status: "running", jobId, accessToken: "test-only-token",
  };
  return { jsonrpc: "2.0", id: request.id, result: { structuredContent: data } };
}

before(async () => {
  server = createServer((req, res) => {
    let body = "";
    req.setEncoding("utf8");
    req.on("data", (chunk) => { body += chunk; });
    req.on("end", () => {
      res.writeHead(200, { "content-type": "application/json" });
      res.end(JSON.stringify(responseFor(JSON.parse(body))));
    });
  });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  endpoint = `http://127.0.0.1:${address.port}`;
});

after(async () => {
  server.closeAllConnections?.();
  await new Promise((resolve) => server.close(resolve));
});

async function run(args, env = {}) {
  try {
    const result = await execFileAsync(process.execPath, [cli, ...args], {
      env: { ...process.env, NIMO_TRY_MCP_URL: endpoint, ...env },
      timeout: 10_000,
    });
    return { code: 0, ...result };
  } catch (error) {
    if (error.killed) throw error;
    return { code: error.code, stdout: error.stdout, stderr: error.stderr };
  }
}

test("prints help and rejects invalid arguments", async () => {
  const help = await run(["--help"]);
  assert.equal(help.code, 0);
  assert.match(help.stdout, /^Usage: nimo-check/);
  assert.equal(help.stderr, "");

  const invalid = await run(["--min-score", "101", "https://example.test"]);
  assert.equal(invalid.code, 2);
  assert.equal(invalid.stdout, "");
  assert.match(invalid.stderr, /--min-score must be between 0 and 100/);
});

test("prints a successful result as JSON and writes GitHub files", async () => {
  const directory = await mkdtemp(join(tmpdir(), "nimo-check-test-"));
  const output = join(directory, "output");
  const summary = join(directory, "summary");
  try {
    const result = await run(["https://example.test/success", "--json"], {
      GITHUB_OUTPUT: output,
      GITHUB_STEP_SUMMARY: summary,
    });

    assert.equal(result.code, 0);
    assert.equal(result.stderr, "");
    assert.deepEqual(JSON.parse(result.stdout), {
      ok: true,
      url: "https://example.test/success",
      device: "mobile",
      measuredAt: "2026-10-27T12:00:00.000Z",
      score: 92,
      lcpMs: 1800,
      cls: 0.04,
      inpMs: 120,
      ttfbMs: 350,
      summary: "The page is fast.",
      fixes: ["Compress the hero image", "Cache static files"],
    });
    assert.equal(await readFile(output, "utf8"), "score=92\nlcp-ms=1800\ncls=0.04\nttfb-ms=350\n");
    assert.match(await readFile(summary, "utf8"), /\| Performance score \| 92 \| good \|/);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test("returns a failing result when the score is below the minimum", async () => {
  const result = await run(["https://example.test/low-score", "--min-score", "50", "--json"]);
  assert.equal(result.code, 1);
  assert.equal(result.stderr, "");
  assert.equal(JSON.parse(result.stdout).ok, false);
  assert.equal(JSON.parse(result.stdout).score, 49);
});

test("reports checks that fail and request errors", async () => {
  const failed = await run(["https://example.test/failed", "--json"]);
  assert.equal(failed.code, 1);
  assert.deepEqual(JSON.parse(failed.stdout), {
    url: "https://example.test/failed", ok: false, error: "The page did not load",
  });

  const requestError = await run(["https://example.test/request-error", "--json"]);
  assert.equal(requestError.code, 2);
  assert.equal(requestError.stdout, "");
  assert.match(requestError.stderr, /Service unavailable/);
});

test("polls a queued check until it completes", async () => {
  const result = await run(["https://example.test/poll", "--timeout", "6", "--json"]);
  assert.equal(result.code, 0);
  assert.equal(JSON.parse(result.stdout).score, 92);
  assert.equal(polls.get("poll"), 1);
});

test("enforces the requested timeout", async () => {
  const started = Date.now();
  const result = await run(["https://example.test/timeout", "--timeout", "0.05", "--json"]);
  const elapsed = Date.now() - started;
  assert.equal(result.code, 2);
  assert.equal(result.stdout, "");
  assert.match(result.stderr, /no result after 0.05 seconds/);
  assert.ok(elapsed < 1_000, `timeout took ${elapsed}ms`);
  assert.equal(polls.get("timeout"), 0);
});
