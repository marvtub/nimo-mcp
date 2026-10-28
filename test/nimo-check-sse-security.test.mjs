import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { once } from "node:events";
import { chmod, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { createServer } from "node:http";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";

const root = fileURLToPath(new URL("..", import.meta.url));
const action = await readFile(join(root, "action.yml"), "utf8");
const blocks = [...action.matchAll(/      run: \|\n((?:        .*\n?)+)/g)];
assert.equal(blocks.length, 1);
const shell = blocks[0][1].replace(/^ {8}/gm, "");
const handle = { jobId: "SSEPrivateJobFixtureOnly0123456789", accessToken: "SSEPrivateTokenFixtureOnly0123456789" };
const attack = "prefix ::error::one ##[warning]legacy\r\n::warning::two\n::add-mask::mask\n::stop-commands::token\u001b[2J\u202e";
const output = "score=90\nlcp-ms=1200\ncls=0.05\nttfb-ms=300\n";
const message = (id, data) => ({ jsonrpc: "2.0", id, result: { structuredContent: data } });
const frame = (data) => `data: ${JSON.stringify(data)}\r\n\r\n`;
function completed() {
  return {
    status: "completed", url: `https://example.invalid/${attack} ${handle.jobId}`,
    device: `device ${attack} ${handle.accessToken}`, measuredAt: `now ${attack}`,
    report: {
      metrics: { performanceScore: 90, lcp: 1200, cls: 0.05, inp: null, ttfb: 300 },
      summary: `summary ${attack} ${handle.accessToken}`,
      primaryFinding: { summary: `finding ${attack} ${handle.jobId}` }, recommendations: [],
    },
  };
}

// Execute the unchanged composite shell. JSON is selected only at the Node
// shim, so every test crosses both the Action argument and real CLI boundary.
async function run(t, handler, { json, seconds = "9" }) {
  const dir = await mkdtemp(join(tmpdir(), "nimo-sse-security-"));
  const sockets = new Set(), requests = [], errors = [];
  const observed = { closed: 0, finished: 0 };
  let child, watchdog;
  const server = createServer(async (req, res) => {
    try {
      let body = "";
      for await (const chunk of req) body += chunk;
      const rpc = JSON.parse(body); requests.push(rpc);
      assert.equal(req.method, "POST");
      assert.equal(req.headers.accept, "application/json, text/event-stream");
      assert.equal(rpc.jsonrpc, "2.0"); assert.equal(rpc.method, "tools/call");
      assert.equal(rpc.id, requests.length);
      assert.equal(rpc.params.name, requests.length === 1 ? "check_website" : "get_check");
      assert.deepEqual(rpc.params.arguments, requests.length === 1 ? { url: "https://example.invalid/" } : handle);
      res.on("close", () => { observed.closed++; });
      res.on("finish", () => { observed.finished++; });
      res.writeHead(200, { "content-type": "text/event-stream" });
      handler(res, rpc, requests.length);
      // No end(): every exit must cancel the stream, including validation/error paths.
    } catch (error) { errors.push(error); res.destroy(); }
  });
  server.on("connection", (socket) => { sockets.add(socket); socket.on("close", () => sockets.delete(socket)); });
  t.after(async () => {
    clearTimeout(watchdog);
    if (child && child.exitCode === null) child.kill("SIGKILL");
    for (const socket of sockets) socket.destroy();
    await new Promise((resolve) => server.close(resolve));
    await rm(dir, { recursive: true, force: true });
  });
  await Promise.all([
    writeFile(join(dir, "output"), ""), writeFile(join(dir, "summary"), ""),
    writeFile(join(dir, "action.sh"), shell),
    writeFile(join(dir, "node"), '#!/bin/bash\nif [ "$JSON_MODE" = 1 ]; then exec "$TEST_NODE" "$@" --json; fi\nexec "$TEST_NODE" "$@"\n'),
  ]);
  await chmod(join(dir, "node"), 0o700);
  await new Promise((resolve, reject) => { server.once("error", reject); server.listen(0, "127.0.0.1", resolve); });
  const start = performance.now();
  child = spawn("/bin/bash", ["--noprofile", "--norc", "-eo", "pipefail", join(dir, "action.sh")], {
    env: {
      PATH: `${dir}:${dirname(process.execPath)}:/usr/bin:/bin`, TEST_NODE: process.execPath, JSON_MODE: json ? "1" : "0",
      NIMO_URL: "https://example.invalid/", NIMO_TIMEOUT: seconds, NIMO_MIN_SCORE: "",
      GITHUB_ACTION_PATH: root, NIMO_TRY_MCP_URL: `http://127.0.0.1:${server.address().port}`,
      GITHUB_OUTPUT: join(dir, "output"), GITHUB_STEP_SUMMARY: join(dir, "summary"),
    },
  });
  let stdout = "", stderr = "";
  child.stdout.on("data", (chunk) => { stdout += chunk; });
  child.stderr.on("data", (chunk) => { stderr += chunk; });
  watchdog = setTimeout(() => child.kill("SIGKILL"), 12_000);
  const [code, signal] = await once(child, "close"); clearTimeout(watchdog);
  const elapsed = performance.now() - start;
  for (let i = 0; i < 20 && observed.closed < requests.length; i++) await new Promise((resolve) => setTimeout(resolve, 10));
  assert.equal(signal, null, "CLI exceeded test guard");
  assert.deepEqual(errors, []);
  return { code, stdout, stderr, elapsed, requests, observed, output: await readFile(join(dir, "output"), "utf8"), summary: await readFile(join(dir, "summary"), "utf8") };
}

function safe(out, connections = 1) {
  // Stronger than either runner parser: neither raw command introducer may
  // survive anywhere, including within JSON strings or prefixed text lines.
  for (const channel of [out.stdout, out.stderr]) {
    assert.doesNotMatch(channel, /::|##\[/);
    assert.doesNotMatch(channel, /[\u0000-\u0009\u000b-\u001f\u007f-\u009f\p{Cf}\u2028\u2029]/u);
  }
  for (const channel of [out.stdout, out.stderr, out.output, out.summary]) {
    for (const value of Object.values(handle)) assert(!channel.includes(value), "private handle leaked");
  }
  assert.equal(out.observed.closed, connections, "peer must observe cancellation of every reader");
  assert.equal(out.observed.finished, 0, "server must not supply EOF to finish the CLI");
}
function rejected(out, pattern, connections = 1) {
  assert.equal(out.code, 2, out.stderr); assert.match(out.stderr, pattern);
  assert.equal(out.stdout + out.output + out.summary, ""); safe(out, connections);
}
function success(out, json, connections = 1) {
  assert.equal(out.code, 0, out.stderr); assert.equal(out.output, output); safe(out, connections);
  assert.match(out.stdout, /private check handle/);
  if (json) {
    const parsed = JSON.parse(out.stdout);
    assert.equal(parsed.summary, `summary ${attack} [private check handle]`);
    assert.equal(parsed.measuredAt, `now ${attack}`);
    assert.equal(parsed.score, 90);
  }
}

for (const json of [false, true]) {
  const mode = json ? "JSON" : "text";
  test(`SSE security ${mode}: keep-open completed data is inert/private and cancels promptly`, async (t) => {
    const out = await run(t, (res, rpc) => res.write(frame(message(rpc.id, { ...handle, ...completed() }))), { json, seconds: "1" });
    success(out, json); assert.ok(out.elapsed < 1_500, `completion waited ${out.elapsed}ms for EOF`);
  });
  test(`SSE security ${mode}: matching RPC error remains inert and cancels`, async (t) => {
    rejected(await run(t, (res, rpc) => res.write(frame({ jsonrpc: "2.0", id: rpc.id, error: { message: attack } })), { json }), /prefix/);
  });
  test(`SSE security ${mode}: tool-error data remembers private handles before throwing`, async (t) => {
    const out = await run(t, (res, rpc) => res.write(frame({ jsonrpc: "2.0", id: rpc.id, result: { isError: true, structuredContent: { ...handle, error: `${attack} ${handle.accessToken}` } } })), { json });
    rejected(out, /private check handle/);
  });
  test(`SSE security ${mode}: malformed MCP text never exposes native parse snippets`, async (t) => {
    const out = await run(t, (res, rpc) => res.write(frame({ jsonrpc: "2.0", id: rpc.id, result: { content: [{ type: "text", text: `not-json ${attack} ${handle.accessToken}` }] } })), { json });
    rejected(out, /nimo returned invalid tool JSON/);
  });
  test(`SSE security ${mode}: queued poll composes handle privacy, output validation and cancellation`, async (t) => {
    const out = await run(t, (res, rpc, n) => res.write(frame(message(rpc.id, n === 1 ? { status: "queued", ...handle } : completed()))), { json });
    assert.equal(out.requests.length, 2); success(out, json, 2);
  });
  test(`SSE security ${mode}: matching poll rejects malicious metrics before any output`, async (t) => {
    const bad = completed(); bad.report.metrics.performanceScore = `90\r\nattacker=true ${attack}`;
    const out = await run(t, (res, rpc, n) => res.write(frame(message(rpc.id, n === 1 ? { status: "queued", ...handle } : bad))), { json });
    assert.equal(out.requests.length, 2); rejected(out, /invalid result \(report\.metrics\.performanceScore\)/, 2);
  });
  test(`SSE security ${mode}: wrong-ID high score cannot bypass matching-response metric validation`, async (t) => {
    const wrong = completed(); wrong.report.metrics.performanceScore = 99;
    const bad = completed(); bad.report.metrics.cls = `0.01\r\ninjected=true ${attack}`;
    const out = await run(t, (res, rpc) => res.write(frame(message(rpc.id + 999, wrong)) + frame(message(rpc.id, bad))), { json });
    rejected(out, /invalid result \(report\.metrics\.cls\)/);
  });
  test(`SSE security ${mode}: incomplete malicious SSE cannot outlive the shared deadline`, async (t) => {
    const out = await run(t, (res, rpc) => res.write(`data: ${JSON.stringify(message(rpc.id, { ...handle, ...completed() }))}`), { json, seconds: "0.25" });
    rejected(out, /no result after 0.25 seconds/);
    assert.ok(out.elapsed >= 200 && out.elapsed < 1_500, `deadline took ${out.elapsed}ms`);
  });
}
