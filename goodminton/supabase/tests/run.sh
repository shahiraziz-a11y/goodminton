#!/usr/bin/env bash
# Runs the SQL tests against a throwaway database on a local Postgres 15+.
# Usage: supabase/tests/run.sh [psql connection args...]   e.g. -h localhost -p 5432 -U postgres
set -euo pipefail
cd "$(dirname "$0")"
DB=goodminton_test_$$
psql -X -q "$@" -c "create database $DB" >/dev/null
trap 'psql -X -q "$@" -c "drop database $DB" >/dev/null' EXIT
psql -X -q -v ON_ERROR_STOP=1 "$@" -d "$DB" -c "do \$\$ begin
  if not exists (select from pg_roles where rolname = 'anon') then create role anon nologin; end if;
  if not exists (select from pg_roles where rolname = 'authenticated') then create role authenticated nologin; end if;
end \$\$" >/dev/null
psql -X -q -v ON_ERROR_STOP=1 "$@" -d "$DB" -f auth_stub.sql >/dev/null
for f in ../migrations/*.sql; do psql -X -q -v ON_ERROR_STOP=1 "$@" -d "$DB" -f "$f" >/dev/null; done
psql -X -q -v ON_ERROR_STOP=1 "$@" -d "$DB" -f match_flow.sql
psql -X -q -v ON_ERROR_STOP=1 "$@" -d "$DB" -f games_flow.sql
psql -X -q -v ON_ERROR_STOP=1 "$@" -d "$DB" -f edit_flow.sql
psql -X -q -v ON_ERROR_STOP=1 "$@" -d "$DB" -f push_flow.sql
psql -X -q -v ON_ERROR_STOP=1 "$@" -d "$DB" -f sponsor_flow.sql
psql -X -q -v ON_ERROR_STOP=1 "$@" -d "$DB" -f court_booking.sql
psql -X -q -v ON_ERROR_STOP=1 "$@" -d "$DB" -f court_booking_more.sql
psql -X -q -v ON_ERROR_STOP=1 "$@" -d "$DB" -f organiser_dropout.sql
psql -X -q -v ON_ERROR_STOP=1 "$@" -d "$DB" -f pairing.sql
psql -X -q -v ON_ERROR_STOP=1 "$@" -d "$DB" -f scheduled.sql
psql -X -q -v ON_ERROR_STOP=1 "$@" -d "$DB" -f email_flow.sql
psql -X -q -v ON_ERROR_STOP=1 "$@" -d "$DB" -f tap_spot.sql
psql -X -q -v ON_ERROR_STOP=1 "$@" -d "$DB" -f home_stats.sql
psql -X -q -v ON_ERROR_STOP=1 "$@" -d "$DB" -f no_regulars.sql
psql -X -q -v ON_ERROR_STOP=1 "$@" -d "$DB" -f groups.sql
psql -X -q -v ON_ERROR_STOP=1 "$@" -d "$DB" -f extras.sql
./concurrency.sh "$@" -d "$DB"
./concurrency_booking.sh "$@" -d "$DB"
./upgrade_0009.sh "$@"
./upgrade_0017.sh "$@"
