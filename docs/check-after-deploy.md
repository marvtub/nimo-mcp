# Check your site after a deploy with Claude, Cursor or Codex

After you ship, two questions matter: is the site still up, and did it get
slower? With the [nimo MCP server](../README.md) connected, your coding
assistant can answer both from real measurements.

## Ask

> I just deployed. Check the homepage and the pricing page, and compare them
> with the last audit before the deploy.

The assistant will typically:

1. `get_uptime_status`: confirm the site answers and there's no ongoing outage;
2. `run_audit` on the saved site (or `audit_url` for a page you haven't saved),
   then `get_audit_status` until it finishes;
3. `compare_audits` against the last audit from before the deploy, and report
   which metrics changed (Largest Contentful Paint, layout shift,
   responsiveness) and the one fix that matters most.

## Make it a habit

Install the [Claude skill](../skills/check-site-after-deploy/SKILL.md), or add
the [GitHub Action](../examples/github-actions/check-after-deploy.yml) so every
deploy gets checked without asking. Or add this to your project's `CLAUDE.md`
or `AGENTS.md`:

```markdown
After a production deploy, use the nimo MCP server: check uptime, run an audit
of the changed pages, and compare it with the previous audit. Report any page
that got slower and the main cause.
```

## Notes

- A one-off lab check can vary by a few hundred milliseconds. Compare like with
  like (same page, same device) and look at the trend with
  `get_audit_history` before acting on a small change.
- Real-visitor data (Chrome UX Report) moves over 28 days, so it won't show a
  deploy's effect the same day. Lab checks will.
- No account? `https://api.heynimo.com/try-mcp` gives you `check_website` and
  `compare_checks` for one-off before-and-after checks.
