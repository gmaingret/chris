# Phase 45: Schema Hygiene & Fixture-Pipeline Cleanup - Pattern Map

**Mapped:** 2026-05-14 (plan-phase --auto)
**Files analyzed:** 2 NEW migrations + 1 NEW config + 6 MODIFIED scripts/tests + ~14 fixture artefacts (generated) = ~23 total
**Analogs found:** 23 / 23 (100% — every change has a direct in-repo precedent)

## Plan Hint Mapping (wave DAG per CONTEXT.md D-02)

| Plan | Wave | Files | Rationale |
|------|------|-------|-----------|
| **Plan 45-01** (Wave A — Migration 0015 + SCHEMA-01) | A | `src/db/migrations/0015_psychological_check_constraints.sql` (NEW), `src/db/migrations/meta/0015_snapshot.json` (NEW, generated), `src/db/migrations/meta/_journal.json` (MOD — append idx 15 entry), `scripts/test.sh` (MOD — append `MIGRATION_15_SQL=` + psql apply line + smoke gate), `scripts/regen-snapshots.sh` (MOD — bump cleanup sentinels 0014→0015), unit/integration tests for the constraint behaviour | DB CHECK-constraint migration is a HARD CO-LOCATION pattern (matches Phase 37 #M11-1, Phase 33 #M10-1). SQL + drizzle journal entry + snapshot + test.sh apply line MUST ship in one atomic plan — splitting reproduces M010 PITFALL M010-11 lineage break. (D-04 — slot 0015 because Phase 43 owns 0014; D-18 cross-phase coordination.) |
| **Plan 45-02** (Wave A — fixture-pipeline scripts + HARN test) | A | `scripts/synthesize-delta.ts` (FIX-01 contradictions FK pre-filter + FIX-02 bias-prompt decoupling), `scripts/synthesize-episodic.ts` (FIX-03 migration-list source + FIX-08 SIGINT cleanup), `scripts/fetch-prod-data.ts` (FIX-04 SSH hardening + FIX-08 SIGINT cleanup), `scripts/regenerate-primed.ts` (FIX-02 path-bug log string + FIX-08 SIGINT child-await), `src/__tests__/fixtures/load-primed.ts` (FIX-05 pgvector staging-table CAST), `src/__tests__/fixtures/primed-sanity-m011.test.ts` (FIX-02 path constant + FIX-07 calendar-month-window + WR-01 strict-inequality), `scripts/.ssh-known-hosts` (NEW — repo-vetted known_hosts), test files for fixture-load + synth-delta unit tests | All 8 FIX-0x requirements live in the fixture-regen pipeline surface and have no inter-task ordering — pure parallel-task plan. NO dependencies on Plan 45-01's migrations (these scripts run outside the app migration chain). |
| **Plan 45-03** (Wave B — Migration 0016 + SCHEMA-02 backfill) | B | `src/db/migrations/0016_phase33_seed_defaults_backfill.sql` (NEW), `src/db/migrations/meta/0016_snapshot.json` (NEW, generated), `src/db/migrations/meta/_journal.json` (MOD — append idx 16 entry), `scripts/test.sh` (MOD — append `MIGRATION_16_SQL=` + psql apply line + post-backfill assertion smoke gate), `scripts/regen-snapshots.sh` (MOD — bump cleanup sentinels 0015→0016), unit/integration tests for backfill effect | Depends on Plan 45-01 ONLY for migration-number lexicographic ordering (Drizzle applies in filename order; 0015 must exist before 0016 is generated). NOT semantically dependent — SCHEMA-01 is jsonb-path CHECKs on psychological tables, SCHEMA-02 is UPDATE + ALTER on operational tables. Separated per CONTEXT D-03 (atomicity + reviewability). |
| **Plan 45-04** (Wave C — FIX-06 fixture refresh) | C | `tests/fixtures/primed/m010-30days/*` (REGENERATED), `tests/fixtures/primed/m010-5days/*` (REGENERATED), `tests/fixtures/primed/m010-anti-hallucination/*` (REGENERATED — if separate) | Cannot start until Plan 45-03's migration 0016 has landed AND Plan 45-02's `scripts/regenerate-primed.ts` SIGINT fix + `scripts/synthesize-episodic.ts` migration-list fix are present. Operator runs `npx tsx scripts/regenerate-primed.ts --milestone m010 --force`; resulting JSONL files committed in a separate commit referencing SCHEMA-02 commit SHA (D-13). PMT-06 anti-hallucination gate must pass locally before push (D-14). |

## File Classification

| File | Status | Role | Data Flow | Closest Analog | Match Quality |
|------|--------|------|-----------|----------------|---------------|
| `src/db/migrations/0015_psychological_check_constraints.sql` | NEW | migration SQL | DDL (ALTER TABLE … ADD CONSTRAINT) | `src/db/migrations/0013_psychological_profiles.sql:57, 82, 100` (existing `overall_confidence_bounds` CHECK constraints) | exact (constraint syntax) + new pattern (jsonb-path expressions) |
| `src/db/migrations/0016_phase33_seed_defaults_backfill.sql` | NEW | migration SQL | DML (UPDATE existing rows) + DDL (ALTER COLUMN … SET DEFAULT) | `src/db/migrations/0008_wellbeing_seed.sql` (existing seed-INSERT pattern; backfill is the UPDATE-shaped sibling) | role-match (some divergences — backfill semantics not seed) |
| `src/db/migrations/meta/0015_snapshot.json` | NEW (drizzle-kit generated) | drizzle build artifact | drizzle-kit output | `src/db/migrations/meta/0013_snapshot.json` (regen via `regen-snapshots.sh`) | exact (regen via tooling) |
| `src/db/migrations/meta/0016_snapshot.json` | NEW (drizzle-kit generated) | drizzle build artifact | drizzle-kit output | same as above | exact |
| `src/db/migrations/meta/_journal.json` | MOD (append idx 14 [Phase 43] then 15 + 16) | append-only ledger | sequential entries | `_journal.json:96-102` (idx 13 entry — `when: 1778699398922`) | exact (monotonic `when` invariant; Phase 32 #3 guardrail enforces) |
| `scripts/test.sh` | MOD (append `MIGRATION_15_SQL=` + `MIGRATION_16_SQL=` + 2 psql apply lines + post-0016 backfill smoke gate) | shell-script smoke gate | sequential SQL apply + assert | `scripts/test.sh:21,86` (`MIGRATION_13_SQL` + apply line) + `:88-122` (0006 smoke gate pattern) | exact |
| `scripts/regen-snapshots.sh` | MOD (bump `MIGRATION_13`→`MIGRATION_15` then `MIGRATION_16`, cleanup sentinels) | shell-script meta cleanup | guarded `find -delete` | `regen-snapshots.sh:67, 118-122, 140-153` (existing bump pattern) | exact |
| `scripts/synthesize-delta.ts` | MOD (FIX-01 pre-filter at line 934; FIX-02a phrasesClause decoupling at lines 584-594) | fixture synthesizer | transform (organic + synth → JSONL) | inline edit; analog is the same file's `bigintReplacer` discipline at `:513-524` | role-match (delta-only edit; no new file) |
| `scripts/synthesize-episodic.ts` | MOD (FIX-03 dynamic migration list at lines 48-55; FIX-08 AbortController SIGINT cleanup at lines 480-484) | fixture synthesizer | shell + DB orchestration | FIX-03 mirrors `scripts/test.sh:43-47` filter-`.sql` pattern; FIX-08 mirrors AbortController pattern from existing scheduler code | exact (FIX-03) + role-match (FIX-08) |
| `scripts/fetch-prod-data.ts` | MOD (FIX-04 SSH `-o StrictHostKeyChecking=accept-new -o UserKnownHostsFile=` at lines 73-88; FIX-08 AbortController SIGINT cleanup at lines 273-277) | prod-data fetcher (SSH tunnel) | side-effect (SSH + dump-to-JSONL) | FIX-04 has NO direct in-repo SSH analog (this script IS the only SSH callsite); pattern reference is `/usr/local/bin/chris-ritual-monitor.sh` on Proxmox (CLAUDE.md memory). FIX-08 mirrors the inline `process.exit(130)`→`process.exitCode = 130` doc-comment at lines 314-317 that the bug never honored. | role-match (FIX-04 — pattern is documented but never applied) |
| `scripts/regenerate-primed.ts` | MOD (FIX-02 path-bug log string at line 304; FIX-08 SIGINT child-await with SIGKILL fallback at lines 222-228) | regen composer | child-process orchestration | FIX-08 mirrors WR-05 fix doc (`24-REVIEW.md:91-95`) — child.on('exit', …) await up to 5s, then SIGKILL | exact (documented fix) |
| `scripts/.ssh-known-hosts` | NEW | repo-vetted SSH known_hosts | static config file | NO in-repo analog (first-of-its-kind). Reference: OpenSSH `known_hosts` format (one host-key per line, output of `ssh-keyscan 192.168.1.50`). | role-match (new pattern, simple) |
| `src/__tests__/fixtures/load-primed.ts` | MOD (FIX-05 staging-table CAST for `pensieve_embeddings`; insert path at lines 274-275) | fixture loader | bulk-INSERT (JSONL → DB) | `24-REVIEW.md:63` recommends "stage the JSONL rows into a temp table with `embedding text`, then `INSERT … SELECT …, embedding::vector FROM staging`" — verbatim canonical approach | exact (recommended approach) |
| `src/__tests__/fixtures/primed-sanity-m011.test.ts` | MOD (FIX-02 FIXTURE_NAME constant at line 163-164 + 174-175; FIX-07 calendar-month-window in `totalTelegramWordCount` at lines 89-100; WR-01 `>=` / `<` boundary alignment at lines 141, 188; D-16 import `MIN_SPEECH_WORDS`) | HARN gate test | DB query + assertion | FIX-07's substrate-window filter is mirrored verbatim from `psychological-shared.ts:248-273` (calendar-month-in-Europe/Paris) | exact (mirror) |
| `tests/fixtures/primed/m010-30days/*.jsonl` + `MANIFEST.json` | REGEN (operator command) | fixture artefacts | output of regen pipeline | `tests/fixtures/primed/m010-30days/*` current artefacts (refreshed against 0016-backfilled schema) | exact (regen-driven) |
| `tests/fixtures/primed/m010-5days/*` | REGEN | fixture artefacts | output of regen pipeline | same as above | exact |
| `tests/fixtures/primed/m010-anti-hallucination/*` | REGEN | fixture artefacts | output of regen pipeline | same as above | exact |

---

## Pattern Assignments

### `src/db/migrations/0015_psychological_check_constraints.sql` (SCHEMA-01)

**Primary analog (header & idempotency guard pattern):** `src/db/migrations/0013_psychological_profiles.sql:1-38` (Phase 37 migration header — Never-Retrofit columns + idempotency rationale).

**Primary analog (CHECK-constraint syntax for top-level real column):** `0013_psychological_profiles.sql:57, 82` — existing `overall_confidence_bounds` CHECK:
```sql
CONSTRAINT "profile_hexaco_overall_confidence_bounds"
  CHECK ("profile_hexaco"."overall_confidence" >= 0
     AND "profile_hexaco"."overall_confidence" <= 1)
```

**NEW pattern — jsonb-path CHECK expressions** (no in-repo prior; per Phase 37 WR-01 §Fix and CONTEXT.md D-04):

Each per-dim jsonb column has shape `{ score: number, confidence: number, last_updated: string }` (or `null` literal when uninitialized). The CHECK constraint must tolerate the literal-null case (`value = 'null'::jsonb`) AND enforce bounds when the object is populated.

```sql
-- Per CONTEXT D-04 + Phase 37 WR-01 §Fix:
-- HEXACO dims: score ∈ [1.0, 5.0], confidence ∈ [0.0, 1.0]
ALTER TABLE "profile_hexaco" ADD CONSTRAINT "profile_hexaco_honesty_humility_bounds"
  CHECK (
    "honesty_humility" = 'null'::jsonb
    OR (
      ("honesty_humility"->>'score')::numeric BETWEEN 1.0 AND 5.0
      AND ("honesty_humility"->>'confidence')::numeric BETWEEN 0.0 AND 1.0
    )
  );
```

Repeat for the 5 other HEXACO dims (`emotionality`, `extraversion`, `agreeableness`, `conscientiousness`, `openness`).

```sql
-- Schwartz dims: score ∈ [0.0, 7.0], confidence ∈ [0.0, 1.0]
ALTER TABLE "profile_schwartz" ADD CONSTRAINT "profile_schwartz_self_direction_bounds"
  CHECK (
    "self_direction" = 'null'::jsonb
    OR (
      ("self_direction"->>'score')::numeric BETWEEN 0.0 AND 7.0
      AND ("self_direction"->>'confidence')::numeric BETWEEN 0.0 AND 1.0
    )
  );
```

Repeat for the 9 other Schwartz dims (`stimulation`, `hedonism`, `achievement`, `power`, `security`, `conformity`, `tradition`, `benevolence`, `universalism`).

For `profile_attachment`: dims are `anxious`, `avoidant`, `secure`. Per CONTEXT D-04 "(where activated)" hedge: still add the bounds (score ∈ [1.0, 5.0]) so the columns are protected once D028 activation fires.

**Header comment pattern** (mirror `0013_psychological_profiles.sql:1-15`):
- MD-02 idempotency-guard rationale (re-runnable migration safety)
- v2.6.1 Phase 45 SCHEMA-01 attribution
- HARD CO-LOCATION #M11-45a (migration + journal + snapshot + `test.sh` apply line + `regen-snapshots.sh` bump)
- Cross-phase coord note: "Migration slot 0014 is owned by Phase 43 (CONTRACT-03 column); SCHEMA-01 occupies slot 0015 per CONTEXT.md D-18."
- Reference: Phase 37 WR-01 §Fix line 45-50 of `37-REVIEW.md`.

### `src/db/migrations/0016_phase33_seed_defaults_backfill.sql` (SCHEMA-02)

**Primary analog (UPDATE-existing-rows backfill pattern):** No exact precedent — closest is `0008_wellbeing_seed.sql` (INSERT-shaped), but the M010 schema_mismatch root-cause requires UPDATE-shaped backfill of jsonb columns on already-seeded rows. **NEW pattern.**

**Primary analog (ALTER COLUMN … SET DEFAULT):** No exact in-repo precedent for jsonb column default changes. Pattern is straight PostgreSQL DDL — `ALTER TABLE x ALTER COLUMN y SET DEFAULT '...'::jsonb;` (verifies via `\d+ profile_health` after apply).

**Per CONTEXT D-05 — TWO operations in a single migration:**

```sql
-- Operation 1: Backfill existing rows where substrate_hash = '' (cold-start sentinel).
-- Targets: profile_health.wellbeing_trend, profile_family.parent_care_responsibilities.
-- Root cause per Phase 34 REVIEW §Schema-Drift Origins Confirmed (lines 361-390):
-- - wellbeing_trend default is '{}'::jsonb, missing required nullable fields
--   energy_30d_mean / mood_30d_mean / anxiety_30d_mean → Zod v3 strict parse fails
--   on missing-required-key → schema_mismatch warn at read time.
-- - parent_care_responsibilities default is '{}'::jsonb, missing required nullable
--   fields notes / dependents → same failure mode.

UPDATE "profile_health"
SET "wellbeing_trend" = '{"energy_30d_mean":null,"mood_30d_mean":null,"anxiety_30d_mean":null}'::jsonb
WHERE "substrate_hash" = '' AND "wellbeing_trend" = '{}'::jsonb;
--> statement-breakpoint

UPDATE "profile_family"
SET "parent_care_responsibilities" = '{"notes":null,"dependents":[]}'::jsonb
WHERE "substrate_hash" = '' AND "parent_care_responsibilities" = '{}'::jsonb;
--> statement-breakpoint

-- Operation 2: Update the column DEFAULTs so future fresh DBs ship the correct
-- seed shape (matches the v3 Zod schema's required-nullable fields at read time).
ALTER TABLE "profile_health"
  ALTER COLUMN "wellbeing_trend"
  SET DEFAULT '{"energy_30d_mean":null,"mood_30d_mean":null,"anxiety_30d_mean":null}'::jsonb;
--> statement-breakpoint

ALTER TABLE "profile_family"
  ALTER COLUMN "parent_care_responsibilities"
  SET DEFAULT '{"notes":null,"dependents":[]}'::jsonb;
--> statement-breakpoint
```

**Header comment pattern** (mirror `0013_psychological_profiles.sql:1-15`):
- MD-02 idempotency-guard rationale (UPDATE is idempotent under `WHERE substrate_hash = '' AND col = '{}'::jsonb`)
- v2.6.1 Phase 45 SCHEMA-02 attribution
- HARD CO-LOCATION #M11-45b (migration + journal + snapshot + `test.sh` apply line + smoke gate + `regen-snapshots.sh` bump)
- Reference: Phase 34 REVIEW §Schema-Drift Origins Confirmed lines 361-390.
- Note: "FIX-06 fixture refresh (Plan 45-04) is the operator step that re-derives M010 primed fixtures against this backfilled schema."

### `scripts/synthesize-delta.ts` (FIX-01 + FIX-02)

**Primary analog (FIX-01 pre-filter — in-place edit):** `scripts/synthesize-delta.ts:934` — the existing concatenation line. Inline edit per Phase 40 REVIEW §Tech-Debt #2 line 126-131 (verbatim snippet provided in CONTEXT.md D-06):

```typescript
// AT line 934, replace:
const fusedContradictions = [...organicContradictions, ...synthContradictions];

// WITH:
const pensieveIds = new Set(fusedPensieve.map((p) => String(p.id)));
const rawContradictions = [...organicContradictions, ...synthContradictions];
const fusedContradictions = rawContradictions.filter(
  (c) =>
    pensieveIds.has(String(c.entry_a_id)) &&
    pensieveIds.has(String(c.entry_b_id)),
);
const droppedCount = rawContradictions.length - fusedContradictions.length;
if (droppedCount > 0) {
  logger.info(
    { droppedCount, totalCount: rawContradictions.length },
    'synth.contradictions.dropped',
  );
}
```

(Logger event shape `synth.contradictions.dropped` per CONTEXT D-06.)

**Primary analog (FIX-02a phrasesClause decoupling):** `scripts/synthesize-delta.ts:584-594` — current code that conditions `phrasesClause` append on `if (dimensionHint)`. Per CONTEXT D-07a + Phase 40 REVIEW §Tech-Debt #3 line 134-135, replace lines 588-593 with a hoisted append:

```typescript
// BEFORE (lines 584-593, current):
const phrasesClause = signalPhrases && signalPhrases.length
  ? ` Where natural, weave in hedge phrases like ${...}`
  : '';
if (dimensionHint) {
  return `${base}\n\nFocus today's entries on ${dimensionHint}.${phrasesClause}`;
}
return base;

// AFTER:
const phrasesClause = signalPhrases && signalPhrases.length
  ? ` Where natural, weave in hedge phrases like ${...}`
  : '';
let result = base;
if (dimensionHint) {
  result = `${result}\n\nFocus today's entries on ${dimensionHint}.`;
}
if (phrasesClause) {
  result = `${result}${phrasesClause}`;
}
return result;
```

This decouples `phrasesClause` from `dimensionHint` truthiness — Pitfall §7 mitigation per Phase 40 REVIEW.

### `scripts/synthesize-episodic.ts` (FIX-03 + FIX-08)

**Primary analog (FIX-03 dynamic migration list):** `scripts/test.sh:43-47` — the existing filter-`.sql` pattern that test.sh uses for its own apply chain. Per CONTEXT D-08 + Phase 24 REVIEW §BL-01 line 33:

```typescript
// AT lines 48-55, replace the hardcoded MIGRATIONS array with:
import { readdir } from 'node:fs/promises';

async function loadMigrations(): Promise<string[]> {
  const files = await readdir('src/db/migrations');
  return files
    .filter((f) => f.endsWith('.sql'))
    .sort()
    .map((f) => `src/db/migrations/${f}`);
}
```

Then call `const MIGRATIONS = await loadMigrations();` inside main() (since top-level await is allowed in this script's ESM context — verified via existing imports in `synthesize-episodic.ts:42-44`). The filter explicitly excludes the `meta/` subdirectory because `readdir` on `src/db/migrations` returns `meta` as a directory entry whose name doesn't end in `.sql` (filter naturally excludes it).

**Primary analog (FIX-08 AbortController SIGINT cleanup):** Per CONTEXT D-17 + Phase 24 REVIEW §BL-04 line 51. Pattern:

```typescript
// REPLACE lines 480-484 sigHandler that calls process.exit(130):
const abortController = new AbortController();
const sigHandler = (): void => {
  process.exitCode = 130;
  abortController.abort();
};
process.on('SIGINT', sigHandler);
process.on('SIGTERM', sigHandler);

// Inside main(): pass abortController.signal to long-running awaitable operations
// (postgres query loops, child process spawns). Existing finally blocks now run
// naturally as the event loop drains.
```

The pattern is the same shape for `scripts/fetch-prod-data.ts:273-277` and `scripts/regenerate-primed.ts:222-228` — see those files' rows below.

### `scripts/fetch-prod-data.ts` (FIX-04 + FIX-08)

**Primary analog (FIX-04 SSH hardening):** No in-repo SSH analog — this script is the sole SSH callsite. Per CONTEXT D-09/D-10 + Phase 24 REVIEW §BL-03 line 41-45:

```typescript
// AT lines 73-88, in the spawn argv array, ADD before SSH_TARGET:
[
  '-N',
  '-L', `${LOCAL_PORT}:localhost:5432`,
  '-o', 'ExitOnForwardFailure=yes',
  '-o', 'ConnectTimeout=10',
  '-o', 'ServerAliveInterval=30',
  // NEW (FIX-04):
  '-o', 'StrictHostKeyChecking=accept-new',
  '-o', 'UserKnownHostsFile=scripts/.ssh-known-hosts',
  SSH_TARGET,
]
```

Plus add a header-comment block (above the `openTunnel` function) documenting the one-time bootstrap step:
```
// FIX-04 SSH hardening (Phase 45 v2.6.1):
//   StrictHostKeyChecking=accept-new — auto-trust the host key on first contact
//   (so fresh runners + new operators work without manual `ssh-keyscan`), but
//   refuse on key MISMATCH (closing the MITM-after-rotation window).
//   UserKnownHostsFile=scripts/.ssh-known-hosts — vetted, repo-committed.
//   Bootstrap: if scripts/.ssh-known-hosts is empty, the first connect populates
//   it; operator MUST commit the line back to the repo so subsequent runs see
//   the known key. To rotate: explicit PR replacing the line.
```

**Primary analog (FIX-08 SIGINT cleanup):** Per CONTEXT D-17. Modify `sigHandler` at lines 273-277:

```typescript
// BEFORE:
const sigHandler = (): void => {
  void closeTunnel(ssh).then(() => process.exit(130));
};

// AFTER:
const abortController = new AbortController();
const sigHandler = (): void => {
  process.exitCode = 130;
  abortController.abort();
};
```

Then thread `abortController.signal` into the table-dump loop (the `for table of TABLES` body around lines 290+) so the loop exits on abort and the existing `finally` block runs `closeTunnel(ssh)` + `await client?.end({ timeout: 5 })` naturally.

### `scripts/regenerate-primed.ts` (FIX-02 path-bug log + FIX-08 SIGINT child-await)

**Primary analog (FIX-02 path-bug log string):** `scripts/regenerate-primed.ts:291-304` — current `primedName` log. Per CONTEXT D-07b, the **test FIXTURE_PATH constants are the ones being updated** (`m011-1000words-5days`), not synthesize-delta.ts's path naming. The log string at line 304 already reads `tests/fixtures/primed/${primedName}/` — `primedName` is constructed at line 291 as `${args.milestone}-${args.targetDays}days` which produces the correct `m011-1000words-5days` already. No actual code change needed in regenerate-primed.ts for the path bug; the fix lands in the test files. **However**, the operator-instructions log line at the head of this file (any "regenerate using …" hint comment) needs to reflect `m011-1000words-5days` as the canonical name — to be verified during planning.

**Primary analog (FIX-08 child-await with SIGKILL fallback):** Per CONTEXT D-17 + Phase 24 REVIEW §WR-05 line 91-95:

```typescript
// REPLACE lines 222-228 sigHandler:
const abortController = new AbortController();
const sigHandler = (): void => {
  process.exitCode = 130;
  abortController.abort();
  if (activeChild) {
    activeChild.kill('SIGTERM');
    // Await up to 5s for child exit; force SIGKILL on timeout (WR-05 fix).
    const killTimer = setTimeout(() => {
      if (activeChild && activeChild.exitCode === null) {
        activeChild.kill('SIGKILL');
      }
    }, 5000);
    activeChild.on('exit', () => clearTimeout(killTimer));
  }
};
```

The composer's `child.on('exit', ...)` handlers in the existing chain (lines 250+) will naturally observe the SIGTERM/SIGKILL and unwind.

### `scripts/.ssh-known-hosts` (NEW)

**Primary analog:** OpenSSH `known_hosts` format. One entry per line — output of `ssh-keyscan -H 192.168.1.50 2>/dev/null`. Header comment (using `#` — supported by OpenSSH known_hosts parser):

```
# Repo-vetted SSH host key fingerprints for fetch-prod-data.ts.
#
# Phase 45 FIX-04 (v2.6.1, 2026-05-14):
# StrictHostKeyChecking=accept-new + this file together close the MITM window
# at first connect AND key rotation. The first operator to clone the repo
# populates this file (ssh-keyscan auto-fills on first contact); subsequent
# operators consume the committed key without prompting; key rotation
# requires an explicit PR replacing the line below.
#
# To rotate: 
#   1. Operator pre-commits the new host line (ssh-keyscan -H 192.168.1.50)
#   2. PR review verifies fingerprint match against out-of-band channel
#   3. Merge → all runners pick up the new key
#
# Host: 192.168.1.50 (Proxmox prod node)
```

Initial commit may ship an empty file with just the header — the first `fetch-prod-data.ts` invocation populates it via `accept-new`; the operator then runs `git add scripts/.ssh-known-hosts && git commit` to lock the key.

### `src/__tests__/fixtures/load-primed.ts` (FIX-05 staging-table CAST)

**Primary analog:** `24-REVIEW.md:63` recommends verbatim: "stage the JSONL rows into a temp table with `embedding text`, then `INSERT … SELECT …, embedding::vector FROM staging`". Per CONTEXT D-11 + D-12.

The current `insertTable('pensieve_embeddings.jsonl', 'pensieve_embeddings')` call at line 274 hits the `jsonb_populate_recordset(NULL::pensieve_embeddings, ...)` path which cannot coerce a JSONB array to `vector(1024)`. New pattern:

```typescript
// NEW helper function (local to load-primed.ts, not a sibling file — per
// CONTEXT "Claude's Discretion" line 92 the planner picks local-vs-sibling;
// chose local for minimal new-surface-area):
async function insertPensieveEmbeddings(
  client: postgres.Sql,
  fixtureDir: string,
): Promise<number> {
  const rows = await loadJsonl<Record<string, unknown>>(
    join(fixtureDir, 'pensieve_embeddings.jsonl'),
  );
  if (rows.length === 0) return 0;

  // Stage into a TEMP table with embedding as TEXT.
  await client`
    CREATE TEMP TABLE IF NOT EXISTS pensieve_embeddings_staging (
      LIKE pensieve_embeddings INCLUDING ALL EXCLUDING CONSTRAINTS
    );
  `;
  // Override the embedding column type to TEXT in the staging table.
  await client`
    ALTER TABLE pensieve_embeddings_staging
      ALTER COLUMN embedding TYPE text USING embedding::text;
  `;
  // Bulk-load JSONL into staging (jsonb_populate_recordset works because
  // the staging column is TEXT, not VECTOR).
  await client.unsafe(
    `INSERT INTO pensieve_embeddings_staging
       SELECT * FROM jsonb_populate_recordset(
         NULL::pensieve_embeddings_staging, $1::jsonb)`,
    [JSON.stringify(rows)],
  );
  // Final INSERT with explicit CAST.
  await client`
    INSERT INTO pensieve_embeddings
    SELECT
      id, pensieve_entry_id,
      embedding::vector AS embedding,
      model, created_at
    FROM pensieve_embeddings_staging
  `;
  // Cleanup (TEMP table auto-drops at session end, but explicit for clarity).
  await client`DROP TABLE pensieve_embeddings_staging`;
  return rows.length;
}

// Call sites: replace lines 274:
//   await insertTable('pensieve_embeddings.jsonl', 'pensieve_embeddings');
// with:
const embeddingsCount = await insertPensieveEmbeddings(client, fixtureDir);
counts['pensieve_embeddings'] = embeddingsCount;
```

**Smoke test (D-12):** Add a single-row real-shaped 1024-dim fixture under `src/__tests__/fixtures/__fixtures__/pgvector-smoke/pensieve_embeddings.jsonl` (1 entry, `embedding: [<1024 floats>]`) and a vitest test that loads it via `loadPrimedFixture('pgvector-smoke')` and asserts row count == 1. Closes regression on first non-empty regen.

### `src/__tests__/fixtures/primed-sanity-m011.test.ts` (FIX-02 + FIX-07 + WR-01)

**Primary analog (FIX-02b path constant):** Per CONTEXT D-07b + Phase 40 REVIEW §BL-01 fix-Option-b (lines 38-42):

```typescript
// BEFORE (lines 163-164):
const M1K_NAME = 'm011-1000words';
const M1K_PATH = `tests/fixtures/primed/${M1K_NAME}/MANIFEST.json`;

// AFTER:
const M1K_NAME = 'm011-1000words-5days'; // matches synthesize-delta.ts:937 naming
const M1K_PATH = `tests/fixtures/primed/${M1K_NAME}/MANIFEST.json`;
```

Same change in `src/memory/profiles/__tests__/integration-m011-1000words.test.ts:124` (the FIXTURE_PATH there). The deferred-items.md docs at `.planning/milestones/v2.6-phases/40-psychological-milestone-tests/deferred-items.md:31-32` updated to reflect the new path.

**Primary analog (FIX-07 calendar-month-window in `totalTelegramWordCount`):** Per CONTEXT D-15 + Phase 40 REVIEW §BL-05 line 67-72. Mirror `psychological-shared.ts:248-273` verbatim — use luxon DateTime + previousMonthStart/End in Europe/Paris:

```typescript
// REPLACE lines 89-100 totalTelegramWordCount with a NOW-driven version:
async function totalTelegramWordCount(now: Date): Promise<number> {
  const nowParis = DateTime.fromJSDate(now, { zone: 'Europe/Paris' });
  const monthStart = nowParis.startOf('month').minus({ months: 1 });
  const monthEnd = monthStart.endOf('month');
  const windowStart = monthStart.toJSDate();
  const windowEnd = monthEnd.toJSDate();

  const rows = await db.execute<{ word_count: number }>(
    drizzleSql`
      SELECT COALESCE(SUM(array_length(regexp_split_to_array(content, E'\\s+'), 1)), 0)::int AS word_count
      FROM pensieve_entries
      WHERE source = 'telegram' AND deleted_at IS NULL
        AND created_at >= ${windowStart}
        AND created_at <= ${windowEnd}
    `,
  );
  return rows.rows[0]?.word_count ?? 0;
}
```

Also fix WR-02 — use `.rows` accessor explicitly (drizzle node-postgres driver returns `{ rows: T[], ... }` envelope, not a plain array — per Phase 40 REVIEW WR-02).

Drive HARN test calls with pinned NOW constants matching each downstream integration test's NOW (m011-30days uses `NOW = 2026-05-01`; m011-1000words uses the same — substrate window = April 2026).

**Primary analog (WR-01 strict-inequality alignment with `MIN_SPEECH_WORDS`):** Per CONTEXT D-16 + Phase 40 REVIEW §WR-01 line 76-79:

```typescript
// Import the constant (verified: lives in src/memory/confidence.ts already)
import { MIN_SPEECH_WORDS } from '../../memory/confidence.js';

// REPLACE line 120:
const MIN_WORDS_30D = 5000; // D-06 verbatim — substrate floor
// WITH:
const MIN_WORDS_30D = MIN_SPEECH_WORDS;

// REPLACE line 141 assertion `.toBeGreaterThan(MIN_WORDS_30D)`:
expect(wordCount).toBeGreaterThanOrEqual(MIN_WORDS_30D);

// REPLACE line 167:
const MAX_WORDS_1K = 5000;
// WITH:
const MAX_WORDS_1K = MIN_SPEECH_WORDS;

// REPLACE line 188 assertion `.toBeLessThan(MAX_WORDS_1K)`:
expect(wordCount).toBeLessThan(MAX_WORDS_1K);  // already correct strict-<
```

Closes the 1-word gap at exactly `wordCount === 5000`. CONTEXT D-16 line 89 notes `MIN_SPEECH_WORDS` already exists in `src/memory/confidence.ts` — no new file needed; planner picks import path.

### Fixture refresh artefacts (FIX-06 — Plan 45-04)

**Primary analog:** Operator command — `npx tsx scripts/regenerate-primed.ts --milestone m010 --force` — invoked AFTER Plan 45-03 (migration 0016) has applied. The regen reads the test DB after `scripts/test.sh` would set it up (or the operator runs the migration apply chain manually on a throwaway DB).

The OUTPUTS are JSONL files under `tests/fixtures/primed/m010-30days/`, `tests/fixtures/primed/m010-5days/`, and `tests/fixtures/primed/m010-anti-hallucination/` (per current m010 fixture layout). Commit message MUST reference the SCHEMA-02 commit SHA per CONTEXT D-13 (e.g., `chore(45): refresh m010 fixtures against SCHEMA-02 backfill (<sha>)`).

Verification per CONTEXT D-14: `npx vitest run src/memory/profiles/__tests__/live-anti-hallucination.test.ts` locally — assertions should NO LONGER emit `family.parent_care_responsibilities` or `health.wellbeing_trend` schema_mismatch warns.

---

## Cross-File Pattern Notes

**Pattern reference — drizzle migration ordering:** Filename lexicographic ordering IS the apply order. The Phase 32 #3 monotonic-`when` guardrail at `scripts/validate-journal-monotonic.ts` enforces that `_journal.json` entries have strictly increasing `when` timestamps. New 0015/0016 entries MUST have `when` values greater than 0013's `1778699398922` AND than 0014's (Phase 43 — pending; landed before 0015's `when`). Plan 45-01 / 45-03 verification gates include this guardrail.

**Pattern reference — drizzle-kit snapshot generation:** Operator runs `npx drizzle-kit generate` after manually authoring the SQL file → drizzle-kit produces `0015_snapshot.json` / `0016_snapshot.json` + appends the `_journal.json` entry. The `scripts/regen-snapshots.sh` script is the canonical wrapper that drives this (see existing 0013 plan/SUMMARY).

**Pattern reference — `scripts/test.sh` migration apply line:** Each new migration adds a `MIGRATION_N_SQL=` variable assignment (top of file) + a `psql ... < "$MIGRATION_N_SQL"` apply line (in the migration loop) + (optionally) a post-apply smoke gate (per HARD CO-LOC pattern). For 0015 (CHECK constraints) the smoke gate verifies the constraints exist via `\d+ profile_hexaco`-style introspection; for 0016 (backfill) the smoke gate verifies a sample row has the backfilled jsonb shape via `SELECT wellbeing_trend FROM profile_health WHERE substrate_hash = '' LIMIT 1;` and asserts the result includes the `energy_30d_mean` key.

**Pattern reference — `scripts/regen-snapshots.sh` cleanup sentinels:** Bumps the `MIGRATION_N=` reference variable + the cleanup sentinels at lines 118-122 and 140-153 (per `regen-snapshots.sh` existing pattern). For 0015/0016, two separate bumps in two separate plans (45-01 bumps from N=13→15; 45-03 bumps from N=15→16).

**Anti-pattern to avoid (CONTEXT specifics):** The current `m011-1000words` test path mismatch is the canonical "same constant in two places that drift" footgun. FIX-07's `MIN_SPEECH_WORDS` consolidation prevents the same class for the word-count gate. Do NOT duplicate constants between FIX-02b path fix and FIX-07 word-count consolidation — there are TWO separate concerns (path string, word-count integer) and they live in different modules.

---

## PATTERN MAPPING COMPLETE

11 files NEW or MODIFIED + 14 fixture artefacts REGENERATED = 25 total file touches across 4 plans.
All 23 modifications have direct in-repo precedents OR are documented patterns from review files.
Wave DAG D-02 honored: 4-plan partition matches the 3-wave structure (Wave A = Plans 45-01 + 45-02 in parallel; Wave B = Plan 45-03; Wave C = Plan 45-04).
