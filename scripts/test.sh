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
MIGRATION_7_SQL="src/db/migrations/0007_daily_voice_note_seed.sql"
MIGRATION_8_SQL="src/db/migrations/0008_wellbeing_seed.sql"
MIGRATION_9_SQL="src/db/migrations/0009_weekly_review_seed.sql"
MIGRATION_10_SQL="src/db/migrations/0010_adjustment_dialogue.sql"
MIGRATION_11_SQL="src/db/migrations/0011_rename_daily_voice_note_to_journal.sql"

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
docker compose -f "$COMPOSE_FILE" exec -T postgres \
  psql -U chris -d chris -v ON_ERROR_STOP=1 -q < "$MIGRATION_7_SQL"
docker compose -f "$COMPOSE_FILE" exec -T postgres \
  psql -U chris -d chris -v ON_ERROR_STOP=1 -q < "$MIGRATION_8_SQL"
docker compose -f "$COMPOSE_FILE" exec -T postgres \
  psql -U chris -d chris -v ON_ERROR_STOP=1 -q < "$MIGRATION_9_SQL"
docker compose -f "$COMPOSE_FILE" exec -T postgres \
  psql -U chris -d chris -v ON_ERROR_STOP=1 -q < "$MIGRATION_10_SQL"
docker compose -f "$COMPOSE_FILE" exec -T postgres \
  psql -U chris -d chris -v ON_ERROR_STOP=1 -q < "$MIGRATION_11_SQL"

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

# Phase 26 (M009 v2.4) + Phase 31 (D-31-05) — journal seed row + PP#5 partial
# index + prompt_text column gate. Migration 0007 seeds daily_voice_note;
# migration 0011 renames it to daily_journal. Gate asserts the renamed row
# post-0011. Failure exits BEFORE vitest (catches lineage mismatches before any
# false-positive type-checked tests).
SEED_CHECK=$(docker compose -f "$COMPOSE_FILE" exec -T postgres \
  psql -U chris -d chris -tAc \
  "SELECT name FROM rituals WHERE name = 'daily_journal' LIMIT 1;")

if [[ "$SEED_CHECK" != "daily_journal" ]]; then
  echo "❌ FAIL: daily_journal seed row missing after migration 0011 (got: '$SEED_CHECK')"
  exit 1
fi

INDEX_CHECK=$(docker compose -f "$COMPOSE_FILE" exec -T postgres \
  psql -U chris -d chris -tAc \
  "SELECT indexname FROM pg_indexes WHERE indexname = 'ritual_pending_responses_chat_id_active_idx';")

if [[ "$INDEX_CHECK" != "ritual_pending_responses_chat_id_active_idx" ]]; then
  echo "❌ FAIL: PP#5 partial index missing after migration 0007 (got: '$INDEX_CHECK')"
  exit 1
fi

# Amended D-26-02 (2026-04-27): verify prompt_text column exists and is NOT NULL
PROMPT_TEXT_CHECK=$(docker compose -f "$COMPOSE_FILE" exec -T postgres \
  psql -U chris -d chris -tAc \
  "SELECT column_name FROM information_schema.columns
   WHERE table_name='ritual_pending_responses' AND column_name='prompt_text' AND is_nullable='NO' LIMIT 1;")

if [[ "$PROMPT_TEXT_CHECK" != "prompt_text" ]]; then
  echo "❌ FAIL: ritual_pending_responses.prompt_text NOT NULL column missing after migration 0007 (got: '$PROMPT_TEXT_CHECK')"
  exit 1
fi

echo "PASS: Phase 26/31 migration 0007+0011 substrate verified (daily_journal + partial index + prompt_text column)"

# Phase 27 (M009 v2.4) — wellbeing seed assertion (D-27-01). Single-line gate
# mirrors Phase 26 journal seed shape: failure exits BEFORE vitest so a
# missing daily_wellbeing seed row blocks the test suite.
psql_seed_count=$(docker compose -f "$COMPOSE_FILE" exec -T postgres \
  psql -U chris -d chris -tAc "SELECT count(*) FROM rituals WHERE name = 'daily_wellbeing'")
if [[ "${psql_seed_count// /}" != "1" ]]; then
  echo "❌ MIGRATION 0008: daily_wellbeing seed missing (got: '${psql_seed_count}')"
  exit 1
fi
echo "✓ Migration 0008 substrate verified (daily_wellbeing seeded)"

# Phase 29 (M009 v2.4) — weekly_review seed assertion (D-09 / WEEK-01 fire-side).
# Single-line gate mirrors Phase 26 journal + Phase 27 wellbeing seed shapes:
# failure exits BEFORE vitest so a missing weekly_review seed row blocks the test
# suite (catches lineage mismatches before any false-positive type-checked tests).
# The gate runs after migration 0009 apply.
echo "🔍 Verifying Phase 29 weekly_review seed row..."
SEED_CHECK=$(docker compose -f "$COMPOSE_FILE" exec -T postgres \
  psql -U chris -d chris -v ON_ERROR_STOP=1 -tAq \
  -c "SELECT count(*) FROM rituals WHERE name = 'weekly_review';" | tr -d '[:space:]')
if [[ "$SEED_CHECK" != "1" ]]; then
  echo "❌ FAIL: weekly_review seed row missing (got count=$SEED_CHECK, expected 1)"
  exit 1
fi
echo "✓ Phase 29 seed-row gate: weekly_review present"

# Phase 28 (M009 v2.4) — adjustment dialogue substrate gate.
# Migration 0010 adds metadata jsonb column to ritual_pending_responses
# (RESEARCH Landmine 2 — column did not exist before Phase 28). Plan 28-03
# depends on this column being present for PP#5 dispatch by metadata.kind.
# Failure exits BEFORE vitest so a missing column blocks the test suite.
METADATA_COL_CHECK=$(docker compose -f "$COMPOSE_FILE" exec -T postgres \
  psql -U chris -d chris -tAc \
  "SELECT column_name FROM information_schema.columns
   WHERE table_name='ritual_pending_responses' AND column_name='metadata' LIMIT 1;")

if [[ "$METADATA_COL_CHECK" != "metadata" ]]; then
  echo "❌ FAIL: ritual_pending_responses.metadata column missing after migration 0010 (got: '$METADATA_COL_CHECK')"
  exit 1
fi

METADATA_IDX_CHECK=$(docker compose -f "$COMPOSE_FILE" exec -T postgres \
  psql -U chris -d chris -tAc \
  "SELECT indexname FROM pg_indexes WHERE indexname = 'ritual_pending_responses_adjustment_confirmation_idx';")

if [[ "$METADATA_IDX_CHECK" != "ritual_pending_responses_adjustment_confirmation_idx" ]]; then
  echo "❌ FAIL: adjustment_confirmation partial index missing after migration 0010 (got: '$METADATA_IDX_CHECK')"
  exit 1
fi

echo "✓ Phase 28 migration 0010 substrate verified (metadata column + adjustment_confirmation partial index)"

# Phase 27 D-27-04 anchor-bias defeat regression guard (Plan 27-03 Task 3).
# Fails loud if src/rituals/wellbeing.ts ever contains a SELECT against
# wellbeing_snapshots. The "hide previous values" contract (Pitfall 11) is
# enforced by absence-of-code, not by added code. Three independent
# regression-defense lines: in-plan negative grep (Plan 27-02 verify block),
# test-suite db.select spy (Plan 27-03 Test 2 in wellbeing.test.ts), and
# this static guard (every CI run). Any one would catch a regression
# independently. Regex matches both Drizzle camelCase (wellbeingSnapshots)
# and SQL snake_case (wellbeing_snapshots) usage. Bare `import` lines do
# NOT match (the regex requires `select.*` or `from.*` preceding the table
# name) — only actual SELECT/FROM usage triggers the failure.
if grep -E "select.*wellbeingSnapshots|from.*wellbeingSnapshots" src/rituals/wellbeing.ts; then
  echo "❌ ANCHOR-BIAS VIOLATION: src/rituals/wellbeing.ts queries wellbeing_snapshots for SELECT."
  echo "   Per D-27-04 (Pitfall 11), the wellbeing module MUST NOT read prior days' values."
  echo "   Hide-previous-values is enforced by absence of code, not by added code."
  exit 1
fi
echo "✓ Anchor-bias defeat regression guard verified (D-27-04 prong 1)"

echo "🧪 Running tests..."
DATABASE_URL="$DB_URL" \
  ANTHROPIC_API_KEY="${ANTHROPIC_API_KEY:-test-key}" \
  TELEGRAM_BOT_TOKEN="${TELEGRAM_BOT_TOKEN:-test-token}" \
  TELEGRAM_AUTHORIZED_USER_ID="${TELEGRAM_AUTHORIZED_USER_ID:-99999}" \
  npx vitest run "$@"
