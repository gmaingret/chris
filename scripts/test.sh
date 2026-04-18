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

echo "🧪 Running tests..."
DATABASE_URL="$DB_URL" \
  ANTHROPIC_API_KEY="${ANTHROPIC_API_KEY:-test-key}" \
  TELEGRAM_BOT_TOKEN="${TELEGRAM_BOT_TOKEN:-test-token}" \
  TELEGRAM_AUTHORIZED_USER_ID="${TELEGRAM_AUTHORIZED_USER_ID:-99999}" \
  npx vitest run "$@"
