import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { createServer } from "node:http";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

async function runCli(job) {
  const server = createServer((request, response) => {
    request.resume();
    response.setHeader("content-type", "application/json");
    response.end(JSON.stringify({ jsonrpc: "2.0", id: 1, result: { structuredContent: job } }));
  });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));

  const directory = await mkdtemp(join(tmpdir(), "nimo-check-test-"));
  const output = join(directory, "output");
  const summary = join(directory, "summary");
  await Promise.all([writeFile(output, ""), writeFile(summary, "")]);
  const address = server.address();
  const child = spawn(process.execPath, ["bin/nimo-check.mjs", "https://example.com", "--json"], {
    cwd: new URL("..", import.meta.url),
    env: {
      ...process.env,
      NIMO_TRY_MCP_URL: `http://127.0.0.1:${address.port}`,
      GITHUB_OUTPUT: output,
      GITHUB_STEP_SUMMARY: summary,
    },
  });
  let stdout = "";
  let stderr = "";
  child.stdout.on("data", (chunk) => { stdout += chunk; });
  child.stderr.on("data", (chunk) => { stderr += chunk; });
  const code = await new Promise((resolve, reject) => {
    child.on("error", reject);
    child.on("close", resolve);
  });
  await new Promise((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
  const result = {
    code,
    stdout,
    stderr,
    output: await readFile(output, "utf8"),
    summary: await readFile(summary, "utf8"),
  };
  await rm(directory, { recursive: true, force: true });
  return result;
}

test("rejects non-numeric metrics before writing GitHub files", async () => {
  const result = await runCli({
    status: "completed",
    url: "https://example.com",
    report: { metrics: { performanceScore: "90\nadmin=true" } },
  });

  assert.equal(result.code, 2);
  assert.match(result.stderr, /invalid result \(report\.metrics\.performanceScore\)/);
  assert.equal(result.output, "");
  assert.equal(result.summary, "");
});

test("escapes remote text in the GitHub step summary", async () => {
  const result = await runCli({
    status: "completed",
    url: "https://example.com\n### forged [link](https://evil.example)",
    report: {
      metrics: { performanceScore: 90, lcp: 1200, cls: 0.05, ttfb: 300 },
      primaryFinding: { title: "<script>alert(1)</script>\n- [click](https://evil.example)" },
    },
  });

  assert.equal(result.code, 0, result.stderr);
  assert.equal(result.output, "score=90\nlcp-ms=1200\ncls=0.05\nttfb-ms=300\n");
  assert.doesNotMatch(result.summary, /\n### forged/);
  assert.doesNotMatch(result.summary, /<script>|\[click\]\(/);
  assert.match(result.summary, /\\<script\\>/);
  assert.match(result.summary, /\\\[click\\\]\\\(/);
});
