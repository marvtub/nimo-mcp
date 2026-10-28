import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { setImmediate as flushTasks } from "node:timers/promises";
import { fileURLToPath } from "node:url";
import vm from "node:vm";
import test from "node:test";

// Execute the production functions and sleep implementation, not a duplicated
// polling algorithm. Override is only for the old-head negative control.
const cli = process.env.NIMO_TEST_CLI || fileURLToPath(new URL("../bin/nimo-check.mjs", import.meta.url));
const source = await readFile(cli, "utf8");
const actualFunction = (name) => {
  const match = source.match(new RegExp(`^(?:async )?function ${name}\\([^\\n]*\\) \\{.*?^\\}`, "ms"));
  assert(match, `missing production ${name}`);
  return match[0];
};
const actualConstant = (name) => {
  const match = source.match(new RegExp(`^const ${name} = [^\\n]+$`, "m"));
  assert(match, `missing production ${name}`);
  return match[0];
};

function clockHarness() {
  let now = 0;
  const timers = [], delays = [];
  let getCheckCalls = 0, settled = false;
  const context = vm.createContext({
    Date: { now: () => now },
    setTimeout(callback, delay) { timers.push({ callback, delay }); delays.push(delay); },
  });
  const waitToPoll = vm.runInContext([
    actualConstant("POLL_MS"), actualConstant("sleep"),
    actualFunction("deadlineError"), actualFunction("remainingTime"), actualFunction("waitToPoll"),
    "waitToPoll;",
  ].join("\n"), context);
  return {
    timers, delays,
    get now() { return now; },
    get getCheckCalls() { return getCheckCalls; },
    get settled() { return settled; },
    start(deadline, timeoutSeconds) {
      // The real caller can send get_check only after this await resolves.
      return waitToPoll(deadline, timeoutSeconds).then(
        () => { settled = true; getCheckCalls++; return { polled: true }; },
        (error) => { settled = true; return { error }; },
      );
    },
    async wake(at) {
      assert(at >= now);
      const timer = timers.shift(); assert(timer, "no scheduled production timer");
      now = at; timer.callback();
      await flushTasks(); // Drain promise continuations without moving fake time.
    },
  };
}

test("actual poll helper: 1ms-early capped wake re-waits then times out without get_check", { timeout: 2_000 }, async () => {
  const clock = clockHarness();
  const result = clock.start(200, 0.2);
  assert.deepEqual(clock.delays, [200]);
  await clock.wake(199);
  assert.equal(clock.getCheckCalls, 0, "capped wake must not permit a poll with 1ms left");
  assert.equal(clock.settled, false);
  assert.deepEqual(clock.delays, [200, 1]);
  await clock.wake(200);
  const out = await result;
  assert.match(out.error?.message ?? "", /no result after 0\.2 seconds/);
  assert.equal(clock.getCheckCalls, 0);
  assert.equal(clock.timers.length, 0);
});

test("actual poll helper: 1ms-early normal interval re-waits then returns at its original target", { timeout: 2_000 }, async () => {
  const clock = clockHarness();
  const result = clock.start(10_000, 10);
  assert.deepEqual(clock.delays, [5_000]);
  await clock.wake(4_999);
  assert.equal(clock.getCheckCalls, 0, "normal interval must not permit an early poll");
  assert.equal(clock.settled, false);
  assert.deepEqual(clock.delays, [5_000, 1]);
  await clock.wake(5_000);
  assert.deepEqual(await result, { polled: true });
  assert.equal(clock.getCheckCalls, 1);
  assert.equal(clock.now, 5_000, "do not slide the poll target forward on every wake");
  assert.equal(clock.timers.length, 0);
});
