import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { once } from "node:events";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { createServer } from "node:http";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";

// The override lets reviewers run the same regressions against an old CLI.
const cli = process.env.NIMO_TEST_CLI || fileURLToPath(new URL("../bin/nimo-check.mjs", import.meta.url));
const job = {
  status: "completed",
  url: "https://example.invalid/",
  report: { metrics: { performanceScore: 95 }, summary: "Local café fixture" },
};
const result = (id, data = job) => ({ jsonrpc: "2.0", id, result: { structuredContent: data } });
const frame = (message, newline = "\n") => `data: ${JSON.stringify(message)}${newline}${newline}`;

async function runMock(t, handler, { args = [], maxMs = 4_000 } = {}) {
  const dir = await mkdtemp(join(tmpdir(), "nimo-sse-"));
  const requests = [];
  const observed = { closed: 0, finished: 0 };
  const timers = new Set();
  const later = (fn, ms) => {
    const timer = setTimeout(fn, ms);
    timers.add(timer);
  };
  const server = createServer(async (request, response) => {
    let body = "";
    for await (const chunk of request) body += chunk;
    const rpc = JSON.parse(body);
    requests.push(rpc);
    response.on("close", () => { observed.closed++; });
    response.on("finish", () => { observed.finished++; });
    handler(response, rpc, requests.length, later);
  });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  let child;
  t.after(async () => {
    if (child && child.exitCode === null) child.kill("SIGKILL");
    for (const timer of timers) clearTimeout(timer);
    server.closeAllConnections();
    await new Promise((resolve) => server.close(resolve));
    await rm(dir, { recursive: true, force: true });
  });
  const started = performance.now();
  child = spawn(process.execPath, [cli, job.url, "--json", ...args], {
    env: {
      PATH: process.env.PATH,
      NIMO_TRY_MCP_URL: `http://127.0.0.1:${server.address().port}`,
      GITHUB_OUTPUT: join(dir, "outputs"),
      GITHUB_STEP_SUMMARY: join(dir, "summary"),
    },
  });
  let stdout = "";
  let stderr = "";
  child.stdout.setEncoding("utf8").on("data", (chunk) => { stdout += chunk; });
  child.stderr.setEncoding("utf8").on("data", (chunk) => { stderr += chunk; });
  const watchdog = setTimeout(() => child.kill("SIGKILL"), maxMs);
  const [code, signal] = await once(child, "close");
  clearTimeout(watchdog);
  const elapsed = performance.now() - started;
  const outputs = await readFile(join(dir, "outputs"), "utf8").catch(() => "");
  const summary = await readFile(join(dir, "summary"), "utf8").catch(() => "");
  assert.equal(signal, null, `CLI exceeded ${maxMs}ms: ${stderr}`);
  return { code, stdout, stderr, elapsed, outputs, summary, requests, observed };
}

function success(out) {
  assert.equal(out.code, 0, out.stderr);
  assert.equal(JSON.parse(out.stdout).ok, true);
  assert.equal(JSON.parse(out.stdout).score, 95);
  assert.match(out.outputs, /^score=95\n/);
}
function rejected(out, pattern = /nimo answered with HTTP 200/) {
  assert.equal(out.code, 2, JSON.stringify(out));
  assert.match(out.stderr, pattern);
  assert.equal(out.stdout, "");
  assert.equal(out.outputs, "");
  assert.equal(out.summary, "");
}

test("keep-open completed SSE returns promptly and cancels the response", async (t) => {
  const out = await runMock(t, (res, rpc) => {
    res.writeHead(200, { "content-type": "text/event-stream" });
    res.write(frame(result(rpc.id)));
    // Deliberately no end(): receiving the result must close the reader itself.
  }, { args: ["--timeout", "1"] });
  success(out);
  assert.ok(out.elapsed < 1_500, `waited ${out.elapsed}ms for EOF`);
  assert.equal(out.observed.closed, 1, "server did not observe reader cancellation");
  assert.equal(out.observed.finished, 0, "server unexpectedly ended the response");
});

test("empty ping event resets the following default message type", async (t) => {
  success(await runMock(t, (res, rpc) => {
    res.writeHead(200, { "content-type": "text/event-stream" });
    res.end(`event: ping\n\n${frame(result(rpc.id))}`);
  }));
});

for (const [name, newline] of [["LF", "\n"], ["CRLF", "\r\n"], ["CR-only", "\r"]]) {
  test(`${name} framing accepts a completed response`, async (t) => {
    success(await runMock(t, (res, rpc) => {
      res.writeHead(200, { "content-type": "text/event-stream; charset=utf-8" });
      res.end(`: comment${newline}event: message${newline}${frame(result(rpc.id), newline)}`);
    }));
  });
}

test("split framing handles BOM, CRLF, UTF-8, comments and multiline data", async (t) => {
  const out = await runMock(t, (res, rpc, _n, later) => {
    res.writeHead(200, { "content-type": "Text/Event-Stream; charset=utf-8" });
    const text = JSON.stringify(result(rpc.id));
    const split = text.indexOf(",") + 1;
    const bytes = Buffer.from(`\ufeffevent: ping\r\n\r\n: ignored\rretry: 100\nid: not-the-rpc-id\r\nevent: message\r\ndata: ${text.slice(0, split)}\r\ndata:${text.slice(split)}\r\n\r\n`);
    // One-byte writes on distinct turns split BOM/UTF-8 and both CRLF boundaries.
    let i = 0;
    const write = () => {
      if (res.destroyed) return;
      if (i === bytes.length) { res.end(); return; }
      res.write(bytes.subarray(i, ++i));
      later(write, 1);
    };
    write();
  });
  success(out);
  assert.equal(JSON.parse(out.stdout).summary, "Local café fixture");
});

test("SSE ignores notifications and unrelated IDs without a last-message fallback", async (t) => {
  success(await runMock(t, (res, rpc) => {
    res.writeHead(200, { "content-type": "text/event-stream" });
    res.end(frame({ jsonrpc: "2.0", method: "notifications/progress", params: {} })
      + frame(result(rpc.id + 10)) + frame(result(String(rpc.id)))
      + frame(result(rpc.id)) + frame(result(rpc.id + 20)));
  }));
});

for (const type of ["SSE", "JSON"]) {
  for (const [name, change] of [
    ["wrong numeric ID", (message) => { message.id += 999; }],
    ["string ID", (message) => { message.id = String(message.id); }],
    ["missing ID", (message) => { delete message.id; }],
    ["no result or error", (message) => { delete message.result; }],
    ["notification with an ID", (message) => { message.method = "notifications/progress"; }],
    ["wrong JSON-RPC version", (message) => { message.jsonrpc = "1.0"; }],
    ["both result and error", (message) => { message.error = { message: "ambiguous" }; }],
  ]) {
    test(`${type} rejects ${name} instead of passing the score gate`, async (t) => {
      const out = await runMock(t, (res, rpc) => {
        const message = result(rpc.id);
        change(message);
        res.writeHead(200, { "content-type": type === "SSE" ? "text/event-stream" : "application/json" });
        res.end(type === "SSE" ? frame(message) : JSON.stringify(message));
      }, { args: ["--min-score", "90"] });
      rejected(out, /no matching JSON-RPC response/);
    });
  }
  test(`${type} rejects a non-contract completed status`, async (t) => {
    const out = await runMock(t, (res, rpc) => {
      const message = result(rpc.id, { ...job, status: "complete" });
      res.writeHead(200, { "content-type": type === "SSE" ? "text/event-stream" : "application/json" });
      res.end(type === "SSE" ? frame(message) : JSON.stringify(message));
    });
    rejected(out, /invalid check status/);
  });
}

for (const payload of ["data: not-json\n\n", "data: null\n\n", ": comment only\n\n"]) {
  test(`SSE rejects a finite stream without a valid result: ${JSON.stringify(payload)}`, async (t) => {
    rejected(await runMock(t, (res) => {
      res.writeHead(200, { "content-type": "text/event-stream" });
      res.end(payload);
    }));
  });
}

test("SSE does not dispatch a truncated event at EOF", async (t) => {
  rejected(await runMock(t, (res, rpc) => {
    res.writeHead(200, { "content-type": "text/event-stream" });
    res.end(`data: ${JSON.stringify(result(rpc.id))}\n`);
  }), /no matching JSON-RPC response/);
});

test("malformed SSE data fails closed and cancels a keep-open stream", async (t) => {
  const out = await runMock(t, (res, rpc) => {
    res.writeHead(200, { "content-type": "text/event-stream" });
    res.write(`data: {bad-json}\n\n${frame(result(rpc.id))}`);
  });
  rejected(out, /invalid JSON response/);
  assert.ok(out.elapsed < 1_500);
  assert.equal(out.observed.closed, 1);
  assert.equal(out.observed.finished, 0);
});

test("malformed trailing events cannot poison an already completed response", async (t) => {
  success(await runMock(t, (res, rpc) => {
    res.writeHead(200, { "content-type": "text/event-stream" });
    res.end(frame(result(rpc.id)) + "data: {bad-json}\n\n");
  }));
});

for (const [name, handler] of [
  ["headers", () => {}],
  ["JSON body", (res, rpc) => { res.writeHead(200, { "content-type": "application/json" }); res.write(JSON.stringify(result(rpc.id)).slice(0, -2)); }],
  ["SSE body", (res, rpc) => { res.writeHead(200, { "content-type": "text/event-stream" }); res.write(`data: ${JSON.stringify(result(rpc.id))}`); }],
  ["SSE unmatched-ID stream", (res, rpc) => { res.writeHead(200, { "content-type": "text/event-stream" }); res.write(frame(result(rpc.id + 99))); }],
]) {
  test(`overall ${name} deadline aborts without fabricating a result`, async (t) => {
    const out = await runMock(t, handler, { args: ["--timeout", "0.2"] });
    rejected(out, /no result after 0.2 seconds/);
    assert.ok(out.elapsed >= 150 && out.elapsed < 1_500, `deadline took ${out.elapsed}ms`);
    assert.equal(out.observed.closed, 1);
  });
}

test("shared deadline includes a slow SSE poll after cancelling the queued stream", async (t) => {
  const token = "synthetic-local-token";
  const out = await runMock(t, (res, rpc, n) => {
    res.writeHead(200, { "content-type": "text/event-stream" });
    if (n === 1) res.write(frame(result(rpc.id, { status: "queued", jobId: "mock-job", accessToken: token })));
    else res.write(`data: ${JSON.stringify(result(rpc.id))}`);
  }, { args: ["--timeout", "5.4"], maxMs: 7_000 });
  rejected(out, /no result after 5.4 seconds/);
  assert.ok(out.elapsed >= 5_000 && out.elapsed < 6_800, `poll deadline took ${out.elapsed}ms`);
  assert.deepEqual(out.requests.map((rpc) => [rpc.id, rpc.params.name]), [[1, "check_website"], [2, "get_check"]]);
  assert.deepEqual(out.requests[1].params.arguments, { jobId: "mock-job", accessToken: token });
  assert.equal(out.observed.closed, 2, "queued and stalled polling readers must both be cancelled");
  assert.doesNotMatch(out.stdout + out.stderr + out.outputs + out.summary, /synthetic-local-token/);
});

test("JSON gateway rate-limit errors retain their useful message", async (t) => {
  const out = await runMock(t, (res) => {
    res.writeHead(429, { "content-type": "application/json" });
    res.end(JSON.stringify({ error: "mock shared limit" }));
  });
  rejected(out, /mock shared limit/);
});

test("non-success HTTP status cannot produce successful Action outputs", async (t) => {
  const out = await runMock(t, (res, rpc) => {
    res.writeHead(503, { "content-type": "application/json" });
    res.end(JSON.stringify(result(rpc.id)));
  });
  rejected(out, /HTTP 503/);
});
