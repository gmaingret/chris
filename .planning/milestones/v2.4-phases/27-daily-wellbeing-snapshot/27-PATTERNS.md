# Phase 27: Daily Wellbeing Snapshot — Patterns Map

**Mapper:** gsd-pattern-mapper (--auto, sub-step of plan-phase)
**Date:** 2026-04-26
**Status:** complete

This document maps **every** pattern Phase 27's plans rely on to a concrete codebase precedent OR an explicit "no precedent — first use" callout. Plan authors use this as a quick-reference card to avoid reinventing established patterns.

---

## Map by Pattern

### 1. Grammy `bot.on('callback_query:data', handler)` registration — **FIRST USE in codebase**

**No prior precedent** in `src/`. Verified via grep: zero existing `callback_query|InlineKeyboard|reply_markup` matches.

**External pattern source:** [grammY callback_query reference](https://grammy.dev/ref/types/callbackquery) + [grammY filter docs](https://grammy.dev/guide/filter-queries.html).

**Reference shape Phase 27 introduces** (Plan 27-01):

```typescript
// In src/bot/bot.ts, after bot.on('message:document', ...) and BEFORE bot.catch:
import { handleRitualCallback } from './handlers/ritual-callback.js';
// eslint-disable-next-line @typescript-eslint/no-explicit-any
bot.on('callback_query:data', handleRitualCallback as any);
```

**Plans using this pattern:** 27-01.

**Future-proofing note for Phase 28/29:** the dispatcher in `src/bot/handlers/ritual-callback.ts` is designed with prefix-based routing (`r:w:*` for wellbeing, future `r:adj:*` for Phase 28 adjustment dialogue, future `r:wr:*` for Phase 29 weekly review confirmation). Phases 28 and 29 add new prefix branches to the same dispatcher; they do NOT add new `bot.on('callback_query:data')` registrations.

---

### 2. Grammy `InlineKeyboard` construction — **FIRST USE in codebase**

**No prior precedent.** External pattern source: [grammY InlineKeyboard reference](https://grammy.dev/ref/core/inlinekeyboard) + node_modules verification at `node_modules/grammy/out/convenience/keyboard.d.ts`.

**Reference shape Phase 27 introduces** (Plan 27-02):

```typescript
import { InlineKeyboard } from 'grammy';

const kb = new InlineKeyboard()
  .text('1', 'r:w:e:1').text('2', 'r:w:e:2').text('3', 'r:w:e:3').text('4', 'r:w:e:4').text('5', 'r:w:e:5').row()
  .text('1', 'r:w:m:1').text('2', 'r:w:m:2').text('3', 'r:w:m:3').text('4', 'r:w:m:4').text('5', 'r:w:m:5').row()
  .text('1', 'r:w:a:1').text('2', 'r:w:a:2').text('3', 'r:w:a:3').text('4', 'r:w:a:4').text('5', 'r:w:a:5').row()
  .text('Skip', 'r:w:skip');

await bot.api.sendMessage(chatId, prompt, { reply_markup: kb });
```

**Plans using this pattern:** 27-02.

---

### 3. Idempotent migration with seed insert — `INSERT … ON CONFLICT (name) DO NOTHING`

**Codebase precedent:** Phase 25's migration `0006_rituals_wellbeing.sql` uses `CREATE TABLE IF NOT EXISTS` + `ADD VALUE IF NOT EXISTS` + DO-block FK guards (idempotent guards described in `MD-02` comment at file top). Phase 27's seed insert mirrors the idempotency philosophy with `ON CONFLICT (name) DO NOTHING`.

**Reference shape Phase 27 uses** (Plan 27-02):

```sql
-- 0008_wellbeing_seed.sql
INSERT INTO rituals (name, type, next_run_at, config)
VALUES (
  'daily_wellbeing',
  'daily',
  (date_trunc('day', now() AT TIME ZONE 'Europe/Paris') + interval '9 hours' +
   CASE WHEN now() AT TIME ZONE 'Europe/Paris' >= date_trunc('day', now() AT TIME ZONE 'Europe/Paris') + interval '9 hours'
        THEN interval '1 day' ELSE interval '0' END) AT TIME ZONE 'Europe/Paris',
  '{
    "fire_at": "09:00",
    "skip_threshold": 3,
    "mute_until": null,
    "time_zone": "Europe/Paris",
    "prompt_set_version": "v1",
    "schema_version": 1
  }'::jsonb
)
ON CONFLICT (name) DO NOTHING;
```

**Constraint reference:** `rituals_name_unique` from Phase 25 migration 0006 line 33 — `CONSTRAINT "rituals_name_unique" UNIQUE("name")`. Idempotent re-application: re-running 0008 against an already-seeded DB is a no-op.

**Plans using this pattern:** 27-02.

---

### 4. drizzle-kit snapshot regeneration via `scripts/regen-snapshots.sh`

**Codebase precedent:** Phase 25 Plan 01 (most recent invocation, 2026-04-26). Pattern originally landed in v2.1 Phase 19 to fix TECH-DEBT-19-01.

**Reference shape Phase 27 uses** (Plan 27-02):

```bash
bash scripts/regen-snapshots.sh
# Generates new src/db/migrations/meta/0008_snapshot.json
# Updates src/db/migrations/meta/_journal.json with the 0008 entry
```

**Friction note (per Phase 25 LEARNINGS):** Script's port-5434 Docker bind conflicts with the running test postgres (port 5433). Operator workaround: `docker compose down` test postgres BEFORE running regen-snapshots.

**Plans using this pattern:** 27-02.

---

### 5. `scripts/test.sh` substrate gate (psql assertion)

**Codebase precedent:** Phase 25 Plan 01 added the `6|1|3` substrate gate (6 tables + 1 enum value + 3 indexes) immediately after migration apply, BEFORE vitest. Phase 27 mirrors with a single-line ritual-row count assertion.

**Reference shape Phase 27 uses** (Plan 27-02):

```bash
# Inside scripts/test.sh, after migration apply:
psql ... -tAc "SELECT count(*) FROM rituals WHERE name = 'daily_wellbeing'" | \
  awk '$1 != "1" { print "MIGRATION 0008: daily_wellbeing seed missing"; exit 1 }'
```

(Phase 26 sibling adds peer line for `daily_voice_note`. Phase 29 will add for `weekly_review`. All independent.)

**Plans using this pattern:** 27-02.

---

### 6. `dispatchRitualHandler` switch case extension

**Codebase precedent:** Phase 25 `src/rituals/scheduler.ts:260-266` ships the throwing skeleton:

```typescript
async function dispatchRitualHandler(ritual: typeof rituals.$inferSelect): Promise<void> {
  throw new Error(
    `rituals.dispatch: handler not implemented for ${ritual.type} (Phase 25 ships skeleton; Phases 26-29 fill)`,
  );
}
```

**Reference shape Phase 27 introduces** (Plan 27-02):

Replace the throwing skeleton with a switch on `ritual.name` (NOT `ritual.type` — the type column is the cadence enum, not the ritual identity):

```typescript
import { fireWellbeing } from './wellbeing.js';

async function dispatchRitualHandler(ritual: typeof rituals.$inferSelect): Promise<void> {
  switch (ritual.name) {
    case 'daily_wellbeing':
      await fireWellbeing(ritual);
      return;
    // case 'daily_voice_note': await fireVoiceNote(ritual); return;  // Phase 26
    // case 'weekly_review':    await fireWeeklyReview(ritual); return; // Phase 29
    default:
      throw new Error(
        `rituals.dispatch: handler not implemented for ${ritual.name} (Phases 26 + 29 fill)`,
      );
  }
}
```

**Sibling collision watch:** Phase 26 will also touch this switch (filling `'daily_voice_note'` case). Phase 29 will fill `'weekly_review'`. All three cases are independent edits to the same function. Orchestrator merges at end of parallel batch.

**Plans using this pattern:** 27-02.

---

### 7. Postgres `jsonb_set` atomic per-column merge

**Codebase precedent:** None in current `src/` for jsonb_set specifically (verified via grep). Drizzle's `sql` template tag for raw SQL inside `.set()` IS used elsewhere — `src/episodic/sources.ts` and `src/db/schema.ts` use the `sql` template for default values and partial-index predicates.

**Reference shape Phase 27 introduces** (Plan 27-02):

```typescript
import { sql } from 'drizzle-orm';

// Per-tap partial-state merge — atomic at Postgres column level (no TOCTOU race)
await db.update(ritualResponses)
  .set({
    metadata: sql`jsonb_set(coalesce(${ritualResponses.metadata}, '{}'::jsonb), '{partial,${sql.raw(dim)}}', ${value}::jsonb, true)`,
  })
  .where(eq(ritualResponses.id, fireRowId));
```

**Note:** Planner verifies the exact `sql.raw` escaping for the `dim` placeholder (it's a 1-char dimension code 'e'/'m'/'a' validated server-side, so SQL injection is bounded — but `sql.raw` should be used carefully). Alternative approach uses `db.execute(sql\`UPDATE … \`)` with a fully-bound query.

**`jsonb_set` API (Postgres 16):** `jsonb_set(target, path, new_value, create_missing)` — `create_missing=true` ensures the path is created if missing (required for the first tap when `metadata.partial` doesn't exist yet).

**Plans using this pattern:** 27-02.

---

### 8. `INSERT … ON CONFLICT … DO UPDATE SET col=EXCLUDED.col` upsert

**Codebase precedent:** `src/episodic/consolidate.ts:185-250` uses this pattern for `episodic_summaries` per CONS-03:
```typescript
await db.insert(episodicSummaries).values({...}).onConflictDoNothing();
```

(Note: `onConflictDoNothing`, not `onConflictDoUpdate`. Phase 27 uses the UPDATE variant because we want completion to be idempotent — if Greg somehow re-completes a snapshot for the same date, the values update.)

**Reference shape Phase 27 uses** (Plan 27-02):

```typescript
import { sql } from 'drizzle-orm';

// Completion-gated wellbeing_snapshots write (all 3 dims captured)
await db.insert(wellbeingSnapshots)
  .values({
    snapshotDate: today,
    energy: partial.e,
    mood: partial.m,
    anxiety: partial.a,
  })
  .onConflictDoUpdate({
    target: wellbeingSnapshots.snapshotDate,
    set: {
      energy: sql.raw('EXCLUDED.energy'),
      mood: sql.raw('EXCLUDED.mood'),
      anxiety: sql.raw('EXCLUDED.anxiety'),
    },
  });
```

**Drizzle `onConflictDoUpdate` API verified** at node_modules/drizzle-orm. The `target` parameter accepts the constraint column reference; `set` accepts a partial of the table's insert shape. `sql.raw('EXCLUDED.energy')` is the way to reference the EXCLUDED pseudo-table from inside Drizzle's update set.

**Plans using this pattern:** 27-02.

---

### 9. Operator script with ESM entry-point guard

**Codebase precedent:** `scripts/manual-sweep.ts` (Phase 25 Plan 03 D-07), `scripts/backfill-episodic.ts:283`, `scripts/regenerate-primed.ts`. All follow the pattern.

**Reference shape Phase 27 uses** (Plan 27-03):

```typescript
#!/usr/bin/env node
/**
 * scripts/fire-wellbeing.ts — Phase 27 Plan 03 (D-07-style operator wrapper)
 * ...
 */
import { db } from '../src/db/connection.js';
import { rituals } from '../src/db/schema.js';
import { fireWellbeing } from '../src/rituals/wellbeing.js';
import { eq } from 'drizzle-orm';
import { logger } from '../src/utils/logger.js';

async function main(): Promise<void> {
  try {
    const [ritual] = await db.select().from(rituals).where(eq(rituals.name, 'daily_wellbeing')).limit(1);
    if (!ritual) {
      console.error('No daily_wellbeing ritual seeded. Run migrations first.');
      process.exit(1);
    }
    await fireWellbeing(ritual);
    console.log('Fired daily_wellbeing — check Telegram for the keyboard.');
    process.exit(0);
  } catch (err) {
    logger.error({ err }, 'fire-wellbeing.error');
    process.exit(1);
  }
}

if (import.meta.url === `file://${process.argv[1]}`) {
  void main();
}
```

**Plans using this pattern:** 27-03.

---

### 10. Real-DB integration test against Docker postgres on port 5433

**Codebase precedent:** `src/rituals/__tests__/idempotency.test.ts` (Phase 25 Plan 02) — verified file exists. Tests `tryFireRitualAtomic` against real Docker postgres.

**Reference shape Phase 27 uses** (Plan 27-03):

```typescript
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { db } from '../../db/connection.js';
import { rituals, ritualResponses, wellbeingSnapshots } from '../../db/schema.js';
// ... etc

describe('wellbeing handler', () => {
  let testRitualId: string;

  beforeEach(async () => {
    // Seed a daily_wellbeing ritual with deterministic next_run_at for testing
    const [r] = await db.insert(rituals).values({
      name: `test_wb_${Date.now()}`,
      type: 'daily',
      nextRunAt: new Date(),
      config: { /* RitualConfigSchema-conformant */ },
    }).returning();
    testRitualId = r!.id;
  });

  afterEach(async () => {
    // Cleanup — delete in FK order: ritual_responses → wellbeing_snapshots → rituals
    await db.delete(ritualResponses).where(eq(ritualResponses.ritualId, testRitualId));
    await db.delete(rituals).where(eq(rituals.id, testRitualId));
  });

  it('per-tap merges into metadata.partial via jsonb_set (rapid-tap concurrency)', async () => {
    // Initial fire to create ritual_responses row
    const ritual = await db.select().from(rituals).where(eq(rituals.id, testRitualId)).limit(1);
    await fireWellbeing(ritual[0]!);

    // Rapid-tap concurrency
    await Promise.all([
      handleWellbeingCallback(buildMockCtx(), 'r:w:e:3'),
      handleWellbeingCallback(buildMockCtx(), 'r:w:m:4'),
      handleWellbeingCallback(buildMockCtx(), 'r:w:a:2'),
    ]);

    // Assert all 3 keys present
    const [row] = await db.select().from(ritualResponses).where(eq(ritualResponses.ritualId, testRitualId)).limit(1);
    expect(row!.metadata).toMatchObject({ partial: { e: 3, m: 4, a: 2 } });
  });
});
```

**Plans using this pattern:** 27-03.

---

### 11. Mocked Grammy Context for routing tests

**Codebase precedent:** `src/bot/__tests__/document-handler.test.ts`, `src/bot/__tests__/sync-handler.test.ts` — verified files exist; both use minimal ctx-stub builders.

**Reference shape Phase 27 uses** (Plan 27-01):

```typescript
import { describe, it, expect, vi } from 'vitest';
import { handleRitualCallback } from '../handlers/ritual-callback.js';

function buildMockCtx(callbackData?: string) {
  return {
    callbackQuery: callbackData ? { data: callbackData } : undefined,
    answerCallbackQuery: vi.fn().mockResolvedValue(true),
    editMessageReplyMarkup: vi.fn().mockResolvedValue(true),
    editMessageText: vi.fn().mockResolvedValue(true),
  } as any;
}

describe('handleRitualCallback', () => {
  it('routes r:w:* to wellbeing handler', async () => {
    const ctx = buildMockCtx('r:w:e:3');
    await handleRitualCallback(ctx);
    // Assert handleWellbeingCallback was called (mock the import)
    // Or: integration-style — assert no throw + answerCallbackQuery was called
  });

  it('silently acks unknown ritual prefixes', async () => {
    const ctx = buildMockCtx('r:adj:accept'); // Phase 28 prefix not yet implemented
    await handleRitualCallback(ctx);
    expect(ctx.answerCallbackQuery).toHaveBeenCalled();
  });

  it('silently acks unknown root prefixes', async () => {
    const ctx = buildMockCtx('foo:bar');
    await handleRitualCallback(ctx);
    expect(ctx.answerCallbackQuery).toHaveBeenCalled();
  });

  it('handles missing callbackQuery.data', async () => {
    const ctx = buildMockCtx(undefined);
    await handleRitualCallback(ctx);
    expect(ctx.answerCallbackQuery).toHaveBeenCalled();
  });
});
```

**Plans using this pattern:** 27-01.

---

### 12. Local-date computation via Luxon (`Europe/Paris`)

**Codebase precedent:** `src/episodic/sources.ts:74-83` `dayBoundaryUtc` — canonical pattern.

**Reference shape Phase 27 uses** (Plan 27-02):

```typescript
import { DateTime } from 'luxon';
import { config } from '../config.js';

const today = DateTime.now().setZone(config.proactiveTimezone).toISODate(); // 'YYYY-MM-DD' in Paris time
```

**FORBIDDEN alternative:** `new Date().toISOString().slice(0, 10)` — UTC date, off-by-1 around midnight Paris.

**Plans using this pattern:** 27-02.

---

### 13. Structured pino logging with subsystem.event[.variant] keys

**Codebase precedent:** Across the codebase — `pensieve.store`, `pensieve.store.dedup`, `episodic.consolidate.complete`, `rituals.sweep.start`, etc.

**Reference shape Phase 27 uses** (Plans 27-01, 27-02, 27-03):

| Event | Log key | Where |
|-------|---------|-------|
| Initial fire | `rituals.wellbeing.fired` | `fireWellbeing` |
| Per-tap merge | `rituals.wellbeing.tap` | `handleWellbeingCallback` |
| Completion | `rituals.wellbeing.completed` | `handleWellbeingCallback` |
| Skip | `rituals.wellbeing.skipped` | `handleWellbeingCallback` |
| Unknown callback prefix | `rituals.callback.unknown_root_prefix` | `handleRitualCallback` |
| Unknown ritual prefix | `rituals.callback.unknown_ritual_prefix` | `handleRitualCallback` |
| Invalid callback payload | `rituals.callback.invalid_payload` | `handleRitualCallback` |

**Plans using this pattern:** 27-01, 27-02, 27-03.

---

### 14. Box-drawing section dividers for modules >100 lines

**Codebase precedent:** `src/episodic/sources.ts`, `src/decisions/__tests__/synthetic-fixture.test.ts`, `src/rituals/scheduler.ts` (Phase 25). Canonical form `// ── Section ─────────────`.

**Reference shape Phase 27 uses** (Plan 27-02):

`src/rituals/wellbeing.ts` will likely cross 100 LOC (fire + render + per-tap + completion + skip = ~150 LOC). Section dividers:

```typescript
// ── Constants ──────────────────────────────────────────────────────────────
// ── Fire-side (called by dispatchRitualHandler) ────────────────────────────
// ── Callback-side (called by handleRitualCallback) ─────────────────────────
// ── Keyboard rendering ─────────────────────────────────────────────────────
// ── Completion + persistence ───────────────────────────────────────────────
// ── Skip handling ──────────────────────────────────────────────────────────
```

**Plans using this pattern:** 27-02.

---

### 15. `// eslint-disable-next-line @typescript-eslint/no-explicit-any` cast at handler registration

**Codebase precedent:** `src/bot/bot.ts:24, 28, 32, 74, 77` — all `bot.command/on(..., handlerX as any)` registrations use this disable-comment because Grammy's strict typing on `bot.on('message:text', handler)` doesn't map cleanly to the simplified handler signatures used in the codebase.

**Reference shape Phase 27 uses** (Plan 27-01):

```typescript
// eslint-disable-next-line @typescript-eslint/no-explicit-any
bot.on('callback_query:data', handleRitualCallback as any);
```

**Plans using this pattern:** 27-01.

---

## Cross-Plan Pattern Reuse Summary

| Plan | Patterns introduced | Patterns reused from prior phases |
|------|---------------------|-----------------------------------|
| 27-01 | #1 (callback_query registration — FIRST USE), #11 (mocked Grammy ctx) | #15 (eslint-disable), #13 (pino logging) |
| 27-02 | #2 (InlineKeyboard — FIRST USE), #7 (jsonb_set), #14 (section dividers in new file) | #3 (idempotent migration), #4 (regen-snapshots), #5 (test.sh gate), #6 (dispatchRitualHandler switch), #8 (onConflictDoUpdate), #12 (Luxon local date), #13 (pino logging) |
| 27-03 | (no new patterns) | #9 (operator script), #10 (real-DB integration test), #13 (pino logging) |

**FIRST-USE patterns (added to codebase by Phase 27):** #1 (callback_query registration), #2 (InlineKeyboard construction), #7 (jsonb_set in Drizzle update). These three become Phase 28 + 29 references.

---

*Patterns: Phase 27 Daily Wellbeing Snapshot*
*Mapped: 2026-04-26 (auto plan-phase sub-step)*
