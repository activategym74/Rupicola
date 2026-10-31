#!/usr/bin/env bash
# Aplica migraciones en una base limpia y ejecuta las pruebas SQL.
# Uso: PGHOST=... PGPORT=... PGUSER=postgres supabase/tests/run.sh
set -euo pipefail
cd "$(dirname "$0")/../.."
DB=${TEST_DB:-rupicola_test}
psql -q -d postgres -c "drop database if exists $DB" -c "create database $DB"
for f in supabase/tests/00_stub_supabase.sql supabase/migrations/*.sql; do
  psql -q -v ON_ERROR_STOP=1 -d "$DB" -f "$f" >/dev/null
done
psql -q -v ON_ERROR_STOP=1 -d "$DB" -f supabase/tests/01_flujo_completo.sql 2>&1 | grep -E "ok ·|FALL|ERROR|TODAS"
