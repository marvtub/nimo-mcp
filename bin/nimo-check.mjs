#!/usr/bin/env node
// Check that a public page loads and how fast it is, using nimo's free MCP
// server (https://api.heynimo.com/try-mcp). No account, key or dependencies.
//
//   npx github:marvtub/nimo-mcp https://example.com
//   npx github:marvtub/nimo-mcp https://example.com --min-score 70 --json
//
// Exit codes: 0 ok, 1 the page failed or scored under --min-score,
// 2 bad input or the check could not run (limit reached, network error).

import { appendFileSync } from "node:fs";

const ENDPOINT = process.env.NIMO_TRY_MCP_URL || "https://api.heynimo.com/try-mcp";
const POLL_MS = 5_000;

const HELP = `Usage: nimo-check <url> [--min-score N] [--timeout SECONDS] [--json]

Runs one free speed check of a public page with nimo and prints the score,
Core Web Vitals and the most useful fix. No account needed; free checks have
hourly and daily limits.

  --min-score N      exit 1 if the performance score is below N (0-100)
  --timeout SECONDS  give up after this long (default 240)
  --json             print the result as JSON
`;

function parseArgs(argv) {
  const opts = { url: null, minScore: null, timeout: 240, json: false };
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === "-h" || arg === "--help") { process.stdout.write(HELP); process.exit(0); }
    else if (arg === "--json") opts.json = true;
    else if (arg === "--min-score") opts.minScore = Number(argv[++i]);
    else if (arg === "--timeout") opts.timeout = Number(argv[++i]);
    else if (arg.startsWith("-")) fail(`Unknown option ${arg}`);
    else if (!opts.url) opts.url = arg;
    else fail(`Unexpected argument ${arg}`);
  }
  if (!opts.url) fail("Give a page address, for example: nimo-check https://example.com");
  if (opts.minScore !== null && !(opts.minScore >= 0 && opts.minScore <= 100)) fail("--min-score must be between 0 and 100");
  if (!Number.isFinite(opts.timeout) || !(opts.timeout > 0)) fail("--timeout must be a positive finite number of seconds");
  return opts;
}

function fail(message, code = 2) {
  process.stderr.write(`nimo-check: ${message}\n`);
  process.exit(code);
}

let rpcId = 0;

function isRpcResponse(message, expectedId) {
  return message !== null && typeof message === "object" && !Array.isArray(message)
    && message.jsonrpc === "2.0" && message.id === expectedId
    && !Object.hasOwn(message, "method")
    && Object.hasOwn(message, "result") !== Object.hasOwn(message, "error");
}

function responseError(res, reason) {
  return new Error(`nimo answered with HTTP ${res.status}: ${reason}`);
}

function parseMessage(body, res) {
  try { return JSON.parse(body); }
  catch { throw responseError(res, "invalid JSON response"); }
}

async function readSseResponse(res, expectedId) {
  if (!res.body) throw responseError(res, "missing response body");
  const reader = res.body.getReader();
  // The streaming decoder preserves split UTF-8 characters and strips the BOM.
  const decoder = new TextDecoder();
  let line = "";
  let skipLf = false;
  let event = "";
  let data = [];

  const acceptLine = () => {
    if (line === "") {
      const currentEvent = event || "message";
      const payload = data.length ? data.join("\n") : null;
      // An empty event still ends the previous event's type and data buffers.
      event = "";
      data = [];
      if (payload === null || currentEvent !== "message") return null;
      const message = parseMessage(payload, res);
      return isRpcResponse(message, expectedId) ? message : null;
    }
    if (line.startsWith(":")) return null;
    const colon = line.indexOf(":");
    const field = colon === -1 ? line : line.slice(0, colon);
    let value = colon === -1 ? "" : line.slice(colon + 1);
    if (value.startsWith(" ")) value = value.slice(1);
    if (field === "event") event = value;
    else if (field === "data") data.push(value);
    return null;
  };

  const consume = (text) => {
    for (const char of text) {
      if (skipLf) {
        skipLf = false;
        if (char === "\n") continue;
      }
      if (char === "\r" || char === "\n") {
        const message = acceptLine();
        line = "";
        skipLf = char === "\r";
        if (message) return message;
      } else line += char;
    }
    return null;
  };

  try {
    while (true) {
      const { value, done } = await reader.read();
      const message = consume(done ? decoder.decode() : decoder.decode(value, { stream: true }));
      if (message) return message;
      // EOF is not an event delimiter: never dispatch an incomplete frame.
      if (done) throw responseError(res, "no matching JSON-RPC response");
    }
  } finally {
    // Do not wait for EOF or keep receiving after a complete matching response.
    try { await reader.cancel(); }
    catch { /* Preserve the response/parse/timeout result if cancellation fails. */ }
    finally { reader.releaseLock(); }
  }
}

async function callTool(name, args, deadline, timeoutSeconds) {
  const id = ++rpcId;
  const remaining = remainingTime(deadline, timeoutSeconds);
  const deadlineLimitsRequest = remaining <= 30_000;
  const signal = AbortSignal.timeout(Math.max(1, Math.ceil(Math.min(30_000, remaining))));
  let res;
  let message;
  try {
    res = await fetch(ENDPOINT, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        accept: "application/json, text/event-stream",
        "user-agent": "nimo-check (+https://github.com/marvtub/nimo-mcp)",
      },
      body: JSON.stringify({ jsonrpc: "2.0", id, method: "tools/call", params: { name, arguments: args } }),
      signal,
    });
    const contentType = res.headers.get("content-type")?.split(";", 1)[0].trim().toLowerCase();
    message = contentType === "text/event-stream"
      ? await readSseResponse(res, id)
      : parseMessage(await res.text(), res);
  } catch (error) {
    // Node versions can report a body timeout as AbortError rather than TimeoutError.
    if (deadlineLimitsRequest && signal.aborted) throw deadlineError(timeoutSeconds);
    throw error;
  }
  remainingTime(deadline, timeoutSeconds);
  if (res.status === 429 || message?.error && !message.jsonrpc) throw new Error(message?.error?.message || message?.error || "Too many requests. Try again later.");
  if (!res.ok) throw responseError(res, "request failed");
  if (!isRpcResponse(message, id)) throw responseError(res, "no matching JSON-RPC response");
  if (message.error) throw new Error(message.error.message || "The request failed.");
  const result = message.result;
  const text = result?.content?.find((c) => c.type === "text")?.text;
  const data = result?.structuredContent ?? (text ? JSON.parse(text) : null);
  if (result?.isError) throw new Error(data?.error || "The check could not run.");
  if (!data) throw new Error("nimo returned an empty result.");
  if (!["queued", "running", "completed", "failed"].includes(data.status)) throw new Error("nimo returned an invalid check status.");
  return data;
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function deadlineError(timeoutSeconds) {
  return new Error(`no result after ${timeoutSeconds} seconds`);
}

function remainingTime(deadline, timeoutSeconds) {
  const remaining = deadline - Date.now();
  if (remaining <= 0) throw deadlineError(timeoutSeconds);
  return remaining;
}

async function waitToPoll(deadline, timeoutSeconds) {
  await sleep(Math.min(POLL_MS, remainingTime(deadline, timeoutSeconds)));
  remainingTime(deadline, timeoutSeconds);
}

function ms(value) {
  if (value === null || value === undefined) return "n/a";
  return value >= 1000 ? `${(value / 1000).toFixed(1)} s` : `${Math.round(value)} ms`;
}

function grade(metric, value) {
  if (value === null || value === undefined) return "";
  const limits = { lcp: [2500, 4000], cls: [0.1, 0.25], inp: [200, 500], ttfb: [800, 1800], score: [90, 50] };
  const [good, poor] = limits[metric];
  if (metric === "score") return value >= good ? "good" : value >= poor ? "needs work" : "poor";
  return value <= good ? "good" : value <= poor ? "needs work" : "poor";
}

function fixTitle(item) {
  return item?.title || item?.headline || item?.summary || item?.description || null;
}

function summarize(job) {
  const m = job.report?.metrics ?? {};
  const fixes = [fixTitle(job.report?.primaryFinding), ...(job.report?.recommendations ?? []).map(fixTitle)]
    .filter(Boolean)
    .filter((t, i, all) => all.indexOf(t) === i)
    .filter((t) => !job.report?.summary?.includes(t))
    .slice(0, 3);
  return {
    url: job.url,
    device: job.device ?? null,
    measuredAt: job.measuredAt ?? null,
    score: m.performanceScore ?? null,
    lcpMs: m.lcp ?? null,
    cls: m.cls ?? null,
    inpMs: m.inp ?? null,
    ttfbMs: m.ttfb ?? null,
    summary: job.report?.summary ?? null,
    fixes,
  };
}

function printText(r) {
  const line = (label, value, g) => `  ${label.padEnd(25)}${String(value).padEnd(10)}${g}`;
  console.log(`\nnimo check: ${r.url}${r.device ? ` (${r.device})` : ""}\n`);
  console.log(line("Performance score", r.score ?? "n/a", grade("score", r.score)));
  console.log(line("Largest paint (LCP)", ms(r.lcpMs), grade("lcp", r.lcpMs)));
  console.log(line("Layout shift (CLS)", r.cls ?? "n/a", grade("cls", r.cls)));
  if (r.inpMs !== null) console.log(line("Response to taps (INP)", ms(r.inpMs), grade("inp", r.inpMs)));
  console.log(line("Server response (TTFB)", ms(r.ttfbMs), grade("ttfb", r.ttfbMs)));
  if (r.summary) console.log(`\n${r.summary}`);
  if (r.fixes.length) console.log(`\nFix first:\n${r.fixes.map((f) => `  - ${f}`).join("\n")}`);
  console.log("\nWatch this page every 5 minutes with alerts in Slack or Telegram: https://heynimo.com\n");
}

async function main() {
  const opts = parseArgs(process.argv.slice(2));
  const deadline = Date.now() + opts.timeout * 1000;
  let job;
  try {
    job = await callTool("check_website", { url: opts.url }, deadline, opts.timeout);
    // The access token only authorizes reading this one check. Keep it in
    // memory and out of logs, since CI logs on public repos are public.
    const handle = { jobId: job.jobId, accessToken: job.accessToken };
    if (!opts.json) process.stderr.write("Checking");
    while (job.status === "queued" || job.status === "running") {
      await waitToPoll(deadline, opts.timeout);
      if (!opts.json) process.stderr.write(".");
      job = await callTool("get_check", handle, deadline, opts.timeout);
    }
    if (!opts.json) process.stderr.write("\n");
  } catch (error) {
    fail(error.message);
  }

  if (job.status === "failed") {
    if (opts.json) console.log(JSON.stringify({ url: opts.url, ok: false, error: job.error }, null, 2));
    else console.error(`\nThe page could not be checked: ${job.error}`);
    process.exit(1);
  }

  const result = summarize(job);
  const belowMin = opts.minScore !== null && (result.score === null || result.score < opts.minScore);
  if (opts.json) console.log(JSON.stringify({ ok: !belowMin, ...result }, null, 2));
  else printText(result);
  writeGithubOutputs(result);
  if (belowMin) {
    if (!opts.json) console.error(`Score ${result.score ?? "n/a"} is below the minimum of ${opts.minScore}.`);
    process.exit(1);
  }
}

function writeGithubOutputs(r) {
  if (process.env.GITHUB_OUTPUT) {
    appendFileSync(process.env.GITHUB_OUTPUT, [
      `score=${r.score ?? ""}`, `lcp-ms=${r.lcpMs ?? ""}`, `cls=${r.cls ?? ""}`, `ttfb-ms=${r.ttfbMs ?? ""}`, "",
    ].join("\n"));
  }
  if (process.env.GITHUB_STEP_SUMMARY) {
    const row = (label, value, metric, raw) => `| ${label} | ${value} | ${grade(metric, raw)} |`;
    appendFileSync(process.env.GITHUB_STEP_SUMMARY, [
      `### nimo check: ${r.url}`, "",
      "| Measure | Value | |", "| --- | --- | --- |",
      row("Performance score", r.score ?? "n/a", "score", r.score),
      row("Largest paint (LCP)", ms(r.lcpMs), "lcp", r.lcpMs),
      row("Layout shift (CLS)", r.cls ?? "n/a", "cls", r.cls),
      row("Server response (TTFB)", ms(r.ttfbMs), "ttfb", r.ttfbMs),
      "", ...(r.fixes.length ? ["**Fix first**", "", ...r.fixes.map((f) => `- ${f}`), ""] : []),
      "Checked with [nimo](https://heynimo.com).", "",
    ].join("\n"));
  }
}

main();
