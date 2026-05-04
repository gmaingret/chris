#!/usr/bin/env bash
#
# scripts/regen-snapshots.sh — regenerate drizzle-kit meta snapshots for
# migrations 0001 and 0003 via clean-slate iterative replay per Phase 20
# CONTEXT.md D-01. Phase 25 extended the acceptance-gate apply sequence to
# cover migrations 0005 + 0006 (rituals foundation, M009 v2.4); Phase 26
# added 0007 (voice-note seed); Phase 27 added 0008 (wellbeing seed); Phase 29
# adds 0009 (weekly-review seed).
#
# Runs in a throwaway Docker container on an isolated volume (compose project
# `chris-regen`, port 5434). Safe to run on any branch — never mutates the
# main postgres (which test.sh runs on port 5433, project `chris-local`).
# Re-runnable on failure.
#
# Approach (clean-slate iterative replay):
#   1. Spin up a fresh Docker postgres on port 5434 (isolated volume).
#   2. Apply migrations 0000 + 0001. Run drizzle-kit introspect to capture
#      the schema state at that point. Patch the resulting snapshot's `id`
#      and `prevId` so it chains from 0000_snapshot. Save as 0001_snapshot.json.
#   3. Apply migrations 0002 + 0003 on top. Introspect again. Patch id/prevId
#      so it chains from 0002_snapshot. Save as 0003_snapshot.json.
#   4. Re-chain 0002.prevId → new 0001.id and 0004.prevId → new 0003.id. This
#      is a required step because drizzle-kit rejects duplicate prevId values
#      across the snapshot chain (deviation from the original plan scope; see
#      Plan 20-01 SUMMARY.md "Deviations").
#   5. Copy regenerated + re-chained snapshots into src/db/migrations/meta/.
#   6. Acceptance gate: tear down, fresh postgres, apply ALL twelve migrations
#      0000..0011, run `drizzle-kit generate`. MUST print
#      "No schema changes, nothing to migrate".
#   7. Cleanup: docker compose down --volumes, rm -rf .tmp/drizzle-regen-*.
#
# Rationale: Plan 19-04 verified Option A ("drizzle-kit generate against
# fully-migrated Docker") returns "No schema changes" — drizzle-kit does
# NOT backfill meta for already-applied entries. Clean-slate iterative
# replay via drizzle-kit introspect is the only path that regenerates the
# missing intermediate snapshots byte-accurately.
#
# Usage:
#   bash scripts/regen-snapshots.sh            # regenerate and write snapshots
#   bash scripts/regen-snapshots.sh --check-only  # dry-run: verify only
#
set -euo pipefail

# ── Config ────────────────────────────────────────────────────────────────
COMPOSE_PROJECT="chris-regen"
COMPOSE_FILE="docker-compose.local.yml"
REGEN_PORT="5434"
DB_URL="postgresql://chris:localtest123@localhost:${REGEN_PORT}/chris"

MIGRATIONS_DIR="src/db/migrations"
META_DIR="${MIGRATIONS_DIR}/meta"
TMP_DIR=".tmp"
OUT_DIR="${TMP_DIR}/regen-out"

MIGRATION_0="${MIGRATIONS_DIR}/0000_curved_colonel_america.sql"
MIGRATION_1="${MIGRATIONS_DIR}/0001_add_photos_psychology_mode.sql"
MIGRATION_2="${MIGRATIONS_DIR}/0002_decision_archive.sql"
MIGRATION_3="${MIGRATIONS_DIR}/0003_add_decision_epistemic_tag.sql"
MIGRATION_4="${MIGRATIONS_DIR}/0004_decision_trigger_suppressions.sql"
MIGRATION_5="${MIGRATIONS_DIR}/0005_episodic_summaries.sql"
MIGRATION_6="${MIGRATIONS_DIR}/0006_rituals_wellbeing.sql"
MIGRATION_7="${MIGRATIONS_DIR}/0007_daily_voice_note_seed.sql"
MIGRATION_8="${MIGRATIONS_DIR}/0008_wellbeing_seed.sql"
MIGRATION_9="${MIGRATIONS_DIR}/0009_weekly_review_seed.sql"
MIGRATION_10="${MIGRATIONS_DIR}/0010_adjustment_dialogue.sql"
MIGRATION_11="${MIGRATIONS_DIR}/0011_rename_daily_voice_note_to_journal.sql"

CHECK_ONLY=0
if [[ "${1:-}" == "--check-only" ]]; then
  CHECK_ONLY=1
fi

# Override compose file to publish on the regen port so we don't collide with
# the test postgres on 5433. Also use a unique volume path via tmpfs (already
# the case in docker-compose.local.yml).
OVERRIDE_FILE="${TMP_DIR}/docker-compose.regen.override.yml"

mkdir -p "${TMP_DIR}" "${OUT_DIR}"

cat > "${OVERRIDE_FILE}" <<OVR
services:
  postgres:
    ports:
      - "${REGEN_PORT}:5432"
OVR

# ── Cleanup on exit ───────────────────────────────────────────────────────
#
# WARNING: historically this trap unconditionally deleted
# ${META_DIR}/0005_snapshot.json on EVERY exit (success or failure). That was
# safe at Plan 20-01 land-time (no 0005 snapshot existed yet) but became
# destructive once Plan 20-02 landed a real 0005 snapshot chained to the
# 0004 snapshot. Any re-run of this script after Plan 20-02 would silently
# nuke the committed 0005 snapshot and force operators to regenerate from
# scratch.
#
# Phase 25 carries this discipline forward to 0006 (and any future Nth
# acceptance-check artifact): the trap only deletes a snapshot when THIS run
# produced it. We set REGEN_PRODUCED_ACCEPTANCE=1 just before invoking the
# acceptance-gate generate that may emit the acceptance-check artifacts. If
# the script exits before that point, or if the acceptance-check SQL does not
# exist at exit time, the snapshot is a real committed file and must be
# preserved.
#
# Phase 26 extends this discipline to 0007 — committed 0007_snapshot.json must
# be preserved; only the post-0007 acceptance-gate artifact (0008_snapshot.json
# named by drizzle's sequence-counter) is wiped when this run produced it.
#
# Phase 27 extends this discipline to 0008 — committed 0008_snapshot.json must
# be preserved; only the post-0008 acceptance-gate artifact (0009_snapshot.json
# named by drizzle's sequence-counter) is wiped when this run produced it.
#
# Phase 29 extends this discipline to 0009 — committed 0009_snapshot.json must
# be preserved; only the post-0009 acceptance-gate artifact (0010_snapshot.json
# named by drizzle's sequence-counter) is wiped when this run produced it.
REGEN_PRODUCED_ACCEPTANCE=0
cleanup() {
  local rc=$?
  echo ""
  echo "🧹 Cleaning up regen postgres (project ${COMPOSE_PROJECT})..."
  docker compose -p "${COMPOSE_PROJECT}" -f "${COMPOSE_FILE}" -f "${OVERRIDE_FILE}" \
    down --volumes --timeout 5 >/dev/null 2>&1 || true
  rm -rf "${TMP_DIR}/drizzle-regen-"* "${OUT_DIR}" "${OVERRIDE_FILE}" || true
  # Clean up any accidentally generated acceptance-check SQL (distinctive name
  # — drizzle-kit only produces it when this script passes --name acceptance_check).
  # The acceptance-check generate runs AFTER applying all current migrations
  # 0000..0009, so the produced filename would be 0010_acceptance_check*.sql.
  # We also defensively wipe stale 0006-0009_acceptance_check artifacts if
  # present (safety belt for partial/aborted prior runs).
  find "${MIGRATIONS_DIR}" -maxdepth 1 -name "0006_acceptance_check*.sql" -delete 2>/dev/null || true
  find "${MIGRATIONS_DIR}" -maxdepth 1 -name "0007_acceptance_check*.sql" -delete 2>/dev/null || true
  find "${MIGRATIONS_DIR}" -maxdepth 1 -name "0008_acceptance_check*.sql" -delete 2>/dev/null || true
  find "${MIGRATIONS_DIR}" -maxdepth 1 -name "0009_acceptance_check*.sql" -delete 2>/dev/null || true
  find "${MIGRATIONS_DIR}" -maxdepth 1 -name "0010_acceptance_check*.sql" -delete 2>/dev/null || true
  find "${MIGRATIONS_DIR}" -maxdepth 1 -name "0011_acceptance_check*.sql" -delete 2>/dev/null || true
  find "${MIGRATIONS_DIR}" -maxdepth 1 -name "0012_acceptance_check*.sql" -delete 2>/dev/null || true
  # Only delete the post-0011 snapshot if THIS run produced it — otherwise it
  # is a legitimate committed snapshot from a future plan and must be preserved.
  # The committed Phase 25 0006_snapshot.json + Phase 26 0007_snapshot.json +
  # Phase 27 0008_snapshot.json + Phase 29 0009_snapshot.json + Phase 28
  # 0010_snapshot.json + Phase 31 0011_snapshot.json are NEVER touched
  # here; only the post-0011 future-snapshot drizzle-kit emits during the
  # acceptance generate (named 0012_snapshot.json by drizzle's sequence-counter).
  if [[ "${REGEN_PRODUCED_ACCEPTANCE}" -eq 1 ]]; then
    find "${META_DIR}" -name "0012_snapshot.json" -delete 2>/dev/null || true
  fi
  exit "${rc}"
}
trap cleanup EXIT INT TERM

# ── Helpers ───────────────────────────────────────────────────────────────
compose() {
  docker compose -p "${COMPOSE_PROJECT}" -f "${COMPOSE_FILE}" -f "${OVERRIDE_FILE}" "$@"
}

wait_ready() {
  local ready=0
  for _ in $(seq 1 30); do
    if compose exec -T postgres pg_isready -U chris -d chris -q 2>/dev/null; then
      ready=1
      break
    fi
    sleep 1
  done
  if [[ "${ready}" -ne 1 ]]; then
    echo "❌ postgres failed to become ready after 30s" >&2
    return 1
  fi
}

apply_sql() {
  local sql_file="$1"
  compose exec -T postgres \
    psql -U chris -d chris -v ON_ERROR_STOP=1 -q < "${sql_file}"
}

apply_psql_cmd() {
  local cmd="$1"
  compose exec -T postgres \
    psql -U chris -d chris -v ON_ERROR_STOP=1 -q -c "${cmd}"
}

# Run drizzle-kit introspect into a given out dir and return the emitted
# snapshot file path (always the 0000_snapshot.json, since introspect starts
# a fresh chain).
introspect_to() {
  local work_dir="$1"
  mkdir -p "${work_dir}/out"
  # Minimal config pointing at the regen DB and the staging out dir.
  cat > "${work_dir}/drizzle.config.ts" <<CFG
import { defineConfig } from 'drizzle-kit';
export default defineConfig({
  schema: './schema.ts',
  out: './out',
  dialect: 'postgresql',
  dbCredentials: { url: '${DB_URL}' },
  extensionsFilters: ['postgis'],
});
CFG
  # Drizzle-kit introspect needs a schema.ts file to exist but will overwrite
  # it; touch an empty one so the config validates.
  printf '' > "${work_dir}/schema.ts"

  # Run drizzle-kit introspect; redirect ALL output to stderr so this
  # function's stdout is reserved for the snapshot file path.
  #
  # Capture the introspect exit code explicitly — the previous pattern used
  # `|| true` which swallowed non-zero exits, so any introspect failure
  # (DB connection timeout, schema parse error, etc.) surfaced only as the
  # generic "did not produce a snapshot" message on the next line. Keeping
  # `set -e` live here but wrapping in a subshell means we have to capture
  # the rc via the subshell's exit status.
  set +e
  (
    cd "${work_dir}"
    # Pipe an empty stdin in case drizzle-kit prompts for anything.
    # Phase 25: switched from `yes '' | ...` to `</dev/null` because under
    # pipefail the `yes` writer gets SIGPIPE (141) once drizzle-kit's stdin
    # closes successfully — the pipeline then reports 141 even though
    # drizzle-kit exited 0. Empty-stdin redirect avoids the spurious failure
    # while still preventing drizzle-kit from blocking on a TTY prompt.
    npx drizzle-kit introspect >&2 2>&1 </dev/null
  ) >&2
  local rc=$?
  set -e
  if [[ "${rc}" -ne 0 ]]; then
    echo "❌ drizzle-kit introspect failed with exit ${rc} (working dir: ${work_dir})" >&2
    return "${rc}"
  fi

  # The emitted snapshot is out/meta/0000_snapshot.json
  local snap="${work_dir}/out/meta/0000_snapshot.json"
  if [[ ! -f "${snap}" ]]; then
    echo "❌ introspect exited 0 but did not produce a snapshot at ${snap}" >&2
    return 1
  fi
  printf '%s\n' "${snap}"
}

# Patch a newly-introspected snapshot's id/prevId fields using node (no jq
# available in this env). Writes with 2-space indentation to match drizzle-kit's
# native serialization style (verified via probe: drizzle-kit generate emits
# 2-space indented JSON).
# Args: src_snapshot dst_snapshot new_id prev_id
patch_snapshot_chain() {
  local src="$1" dst="$2" new_id="$3" prev_id="$4"
  node -e "
    const fs = require('fs');
    const s = JSON.parse(fs.readFileSync('${src}', 'utf8'));
    s.id = '${new_id}';
    s.prevId = '${prev_id}';
    // Match drizzle-kit's native output: 2-space indent, no trailing newline.
    fs.writeFileSync('${dst}', JSON.stringify(s, null, 2));
  "
}

# Read an existing snapshot's id (for building the chain).
snapshot_id() {
  local file="$1"
  node -e "console.log(JSON.parse(require('fs').readFileSync('${file}', 'utf8')).id);"
}

# Update only the prevId of an existing snapshot in-place. Used to re-chain
# 0002 and 0004 after inserting new 0001 and 0003 snapshots — drizzle-kit
# rejects duplicate prevId values across the chain, so we must re-point
# 0002 → new_0001.id and 0004 → new_0003.id. This preserves the snapshot
# content (byte-accurate schema serialization); only the chain pointer
# changes.
patch_prev_id_inplace() {
  local file="$1" new_prev="$2"
  node -e "
    const fs = require('fs');
    const s = JSON.parse(fs.readFileSync('${file}', 'utf8'));
    s.prevId = '${new_prev}';
    // Match drizzle-kit's native output: 2-space indent, no trailing newline.
    fs.writeFileSync('${file}', JSON.stringify(s, null, 2));
  "
}

# Generate a deterministic-ish new UUID (v4). We don't need crypto-strength
# randomness — just uniqueness within the chain.
new_uuid() {
  node -e "console.log(require('crypto').randomUUID());"
}

# ── Step 1: bring up fresh regen postgres ─────────────────────────────────
echo "🐘 Starting regen postgres (project ${COMPOSE_PROJECT}, port ${REGEN_PORT})..."
compose up -d postgres >/dev/null
wait_ready
apply_psql_cmd "CREATE EXTENSION IF NOT EXISTS vector;"

# ── Step 2: apply 0000 + 0001, introspect, save 0001_snapshot ────────────
echo "📦 Applying migrations 0000 + 0001..."
apply_sql "${MIGRATION_0}"
apply_sql "${MIGRATION_1}"

echo "🔍 Introspecting for 0001_snapshot..."
REGEN_0001_DIR="${TMP_DIR}/drizzle-regen-0001"
rm -rf "${REGEN_0001_DIR}"
SNAP_0001_RAW=$(introspect_to "${REGEN_0001_DIR}")

ID_0000=$(snapshot_id "${META_DIR}/0000_snapshot.json")
NEW_ID_0001=$(new_uuid)
patch_snapshot_chain \
  "${SNAP_0001_RAW}" \
  "${OUT_DIR}/0001_snapshot.json" \
  "${NEW_ID_0001}" \
  "${ID_0000}"
echo "  → staged ${OUT_DIR}/0001_snapshot.json (id=${NEW_ID_0001:0:8}..., prevId=${ID_0000:0:8}...)"

# ── Step 3: apply 0002 + 0003, introspect, save 0003_snapshot ────────────
echo "📦 Applying migrations 0002 + 0003..."
apply_sql "${MIGRATION_2}"
apply_sql "${MIGRATION_3}"

echo "🔍 Introspecting for 0003_snapshot..."
REGEN_0003_DIR="${TMP_DIR}/drizzle-regen-0003"
rm -rf "${REGEN_0003_DIR}"
SNAP_0003_RAW=$(introspect_to "${REGEN_0003_DIR}")

ID_0002=$(snapshot_id "${META_DIR}/0002_snapshot.json")
NEW_ID_0003=$(new_uuid)
patch_snapshot_chain \
  "${SNAP_0003_RAW}" \
  "${OUT_DIR}/0003_snapshot.json" \
  "${NEW_ID_0003}" \
  "${ID_0002}"
echo "  → staged ${OUT_DIR}/0003_snapshot.json (id=${NEW_ID_0003:0:8}..., prevId=${ID_0002:0:8}...)"

# ── Step 4: install regenerated snapshots + re-chain 0002/0004 ─────────────
if [[ "${CHECK_ONLY}" -eq 1 ]]; then
  echo "ℹ️  --check-only: staged snapshots in ${OUT_DIR} but not installing."
else
  echo "📥 Installing regenerated snapshots into ${META_DIR}/..."
  cp "${OUT_DIR}/0001_snapshot.json" "${META_DIR}/0001_snapshot.json"
  cp "${OUT_DIR}/0003_snapshot.json" "${META_DIR}/0003_snapshot.json"

  # Re-chain 0002 and 0004 so their prevId points at the new 0001/0003 ids
  # (instead of the pre-regen values that skipped over them). Drizzle-kit
  # rejects duplicate prevId values across snapshots — this is NOT optional.
  echo "🔗 Re-chaining 0002.prevId → new 0001.id (${NEW_ID_0001:0:8}...)"
  patch_prev_id_inplace "${META_DIR}/0002_snapshot.json" "${NEW_ID_0001}"
  echo "🔗 Re-chaining 0004.prevId → new 0003.id (${NEW_ID_0003:0:8}...)"
  patch_prev_id_inplace "${META_DIR}/0004_snapshot.json" "${NEW_ID_0003}"
fi

# ── Step 5: acceptance gate — fresh DB, all 10 migrations, generate = no-op ──
echo ""
echo "🧪 Acceptance gate: fresh postgres + all 12 migrations + drizzle-kit generate..."

compose down --volumes --timeout 5 >/dev/null 2>&1 || true
compose up -d postgres >/dev/null
wait_ready
apply_psql_cmd "CREATE EXTENSION IF NOT EXISTS vector;"
apply_sql "${MIGRATION_0}"
apply_sql "${MIGRATION_1}"
apply_sql "${MIGRATION_2}"
apply_sql "${MIGRATION_3}"
apply_sql "${MIGRATION_4}"
apply_sql "${MIGRATION_5}"
apply_sql "${MIGRATION_6}"
apply_sql "${MIGRATION_7}"
apply_sql "${MIGRATION_8}"
apply_sql "${MIGRATION_9}"
apply_sql "${MIGRATION_10}"
apply_sql "${MIGRATION_11}"

# Run generate from repo root. Use a distinctive name so any accidentally-
# produced migration is easy to spot and cleanup.
#
# Mark that THIS run is responsible for any post-0011 snapshot that appears
# from here onward. The EXIT trap consults this flag before deleting any
# 0012_snapshot.json so it never blows away a legitimate committed snapshot
# on a script re-run after a future plan lands a real 0012 migration.
REGEN_PRODUCED_ACCEPTANCE=1
set +e
GEN_OUT=$(DATABASE_URL="${DB_URL}" npx drizzle-kit generate --name acceptance_check 2>&1)
GEN_RC=$?
set -e

echo "${GEN_OUT}"

if echo "${GEN_OUT}" | grep -q "No schema changes"; then
  echo ""
  echo "✓ Snapshot regeneration acceptance gate: No schema changes"
  # Defensive cleanup in case drizzle-kit wrote anything (the next sequence
  # number after 0011 is 0012).
  find "${MIGRATIONS_DIR}" -maxdepth 1 -name "0012_acceptance_check*.sql" -delete 2>/dev/null || true
  find "${META_DIR}" -name "0012_snapshot.json" -delete 2>/dev/null || true
  exit 0
else
  echo ""
  echo "✗ Regeneration failed — snapshots diverge from schema.ts"
  echo "  drizzle-kit exited ${GEN_RC} and emitted the above diff."
  echo "  Inspect .tmp/regen-out/*.json and compare to schema.ts, then iterate."
  exit 1
fi
