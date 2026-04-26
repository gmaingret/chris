#!/usr/bin/env bash
# Run the full test suite with a real database.
# Starts a local postgres via docker-compose, runs migrations, then vitest.
set -euo pipefail

COMPOSE_FILE="docker-compose.local.yml"
DB_URL="postgresql://chris:localtest123@localhost:5433/chris"
MIGRATION_SQL="src/db/migrations/0000_curved_colonel_america.sql"
ENUM_FIX_SQL="src/db/migrations/0001_add_photos_psychology_mode.sql"
MIGRATION_2_SQL="src/db/migrations/0002_decision_archive.sql"
MIGRATION_3_SQL="src/db/migrations/0003_add_decision_epistemic_tag.sql"
MIGRATION_4_SQL="src/db/migrations/0004_decision_trigger_suppressions.sql"
MIGRATION_5_SQL="src/db/migrations/0005_episodic_summaries.sql"
MIGRATION_6_SQL="src/db/migrations/0006_rituals_wellbeing.sql"

cleanup() {
  echo "🧹 Stopping test postgres..."
  docker compose -f "$COMPOSE_FILE" down --timeout 5 2>/dev/null || true
}
trap cleanup EXIT

echo "🐘 Starting test postgres..."
docker compose -f "$COMPOSE_FILE" up -d postgres

# Wait for postgres to be ready
ready=0
for i in $(seq 1 30); do
  if docker compose -f "$COMPOSE_FILE" exec postgres pg_isready -U chris -d chris -q 2>/dev/null; then
    ready=1
    break
  fi
  sleep 1
done
if [ "$ready" -ne 1 ]; then
  echo "❌ postgres failed to become ready after 30s" >&2
  exit 1
fi

echo "📦 Running migrations..."
# -v ON_ERROR_STOP=1 forces psql to exit non-zero on SQL errors (without it,
# psql exits 0 even on failure, which defeats `set -euo pipefail` and silently
# proceeds to run vitest against a half-migrated schema).
docker compose -f "$COMPOSE_FILE" exec -T postgres \
  psql -U chris -d chris -v ON_ERROR_STOP=1 -q -c "CREATE EXTENSION IF NOT EXISTS vector;"
docker compose -f "$COMPOSE_FILE" exec -T postgres \
  psql -U chris -d chris -v ON_ERROR_STOP=1 -q < "$MIGRATION_SQL"
docker compose -f "$COMPOSE_FILE" exec -T postgres \
  psql -U chris -d chris -v ON_ERROR_STOP=1 -q < "$ENUM_FIX_SQL"
docker compose -f "$COMPOSE_FILE" exec -T postgres \
  psql -U chris -d chris -v ON_ERROR_STOP=1 -q < "$MIGRATION_2_SQL"
docker compose -f "$COMPOSE_FILE" exec -T postgres \
  psql -U chris -d chris -v ON_ERROR_STOP=1 -q < "$MIGRATION_3_SQL"
docker compose -f "$COMPOSE_FILE" exec -T postgres \
  psql -U chris -d chris -v ON_ERROR_STOP=1 -q < "$MIGRATION_4_SQL"
docker compose -f "$COMPOSE_FILE" exec -T postgres \
  psql -U chris -d chris -v ON_ERROR_STOP=1 -q < "$MIGRATION_5_SQL"
docker compose -f "$COMPOSE_FILE" exec -T postgres \
  psql -U chris -d chris -v ON_ERROR_STOP=1 -q < "$MIGRATION_6_SQL"

# Phase 25 (M009 v2.4) — post-migration substrate smoke gate.
# Per HARD CO-LOCATION CONSTRAINT #7 + Pitfall 28: the SQL migration, the
# meta snapshot, AND this assertion line all ship in the same plan. Splitting
# any of the three reproduces TECH-DEBT-19-01 lineage breakage. The gate runs
# BEFORE `npx vitest run` so a substrate failure aborts the whole test suite
# (catches lineage mismatches before any false-positive type-checked tests).
echo "🔍 Verifying migration 0006 substrate..."
docker compose -f "$COMPOSE_FILE" exec -T postgres \
  psql -U chris -d chris -v ON_ERROR_STOP=1 -tAq -c "
    SELECT
      (SELECT COUNT(*) FROM information_schema.tables
       WHERE table_schema = 'public'
       AND table_name IN ('rituals', 'wellbeing_snapshots', 'ritual_responses',
                          'ritual_fire_events', 'ritual_config_events', 'ritual_pending_responses')) AS table_count,
      (SELECT COUNT(*) FROM pg_enum
       WHERE enumlabel = 'RITUAL_RESPONSE'
       AND enumtypid = (SELECT oid FROM pg_type WHERE typname = 'epistemic_tag')) AS enum_value_count,
      (SELECT COUNT(*) FROM pg_indexes
       WHERE schemaname = 'public'
       AND indexname IN ('rituals_next_run_at_enabled_idx',
                         'wellbeing_snapshots_snapshot_date_idx',
                         'ritual_responses_ritual_id_fired_at_idx')) AS index_count;
  " | tee /tmp/m009_smoke.txt
grep -q "^6|1|3$" /tmp/m009_smoke.txt || { echo "❌ Migration 0006 substrate incomplete"; exit 1; }
echo "✓ Migration 0006 substrate verified (6 tables + 1 enum value + 3 indexes)"

echo "🧪 Running tests..."
DATABASE_URL="$DB_URL" \
  ANTHROPIC_API_KEY="${ANTHROPIC_API_KEY:-test-key}" \
  TELEGRAM_BOT_TOKEN="${TELEGRAM_BOT_TOKEN:-test-token}" \
  TELEGRAM_AUTHORIZED_USER_ID="${TELEGRAM_AUTHORIZED_USER_ID:-99999}" \
  npx vitest run "$@"
