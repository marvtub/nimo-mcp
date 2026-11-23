import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { dirname } from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import { createNimoFixture } from "../test-support/nimo-loopback.mjs";

const execFileAsync = promisify(execFile);
const installedCli = process.env.NIMO_CHECK_BIN;
const cli = installedCli || process.execPath;
const cliArgs = installedCli ? [] : [fileURLToPath(new URL("../bin/nimo-check.mjs", import.meta.url))];

test("CLI returns machine-readable results for completed and failed checks", { timeout: 12_000 }, async () => {
  const requests = [];
  const server = createNimoFixture(requests);

  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  const { port } = server.address();
  const childOptions = {
    env: {
      NIMO_TRY_MCP_URL: `http://127.0.0.1:${port}`,
      ...(installedCli && { PATH: dirname(process.execPath) }),
    },
    timeout: 5_000,
    killSignal: "SIGKILL",
    maxBuffer: 256 * 1024,
  };

  const runCheck = (url) => execFileAsync(cli, [...cliArgs, url, "--json"], childOptions);

  try {
    const success = await runCheck("https://example.com");
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
      runCheck("https://broken.example"),
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
