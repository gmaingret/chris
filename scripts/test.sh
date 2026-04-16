#!/usr/bin/env bash
# Run the full test suite with a real database.
# Starts a local postgres via docker-compose, runs migrations, then vitest.
set -euo pipefail

COMPOSE_FILE="docker-compose.local.yml"
DB_URL="postgresql://chris:localtest123@localhost:5433/chris"
MIGRATION_SQL="src/db/migrations/0000_curved_colonel_america.sql"
ENUM_FIX_SQL="src/db/migrations/0001_add_photos_psychology_mode.sql"

cleanup() {
  echo "🧹 Stopping test postgres..."
  docker compose -f "$COMPOSE_FILE" down --timeout 5 2>/dev/null || true
}
trap cleanup EXIT

echo "🐘 Starting test postgres..."
docker compose -f "$COMPOSE_FILE" up -d postgres

# Wait for postgres to be ready
for i in $(seq 1 30); do
  if docker compose -f "$COMPOSE_FILE" exec postgres pg_isready -U chris -d chris -q 2>/dev/null; then
    break
  fi
  sleep 1
done

echo "📦 Running migrations..."
docker compose -f "$COMPOSE_FILE" exec postgres psql -U chris -d chris -c "CREATE EXTENSION IF NOT EXISTS vector;" -q 2>/dev/null
cat "$MIGRATION_SQL" | docker compose -f "$COMPOSE_FILE" exec -T postgres psql -U chris -d chris -q 2>/dev/null
cat "$ENUM_FIX_SQL" | docker compose -f "$COMPOSE_FILE" exec -T postgres psql -U chris -d chris -q 2>/dev/null

echo "🧪 Running tests..."
DATABASE_URL="$DB_URL" \
  ANTHROPIC_API_KEY="${ANTHROPIC_API_KEY:-test-key}" \
  TELEGRAM_BOT_TOKEN="${TELEGRAM_BOT_TOKEN:-test-token}" \
  TELEGRAM_AUTHORIZED_USER_ID="${TELEGRAM_AUTHORIZED_USER_ID:-99999}" \
  npx vitest run "$@"
