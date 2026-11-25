import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import { createNimoFixture } from "../test-support/nimo-loopback.mjs";

const execFileAsync = promisify(execFile);
const cli = fileURLToPath(new URL("../bin/nimo-check.mjs", import.meta.url));

test("CLI exits on a deadline and the next check returns a fresh result", { timeout: 30_000 }, async () => {
  const requests = [];
  const server = createNimoFixture(requests);

  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  const { port } = server.address();
  const childOptions = {
    env: { NIMO_TRY_MCP_URL: `http://127.0.0.1:${port}` },
    timeout: 5_000,
    killSignal: "SIGKILL",
    maxBuffer: 256 * 1024,
  };

  try {
    const started = performance.now();
    await assert.rejects(
      execFileAsync(process.execPath, [cli, "https://pending.example", "--json", "--timeout", "2"], {
        ...childOptions,
        timeout: 12_000,
      }),
      (error) => {
        const elapsed = performance.now() - started;
        assert.equal(error.signal, null, "CLI should exit without a watchdog kill");
        assert.equal(error.code, 2);
        assert.equal(error.stdout, "");
        assert.equal(error.stderr, "nimo-check: no result after 2 seconds\n");
        // Allow for startup and scheduling without waiting for the watchdog.
        assert.ok(elapsed < 4_500, `CLI deadline exit took ${Math.round(elapsed)} ms (expected under 4500 ms)`);
        return true;
      },
    );

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
      requests.map(({ params }) => [params.name, params.arguments.url]),
      [
        ["check_website", "https://pending.example"],
        ["check_website", "https://example.com"],
        ["check_website", "https://broken.example"],
      ],
    );
  } finally {
    const closed = new Promise((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
    server.closeAllConnections();
    await closed;
  }
});
