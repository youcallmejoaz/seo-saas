#!/usr/bin/env bash
# Starts a throwaway Postgres 16 in ./.pgdata on port 54329 and applies the Supabase
# stub + migrations. Used by `pnpm test:db` when Docker / the Supabase CLI is unavailable.
set -euo pipefail
PGBIN="${PGBIN:-$(ls -d /usr/lib/postgresql/*/bin 2>/dev/null | sort -V | tail -1)}"
DATA="${PGDATA_DIR:-${TMPDIR:-/tmp}/seo-saas-pgdata}"
PORT="${PGPORT:-54339}"
# Postgres refuses to run as root; drop to the `postgres` system user when needed.
AS=()
if [ "$(id -u)" = "0" ]; then AS=(runuser -u postgres --); fi
if [ ! -d "$DATA" ]; then
  mkdir -p "$DATA"
  if [ "$(id -u)" = "0" ]; then chown postgres "$DATA"; fi
  "${AS[@]}" "$PGBIN/initdb" -D "$DATA" -U postgres --auth=trust >/dev/null
fi
# (Re)start so the cluster always listens on $PORT.
"${AS[@]}" "$PGBIN/pg_ctl" -D "$DATA" stop >/dev/null 2>&1 || true
"${AS[@]}" "$PGBIN/pg_ctl" -D "$DATA" -o "-p $PORT -k /tmp" -l "$DATA/log" -w start >/dev/null
export PGHOST=/tmp PGPORT="$PORT" PGUSER=postgres
psql -q -d postgres -c "drop database if exists seo_saas_test" -c "create database seo_saas_test"
psql -q -v ON_ERROR_STOP=1 -d seo_saas_test -f tests/db/supabase-stub.sql
for f in supabase/migrations/*.sql; do
  psql -q -v ON_ERROR_STOP=1 -d seo_saas_test -f "$f"
done
echo "postgres://postgres@localhost:$PORT/seo_saas_test"
