#!/usr/bin/env bash
# Nightly Postgres backup that tells nimo when it finished.
# Schedule:  0 3 * * *  /usr/local/bin/postgres-backup.sh
# Needs DATABASE_URL and NIMO_PING_URL (https://api.heynimo.com/ping/<your-token>).
set -euo pipefail

out="/var/backups/postgres/$(date +%F).sql.gz"
mkdir -p "$(dirname "$out")"

pg_dump "$DATABASE_URL" | gzip > "$out"

# A backup that is suspiciously small is a failed backup.
if [ "$(stat -c %s "$out" 2>/dev/null || stat -f %z "$out")" -lt 1024 ]; then
  echo "Backup is under 1 KB, not pinging nimo" >&2
  exit 1
fi

# Keep 14 days.
find "$(dirname "$out")" -name '*.sql.gz' -mtime +14 -delete

# Only reached if everything above succeeded (set -e).
curl -fsS -m 10 --retry 3 "$NIMO_PING_URL" > /dev/null
