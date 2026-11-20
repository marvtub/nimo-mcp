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
  const startAt = 100_000; // Same starting value for both clocks in the old and new CLI.
  let elapsed = 0, wall = startAt;
  const timers = [], delays = [];
  let getCheckCalls = 0, settled = false;
  const context = vm.createContext({
    Date: { now: () => wall },
    performance: { now: () => startAt + elapsed },
    setTimeout(callback, delay) { timers.push({ callback, delay }); delays.push(delay); },
  });
  const waitToPoll = vm.runInContext([
    actualConstant("POLL_MS"), actualConstant("sleep"),
    actualFunction("deadlineError"), actualFunction("remainingTime"), actualFunction("waitToPoll"),
    "waitToPoll;",
  ].join("\n"), context);
  return {
    timers, delays,
    get elapsed() { return elapsed; },
    get getCheckCalls() { return getCheckCalls; },
    get settled() { return settled; },
    start(timeoutSeconds) {
      // The real caller can send get_check only after this await resolves.
      return waitToPoll(startAt + timeoutSeconds * 1000, timeoutSeconds).then(
        () => { settled = true; getCheckCalls++; return { polled: true }; },
        (error) => { settled = true; return { error }; },
      );
    },
    async wake(at, wallStep = 0) {
      assert(at >= elapsed);
      const timer = timers.shift(); assert(timer, "no scheduled production timer");
      wall += at - elapsed + wallStep;
      elapsed = at;
      timer.callback();
      await flushTasks(); // Drain promise continuations without moving fake time.
    },
  };
}

for (const [label, wallStep] of [["ordinary deadline", 0], ["wall clock rolls back", -1_000]]) {
  test(`actual poll helper: ${label} times out at 200ms elapsed`, { timeout: 2_000 }, async () => {
    const clock = clockHarness();
    const result = clock.start(0.2);
    await clock.wake(200, wallStep);
    assert.deepEqual(clock.delays, [200], "no extra wait once the budget is spent");
    assert.equal(clock.settled, true);
    assert.equal((await result).error?.message, "no result after 0.2 seconds");
    assert.equal(clock.getCheckCalls, 0);
    assert.equal(clock.timers.length, 0);
  });
}

for (const [label, wallStep] of [["capped wake", 0], ["capped wake with clock jumping forward", 1_000]]) {
  test(`actual poll helper: 1ms-early ${label} re-waits then times out without get_check`, { timeout: 2_000 }, async () => {
    const clock = clockHarness();
    const result = clock.start(0.2);
    assert.deepEqual(clock.delays, [200]);
    await clock.wake(199, wallStep);
    assert.equal(clock.getCheckCalls, 0, "capped wake must not permit a poll with 1ms left");
    assert.equal(clock.settled, false, "must not time out with 1ms left");
    assert.deepEqual(clock.delays, [200, 1]);
    await clock.wake(200);
    assert.equal((await result).error?.message, "no result after 0.2 seconds");
    assert.equal(clock.getCheckCalls, 0);
    assert.equal(clock.timers.length, 0);
  });
}

for (const [label, wallStep] of [["normal interval", 0], ["normal interval with clock jumping forward", 1_000]]) {
  test(`actual poll helper: 1ms-early ${label} re-waits then returns at its original target`, { timeout: 2_000 }, async () => {
    const clock = clockHarness();
    const result = clock.start(10);
    assert.deepEqual(clock.delays, [5_000]);
    await clock.wake(4_999, wallStep);
    assert.equal(clock.getCheckCalls, 0, "normal interval must not permit an early poll");
    assert.equal(clock.settled, false);
    assert.deepEqual(clock.delays, [5_000, 1]);
    await clock.wake(5_000);
    assert.deepEqual(await result, { polled: true });
    assert.equal(clock.getCheckCalls, 1);
    assert.equal(clock.elapsed, 5_000, "do not slide the poll target forward on every wake");
    assert.equal(clock.timers.length, 0);
  });
}
