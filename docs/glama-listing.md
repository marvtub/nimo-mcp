# Glama listing

Public directory entry for the nimo MCP connector:
https://glama.ai/mcp/connectors/io.github.marvtub/nimo

## Status

Glama runs an hourly health check against the MCP server. The listing must show
**Healthy** — unhealthy listings rank below healthy ones.

## Test profile (Admin → Test Profile)

Health checks authenticate as a dedicated test identity, separate from personal
connections.

- **Authentication type:** API Key (Bearer)
- **Key:** a dedicated key named `Glama health check`, created in the nimo
  dashboard under Settings → Integrations → Manage Nimo MCP. The key value lives
  only in Glama's test profile — never commit it to this repo.
- **Why not OAuth:** Glama's backend cannot complete OAuth client registration
  against `api.heynimo.com` ("public clients with registered callbacks are
  required" / "could not reach the OAuth provider"), even though the server's
  OAuth endpoints respond fine to direct probes. Do not switch the test profile
  back to OAuth 2.0.

## Listing details (Admin → Listing)

- **Description:** "Hear it from nimo, not your customers. Monitoring that tells
  you the fix, not just the alert: uptime, Core Web Vitals, cron check-ins, plus
  Journey Watch for your signup and checkout flows. Free one-off checks, no
  account needed."
- **Categories:** Monitoring, Observability, Developer Tools (3 is the max)
- **"Use Glama listing details as the source of truth"** is enabled, so registry
  syncs don't overwrite manual edits. `server.json` in this repo carries the same
  description — keep them in sync.

## If the listing goes Unhealthy again

1. In Glama: Admin → Test Profile → Test Connection. Note the exact error.
2. Check the `Glama health check` key still exists in the nimo dashboard
   (Settings → Integrations → Manage Nimo MCP). If it was deleted or rotated,
   create a new one and paste it into the test profile.
3. Re-run Test Connection until it passes; the public listing flips back to
   Healthy (public page cache can lag a few minutes).

## Access

Glama sign-in is Google OAuth (no password). The connector is claimed under the
owner's Google account.
