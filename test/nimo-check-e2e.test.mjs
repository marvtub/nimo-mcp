import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { createServer } from "node:http";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);
const cli = fileURLToPath(new URL("../bin/nimo-check.mjs", import.meta.url));

test("CLI returns machine-readable results for completed and failed checks", { timeout: 12_000 }, async () => {
  const requests = [];
  const server = createServer(async (request, response) => {
    let rawBody = "";
    for await (const chunk of request) rawBody += chunk;
    const body = JSON.parse(rawBody);
    requests.push(body);

    const url = body.params.arguments.url;
    const job = url === "https://example.com"
      ? {
          jobId: "a".repeat(64),
          accessToken: "b".repeat(64),
          status: "completed",
          url,
          device: "mobile",
          measuredAt: "2026-01-02T03:04:05.000Z",
          report: {
            metrics: {
              performanceScore: 87,
              lcp: 2450,
              cls: 0.02,
              inp: 180,
              ttfb: 320,
            },
            summary: "The fixture page loaded successfully.",
            primaryFinding: { title: "Compress the hero image" },
            recommendations: [{ title: "Cache static files" }],
          },
        }
      : {
          jobId: "c".repeat(64),
          accessToken: "d".repeat(64),
          status: "failed",
          error: "The fixture page could not be reached.",
        };

    response.writeHead(200, { "content-type": "application/json" });
    response.end(JSON.stringify({
      jsonrpc: "2.0",
      id: body.id,
      result: { structuredContent: job },
    }));
  });

  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  const { port } = server.address();
  const childOptions = {
    env: { NIMO_TRY_MCP_URL: `http://127.0.0.1:${port}` },
    timeout: 5_000,
    killSignal: "SIGKILL",
    maxBuffer: 256 * 1024,
  };

  try {
    const success = await execFileAsync(process.execPath, [cli, "https://example.com", "--json"], childOptions);
    assert.equal(success.stderr, "");
    assert.deepEqual(JSON.parse(success.stdout), {
      ok: true,
      url: "https://example.com",
      device: "mobile",
      measuredAt: "2026-01-02T03:04:05.000Z",
      score: 87,
      lcpMs: 2450,
      cls: 0.02,
      inpMs: 180,
      ttfbMs: 320,
      summary: "The fixture page loaded successfully.",
      fixes: ["Compress the hero image", "Cache static files"],
    });

    await assert.rejects(
      execFileAsync(process.execPath, [cli, "https://broken.example", "--json"], childOptions),
      (error) => {
        assert.equal(error.code, 1);
        assert.equal(error.stderr, "");
        assert.deepEqual(JSON.parse(error.stdout), {
          url: "https://broken.example",
          ok: false,
          error: "The fixture page could not be reached.",
        });
        return true;
      },
    );

    assert.deepEqual(
      requests.map((request) => request.params.name),
      ["check_website", "check_website"],
    );
  } finally {
    server.closeAllConnections();
    await new Promise((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
  }
});
