# Know when a cron job or backup didn't run

A job that silently stops is worse than one that fails loudly: nothing errors,
nothing alerts, and you find out when you need the backup. The fix is a
"heartbeat" (also called a check-in, or dead man's switch): the job pings a URL
each time it finishes, and you get an alert when the ping doesn't arrive.

## With your AI assistant

With the [nimo MCP server](../README.md) connected, ask:

> Watch my nightly database backup and tell me if it stops running.

The assistant will:

1. call `add_check_in` with a name and how often the job runs (`hour`, `day`
   or `week`) and get a ping URL;
2. add the ping to the end of the job's command;
3. run the job once and call `get_check_in` to confirm the first ping arrived.

## By hand

Add the ping to the **end** of the command, joined with `&&`:

```cron
0 3 * * * /usr/local/bin/backup.sh && curl -fsS https://api.heynimo.com/ping/<your-token>
```

- `&&` means the ping is only sent if the job **succeeded**. Never use `;`,
  which pings even when the job failed.
- `curl -fsS` stays quiet on success and fails on an HTTP error.

Other schedulers work the same way: a GitHub Actions step at the end of the
workflow, the last line of a Kubernetes CronJob command, or a request at the
end of a serverless function.

## When you get an alert

nimo allows some slack before alerting, so a job that runs a little late
doesn't page you:

| Job runs | Alert if no ping within |
| --- | --- |
| Every hour | 1 hour + 15 minutes |
| Every day | 1 day + 2 hours |
| Every week | 1 week + 6 hours |

## Check your jobs later

> Which of my scheduled jobs haven't checked in?

`list_check_ins` lists every watched job and whether it checked in on time.
`remove_check_in` stops watching one.
