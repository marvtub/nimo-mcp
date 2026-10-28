import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { chmod, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { createServer } from "node:http";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";
// Registered-command recognition/unescaping ported from GitHub's runner:
// https://github.com/actions/runner/blob/4197182ef8f39c719f66038c1bc9b34cd9e9ac9a/src/Runner.Common/ActionCommand.cs
// V2 trims leading whitespace; legacy V1 searches the whole line. anywhereV2
// additionally imposes the stronger scanning contract, including JSON strings.
const registered = new Set([
  "error", "warning", "notice", "add-mask", "stop-commands", "debug", "group",
  "endgroup", "set-output", "save-state", "set-env", "add-path",
]);
function unescape(value, pairs) {
  for (const [from, to] of pairs) value = value.split(from).join(to);
  return value;
}
const dataPairs = [["%0D", "\r"], ["%0A", "\n"], ["%25", "%"]];
const propertyPairs = [["%0D", "\r"], ["%0A", "\n"], ["%3A", ":"], ["%2C", ","], ["%25", "%"]];
const legacyPairs = [["%3B", ";"], ["%0D", "\r"], ["%0A", "\n"], ["%5D", "]"], ["%25", "%"]];
function parseCommand(message, version, anywhereV2) {
  let start, end, delimiter, pairs, separator;
  if (version === 2) {
    message = message.trimStart();
    start = anywhereV2 ? message.indexOf("::") : message.startsWith("::") ? 0 : -1;
    if (start < 0) return null;
    end = message.indexOf("::", start + 2);
    delimiter = 2; pairs = propertyPairs; separator = ",";
  } else {
    start = message.indexOf("##[");
    if (start < 0) return null;
    end = message.indexOf("]", start);
    delimiter = 3; pairs = legacyPairs; separator = ";";
  }
  if (end < 0) return null;
  const info = message.slice(start + delimiter, end);
  const space = info.indexOf(" ");
  const name = (space < 0 ? info : info.slice(0, space)).toLowerCase();
  if (!registered.has(name)) return null;
  const properties = {};
  if (space > 0) for (const item of info.slice(space + 1).trim().split(separator).filter(Boolean)) {
    const equals = item.indexOf("=");
    if (equals > 0 && equals < item.length - 1) properties[item.slice(0, equals).toLowerCase()] = unescape(item.slice(equals + 1), pairs);
  }
  return { name, properties, data: unescape(message.slice(end + (version === 2 ? 2 : 1)), version === 2 ? dataPairs : legacyPairs), version };
}
function commands(log, { anywhereV2 = false } = {}) {
  return log.split(/\r\n|[\r\n]/).map((line) => parseCommand(line, 2, anywhereV2) ?? parseCommand(line, 1, false)).filter(Boolean);
}

const actionPath = process.env.NIMO_SECURITY_ACTION_PATH || fileURLToPath(new URL("..", import.meta.url));
const action = await readFile(join(actionPath, "action.yml"), "utf8");
const runBlocks = [...action.matchAll(/      run: \|\n((?:        .*\n?)+)/g)];
assert.equal(runBlocks.length, 1, "execute the actual composite run block, not a retyped CLI command");
const shell = runBlocks[0][1].replace(/^ {8}/gm, "");
const privateJob = "privateJobIdForSecurityTestOnly0123456789";
const privateToken = "privateAccessTokenForSecurityTestOnly0123456789";
const output = "score=90\nlcp-ms=1200\ncls=0.05\nttfb-ms=300\n";
const rpc = (job) => ({ jsonrpc: "2.0", result: { structuredContent: job } });
const fixture = () => ({
  jobId: privateJob, accessToken: privateToken, status: "completed",
  url: "https://example.com/", device: "mobile", measuredAt: "2026-10-28T00:00:00Z",
  report: {
    summary: "Measured summary", primaryFinding: null, recommendations: [],
    metrics: { performanceScore: 90, lcp: 1200, cls: 0.05, inp: null, ttfb: 300 },
  },
});

async function runAction(response, { json = false, http = 200, raw, sequence } = {}) {
  const directory = await mkdtemp(join(tmpdir(), "nimo-runner-security-"));
  const outputPath = join(directory, "output"), summaryPath = join(directory, "summary");
  const script = join(directory, "action.sh"), nodeShim = join(directory, "node");
  await Promise.all([
    writeFile(outputPath, ""), writeFile(summaryPath, ""), writeFile(script, shell),
    writeFile(nodeShim, '#!/bin/bash\nif [ "$NIMO_TEST_JSON" = 1 ]; then exec "$NIMO_TEST_NODE" "$@" --json; fi\nexec "$NIMO_TEST_NODE" "$@"\n'),
  ]);
  await chmod(nodeShim, 0o700);
  const requests = [];
  const sockets = new Set();
  const server = createServer(async (request, reply) => {
    let body = "";
    for await (const chunk of request) body += chunk;
    requests.push(JSON.parse(body));
    reply.writeHead(http, { "content-type": "application/json" });
    const envelope = sequence ? sequence[Math.min(requests.length - 1, sequence.length - 1)] : response;
    // Match the actual request, including poll ID2; tool/error fixtures must
    // reach the security boundary rather than fail transport validation first.
    reply.end(raw ?? JSON.stringify(http === 200
      ? { jsonrpc: "2.0", id: requests[requests.length - 1].id, ...envelope }
      : envelope));
  });
  server.on("connection", (socket) => { sockets.add(socket); socket.on("close", () => sockets.delete(socket)); });
  try {
    await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
    const child = spawn("/bin/bash", ["--noprofile", "--norc", "-eo", "pipefail", script], {
      env: {
        PATH: `${directory}:${dirname(process.execPath)}:/usr/bin:/bin`,
        NIMO_TEST_NODE: process.execPath, NIMO_TEST_JSON: json ? "1" : "0",
        NIMO_URL: "https://example.com/", NIMO_MIN_SCORE: "", NIMO_TIMEOUT: "20",
        GITHUB_ACTION_PATH: actionPath, GITHUB_OUTPUT: outputPath, GITHUB_STEP_SUMMARY: summaryPath,
        NIMO_TRY_MCP_URL: `http://127.0.0.1:${server.address().port}`,
      },
    });
    let stdout = "", stderr = "";
    child.stdout.on("data", (chunk) => { stdout += chunk; });
    child.stderr.on("data", (chunk) => { stderr += chunk; });
    const timer = setTimeout(() => child.kill("SIGKILL"), 25_000);
    let code;
    try {
      code = await new Promise((resolve, reject) => { child.on("error", reject); child.on("close", resolve); });
    } finally { clearTimeout(timer); }
    return { code, stdout, stderr, output: await readFile(outputPath, "utf8"), summary: await readFile(summaryPath, "utf8"), requests };
  } finally {
    for (const socket of sockets) socket.destroy();
    await new Promise((resolve) => server.close(resolve));
    await rm(directory, { recursive: true, force: true });
  }
}

function inertLogs(result) {
  for (const log of [result.stdout, result.stderr]) {
    assert.deepEqual(commands(log), [], "GitHub's registered-command parser accepted remote text");
    assert.deepEqual(commands(log, { anywhereV2: true }), [], "even anywhere-in-line V2 scanning must find no commands");
    assert.doesNotMatch(log, /[\u0000-\u0009\u000b-\u001f\u007f-\u009f\p{Cf}\u2028\u2029]/u, "terminal control escaped the log boundary");
  }
}

function privateChannels(result) {
  for (const channel of [result.stdout, result.stderr, result.output, result.summary]) {
    assert(!channel.includes(privateToken), "bearer token leaked");
    assert(!channel.includes(privateJob), "private job id leaked");
  }
}

function expectedResult(job) {
  return {
    ok: true, url: job.url, device: job.device, measuredAt: job.measuredAt,
    score: 90, lcpMs: 1200, cls: 0.05, inpMs: null, ttfbMs: 300,
    summary: job.report.summary,
    fixes: [job.report.primaryFinding?.summary, ...job.report.recommendations.map((r) => r.title)].filter(Boolean),
  };
}

test("runner parser model recognizes real commands and rejects harmless lookalikes", () => {
  assert.deepEqual(commands("  ::error file=a%3Ab,line=2::bad%0Aline")[0], {
    name: "error", properties: { file: "a:b", line: "2" }, data: "bad\nline", version: 2,
  });
  assert.equal(commands("prefix ##[warning]bad")[0].name, "warning");
  assert.equal(commands('"summary": "::add-mask::value"', { anywhereV2: true })[0].name, "add-mask");
  assert.equal(commands("::stop-commands::remote-token")[0].name, "stop-commands");
  assert.deepEqual(commands("::not-a-registered-command::data"), []);
  assert.deepEqual(commands("\\u003a\\u003aerror\\u003a\\u003abad"), []);
  assert.deepEqual(commands("%3A%3Aerror%3A%3Abad"), []);
});

for (const json of [false, true]) {
  const mode = json ? "JSON" : "default text";
  // JSON is selected by a transparent node shim; the action.yml shell itself
  // executes unchanged in both modes. Normal execution uses the same Node as npm test.
  for (const command of ["error", "warning", "add-mask", "stop-commands"]) {
    for (const multiline of [false, true]) for (const field of ["url", "device", "summary", "finding", "recommendation", "error"]) {
      test(`${mode}: ${field} ${command} ${multiline ? "CRLF" : "single-line"} cannot command the runner`, async () => {
        const attack = `${multiline ? "trusted\r\n" : "trusted "}::${command}::remote-command-data`;
        const job = fixture();
        if (field === "error") { job.status = "failed"; job.error = attack; delete job.report; }
        else if (field === "summary") job.report.summary = attack;
        else if (field === "finding") job.report.primaryFinding = { summary: attack };
        else if (field === "recommendation") job.report.recommendations = [{ title: attack }];
        else job[field] = attack;
        const result = await runAction(rpc(job), { json });
        assert.equal(result.code, field === "error" ? 1 : 0, result.stderr);
        inertLogs(result); privateChannels(result);
        if (field === "error") {
          assert.equal(result.output, ""); assert.equal(result.summary, "");
          if (json) assert.deepEqual(JSON.parse(result.stdout), { url: "https://example.com/", ok: false, error: attack });
        } else {
          assert.equal(result.output, output);
          if (json) assert.deepEqual(JSON.parse(result.stdout), expectedResult(job));
        }
      });
    }
  }

  test(`${mode}: JSON-only timestamp text is inert and parse-equivalent`, async () => {
    const job = fixture();
    job.measuredAt = 'single ::error::timestamp ##[warning]legacy\\::add-mask::mask\r\n::stop-commands::token';
    const result = await runAction(rpc(job), { json });
    assert.equal(result.code, 0); inertLogs(result); privateChannels(result);
    if (json) assert.deepEqual(JSON.parse(result.stdout), expectedResult(job));
  });

  test(`${mode}: legacy parser, terminal controls, and escaped Unicode remain inert`, async () => {
    const job = fixture();
    job.report.summary = 'normal https://example.com/path : colon; prefix ##[error]legacy\n::warning::new\r\n::add-mask::hide\n::stop-commands::token\u001b]8;;https://evil.example\u0007click\u001b[2J\u009b2J\u202e\u2066\u0000\temoji 🎾 \\u003a literal';
    job.report.recommendations = [{ title: "An ordinary object recommendation" }];
    const result = await runAction(rpc(job), { json });
    assert.equal(result.code, 0, result.stderr); inertLogs(result); privateChannels(result);
    assert.equal(result.output, output);
    if (json) assert.deepEqual(JSON.parse(result.stdout), expectedResult(job));
    else assert.match(result.stdout, /https:\/\/example\.com\/path : colon/);
  });

  for (const kind of ["rpc", "http", "tool", "tool-text", "malformed-http", "malformed-tool"]) {
    test(`${mode}: ${kind} failures are inert and do not expose body snippets`, async () => {
      const attack = "prefix ::error::single ##[warning]legacy\r\n::add-mask::secret\n::stop-commands::remote";
      const options = { json };
      let response;
      if (kind === "rpc") response = { jsonrpc: "2.0", error: { message: attack } };
      if (kind === "http") { options.http = 429; response = { error: attack }; }
      if (kind === "tool") response = { result: { isError: true, structuredContent: { error: attack, jobId: privateJob, accessToken: privateToken } } };
      if (kind === "tool-text") response = { result: { isError: true, content: [{ type: "text", text: JSON.stringify({ error: attack, accessToken: privateToken }) }] } };
      if (kind === "malformed-http") options.raw = `not-json ${attack} ${privateToken}`;
      if (kind === "malformed-tool") response = { result: { content: [{ type: "text", text: `not-json ${attack} ${privateToken}` }] } };
      const result = await runAction(response, options);
      assert.equal(result.code, 2, result.stderr); inertLogs(result); privateChannels(result);
      assert.equal(result.stdout, ""); assert.equal(result.output, ""); assert.equal(result.summary, "");
      assert.doesNotMatch(result.stderr, /SyntaxError|at file:/);
    });
  }

  test(`${mode}: private handles echoed in completed/failed/tool-error data are redacted on all channels`, async () => {
    for (const kind of ["completed", "failed", "tool-error"]) {
      const job = fixture();
      const echo = `${privateJob} ${privateToken}`;
      job.url += echo; job.device += echo; job.measuredAt += echo;
      job.report.summary += echo;
      job.report.primaryFinding = { summary: `finding ${echo}` };
      job.report.recommendations = [{ title: `recommendation ${echo}` }];
      if (kind === "failed") { job.status = "failed"; job.error = `failed ${echo}`; }
      const response = kind === "tool-error" ? { result: { isError: true, structuredContent: { ...job, error: `error ${echo}` } } } : rpc(job);
      const result = await runAction(response, { json });
      assert.equal(result.code, kind === "completed" ? 0 : kind === "failed" ? 1 : 2);
      privateChannels(result); inertLogs(result);
      assert.match(result.stdout + result.stderr, /private check handle/);
      if (json && kind !== "tool-error") assert(JSON.parse(result.stdout));
    }
  });

  for (const recommendations of [[], [{ title: "Compress the hero image" }]]) {
    test(`${mode}: completed/null finding/object recommendations preserve the Action contract ${recommendations.length}`, async () => {
      const job = fixture(); job.report.recommendations = recommendations;
      const result = await runAction(rpc(job), { json });
      assert.equal(result.code, 0); assert.equal(result.output, output); inertLogs(result); privateChannels(result);
      if (json) assert.deepEqual(JSON.parse(result.stdout), expectedResult(job));
    });
  }

  for (const metric of ["performanceScore", "lcp", "cls", "inp", "ttfb"]) {
    test(`${mode}: ${metric} CRLF cannot write an extra output or summary`, async () => {
      const job = fixture(); job.report.metrics[metric] = "90\r\nattacker=true\r::error::injected";
      const result = await runAction(rpc(job), { json });
      assert.equal(result.code, 2); assert.equal(result.stdout, "");
      assert.equal(result.output, ""); assert.equal(result.summary, ""); inertLogs(result); privateChannels(result);
    });
  }

  test(`${mode}: CRLF/HTML/Markdown report text stays escaped in the step summary`, async () => {
    const job = fixture();
    job.url = "https://example.com\r\n### forged [link](https://evil.example)";
    job.report.primaryFinding = { summary: '<a href="https://evil.example">click</a>\r\n<img src=x onerror=alert(1)>\n- [fix](https://evil.example)' };
    const result = await runAction(rpc(job), { json });
    assert.equal(result.code, 0); assert.equal(result.output, output); inertLogs(result); privateChannels(result);
    assert.doesNotMatch(result.summary, /\n### forged|(?<!\\)<(?:a|img)\b|\[fix\]\(/);
    assert.match(result.summary, /\\<a /); assert.match(result.summary, /\\\[fix\\\]\\\(/);
    if (json) assert.deepEqual(JSON.parse(result.stdout), expectedResult(job));
  });
}

test("queued handles stay private when a later RPC error echoes them in either mode", async () => {
  await Promise.all([false, true].map(async (json) => {
    const queued = { status: "queued", jobId: privateJob, accessToken: privateToken };
    const error = { jsonrpc: "2.0", error: { message: `private ${privateJob} ${privateToken}\r\n::error::injected` } };
    const result = await runAction(null, { json, sequence: [rpc(queued), error] });
    assert.equal(result.code, 2); assert.equal(result.requests.length, 2);
    assert.deepEqual(result.requests[1].params.arguments, { jobId: privateJob, accessToken: privateToken });
    assert.equal(result.stdout, ""); assert.equal(result.output, ""); assert.equal(result.summary, "");
    inertLogs(result); privateChannels(result); assert.match(result.stderr, /private check handle/);
  }));
});
