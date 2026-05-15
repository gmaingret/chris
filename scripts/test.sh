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
MIGRATION_12_SQL="src/db/migrations/0012_operational_profiles.sql"
MIGRATION_13_SQL="src/db/migrations/0013_psychological_profiles.sql"
MIGRATION_14_SQL="src/db/migrations/0014_psychological_data_consistency_column.sql"
MIGRATION_15_SQL="src/db/migrations/0015_psychological_check_constraints.sql"

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

# Phase 32 #3 — CI monotonic-`when` guardrail. Catches stale-`when` typos in
# src/db/migrations/meta/_journal.json before they break drizzle apply order.
# Runs BEFORE migrations apply so a journal-level mistake fails fast and does
# not corrupt the test database with a half-applied or out-of-order schema.
echo "🔍 Verifying migrations journal monotonicity (Phase 32 #3)..."
npx tsx scripts/validate-journal-monotonic.ts

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
docker compose -f "$COMPOSE_FILE" exec -T postgres \
  psql -U chris -d chris -v ON_ERROR_STOP=1 -q < "$MIGRATION_12_SQL"
docker compose -f "$COMPOSE_FILE" exec -T postgres \
  psql -U chris -d chris -v ON_ERROR_STOP=1 -q < "$MIGRATION_13_SQL"
# Phase 43 Plan 02 / CONTRACT-03 — data_consistency column on the 3 psych tables.
# HARD CO-LOC #M11-1: this apply line + schema.ts dataConsistency column adds +
# 0014_*.sql + meta/0014_snapshot.json + _journal.json idx-14 entry ALL ship
# atomically in Plan 43-02 Task 3.
docker compose -f "$COMPOSE_FILE" exec -T postgres \
  psql -U chris -d chris -v ON_ERROR_STOP=1 -q < "$MIGRATION_14_SQL"
# Phase 45 Plan 01 / SCHEMA-01 — 19 per-dim CHECK constraints on psychological
# jsonb columns (defense-in-depth behind Zod v3 read-time parse).
# HARD CO-LOC #M11-45a: this apply line + 0015_*.sql + meta/0015_snapshot.json +
# _journal.json idx-15 entry + the 19-constraint smoke gate below ALL ship
# atomically in Plan 45-01 (CONTEXT D-04/D-18; slot 0015 because Phase 43 owns 0014).
docker compose -f "$COMPOSE_FILE" exec -T postgres \
  psql -U chris -d chris -v ON_ERROR_STOP=1 -q < "$MIGRATION_15_SQL"

# Phase 45 SCHEMA-01 — post-migration CHECK-constraint smoke gate.
# Per HARD CO-LOC #M11-45a: SQL migration + journal entry + this assertion
# all ship together. Validates that all 19 new per-dim bounds constraints
# (6 HEXACO + 10 Schwartz + 3 attachment) exist after migration apply.
echo "🔍 Verifying migration 0015 CHECK constraints..."
docker compose -f "$COMPOSE_FILE" exec -T postgres \
  psql -U chris -d chris -v ON_ERROR_STOP=1 -tAq -c "
    SELECT COUNT(*) FROM information_schema.check_constraints
    WHERE constraint_name LIKE 'profile_hexaco_%_bounds'
      AND constraint_name <> 'profile_hexaco_overall_confidence_bounds'
      AND constraint_name <> 'profile_hexaco_data_consistency_bounds';
  " | grep -q '^6$' || { echo '❌ Expected 6 profile_hexaco per-dim bounds constraints (HEXACO 6 dims); see migration 0015'; exit 1; }
docker compose -f "$COMPOSE_FILE" exec -T postgres \
  psql -U chris -d chris -v ON_ERROR_STOP=1 -tAq -c "
    SELECT COUNT(*) FROM information_schema.check_constraints
    WHERE constraint_name LIKE 'profile_schwartz_%_bounds'
      AND constraint_name <> 'profile_schwartz_overall_confidence_bounds'
      AND constraint_name <> 'profile_schwartz_data_consistency_bounds';
  " | grep -q '^10$' || { echo '❌ Expected 10 profile_schwartz per-dim bounds constraints (Schwartz 10 dims); see migration 0015'; exit 1; }
docker compose -f "$COMPOSE_FILE" exec -T postgres \
  psql -U chris -d chris -v ON_ERROR_STOP=1 -tAq -c "
    SELECT COUNT(*) FROM information_schema.check_constraints
    WHERE constraint_name LIKE 'profile_attachment_%_bounds'
      AND constraint_name <> 'profile_attachment_overall_confidence_bounds'
      AND constraint_name <> 'profile_attachment_data_consistency_bounds';
  " | grep -q '^3$' || { echo '❌ Expected 3 profile_attachment per-dim bounds constraints (attachment 3 dims); see migration 0015'; exit 1; }
echo "✅ Migration 0015 CHECK constraints verified (6+10+3 = 19 per-dim bounds)"

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

# Phase 33 (M010 v2.5) — operational profiles substrate smoke gate.
# HARD CO-LOCATION #M10-1: this gate ships in the SAME plan as the migration
# SQL + drizzle meta snapshot + schema.ts table defs. Failure exits BEFORE
# vitest (mirrors Phase 25 0006 substrate gate at line ~88).
#
# Asserts (matched format ^5|1|1|1|1|0|0.3|0.2|0|0$):
#   - 5 tables exist (4 profile_* + 1 profile_history)
#   - Each of 4 profile_* tables has exactly 1 row WHERE name='primary'
#   - profile_history has 0 rows (write-only in Phase 33; D-18)
#   - Seed confidence values match D-10 mapping (jur=0.3, cap=0.2, hea/fam=0)
echo "🔍 Verifying migration 0012 substrate..."
docker compose -f "$COMPOSE_FILE" exec -T postgres \
  psql -U chris -d chris -v ON_ERROR_STOP=1 -tAq -c "
    SELECT
      (SELECT COUNT(*) FROM information_schema.tables
       WHERE table_schema = 'public'
       AND table_name IN ('profile_jurisdictional', 'profile_capital',
                          'profile_health', 'profile_family',
                          'profile_history')) AS table_count,
      (SELECT COUNT(*) FROM profile_jurisdictional WHERE name = 'primary') AS jur_seed,
      (SELECT COUNT(*) FROM profile_capital WHERE name = 'primary') AS cap_seed,
      (SELECT COUNT(*) FROM profile_health WHERE name = 'primary') AS hea_seed,
      (SELECT COUNT(*) FROM profile_family WHERE name = 'primary') AS fam_seed,
      (SELECT COUNT(*) FROM profile_history) AS hist_count,
      (SELECT confidence::text FROM profile_jurisdictional WHERE name = 'primary') AS jur_conf,
      (SELECT confidence::text FROM profile_capital WHERE name = 'primary') AS cap_conf,
      (SELECT confidence::text FROM profile_health WHERE name = 'primary') AS hea_conf,
      (SELECT confidence::text FROM profile_family WHERE name = 'primary') AS fam_conf;
  " | tee /tmp/m010_smoke.txt
grep -q "^5|1|1|1|1|0|0.3|0.2|0|0$" /tmp/m010_smoke.txt || { echo "❌ Migration 0012 substrate incomplete or seed values wrong"; cat /tmp/m010_smoke.txt; exit 1; }
echo "✓ Migration 0012 substrate verified (5 tables + 4 seed rows + 0 history rows + correct confidence values)"

# Phase 33 also asserts: schema_version + substrate_hash + data_consistency
# present on all 4 profile tables. Catches a forgetful retrofit.
echo "🔍 Verifying migration 0012 non-retrofittable columns..."
docker compose -f "$COMPOSE_FILE" exec -T postgres \
  psql -U chris -d chris -v ON_ERROR_STOP=1 -tAq -c "
    SELECT COUNT(*) FROM information_schema.columns
     WHERE table_schema = 'public'
     AND table_name IN ('profile_jurisdictional', 'profile_capital', 'profile_health', 'profile_family')
     AND column_name IN ('schema_version', 'substrate_hash', 'data_consistency', 'name', 'confidence');
  " | tee /tmp/m010_cols.txt
# 4 tables × 5 required columns = 20 rows
grep -q "^20$" /tmp/m010_cols.txt || { echo "❌ Migration 0012 non-retrofittable columns incomplete"; cat /tmp/m010_cols.txt; exit 1; }
echo "✓ Migration 0012 non-retrofittable columns verified (schema_version + substrate_hash + data_consistency + name + confidence on all 4 profile tables)"

# Phase 37 (M011 v2.6) — psychological profiles substrate smoke gate.
# HARD CO-LOCATION #M11-1: this gate ships in the SAME plan as the migration
# SQL + drizzle meta snapshot + schema.ts table defs (Plan 37-01). Failure
# exits BEFORE vitest (mirrors Phase 33 0012 substrate gate at line ~228).
# This gate runs independently of the M010 gate per RESEARCH.md OQ-3 —
# regression isolation across milestones.
#
# Asserts (matched format ^3|1|1|1|0|0|0|false$):
#   - 3 new tables exist (profile_hexaco, profile_schwartz, profile_attachment)
#   - Each of 3 psych tables has exactly 1 row WHERE name='primary'
#   - overall_confidence=0 and word_count=0 on profile_hexaco seed
#   - profile_attachment additionally: relational_word_count=0, activated=false
#     (psql casts boolean to "true"/"false" text, not "t"/"f")
echo "🔍 Verifying migration 0013 substrate..."
docker compose -f "$COMPOSE_FILE" exec -T postgres \
  psql -U chris -d chris -v ON_ERROR_STOP=1 -tAq -c "
    SELECT
      (SELECT COUNT(*) FROM information_schema.tables
       WHERE table_schema = 'public'
       AND table_name IN ('profile_hexaco', 'profile_schwartz',
                          'profile_attachment')) AS table_count,
      (SELECT COUNT(*) FROM profile_hexaco WHERE name = 'primary') AS hex_seed,
      (SELECT COUNT(*) FROM profile_schwartz WHERE name = 'primary') AS sch_seed,
      (SELECT COUNT(*) FROM profile_attachment WHERE name = 'primary') AS att_seed,
      (SELECT overall_confidence::text FROM profile_hexaco WHERE name = 'primary') AS hex_conf,
      (SELECT word_count::text FROM profile_hexaco WHERE name = 'primary') AS hex_wc,
      (SELECT relational_word_count::text FROM profile_attachment WHERE name = 'primary') AS att_rwc,
      (SELECT activated::text FROM profile_attachment WHERE name = 'primary') AS att_act;
  " | tee /tmp/m011_smoke.txt
grep -q "^3|1|1|1|0|0|0|false$" /tmp/m011_smoke.txt || { echo "❌ Migration 0013 substrate incomplete or seed values wrong"; cat /tmp/m011_smoke.txt; exit 1; }
echo "✓ Migration 0013 substrate verified (3 tables + 3 seed rows + cold-start values)"

# Phase 37 also asserts: schema_version + substrate_hash + name +
# overall_confidence + word_count + word_count_at_last_run present on all 3
# psychological tables (Never-Retrofit Checklist per D-06). Catches a
# forgetful retrofit. 3 tables × 6 columns = 18.
echo "🔍 Verifying migration 0013 non-retrofittable columns..."
docker compose -f "$COMPOSE_FILE" exec -T postgres \
  psql -U chris -d chris -v ON_ERROR_STOP=1 -tAq -c "
    SELECT COUNT(*) FROM information_schema.columns
     WHERE table_schema = 'public'
     AND table_name IN ('profile_hexaco', 'profile_schwartz', 'profile_attachment')
     AND column_name IN ('schema_version', 'substrate_hash', 'name',
                         'overall_confidence', 'word_count', 'word_count_at_last_run');
  " | tee /tmp/m011_cols.txt
# 3 tables × 6 required columns = 18 rows
grep -q "^18$" /tmp/m011_cols.txt || { echo "❌ Migration 0013 non-retrofittable columns incomplete (expected 18, got: $(cat /tmp/m011_cols.txt))"; cat /tmp/m011_cols.txt; exit 1; }
echo "✓ Migration 0013 non-retrofittable columns verified (schema_version + substrate_hash + name + overall_confidence + word_count + word_count_at_last_run on all 3 psychological tables)"

# Phase 37 — profile_attachment specific D-07 columns (relational_word_count
# + activated). Catches a Pitfall 1 retrofit attempt (e.g., trying to ALTER
# TABLE profile_attachment ADD COLUMN activated in a later migration —
# would mean the D028 activation gate has no column to flip at activation).
echo "🔍 Verifying migration 0013 profile_attachment D-07 columns..."
docker compose -f "$COMPOSE_FILE" exec -T postgres \
  psql -U chris -d chris -v ON_ERROR_STOP=1 -tAq -c "
    SELECT COUNT(*) FROM information_schema.columns
     WHERE table_schema = 'public'
     AND table_name = 'profile_attachment'
     AND column_name IN ('relational_word_count', 'activated');
  " | tee /tmp/m011_att_cols.txt
grep -q "^2$" /tmp/m011_att_cols.txt || { echo "❌ Migration 0013 profile_attachment D-07 columns missing (expected 2, got: $(cat /tmp/m011_att_cols.txt))"; cat /tmp/m011_att_cols.txt; exit 1; }
echo "✓ Migration 0013 profile_attachment D-07 columns verified (relational_word_count + activated)"

echo "🧪 Running tests..."
# Source .env if present so real API credentials win over the -:fallback below.
# Without this, dotenv/config in src/config.ts will not override env vars
# already set in scripts/test.sh, leaving live tests with the literal "test-key"
# and silently failing all Anthropic calls with 401 (2026-05-11 fix).
if [ -f .env ]; then
  set -a
  # shellcheck disable=SC1091
  source .env
  set +a
fi
# Redirect HuggingFace transformers cache to a user-writable dir. The bundled
# node_modules/@huggingface/transformers/.cache path is owned by root in
# read-only sandbox installs and trips EACCES on first bge-m3 model load,
# crashing tests that exercise pensieve.embed (2026-05-11 fix).
HF_CACHE_DIR="${HF_HOME:-/tmp/hf-cache-$USER}"
mkdir -p "$HF_CACHE_DIR" 2>/dev/null || true
DATABASE_URL="$DB_URL" \
  ANTHROPIC_API_KEY="${ANTHROPIC_API_KEY:-test-key}" \
  TELEGRAM_BOT_TOKEN="${TELEGRAM_BOT_TOKEN:-test-token}" \
  TELEGRAM_AUTHORIZED_USER_ID="${TELEGRAM_AUTHORIZED_USER_ID:-99999}" \
  HF_HOME="$HF_CACHE_DIR" \
  TRANSFORMERS_CACHE="$HF_CACHE_DIR" \
  npx vitest run "$@"
