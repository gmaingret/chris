# Phase 41: Adjustment-Dialogue Rework — Pattern Map

**Mapped:** 2026-05-14
**Files analyzed:** 5 (1 new, 4 modified)
**Analogs found:** 5 / 5

## File Classification

| New/Modified File | Role | Data Flow | Closest Analog | Match Quality |
|-------------------|------|-----------|----------------|---------------|
| `src/rituals/display-names.ts` (NEW) | utility (locale-keyed constant map) | static lookup | `src/chris/refusal.ts:180-193` (`ACKNOWLEDGMENTS` + `generateRefusalAcknowledgment`) | exact |
| `src/rituals/adjustment-dialogue.ts` (MODIFIED) | service (Telegram I/O + DB writes + Haiku) | request-response + event-driven | `src/rituals/journal.ts` (fire/reply handlers + skipCount reset pattern) | exact role-match |
| `src/rituals/skip-tracking.ts` (MODIFIED — `autoReEnableExpiredMutes` only) | service (DB UPDATE + audit insert) | batch loop with idempotent writes | `src/rituals/skip-tracking.ts:264-314` itself (extend existing loop) | self |
| `src/rituals/types.ts` (CONSUMED only — no schema change) | model (Zod schema) | static schema | `src/rituals/types.ts:55-86` (`RitualConfigSchema.parse`) | direct |
| `src/rituals/__tests__/adjustment-dialogue-no-refire.test.ts` (NEW) | test (integration, real Docker PG + mocked Anthropic/Telegram) | request-response | `src/rituals/__tests__/adjustment-dialogue.integration.test.ts` | exact |

## Pattern Assignments

### `src/rituals/display-names.ts` (utility, static lookup) — NEW

**Analog:** `src/chris/refusal.ts:180-193`

**Imports pattern** (refusal.ts top, language.ts:101 for `Lang`):
```typescript
import type { Lang } from '../chris/language.js';
```

**Locale-keyed map pattern** (`refusal.ts:180-184`):
```typescript
const ACKNOWLEDGMENTS: Record<string, string[]> = {
  English: ['Got it — moving on.', 'Understood.', "No problem, we'll skip that."],
  French: ['Compris — on passe à autre chose.', 'Pas de souci.', "D'accord, on laisse ça."],
  Russian: ['Понял — идём дальше.', 'Хорошо.', 'Без проблем, пропустим это.'],
};
```

**Display-name map shape** (Phase 41 — mirrors `ACKNOWLEDGMENTS` keyed by `Lang` display-name strings, not ISO codes):
```typescript
export const RITUAL_DISPLAY_NAMES: Record<string, Record<Lang, string>> = {
  daily_journal:   { English: 'evening journal',  French: "journal du soir",   Russian: 'вечерний журнал' },
  daily_wellbeing: { English: 'wellbeing check',  French: 'check bien-être',   Russian: 'проверка bien-être' },
  weekly_review:   { English: 'weekly review',    French: 'bilan hebdo',       Russian: 'еженедельный обзор' },
};
```

**Lookup helper pattern** (mirrors `generateRefusalAcknowledgment`, refusal.ts:186-193):
```typescript
export function displayName(slug: string, locale: Lang): string {
  return RITUAL_DISPLAY_NAMES[slug]?.[locale] ?? slug;
}
```

**Config-field label map** (parallel structure, same shape):
```typescript
export const CONFIG_FIELD_LABELS: Record<string, Record<Lang, string>> = {
  fire_at:         { English: 'fire time',       French: 'heure de déclenchement', Russian: 'время срабатывания' },
  fire_dow:        { English: 'day of week',     French: 'jour de la semaine',     Russian: 'день недели' },
  skip_threshold:  { English: 'skip threshold',  French: 'seuil de saut',          Russian: 'порог пропусков' },
};

export function configFieldLabel(field: string, locale: Lang): string {
  return CONFIG_FIELD_LABELS[field]?.[locale] ?? field;
}
```

**Why mirror ACKNOWLEDGMENTS exactly:** D-41-03 names the `ACKNOWLEDGMENTS` map as the exemplar. Same `Record<Lang, string>` value-shape, same `?? fallback-to-key` semantics, same module structure (constants + tiny lookup function). No new abstraction.

---

### `src/rituals/adjustment-dialogue.ts` (service, request-response) — MODIFIED

**Analog:** `src/rituals/journal.ts` (fire-side + reply-side handlers) + self

**Locale-detection wiring pattern** (engine.ts:357-359, 366-369):
```typescript
const chatIdStr = chatId.toString();
const previousLanguage = getLastUserLanguage(chatIdStr);
const detectedLanguage = detectLanguage(text, previousLanguage);
if (detectedLanguage) setLastUserLanguage(chatIdStr, detectedLanguage);
const language = detectedLanguage ?? undefined;
```

**Fire-side locale resolution pattern (no user reply yet)** — Phase 32 weekly-review precedent for cron-context handlers, exposed at `language.ts:66-84`:
```typescript
// Cron-context fire-side: no user text in hand, use DB-backed lookup
const lastLang = await getLastUserLanguageFromDb(chatId);  // bigint chatId
const locale: Lang = langOf(lastLang);                      // narrow to Lang union
```

**Reply-side locale resolution pattern** — same as engine.ts but inside the handler:
```typescript
const chatIdStr = String(chatId);
const previousLanguage = getLastUserLanguage(chatIdStr);
const language = detectLanguage(text, previousLanguage);
if (language) setLastUserLanguage(chatIdStr, language);
const locale: Lang = langOf(language);
```

**Locale-aware sendMessage pattern** — wrap each user-facing string in a small per-locale map inside the file (mirrors `ACKNOWLEDGMENTS` shape, locality-of-reference for review):
```typescript
const NOT_NOW_ACK: Record<Lang, string> = {
  English: "OK, I'll skip the adjustment dialogue for 7 days. Skip-tracking continues.",
  French:  "D'accord, je passe le dialogue d'ajustement pendant 7 jours. Le suivi des sauts continue.",
  Russian: "Хорошо, пропускаю диалог настройки на 7 дней. Учёт пропусков продолжается.",
};
await bot.api.sendMessage(Number(config.telegramAuthorizedUserId), NOT_NOW_ACK[locale]);
```

**skipCount reset pattern (yes/no completion path)** — REVIEW.md BL-04 suggested fix:
```typescript
await db.transaction(async (tx) => {
  await tx.update(rituals).set({ skipCount: 0 }).where(eq(rituals.id, pending.ritualId));
  await tx.insert(ritualFireEvents).values({
    ritualId: pending.ritualId,
    firedAt: new Date(),
    outcome: RITUAL_OUTCOME.RESPONDED,
    metadata: { confirmationId: pending.id, source: 'user_yes' },
  });
});
// sendMessage AFTER the transaction commits (BL-11 ordering is a v2.7 rework;
// Phase 41 accepts the current state-then-send pattern documented in D-41-05).
await bot.api.sendMessage(chatId, APPLIED_ACK[locale]);
```

**Existing reset-with-fire-event pattern in same file** (lines 690-701, `ritualConfirmationSweep`):
```typescript
await db.insert(ritualFireEvents).values({
  ritualId: row.ritualId,
  firedAt: new Date(),
  outcome: RITUAL_OUTCOME.RESPONDED,
  metadata: { confirmationId: row.id, source: 'auto_apply_on_timeout' },
});
await db.update(rituals).set({ skipCount: 0 }).where(eq(rituals.id, row.ritualId));
```
**Phase 41 mirrors this exactly at handleConfirmationReply yes/no + routeRefusal both branches.** D-41-05 wraps the pair in `db.transaction()` (WR-06 fix scoped to completion paths only).

**Per-field validation pattern (ADJ-06 / BL-08 candidate-parse)** — direct reuse of `parseRitualConfig` already imported at line 45:
```typescript
const cfg = ritual.config as Record<string, unknown>;
const candidate = { ...cfg, [proposedChange.field]: proposedChange.new_value };
try {
  parseRitualConfig(candidate);    // ZodError on type mismatch — same call scheduler.ts:282 uses
} catch (err) {
  logger.warn({ ritualId, field: proposedChange.field, newValue: proposedChange.new_value, err: String(err) },
    'chris.adjustment.config_patch.invalid_type');
  await db.insert(ritualConfigEvents).values({
    ritualId,
    actor,
    patch: { kind: 'rejected', field: proposedChange.field, attempted_new_value: proposedChange.new_value,
             error: String(err), source: actor === 'auto_apply_on_timeout' ? 'sweep' : 'reply' },
  });
  return;  // No jsonb_set, no crash, no config_invalid downstream
}
// On success: proceed to existing jsonb_set UPDATE (line 586-591)
```

**Zod enum tightening pattern (ADJ-05 / BL-07)** — drop `mute_until` from BOTH v3 + v4 enums (lines 193 + 203). Existing struct is the contract; only the literal list shrinks:
```typescript
// BEFORE: field: z.enum(['fire_at', 'fire_dow', 'skip_threshold', 'mute_until'])
// AFTER:  field: z.enum(['fire_at', 'fire_dow', 'skip_threshold'])
```

---

### `src/rituals/skip-tracking.ts` (`autoReEnableExpiredMutes`, lines 264-314) — MODIFIED

**Analog:** self (extend the existing UPDATE in the same function)

**Existing update pattern** (lines 288-295):
```typescript
await db
  .update(rituals)
  .set({
    enabled: true,
    config: sql`jsonb_set(${rituals.config}, '{mute_until}', 'null'::jsonb)`,
  })
  .where(eq(rituals.id, row.id));
```

**Phase 41 extension** (ADJ-04 site #4 / BL-10 fix — add `skipCount: 0` to the same SET clause):
```typescript
await db
  .update(rituals)
  .set({
    enabled: true,
    skipCount: 0,                                            // ← ADD (BL-10)
    config: sql`jsonb_set(${rituals.config}, '{mute_until}', 'null'::jsonb)`,
  })
  .where(eq(rituals.id, row.id));
```

The `ritualConfigEvents` insert at lines 298-306 already exists with `kind: 'auto_re_enable'`. Phase 41 also emits a parallel `ritual_fire_events` row with `outcome: RESPONDED, metadata.source: 'auto_re_enable'` so `computeSkipCount` replay stays consistent with the denormalized reset (D-41-05 final site).

---

### `src/rituals/__tests__/adjustment-dialogue-no-refire.test.ts` (test, integration) — NEW

**Analog:** `src/rituals/__tests__/adjustment-dialogue.integration.test.ts` (existing Phase 28 SKIP-04 test, exact same mock/setup shape)

**Vitest + hoisted mocks pattern** (adjustment-dialogue.integration.test.ts:18-40):
```typescript
import { describe, it, expect, vi, beforeEach, afterAll } from 'vitest';
import { and, eq } from 'drizzle-orm';

const { mockAnthropicCreate, mockAnthropicParse, mockSendMessage } = vi.hoisted(() => ({
  mockAnthropicCreate: vi.fn(),
  mockAnthropicParse: vi.fn(),
  mockSendMessage: vi.fn().mockResolvedValue({ message_id: 9999 }),
}));

vi.mock('../../llm/client.js', () => ({
  anthropic: { messages: { create: mockAnthropicCreate, parse: mockAnthropicParse } },
  HAIKU_MODEL: 'claude-haiku-3',
  SONNET_MODEL: 'claude-sonnet',
  OPUS_MODEL: 'claude-opus',
}));

vi.mock('../../bot/bot.js', () => ({ bot: { api: { sendMessage: mockSendMessage } } }));
```

**Test fixture pattern** (lines 56-78):
```typescript
async function createTestRitual(type: 'daily' | 'weekly' = 'daily') {
  const [ritual] = await db.insert(rituals).values({
    name: FIXTURE_RITUAL_NAME,
    type,
    nextRunAt: new Date(),
    enabled: true,
    skipCount: 3,                          // already at threshold → predicate fires
    config: {
      fire_at: '21:00',
      prompt_bag: [1, 2, 3],
      skip_threshold: 3,
      mute_until: null,
      time_zone: 'Europe/Paris',
      prompt_set_version: 'v1',
      schema_version: 1,
    },
  }).returning();
  return ritual!;
}

async function cleanup() {
  await db.delete(ritualResponses);
  await db.delete(ritualPendingResponses);
  await db.delete(ritualFireEvents);
  await db.delete(rituals).where(eq(rituals.name, FIXTURE_RITUAL_NAME));
}
```

**Run-harness pattern (Docker PG via test.sh)** — header comment matches existing integration tests:
```
* Run via canonical Docker harness:
*   bash scripts/test.sh src/rituals/__tests__/adjustment-dialogue-no-refire.test.ts
```

**Cumulative Sonnet-never-called invariant** (Pitfall 6 from Phase 28 — line 89):
```typescript
afterAll(async () => {
  expect(mockAnthropicCreate).not.toHaveBeenCalled();
  await cleanup();
  await sql.end({ timeout: 5 }).catch(() => {});
});
```

**Assertion shape for no-refire (ADJ-07 success criterion)** — calls `runRitualSweep` directly after the completion path and asserts predicate-doesn't-hit:
```typescript
import { runRitualSweep } from '../scheduler.js';
import { shouldFireAdjustmentDialogue } from '../skip-tracking.js';

// after firing + completing the dialogue
const results = await runRitualSweep(new Date(Date.now() + 1000));   // 1s later
expect(results.find((r) => r.ritualId === ritual.id)?.outcome).not.toBe('in_dialogue');
const [refreshed] = await db.select().from(rituals).where(eq(rituals.id, ritual.id));
expect(refreshed!.skipCount).toBe(0);
expect(await shouldFireAdjustmentDialogue(refreshed!)).toBe(false);
```

---

## Shared Patterns

### Locale narrowing (consumed by every modified user-facing string site)

**Source:** `src/chris/language.ts:101-119`
**Apply to:** Every locale lookup site in adjustment-dialogue.ts (fire-side + 7 reply-side sendMessage)
```typescript
import { detectLanguage, getLastUserLanguage, getLastUserLanguageFromDb, setLastUserLanguage, langOf, type Lang } from '../chris/language.js';

// Fire-side (cron, no text):
const locale: Lang = langOf(await getLastUserLanguageFromDb(chatId));

// Reply-side (in handler, with text):
const previousLanguage = getLastUserLanguage(chatIdStr);
const language = detectLanguage(text, previousLanguage);
if (language) setLastUserLanguage(chatIdStr, language);
const locale: Lang = langOf(language);
```

### Display-name substitution (consumed by 4 user-facing sites in adjustment-dialogue.ts)

**Source:** `src/rituals/display-names.ts` (NEW — pattern from `refusal.ts:180-193`)
**Apply to:** lines 285, 308 (metadata.ritualName context), 471, 733 (CONFIG_FIELD_LABELS for proposedChange.field)
```typescript
import { displayName, configFieldLabel } from './display-names.js';

// fire-side prompt (line 285):
const dispName = displayName(ritual.name, locale);
const messageText = OBSERVATIONAL_PROMPT[locale](dispName);

// confirmation echo (line 733):
const fieldLbl = configFieldLabel(proposedChange.field, locale);
await bot.api.sendMessage(chatId, CONFIRM_ECHO[locale](fieldLbl, proposedChange.new_value));
```

### Transaction-wrapped reset + audit-event pair (4 sites in ADJ-04)

**Source:** `src/rituals/adjustment-dialogue.ts:688-701` (existing pattern in `ritualConfirmationSweep`)
**Apply to:** handleConfirmationReply yes + no branches, routeRefusal both branches, autoReEnableExpiredMutes (4 sites total per D-41-05)
```typescript
await db.transaction(async (tx) => {
  await tx.update(rituals).set({ skipCount: 0 }).where(eq(rituals.id, ritualId));
  await tx.insert(ritualFireEvents).values({
    ritualId,
    firedAt: new Date(),
    outcome: RITUAL_OUTCOME.RESPONDED,
    metadata: { source: 'user_yes' /* | 'user_no' | 'user_drop_it_or_disable' | 'user_not_now' | 'auto_re_enable' */ },
  });
});
// sendMessage stays OUTSIDE the transaction (BL-11 ordering documented in D-41-05; v2.7 owns the outbox rework)
```

### Candidate-config parse before write (ADJ-06)

**Source:** `src/rituals/types.ts:95-97` (`parseRitualConfig`) — already imported at adjustment-dialogue.ts:45
**Apply to:** `confirmConfigPatch` (line 568-616), inserted between the current `cfg` read (line 580) and the `jsonb_set` UPDATE (line 586)
```typescript
const candidate = { ...cfg, [proposedChange.field]: proposedChange.new_value };
try {
  parseRitualConfig(candidate);
} catch (err) {
  // log + ritual_config_events.kind='rejected' + locale-aware sendMessage + return
  // (no jsonb_set, no crash on next sweep)
}
```

---

## No Analog Found

None — all five files map to existing exemplars in the codebase.

## Metadata

**Analog search scope:**
- `src/rituals/` (sibling handlers — journal.ts, wellbeing.ts, weekly-review.ts, scheduler.ts, skip-tracking.ts, idempotency.ts)
- `src/chris/` (`refusal.ts` ACKNOWLEDGMENTS — the exemplar D-41-03 names; `language.ts` — the locale helpers D-41-04 reuses; `engine.ts` PP#5 + locale wiring)
- `src/rituals/__tests__/` (existing integration tests — `adjustment-dialogue.integration.test.ts` is the direct analog)

**Files scanned:** 9 source + 2 test files

**Key cross-cutting patterns identified:**
1. **`ACKNOWLEDGMENTS`-shaped locale maps** — Phase 41's display-name + config-field-label + per-site copy maps all use the same `Record<Lang, string>` shape, mirroring `src/chris/refusal.ts:180-184`. Single exemplar, three uses.
2. **`db.transaction()` wrapping reset + fire-event pair** — Phase 41 lifts the existing 2-write pattern from `ritualConfirmationSweep` (lines 688-701) into a transaction at four additional sites. sendMessage stays outside (BL-11 documented, deferred).
3. **`parseRitualConfig` as the candidate-validator** — types.ts already encodes per-field types via `RitualConfigSchema`. Phase 41 reuses this single Zod schema as the candidate-parse gate (ADJ-06), avoiding per-field switch ladders.
4. **Locale wiring is two-tier**: `getLastUserLanguageFromDb` for cron/fire-side (no text), `detectLanguage + setLastUserLanguage` for reply-side (text in hand). Both narrowed by `langOf` to the `Lang` union.
5. **Test mocking discipline (Pitfall 6)**: Real Drizzle, real Docker Postgres, mock ONLY `bot.api.sendMessage` and `anthropic.messages.parse`. Cumulative `expect(mockAnthropicCreate).not.toHaveBeenCalled()` invariant carries forward.

**Pattern extraction date:** 2026-05-14

## PATTERN MAPPING COMPLETE

**Phase:** 41 - Adjustment-Dialogue Rework
**Files classified:** 5
**Analogs found:** 5 / 5

### Coverage
- Files with exact analog: 4 (display-names.ts, adjustment-dialogue.ts, adjustment-dialogue-no-refire.test.ts, autoReEnableExpiredMutes site)
- Files with role-match analog: 1 (types.ts consumed as-is, no schema change)
- Files with no analog: 0

### Key Patterns Identified
- `ACKNOWLEDGMENTS`-shaped locale maps (refusal.ts:180-184) — copy exactly for `RITUAL_DISPLAY_NAMES`, `CONFIG_FIELD_LABELS`, and per-area copy maps
- `db.transaction()` wrapping reset + fire-event pair (adjustment-dialogue.ts:688-701) — lift to 4 completion sites
- `parseRitualConfig` as candidate-validator (types.ts:95) — single existing schema as ADJ-06 gate
- Locale two-tier wiring: `getLastUserLanguageFromDb` (cron) + `detectLanguage`/`setLastUserLanguage` (reply), narrowed by `langOf`

### File Created
`.planning/phases/41-adjustment-dialogue-rework/41-PATTERNS.md`

### Ready for Planning
Pattern mapping complete. Planner can reference analog patterns in PLAN.md files for Plans 41-01 and 41-02.
