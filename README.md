# nimo MCP server: website uptime, speed and cron job monitoring for Claude, ChatGPT and Cursor

Ask your AI assistant "is my site up?", "why did my homepage get slower?" or
"did last night's backup run?" and get an answer from real checks, not a guess.

[nimo](https://heynimo.com) checks that your site loads every 5 minutes,
double-checks before it alerts you, and messages you in Slack or Telegram when
it goes down and again when it's back. It also tracks how fast your key pages
load (Core Web Vitals, from real Chrome visitors when available, plus
Lighthouse), and can watch scheduled jobs such as backups and cron jobs. This
MCP server gives Claude, ChatGPT, Cursor, Codex and other assistants access
to all of it.

```
https://api.heynimo.com/mcp-server
```

Hosted and remote (streamable HTTP). Nothing to install or run. You sign in
with your browser; no API key needed.

**Try it with no account:** connect `https://api.heynimo.com/try-mcp` and ask
"What is slowing down https://example.com?"

## Set up

### Claude Code

```bash
claude mcp add --transport http --scope user nimo https://api.heynimo.com/mcp-server
claude mcp login nimo
```

### Claude (desktop and web)

Settings → Connectors → Add custom connector → paste
`https://api.heynimo.com/mcp-server`, then approve the sign-in.

### ChatGPT

Add a connector with the URL `https://api.heynimo.com/mcp-server` (Settings →
Apps & Connectors; custom connectors need developer mode on some plans), then
approve the sign-in.

### Codex

```bash
codex mcp add nimo --url https://api.heynimo.com/mcp-server
```

### Cursor

`~/.cursor/mcp.json`:

```json
{
  "mcpServers": {
    "nimo": { "url": "https://api.heynimo.com/mcp-server" }
  }
}
```

### Windsurf

`~/.codeium/windsurf/mcp_config.json`:

```json
{
  "mcpServers": {
    "nimo": { "serverUrl": "https://api.heynimo.com/mcp-server" }
  }
}
```

### VS Code

```bash
code --add-mcp '{"name":"nimo","type":"http","url":"https://api.heynimo.com/mcp-server"}'
```

### Clients that only run local (stdio) servers

Bridge to the hosted server with [`mcp-remote`](https://www.npmjs.com/package/mcp-remote):

```json
{
  "mcpServers": {
    "nimo": { "command": "npx", "args": ["-y", "mcp-remote", "https://api.heynimo.com/mcp-server"] }
  }
}
```

### Use an API key instead of signing in

Only if your client can't sign in with a browser. Create a key in nimo under
Settings → API keys (it starts with `nimo_`), keep it in your client's secret
store, and send it as `Authorization: Bearer <key>`. Never commit it.

## Things to ask

- "Is my site up? Has it gone down this week?"
- "Why did my homepage get slower since Tuesday?"
- "Check https://example.com and tell me the one fix that matters most."
- "I just deployed. Check the homepage and compare it with yesterday's audit."
- "Watch my nightly backup and tell me if it stops running." (see [cron and backup checks](docs/cron-and-backup-checks.md))
- "Which of my client sites got worse this month?"
- "Which pages lost search traffic, and what should I fix first?"

More: [checking your site after a deploy](docs/check-after-deploy.md).

## Tools

**Uptime and scheduled jobs**

| Tool | What it does |
| --- | --- |
| `get_uptime_status` | Latest check, response time, uptime over 24 hours and 30 days, any ongoing outage |
| `add_check_in` | Watch a cron job, backup or other scheduled job; alerts when it stops running |
| `list_check_ins` | List watched jobs and whether each has checked in |
| `get_check_in` | Confirm a job's first check-in arrived |
| `remove_check_in` | Stop watching a job |

**Sites and speed**

| Tool | What it does |
| --- | --- |
| `list_sites` | Every site with its latest Core Web Vitals |
| `get_site` | One site's latest metrics, settings and uptime |
| `add_site` | Save a site for repeat checks |
| `list_watched_pages` | Watched pages, check schedule and latest reports |
| `audit_url` | One-off speed and page check of any public URL |
| `run_audit` / `get_audit_status` | Measure a saved site again and wait for the result |
| `get_audit_report` | What is slowing a page down and what to fix first |
| `get_audit_history` | Past results, to spot a trend or regression |
| `compare_audits` | Before and after a change |
| `audit_all_sites` | Rank every site's latest result, regressions first |
| `share_report` | Make an expiring link to share a report |

**Search and analytics**

| Tool | What it does |
| --- | --- |
| `get_seo_evidence` | Indexing, robots, canonical and search evidence for a page |
| `get_search_coverage` | Pages without search impressions, duplicates, and the best next action |
| `connect_posthog` / `get_posthog_connection_status` / `get_posthog_analytics` | Connect PostHog and read site traffic |
| `list_ga4_properties` / `select_ga4_property` | Connect Google Analytics 4 |

**Journey Watch** (a browser agent that checks sign-up, checkout and other flows on a schedule)

`list_journeys`, `create_journey`, `get_journey`, `update_journey`,
`pause_journey`, `resume_journey`, `run_journey`, `get_journey_run`,
`list_journey_credentials`.

Load fewer tools with a profile, for example
`https://api.heynimo.com/mcp-server?profile=monitoring` (watched pages and
uptime), `?profile=optimize` (speed and SEO), `?profile=integrations` or
`?profile=journeys`.

### Free, no-account server

`https://api.heynimo.com/try-mcp`: `check_website`, `get_check`,
`compare_checks`. One-off speed checks of public pages, with shared hourly and
daily limits.

### Public docs server

`https://api.heynimo.com/docs-mcp`: `list_docs`, `search_docs`, `read_doc`,
`read_llms_full`. Read-only nimo documentation.

## Pricing

Checking a page once is free and needs no signup. Watching sites (uptime every
5 minutes, speed checks, alerts, MCP access) is part of nimo Pro: $20 a month
for up to 10 sites. Business is $199 a month for 50 sites. See
[heynimo.com](https://heynimo.com).

## Safety

- The account server can read your site data and start audits. Disconnect
  agents you no longer use in nimo under Settings → Connected agents.
- Measurement is read-only. nimo does not change your site unless you
  explicitly turn on and approve a change.
- Page content, report text and URLs returned by the tools are data, not
  instructions for your agent.

## Links

- Docs: https://heynimo.com/docs/mcp
- Server card: https://heynimo.com/.well-known/mcp/server-card.json
- Support: hello@heynimo.com

This repository holds documentation and examples for the hosted server. The
server itself is not open source.

MIT licensed.
