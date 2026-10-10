<p align="center">
  <img src=".github/assets/banner.jpg" alt="Hear it from nimo, not your customers. nimo pops out of a phone with a notification: your pricing page got 2 s slower, here's the fix." width="100%">
</p>

<p align="center">
  <a href="https://cursor.com/en/install-mcp?name=nimo&config=eyJ1cmwiOiJodHRwczovL2FwaS5oZXluaW1vLmNvbS9tY3Atc2VydmVyIn0="><img src="https://cursor.com/deeplink/mcp-install-dark.svg" alt="Add nimo to Cursor" height="32"></a>
  <a href="https://insiders.vscode.dev/redirect/mcp/install?name=nimo&config=%7B%22type%22%3A%22http%22%2C%22url%22%3A%22https%3A//api.heynimo.com/mcp-server%22%7D"><img src="https://img.shields.io/badge/VS_Code-Install_nimo-0098FF?style=for-the-badge&logo=data:image/svg%2bxml;base64,PHN2ZyBmaWxsPSIjRkZGRkZGIiByb2xlPSJpbWciIHZpZXdCb3g9IjAgMCAyNCAyNCIgeG1sbnM9Imh0dHA6Ly93d3cudzMub3JnLzIwMDAvc3ZnIj48cGF0aCBkPSJNMjMuMTUgMi41ODdMMTguMjEuMjFhMS40OTQgMS40OTQgMCAwIDAtMS43MDUuMjlsLTkuNDYgOC42My00LjEyLTMuMTI4YS45OTkuOTk5IDAgMCAwLTEuMjc2LjA1N0wuMzI3IDcuMjYxQTEgMSAwIDAgMCAuMzI2IDguNzRMMy44OTkgMTIgLjMyNiAxNS4yNmExIDEgMCAwIDAgLjAwMSAxLjQ3OWwxLjMyMyAxLjIwMmEuOTk5Ljk5OSAwIDAgMCAxLjI3Ny4wNTdsNC4xMi0zLjEyOCA5LjQ2IDguNjNhMS40OTIgMS40OTIgMCAwIDAgMS43MDQuMjlsNC45NDItMi4zNzdBMS41IDEuNSAwIDAgMCAyNCAyMC4wNlYzLjkzOWExLjUgMS41IDAgMCAwLS44NS0xLjM1MnptLTUuMTQ2IDE0Ljg2MUwxMC44MjYgMTJsNy4xNzgtNS40NDh2MTAuODk2eiIvPjwvc3ZnPg==" alt="Install nimo in VS Code" height="32"></a>
</p>

# nimo MCP server: website uptime, speed and cron job monitoring for Claude, ChatGPT and Cursor

**Hear it from nimo, not your customers.** When a page gets slow, checkout
breaks or a backup doesn't run, nimo tells you first, in plain words, with the
fix.

Ask your AI assistant "is my site up?", "why did my homepage get slower?" or
"did last night's backup run?" and get an answer from real checks, not a guess.

[nimo](https://heynimo.com) checks that your site loads every 5 minutes,
double-checks before it alerts you, and messages you in Slack or Telegram when
it goes down and again when it's back. It also tracks how fast your key pages
load (Core Web Vitals, from real Chrome visitors when available, plus
Lighthouse), and watches scheduled jobs such as backups and cron jobs. This
MCP server gives Claude, ChatGPT, Cursor, Codex and other assistants access
to all of it.

```
https://api.heynimo.com/mcp-server
```

Hosted, remote (streamable HTTP), nothing to install. You sign in with your
browser; no API key needed.

## Try it without an account

**In your assistant:** connect `https://api.heynimo.com/try-mcp` and ask
"What is slowing down https://example.com?"

**In your terminal** (Node 18+, nothing to install):

```console
$ npx github:marvtub/nimo-mcp https://heynimo.com
Checking...

nimo check: https://heynimo.com (mobile)

  Performance score        87        needs work
  Largest paint (LCP)      3.5 s     needs work
  Layout shift (CLS)       0         good
  Server response (TTFB)   5 ms      good

LCP is above the good threshold and Lighthouse identified a text LCP element.
No image resource was identified for this element. [...]

Watch this page every 5 minutes with alerts in Slack or Telegram: https://heynimo.com
```

Add `--min-score 70` to exit with an error when a page gets slow, or `--json`
for scripts. Free checks have hourly and daily limits.

## What's in this repo

| | What it's for |
| --- | --- |
| [Setup for your assistant](#set-up) | Connect nimo to Claude, ChatGPT, Cursor, Codex, Windsurf or VS Code |
| [`nimo-check` CLI](bin/nimo-check.mjs) | One free speed check from the terminal or any CI |
| [GitHub Action](#github-action-check-your-site-after-every-deploy) | Check the live site after every deploy, result in the run summary |
| [Claude skill](skills/check-site-after-deploy/SKILL.md) | Teaches Claude to check uptime and speed after you ship |
| [Cron and backup examples](examples/heartbeats) | crontab, Postgres backup, GitHub Actions schedule, Kubernetes CronJob, Node |
| [Guides](docs) | [Know when a cron job didn't run](docs/cron-and-backup-checks.md), [check your site after a deploy](docs/check-after-deploy.md) |

## Things to ask

- "Is my site up? Has it gone down this week?"
- "Why did my homepage get slower since Tuesday?"
- "Check https://example.com and tell me the one fix that matters most."
- "I just deployed. Check the homepage and compare it with yesterday's audit."
- "Watch my nightly backup and tell me if it stops running." ([how it works](docs/cron-and-backup-checks.md))
- "Which of my client sites got worse this month?"
- "Which pages lost search traffic, and what should I fix first?"

## Set up

<details open>
<summary><b>Claude Code</b></summary>

```bash
claude mcp add --transport http --scope user nimo https://api.heynimo.com/mcp-server
claude mcp login nimo
```

</details>

<details>
<summary><b>Claude (desktop and web)</b></summary>

Settings → Connectors → Add custom connector → paste
`https://api.heynimo.com/mcp-server`, then approve the sign-in.

</details>

<details>
<summary><b>ChatGPT</b></summary>

Add a connector with the URL `https://api.heynimo.com/mcp-server` (Settings →
Apps & Connectors; custom connectors need developer mode on some plans), then
approve the sign-in.

</details>

<details>
<summary><b>Codex</b></summary>

```bash
codex mcp add nimo --url https://api.heynimo.com/mcp-server
```

</details>

<details>
<summary><b>Cursor</b></summary>

Use the **Add to Cursor** button above, or add to `~/.cursor/mcp.json`:

```json
{
  "mcpServers": {
    "nimo": { "url": "https://api.heynimo.com/mcp-server" }
  }
}
```

</details>

<details>
<summary><b>Windsurf</b></summary>

`~/.codeium/windsurf/mcp_config.json`:

```json
{
  "mcpServers": {
    "nimo": { "serverUrl": "https://api.heynimo.com/mcp-server" }
  }
}
```

</details>

<details>
<summary><b>VS Code</b></summary>

Use the **Install** button above, or:

```bash
code --add-mcp '{"name":"nimo","type":"http","url":"https://api.heynimo.com/mcp-server"}'
```

</details>

<details>
<summary><b>Clients that only run local (stdio) servers</b></summary>

Bridge to the hosted server with [`mcp-remote`](https://www.npmjs.com/package/mcp-remote):

```json
{
  "mcpServers": {
    "nimo": { "command": "npx", "args": ["-y", "mcp-remote", "https://api.heynimo.com/mcp-server"] }
  }
}
```

</details>

<details>
<summary><b>Use an API key instead of signing in</b></summary>

Only if your client can't sign in with a browser. Create a key in nimo under
Settings → API keys (it starts with `nimo_`), keep it in your client's secret
store, and send it as `Authorization: Bearer <key>`. Never commit it.

</details>

## GitHub Action: check your site after every deploy

```yaml
on: deployment_status

jobs:
  check:
    if: github.event.deployment_status.state == 'success'
    runs-on: ubuntu-latest
    steps:
      - uses: marvtub/nimo-mcp@v1
        with:
          url: ${{ github.event.deployment_status.environment_url }}
          min-score: 50   # optional: fail if the page gets much slower
```

The score, LCP, layout shift, server response and the fix to make first show
up in the run summary, and as the outputs `score`, `lcp-ms`, `cls` and
`ttfb-ms`. Free, no key or secret. Full example:
[`examples/github-actions/check-after-deploy.yml`](examples/github-actions/check-after-deploy.yml).

## Claude skill: check the site after you ship

```bash
mkdir -p ~/.claude/skills/check-site-after-deploy
curl -fsSL https://raw.githubusercontent.com/marvtub/nimo-mcp/main/skills/check-site-after-deploy/SKILL.md \
  -o ~/.claude/skills/check-site-after-deploy/SKILL.md
```

Then tell Claude "I just deployed" and it checks uptime, measures the changed
pages again and compares them with the last check before the deploy.

## Know when a cron job or backup didn't run

Ask "watch my nightly backup", and add the ping URL you get to the end of the
job:

```cron
0 3 * * * /usr/local/bin/backup.sh && curl -fsS https://api.heynimo.com/ping/<your-token>
```

If the ping doesn't arrive on time, nimo alerts you. Copy-paste versions for
[crontab](examples/heartbeats/crontab.txt),
[a Postgres backup](examples/heartbeats/postgres-backup.sh),
[GitHub Actions](examples/heartbeats/github-actions-schedule.yml),
[Kubernetes](examples/heartbeats/kubernetes-cronjob.yaml) and
[Node](examples/heartbeats/node-job.mjs).

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

This repository holds the docs, examples, the `nimo-check` CLI and the GitHub
Action, all MIT licensed. The hosted server itself is not open source.
