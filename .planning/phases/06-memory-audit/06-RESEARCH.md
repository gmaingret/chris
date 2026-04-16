# Phase 6: Memory Audit - Research

**Researched:** 2026-04-13
**Domain:** Pensieve data audit — soft-delete correction, ground-truth fixture, local seed/run cycle
**Confidence:** HIGH

<user_constraints>
## User Constraints (from CONTEXT.md)

### Locked Decisions

- **D-01:** Incorrect Pensieve entries are soft-deleted (set `deletedAt`) and corrected versions re-inserted as new entries with `source='audit'`. Existing retrieval already filters `deletedAt IS NULL`, so corrections take effect immediately.
- **D-02:** Corrected entries get embeddings generated immediately (not deferred to pipeline) so they're retrievable right away.
- **D-03:** Ground truth stored as a TypeScript const in `src/pensieve/ground-truth.ts` — a typed `Record<string, string>` (or similar structured export) with categorized facts (identity, location_history, property, business, financial). Directly importable by Phase 8 (structured fact injection) and Phase 10 (live tests).
- **D-04:** Audit covers only the fact categories in the M006 spec ground truth: location history, property (Golfe-Juan rental), business entities (MAINGRET LLC, Georgian IE), key dates (birth, moves), nationality, Panama residency, FI target. Other FACT/RELATIONSHIP-tagged entries are out of scope for this phase.
- **D-05:** Audit script generates a markdown report in `.planning/phases/06-memory-audit/` listing each entry reviewed, correctness status, and action taken (kept, soft-deleted, replaced).
- **D-06:** Run Chris locally with Docker Compose. A seed script inserts realistic Pensieve entries mimicking real conversations — some with correct facts, some with known errors (Cagnes-sur-Mer/Golfe-Juan mix-up, wrong move direction, etc.). Audit script runs against this local DB.
- **D-07:** After local testing passes, the same audit script runs against production with a dry-run flag first (report-only), then a wet-run with explicit user approval per D019.

### Claude's Discretion

- Seed data details: Claude decides the specific conversation entries to generate, as long as they cover the ground-truth categories and include the known error patterns from the M006 spec.
- Audit script structure: Claude decides internal implementation (query patterns, matching logic, report formatting).

### Deferred Ideas (OUT OF SCOPE)

None — discussion stayed within phase scope.

</user_constraints>

<phase_requirements>
## Phase Requirements

| ID | Description | Research Support |
|----|-------------|------------------|
| RETR-03 | Memory audit completed — all incorrect/outdated Pensieve entries about Greg reconciled against ground truth | Ground-truth TypeScript const, soft-delete correction pattern, seed + audit scripts, local Docker test cycle, markdown audit report |

</phase_requirements>

---

## Summary

Phase 6 is a data-correctness phase, not a feature-code phase. The deliverables are:
(1) a TypeScript ground-truth module (`src/pensieve/ground-truth.ts`) that codifies authoritative facts about Greg,
(2) a seed script that inserts realistic Pensieve entries including known error patterns against a local Docker Postgres instance,
(3) an audit script that queries the Pensieve, compares entries against ground truth, soft-deletes incorrect ones, inserts corrected replacements with immediate embeddings, and writes a markdown report, and
(4) a production run of that same audit script under the D019 approval gate.

The entire phase is built on already-existing infrastructure: `storePensieveEntry()`, `embedAndStore()`, Drizzle ORM, Docker Compose local test setup. No new dependencies are required. The complexity is in correctly identifying which Pensieve entries correspond to each audited fact category, soft-deleting the bad ones, and generating the corrected replacements with synchronous embeddings (departing from the normal fire-and-forget contract per D-02).

The M006 spec names the exact ground truth facts and the known error patterns (Cagnes-sur-Mer vs Golfe-Juan, wrong move direction). These drive both the seed data and the audit assertions. The ground-truth module must export a structure that Phase 8 (structured fact injection) and Phase 10 (live integration tests) can import directly — the TypeScript type matters.

**Primary recommendation:** Write `ground-truth.ts` first (it's the shared contract), then the seed script, then the audit script. Run locally against Docker Compose test DB (port 5433). Audit report goes in `.planning/phases/06-memory-audit/`. Production run is the final step after local pass.

---

## Standard Stack

### Core (all already in project — no new installs)
| Library | Version | Purpose | Why Standard |
|---------|---------|---------|--------------|
| drizzle-orm | (existing) | Querying and updating `pensieve_entries` | Project ORM — type-safe, already used everywhere |
| postgres (postgres.js) | (existing) | DB client via `src/db/connection.ts` | Project DB client |
| @huggingface/transformers | (existing) | bge-m3 embeddings via `embedText()` | Project embedding model — required for D-02 synchronous embeddings |
| vitest | ^4.1.2 | Test runner | Project test framework |
| Docker Compose | (existing) | Local Postgres on port 5433 | `docker-compose.local.yml` + `scripts/test.sh` pattern |

[VERIFIED: codebase grep — package.json, existing src files]

### No New Dependencies Required

The audit and seed scripts reuse:
- `storePensieveEntry()` from `src/pensieve/store.ts` — insert seed entries and corrected replacements
- `embedText()` + `embedAndStore()` from `src/pensieve/embeddings.ts` — synchronous embedding per D-02
- `db` from `src/db/connection.ts` — Drizzle ORM client for soft-delete UPDATE queries
- `pensieveEntries` schema from `src/db/schema.ts` — typed column access

[VERIFIED: codebase read of all four files]

---

## Architecture Patterns

### Recommended Project Structure

New files this phase:

```
src/
├── pensieve/
│   └── ground-truth.ts          # NEW — exported typed const, imported by Phase 8 + 10
src/
└── scripts/
    ├── seed-audit-data.ts        # NEW — inserts seed entries against local DB
    └── audit-pensieve.ts         # NEW — queries, compares, soft-deletes, re-inserts, reports

.planning/phases/06-memory-audit/
└── audit-report.md              # NEW — generated by audit script (D-05)
```

### Pattern 1: Ground-Truth Module

`src/pensieve/ground-truth.ts` exports a typed record so downstream phases import types cleanly.

```typescript
// Source: CONTEXT.md D-03, M006_Trustworthy_Chris.md ground truth section

export type FactCategory = 'identity' | 'location_history' | 'property' | 'business' | 'financial';

export interface GroundTruthEntry {
  key: string;
  value: string;
  category: FactCategory;
}

export const GROUND_TRUTH: GroundTruthEntry[] = [
  // identity
  { key: 'nationality', value: 'French', category: 'identity' },
  { key: 'birth_date', value: '1979-06-15', category: 'identity' },
  { key: 'birth_place', value: 'Cagnes-sur-Mer, France', category: 'identity' },

  // location_history (ordered chronologically)
  { key: 'current_location', value: 'Saint Petersburg, Russia (until 2026-04-28)', category: 'location_history' },
  { key: 'next_move', value: 'Batumi, Georgia (~1 month, from 2026-04-28)', category: 'location_history' },
  { key: 'after_batumi', value: 'Antibes, France (June through end of August 2026)', category: 'location_history' },
  { key: 'permanent_relocation', value: 'Batumi, Georgia (permanent, from ~September 2026)', category: 'location_history' },

  // property
  { key: 'rental_property', value: 'Golfe-Juan, France', category: 'property' },
  { key: 'rental_manager', value: 'Citya (since October 2022)', category: 'property' },

  // business
  { key: 'business_us', value: 'MAINGRET LLC (New Mexico)', category: 'business' },
  { key: 'business_georgia', value: 'Georgian Individual Entrepreneur', category: 'business' },
  { key: 'residency_panama', value: 'Panama permanent residency', category: 'business' },

  // financial
  { key: 'fi_target', value: '$1,500,000', category: 'financial' },
];

// Flat map for quick key lookups (used by audit script and Phase 8 injection)
export const GROUND_TRUTH_MAP: Record<string, string> = Object.fromEntries(
  GROUND_TRUTH.map((e) => [e.key, e.value])
);
```

[ASSUMED — structure is correct per decisions, but exact TypeScript shape is Claude's discretion per CONTEXT.md]

### Pattern 2: Soft-Delete Correction

The audit script soft-deletes incorrect entries and inserts corrected ones. The key operation is an UPDATE setting `deletedAt` — Drizzle ORM handles this directly.

```typescript
// Source: src/db/schema.ts (deletedAt column), src/pensieve/store.ts (insert pattern)
// Pattern: soft-delete via UPDATE, then storePensieveEntry() for replacement

import { eq } from 'drizzle-orm';
import { db } from '../db/connection.js';
import { pensieveEntries } from '../db/schema.js';
import { storePensieveEntry } from '../pensieve/store.js';
import { embedAndStore } from '../pensieve/embeddings.js';

async function correctEntry(
  incorrectEntryId: string,
  correctedContent: string,
): Promise<string> {
  // Soft-delete the incorrect entry
  await db
    .update(pensieveEntries)
    .set({ deletedAt: new Date() })
    .where(eq(pensieveEntries.id, incorrectEntryId));

  // Insert corrected replacement
  const corrected = await storePensieveEntry(correctedContent, 'audit');

  // Synchronous embedding (D-02 — not fire-and-forget for audit entries)
  await embedAndStore(corrected.id, correctedContent);

  return corrected.id;
}
```

[VERIFIED: src/db/schema.ts deletedAt column; src/pensieve/store.ts storePensieveEntry signature; src/pensieve/embeddings.ts embedAndStore signature]

### Pattern 3: Seed Script Structure

The seed script inserts entries that mimic real Telegram conversations. It must cover all ground-truth categories and include specific error patterns the audit will catch and fix.

```typescript
// Source: CONTEXT.md §Specific Ideas, M006_Trustworthy_Chris.md
// Known errors to seed (audit must catch these):
// - "Cagnes-sur-Mer" used as rental property location (correct: Golfe-Juan)
// - Wrong move direction (e.g., "moving from Georgia to Saint Petersburg" inverted)
// - Use epistemicTag: 'FACT' or 'RELATIONSHIP' so they appear in fact-category queries

const SEED_ENTRIES = [
  // Correct entries
  { content: "I was born on June 15, 1979 in Cagnes-sur-Mer.", epistemicTag: 'FACT', source: 'telegram' },
  { content: "My rental property in Golfe-Juan has been managed by Citya since October 2022.", epistemicTag: 'FACT', source: 'telegram' },

  // Error entries (audit will correct these)
  { content: "My apartment in Cagnes-sur-Mer is rented out through Citya.", epistemicTag: 'FACT', source: 'telegram' },  // Wrong: should be Golfe-Juan
  { content: "I'm planning to move from Georgia to Saint Petersburg next month.", epistemicTag: 'FACT', source: 'telegram' },  // Wrong direction

  // More entries covering other categories...
];
```

[ASSUMED — specific seed content is Claude's discretion per CONTEXT.md; error patterns come from M006 spec]

### Pattern 4: Dry-Run / Wet-Run Flag (D-07)

The audit script accepts a `--dry-run` flag. In dry-run mode it only writes the markdown report; in wet-run mode it performs soft-deletes and insertions. This implements the D019 production approval gate.

```typescript
// Source: CONTEXT.md D-07, PROJECT.md D019
const isDryRun = process.argv.includes('--dry-run');

if (!isDryRun) {
  await correctEntry(entry.id, correctedContent);
}

// Always write the report
await writeReport(auditResults);
```

[ASSUMED — implementation pattern is Claude's discretion; dry-run flag is the D019 mechanism]

### Anti-Patterns to Avoid

- **Using `embedAndStoreChunked()` for audit entries:** Audit entries are short fact statements (< 200 chars). Single-chunk `embedAndStore()` is correct. `embedAndStoreChunked()` is for long documents from Gmail/Drive.
- **Fire-and-forget embedding for corrected entries:** D-02 explicitly requires synchronous embedding. Do not call `embedAndStore()` and not await it. Await the call.
- **Hard-deleting entries:** D004 (append-only) + D-01 are absolute. No DELETE statements. Soft-delete only via `SET deleted_at = NOW()`.
- **Running wet-run against production without dry-run review:** D019 (explicit user approval) + D-07 require dry-run first, report review, then explicit confirmation before wet-run.
- **Using UPDATE to modify entry content in place:** The pattern is soft-delete + re-insert, not UPDATE of content. This preserves the original entry for audit trail purposes.

---

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| DB connection | Custom postgres client | `src/db/connection.ts` | Already configured with schema |
| Entry insertion | Raw INSERT SQL | `storePensieveEntry()` | Handles logging, returning typed row |
| Embedding generation | Direct pipeline call | `embedAndStore()` | Handles error logging, swallowing |
| Soft-delete query | Raw SQL UPDATE | Drizzle `db.update(...).set({ deletedAt })` | Type-safe, consistent with existing codebase |

**Key insight:** This phase is purely orchestration of existing primitives. All I/O primitives already exist.

---

## Common Pitfalls

### Pitfall 1: epistemicTag not set on seed entries — audit queries miss them

**What goes wrong:** Seed entries inserted without `epistemicTag` default to `null`. Queries filtering on `epistemicTag IN ('FACT', 'RELATIONSHIP')` return no rows. Audit reports nothing to fix even though errors exist.

**Why it happens:** `storePensieveEntry()` does not accept `epistemicTag` — it uses the normal async tagger pipeline. Seed entries need to be inserted via Drizzle directly (or via a wrapper that sets `epistemicTag` in the INSERT) so audit-scope tags are set synchronously.

**How to avoid:** Seed script uses `db.insert(pensieveEntries).values({ ..., epistemicTag: 'FACT' })` directly, not `storePensieveEntry()` (which doesn't expose the tag parameter). Or build a small wrapper `seedEntry()` used only in the seed script.

**Warning signs:** Audit script reports 0 entries reviewed for FACT/RELATIONSHIP categories despite a populated DB.

[VERIFIED: src/pensieve/store.ts — storePensieveEntry() signature has no epistemicTag parameter; src/db/schema.ts — epistemicTagEnum column exists on table]

### Pitfall 2: embeddings not generated for seed entries — retrieval misses them

**What goes wrong:** Seed entries are inserted but `embedAndStore()` is not called. The HNSW index has no embedding row for these entries. Semantic search returns no results for fact-related queries even though entries exist.

**Why it happens:** The normal pipeline (engine → tagger → embedder) doesn't run during seed/audit scripts. Scripts must call `embedAndStore()` explicitly for each inserted entry.

**How to avoid:** After each `db.insert()` or `storePensieveEntry()` call in the seed script, immediately call `await embedAndStore(entry.id, entry.content)`.

**Warning signs:** `searchPensieve("rental property location")` returns 0 results after seeding.

[VERIFIED: src/pensieve/embeddings.ts — embedAndStore() is a separate callable function; not auto-called by storePensieveEntry()]

### Pitfall 3: bge-m3 model load time — script appears to hang

**What goes wrong:** First call to `embedText()` triggers lazy `getEmbeddingPipeline()`, which downloads/loads the bge-m3 ONNX model. This takes 10-30 seconds. Scripts with no progress output appear to hang.

**Why it happens:** `pipelineInstance` is `null` until first use. Model is ~1.1GB from HuggingFace cache.

**How to avoid:** Add a `console.log("Loading bge-m3 embedding model...")` before the first `embedText()` call. The model is cached in the Docker image — in the Docker environment this is fast (~2s). In bare Node.js outside Docker it may be slow on first run.

**Warning signs:** Script prints nothing for 20+ seconds after start.

[VERIFIED: src/pensieve/embeddings.ts — lazy singleton pattern via getEmbeddingPipeline()]

### Pitfall 4: `storePensieveEntry()` dedup creates collision with seed data

**What goes wrong:** Using `storePensieveEntryDedup()` in seed script with identical content strings causes the second insert to return the existing entry silently. Multiple seed runs produce only one copy of each entry.

**Why it happens:** `storePensieveEntryDedup()` checks `contentHash` before inserting.

**How to avoid:** Use plain `storePensieveEntry()` (no dedup) or `db.insert()` directly in seed scripts. The seed script is intentionally idempotent by being run once against a fresh local DB — not by dedup logic.

[VERIFIED: src/pensieve/store.ts — storePensieveEntryDedup() does contentHash lookup]

### Pitfall 5: Connecting audit script to wrong DB (production vs local)

**What goes wrong:** Audit script runs against production when intending to test locally. Real entries get soft-deleted.

**Why it happens:** `DATABASE_URL` env var points to production if `.env` is loaded without override.

**How to avoid:** Seed and local audit scripts must be run with explicit `DATABASE_URL=postgresql://chris:localtest123@localhost:5433/chris` prefix (matching docker-compose.local.yml port 5433). Alternatively, add a DB environment check at script startup that refuses to run wet against a non-localhost URL unless `--force-production` flag is set.

[VERIFIED: docker-compose.local.yml — port 5433 mapping; src/config.ts — reads DATABASE_URL env var]

---

## Code Examples

### Soft-delete an entry and insert corrected replacement

```typescript
// Source: src/db/schema.ts, src/pensieve/store.ts, src/pensieve/embeddings.ts

import { eq } from 'drizzle-orm';
import { db } from '../db/connection.js';
import { pensieveEntries } from '../db/schema.js';
import { storePensieveEntry } from '../pensieve/store.js';
import { embedAndStore } from '../pensieve/embeddings.js';

// Soft-delete incorrect entry
await db
  .update(pensieveEntries)
  .set({ deletedAt: new Date() })
  .where(eq(pensieveEntries.id, incorrectId));

// Insert corrected replacement with source='audit'
const corrected = await storePensieveEntry(correctedContent, 'audit');

// Synchronous embedding — D-02 requires this, not fire-and-forget
await embedAndStore(corrected.id, correctedContent);
```

### Query FACT/RELATIONSHIP entries without deletedAt filter override

```typescript
// Source: src/db/schema.ts, src/pensieve/retrieve.ts pattern

import { isNull, inArray } from 'drizzle-orm';
import { db } from '../db/connection.js';
import { pensieveEntries } from '../db/schema.js';

const factEntries = await db
  .select()
  .from(pensieveEntries)
  .where(
    and(
      isNull(pensieveEntries.deletedAt),
      inArray(pensieveEntries.epistemicTag, ['FACT', 'RELATIONSHIP']),
    )
  );
```

### Insert seed entry with explicit epistemicTag (bypass tagger pipeline)

```typescript
// Source: src/db/schema.ts — direct insert needed because storePensieveEntry() has no epistemicTag param

import { db } from '../db/connection.js';
import { pensieveEntries } from '../db/schema.js';
import { embedAndStore } from '../pensieve/embeddings.js';

const [entry] = await db
  .insert(pensieveEntries)
  .values({
    content: 'My rental property in Cagnes-sur-Mer is managed by Citya.',  // intentional error
    epistemicTag: 'FACT',
    source: 'telegram',
    metadata: { seedScenario: 'wrong_property_location' },
  })
  .returning();

await embedAndStore(entry.id, entry.content);
```

### Run audit script against local DB

```bash
# Start local postgres (docker-compose.local.yml, port 5433)
docker compose -f docker-compose.local.yml up -d postgres

# Seed test data
DATABASE_URL="postgresql://chris:localtest123@localhost:5433/chris" \
  npx tsx src/scripts/seed-audit-data.ts

# Dry-run audit (report only, no mutations)
DATABASE_URL="postgresql://chris:localtest123@localhost:5433/chris" \
  npx tsx src/scripts/audit-pensieve.ts --dry-run

# Wet-run audit (soft-deletes + corrections)
DATABASE_URL="postgresql://chris:localtest123@localhost:5433/chris" \
  npx tsx src/scripts/audit-pensieve.ts
```

---

## State of the Art

| Old Approach | Current Approach | When Changed | Impact |
|--------------|------------------|--------------|--------|
| Fire-and-forget embeddings for all entries | Synchronous embeddings for audit-inserted entries (D-02) | Phase 6 decision | Corrected entries retrievable immediately, not after async pipeline |
| prose-dump context (pre-M006) | Structured fact injection (Phase 8) | Phase 8 | Phase 6 ground-truth.ts is the prerequisite data contract |

---

## Assumptions Log

| # | Claim | Section | Risk if Wrong |
|---|-------|---------|---------------|
| A1 | `ground-truth.ts` exports `GroundTruthEntry[]` + `GROUND_TRUTH_MAP` as the TypeScript contract | Standard Stack / Code Examples | Phase 8/10 may need a different shape — adjust before Phase 8 starts, not during |
| A2 | Seed script uses `db.insert()` directly (not `storePensieveEntry()`) to set epistemicTag | Common Pitfalls / Code Examples | If a wrapper with epistemicTag is preferred, update accordingly — behavior is the same |
| A3 | Dry-run flag is `--dry-run` CLI argument | Architecture Patterns | Could be any mechanism — the requirement is D-07 pre-approval behavior |
| A4 | Audit script file lives at `src/scripts/audit-pensieve.ts` | Architecture Patterns | Could be `scripts/` at repo root — follow existing `scripts/test.sh` convention |

---

## Open Questions

1. **Does the audit script need to handle production entries already in the real DB (not just seed data)?**
   - What we know: D-07 requires a production wet-run after local testing passes. Production DB has real Telegram entries that may contain the known errors from real conversations.
   - What's unclear: Whether the audit script should attempt to identify real entries (via semantic search for keywords like "Cagnes-sur-Mer" as rental property) or only correct entries it can precisely identify.
   - Recommendation: Use keyword/pattern matching for the known error patterns (property location Cagnes-sur-Mer when context is rental, wrong move direction). Semantic search for category-related entries is unreliable for precise fact correction.

2. **Does `epistemicTag` need to be set on audit-inserted corrected entries?**
   - What we know: Corrected entries are inserted via `storePensieveEntry()` with `source='audit'`. That function does not set `epistemicTag` — the async tagger pipeline normally does this.
   - What's unclear: Whether corrected entries need to be immediately retrievable via FACT-filtered queries (which Phase 8 uses).
   - Recommendation: Yes — corrected entries should have `epistemicTag: 'FACT'` set synchronously (use `db.insert()` directly or extend `storePensieveEntry()` with an optional tag parameter for this phase).

---

## Environment Availability

| Dependency | Required By | Available | Version | Fallback |
|------------|------------|-----------|---------|----------|
| Docker | Local Postgres via docker-compose.local.yml | ✓ | 29.3.1 | — |
| Docker Compose | scripts/test.sh local DB pattern | ✓ | v5.1.1 | — |
| Node.js | Script execution via `npx tsx` | ✓ | v24.14.1 | — |
| npx / tsx | Running TypeScript scripts directly | ✓ | 11.11.0 | — |
| bge-m3 model | embedText() / embedAndStore() | ✓ (cached in Docker image) | Xenova/bge-m3 | — |

[VERIFIED: Bash tool — docker --version, docker compose version, node --version, npx --version]

**No missing dependencies.** All tools required for this phase are available.

---

## Validation Architecture

### Test Framework
| Property | Value |
|----------|-------|
| Framework | vitest ^4.1.2 |
| Config file | `vitest.config.ts` (root: `src`, include: `**/__tests__/**/*.test.ts`) |
| Quick run command | `npm test -- src/pensieve/__tests__/` |
| Full suite command | `npm test` (via `scripts/test.sh`, spins up Docker Postgres on port 5433) |

### Phase Requirements → Test Map

| Req ID | Behavior | Test Type | Automated Command | File Exists? |
|--------|----------|-----------|-------------------|-------------|
| RETR-03 | Ground-truth.ts exports valid typed structure | unit | `npm test -- src/pensieve/__tests__/ground-truth.test.ts` | ❌ Wave 0 |
| RETR-03 | Soft-delete correctly sets deletedAt; entry no longer returned by searchPensieve | integration | `npm test -- src/pensieve/__tests__/audit.test.ts` | ❌ Wave 0 |
| RETR-03 | Corrected entry (source='audit') is retrievable immediately after embedAndStore | integration | `npm test -- src/pensieve/__tests__/audit.test.ts` | ❌ Wave 0 |
| RETR-03 | Audit markdown report generated with correct columns | unit | `npm test -- src/scripts/__tests__/audit-report.test.ts` | ❌ Wave 0 |

### Sampling Rate
- **Per task commit:** `npm test -- src/pensieve/__tests__/ground-truth.test.ts src/pensieve/__tests__/audit.test.ts`
- **Per wave merge:** `npm test` (full suite via scripts/test.sh)
- **Phase gate:** Full suite green before `/gsd-verify-work`

### Wave 0 Gaps
- [ ] `src/pensieve/__tests__/ground-truth.test.ts` — validates GROUND_TRUTH exports, GROUND_TRUTH_MAP completeness, GroundTruthEntry types
- [ ] `src/pensieve/__tests__/audit.test.ts` — validates soft-delete mutation, corrected entry retrieval, dry-run no-op behavior
- [ ] `src/scripts/__tests__/audit-report.test.ts` — validates markdown report format and content

---

## Security Domain

This phase has no network-facing changes, no new API endpoints, and no new authentication surfaces. The only security-relevant consideration is:

### Production Access Control (D019)
The audit script must enforce the dry-run gate before any wet-run against production. This is an operational control, not a code security issue. The standard control is the `--dry-run` flag plus explicit user approval as documented in PROJECT.md D019.

### No Applicable ASVS Categories
V2 Authentication, V3 Session Management, V4 Access Control, V6 Cryptography — none apply to a CLI data-migration script that runs locally or over an already-secured private network to a self-hosted Postgres instance.

V5 Input Validation: Ground-truth values are TypeScript compile-time constants, not user input. No validation layer needed.

---

## Sources

### Primary (HIGH confidence)
- `src/db/schema.ts` — `pensieveEntries` table columns, `deletedAt`, `epistemicTag` enum values, `source` field
- `src/pensieve/store.ts` — `storePensieveEntry()` signature, dedup variants, no `epistemicTag` parameter
- `src/pensieve/retrieve.ts` — `searchPensieve()`, `isNull(deletedAt)` filter confirmed
- `src/pensieve/embeddings.ts` — `embedText()`, `embedAndStore()`, `embedAndStoreChunked()`, lazy pipeline singleton
- `src/db/connection.ts` — `db` export (Drizzle + postgres-js)
- `.planning/phases/06-memory-audit/06-CONTEXT.md` — all D-0x decisions, ground truth facts, known error patterns
- `M006_Trustworthy_Chris.md` — canonical ground truth, known errors, acceptance criteria
- `.planning/REQUIREMENTS.md` §RETR-03 — requirement definition
- `docker-compose.local.yml` — local DB at port 5433, credentials
- `scripts/test.sh` — test DB setup pattern (migrations, env vars)
- `vitest.config.ts` — test root and include patterns

### Secondary (MEDIUM confidence)
- `.planning/PROJECT.md` D004 (append-only), D019 (production approval), D031 (structured fact injection) — architectural constraints verified from file
- `src/config.ts` — `DATABASE_URL` env var pattern, model names

---

## Metadata

**Confidence breakdown:**
- Standard stack: HIGH — all libraries verified from existing codebase
- Architecture: HIGH — patterns derived directly from existing code; TypeScript shapes are Claude's discretion (A1)
- Pitfalls: HIGH — all five pitfalls verified against actual code (storePensieveEntry has no epistemicTag param, embedAndStore is not auto-called, lazy pipeline pattern, dedup behavior, port 5433)

**Research date:** 2026-04-13
**Valid until:** 2026-05-13 (stable codebase; valid until any Pensieve schema change)
