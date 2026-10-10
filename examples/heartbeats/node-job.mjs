// Ping nimo at the end of a Node job (a serverless cron, a worker, a script).
// Set NIMO_PING_URL to https://api.heynimo.com/ping/<your-token>.

async function runJob() {
  // ... your job ...
}

await runJob(); // if this throws, no ping is sent and nimo alerts you

try {
  await fetch(process.env.NIMO_PING_URL, { signal: AbortSignal.timeout(10_000) });
} catch (error) {
  // A failed ping must not fail the job itself; nimo alerts if pings stop.
  console.warn("Could not ping nimo:", error.message);
}
