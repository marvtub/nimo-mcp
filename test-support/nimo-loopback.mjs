import { createServer } from "node:http";

export function createNimoFixture(requests = []) {
  return createServer(async (request, response) => {
    let rawBody = "";
    for await (const chunk of request) rawBody += chunk;
    const body = JSON.parse(rawBody);
    requests.push(body);

    const { name, arguments: { url, jobId } } = body.params;
    const pendingId = "e".repeat(64);
    let job = url === "https://example.com"
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
    if (url === "https://pending.example" || (name === "get_check" && jobId === pendingId)) {
      job = { jobId: pendingId, accessToken: "f".repeat(64), status: "queued" };
    }

    response.writeHead(200, { "content-type": "application/json" });
    response.end(JSON.stringify({
      jsonrpc: "2.0",
      id: body.id,
      result: { structuredContent: job },
    }));
  });
}
