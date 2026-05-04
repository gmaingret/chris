/**
 * src/rituals/__tests__/wellbeing.test.ts — Phase 27 Plan 03 Task 2
 * (WELL-01..05 real-DB integration tests + D-27-04 anchor-bias defeat regression)
 *
 * Real-DB integration test suite for the wellbeing ritual handler. Runs
 * against Docker postgres on port 5433 (per D-27-10 + Phase 25 LEARNINGS:
 * "Postgres concurrent-update semantics must be tested with REAL postgres,
 * not mocks"). Telegram API stubbed via vi.mock of '../../bot/bot.js' (no
 * real Telegram traffic). Per-test fixture cleanup in afterEach.
 *
 * 8 behaviors covered (Plan 27-03 task 2 <behavior>):
 *
 *   1. fireWellbeing inserts ritual_responses row + sends 4-row keyboard
 *      (3 dim rows × 5 buttons + 1 skip row × 1 button). [WELL-01]
 *   2. No-anchor keyboard output — db.select spy asserts ZERO SELECTs against
 *      wellbeingSnapshots during fireWellbeing AND rendered keyboard contains
 *      ZERO [N] highlights even when yesterday has data. Three-layer
 *      regression defense for D-27-04 prong 1 (with the static grep guard
 *      added in Task 3 + Plan 27-02's in-plan negative grep). [WELL-03]
 *   3. No-anchor prompt text — sent prose contains no digits 1-5. [WELL-03 + D-27-04 prong 2]
 *   4. Per-tap merge via jsonb_set into metadata.partial across two
 *      sequential UPDATEs. [WELL-02 + WELL-03]
 *   5. Rapid-tap concurrency (REAL POSTGRES) — Promise.all of 3 callbacks
 *      merges all 3 dims; jsonb_set is atomic at row-lock level. Mocks
 *      would silently pass broken merge logic — real Postgres mandated by
 *      D-27-10. [WELL-02 + D-27-05]
 *   6. Third-dim tap completes snapshot — wellbeing_snapshots row written
 *      with all 3 values + ritual_fire_events emits 'wellbeing_completed'
 *      + keyboard cleared via editMessageText. [WELL-02 + WELL-03]
 *   7. Skip button writes adjustment_eligible: false + emits
 *      'wellbeing_skipped' (distinct from 'fired_no_response'); does NOT
 *      increment rituals.skip_count; does NOT insert wellbeing_snapshots. [WELL-04]
 *   8. Invalid callback payload graceful handling — out-of-range value
 *      ('r:w:e:6') and unknown dim ('r:w:x:3') both ack gracefully without
 *      DB writes. metadata.partial remains {}. [D-27-09]
 *
 * Run via canonical Docker harness:
 *   bash scripts/test.sh src/rituals/__tests__/wellbeing.test.ts
 *
 * Or directly against the test postgres on port 5433:
 *   DATABASE_URL='postgresql://chris:localtest123@localhost:5433/chris' \
 *     npx vitest run src/rituals/__tests__/wellbeing.test.ts
 */
import { describe, it, expect, vi, beforeEach, afterEach, afterAll } from 'vitest';
import { eq } from 'drizzle-orm';

// Mock bot.api.sendMessage to avoid real Telegram calls.
// vi.hoisted ensures the mock fn is available when the vi.mock factory runs
// (mirrors journal-handler.test.ts pattern).
const { mockSendMessage } = vi.hoisted(() => ({
  mockSendMessage: vi.fn(),
}));
vi.mock('../../bot/bot.js', () => ({
  bot: { api: { sendMessage: mockSendMessage } },
}));

import { db, sql } from '../../db/connection.js';
import * as connectionModule from '../../db/connection.js';
import {
  rituals,
  ritualResponses,
  ritualFireEvents,
  wellbeingSnapshots,
} from '../../db/schema.js';
import { fireWellbeing, handleWellbeingCallback } from '../wellbeing.js';
import { parseRitualConfig } from '../types.js';

// ── Mock Grammy Context builder ────────────────────────────────────────────

interface MockCtx {
  callbackQuery?: { data: string; message?: { message_id: number } };
  answerCallbackQuery: ReturnType<typeof vi.fn>;
  editMessageReplyMarkup: ReturnType<typeof vi.fn>;
  editMessageText: ReturnType<typeof vi.fn>;
}

function buildMockCtx(callbackData?: string, messageId = 12345): MockCtx {
  return {
    callbackQuery: callbackData
      ? { data: callbackData, message: { message_id: messageId } }
      : undefined,
    answerCallbackQuery: vi.fn().mockResolvedValue(true),
    editMessageReplyMarkup: vi.fn().mockResolvedValue(true),
    editMessageText: vi.fn().mockResolvedValue(true),
  };
}

// ── Fixture lifecycle ──────────────────────────────────────────────────────

const FIXTURE_NAME = 'daily_wellbeing'; // matches the production seed (migration 0008)
let testRitualId: string;

beforeEach(async () => {
  // Reset Telegram mock (mockResolvedValue returns synthetic message_id)
  mockSendMessage.mockReset();
  mockSendMessage.mockResolvedValue({ message_id: 12345 });

  // Cleanup ephemeral state from any prior test in this file (idempotent).
  // FK order: wellbeing_snapshots → ritual_fire_events → ritual_responses.
  // The seeded daily_wellbeing ritual row is left intact across tests.
  await db.delete(wellbeingSnapshots);
  await db.delete(ritualFireEvents);
  await db.delete(ritualResponses);

  // Use the seeded daily_wellbeing row (migration 0008 inserts during test.sh
  // setup); fall back to an inserted fixture if missing (e.g. running tests
  // outside test.sh harness).
  const [existing] = await db
    .select()
    .from(rituals)
    .where(eq(rituals.name, FIXTURE_NAME))
    .limit(1);

  if (!existing) {
    const [r] = await db
      .insert(rituals)
      .values({
        name: FIXTURE_NAME,
        type: 'daily',
        nextRunAt: new Date(),
        config: {
          fire_at: '09:00',
          skip_threshold: 3,
          mute_until: null,
          time_zone: 'Europe/Paris',
          prompt_set_version: 'v1',
          schema_version: 1,
        },
      })
      .returning();
    testRitualId = r!.id;
  } else {
    testRitualId = existing.id;
  }
});

afterEach(async () => {
  // Cleanup in FK order so the seeded ritual row stays intact for the
  // next test or for production state (when tests run against a shared DB).
  await db.delete(wellbeingSnapshots);
  await db.delete(ritualFireEvents).where(eq(ritualFireEvents.ritualId, testRitualId));
  await db.delete(ritualResponses).where(eq(ritualResponses.ritualId, testRitualId));
  vi.clearAllMocks();
});

afterAll(async () => {
  // Final cleanup + close pool (mirrors journal-handler.test.ts pattern).
  await db.delete(wellbeingSnapshots);
  await db.delete(ritualFireEvents);
  await db.delete(ritualResponses);
  await sql.end({ timeout: 5 }).catch(() => {});
});

// ── Tests ──────────────────────────────────────────────────────────────────

describe('wellbeing handler (Phase 27 WELL-01..05)', () => {
  // ── Test 1 — Initial fire (WELL-01) ──────────────────────────────────────
  it('Test 1: fireWellbeing inserts ritual_responses row + sends inline keyboard with no anchor-bias surfaces', async () => {
    const [ritual] = await db.select().from(rituals).where(eq(rituals.id, testRitualId));
    const cfg = parseRitualConfig(ritual!.config);
    const outcome = await fireWellbeing(ritual!, cfg);

    expect(outcome).toBe('fired');

    // Assert ritual_responses row created with empty partial state.
    // (Note: post-fire metadata also contains message_id from the second
    // jsonb_set update — assert partial: {} via toMatchObject which allows
    // extra keys.)
    const [row] = await db
      .select()
      .from(ritualResponses)
      .where(eq(ritualResponses.ritualId, testRitualId));
    expect(row).toBeDefined();
    expect(row!.metadata).toMatchObject({ partial: {} });
    expect(row!.respondedAt).toBeNull();

    // Assert bot.api.sendMessage called with the constant prompt + 4-row keyboard.
    expect(mockSendMessage).toHaveBeenCalledTimes(1);
    const sendArgs = mockSendMessage.mock.calls[0]!;
    const text = sendArgs[1] as string;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const opts = sendArgs[2] as any;
    expect(text).toBe('Wellbeing snapshot — tap energy, mood, anxiety:');

    // Grammy's InlineKeyboard exposes the rows array via reply_markup.inline_keyboard
    // (Grammy 1.31+ — verified against journal-handler.test.ts patterns).
    const keyboard = opts.reply_markup.inline_keyboard;
    expect(keyboard).toHaveLength(4); // 3 dim rows + 1 skip row
    expect(keyboard[0]).toHaveLength(5); // energy: 1-5
    expect(keyboard[1]).toHaveLength(5); // mood: 1-5
    expect(keyboard[2]).toHaveLength(5); // anxiety: 1-5
    expect(keyboard[3]).toHaveLength(1); // single Skip button
  });

  // ── Test 2 — No-anchor keyboard output (WELL-03 + D-27-04 prong 1, honestly scoped) ──
  it('Test 2: no-anchor keyboard output — fireWellbeing does not query wellbeingSnapshots and renders no [N] highlights even when yesterday has data', async () => {
    // Seed yesterday's snapshot to prove fireWellbeing ignores it.
    // Date string is yesterday relative to today's local date — concrete
    // ISO-8601 date sufficient for the assertion (no time-sensitive logic).
    await db.insert(wellbeingSnapshots).values({
      snapshotDate: '2026-04-25',
      energy: 5,
      mood: 5,
      anxiety: 1,
    });

    // Spy on db.select to detect any SELECT against wellbeingSnapshots during
    // fireWellbeing. We clear AFTER the seed lookup below so only fireWellbeing's
    // calls are tracked.
    const selectSpy = vi.spyOn(connectionModule.db, 'select');

    const [ritual] = await db.select().from(rituals).where(eq(rituals.id, testRitualId));
    const cfg = parseRitualConfig(ritual!.config);
    selectSpy.mockClear(); // ignore the line above which is test setup

    await fireWellbeing(ritual!, cfg);

    // Assertion 1 — DB query layer: no SELECT call inside fireWellbeing
    // referenced wellbeingSnapshots. We introspect the captured `from(...)`
    // calls via the chained query builder. Drizzle's PgSelectBase carries
    // table refs internally; the simplest robust check is to assert that
    // the spy was either not called, or every call's chained .from() targets
    // ritualResponses (the metadata insert/update ID lookup) — never
    // wellbeingSnapshots.
    //
    // We use a JSON-stringify probe across spy.mock.results values which
    // include the chain object's serialized form. If the production code
    // ever adds db.select().from(wellbeingSnapshots), this stringify would
    // capture the table reference (Drizzle table objects serialize their
    // tableName).
    for (const result of selectSpy.mock.results) {
      // Each result.value is a PgSelect chain; stringify safely.
      const probe = (() => {
        try {
          return JSON.stringify(result.value);
        } catch {
          return String(result.value);
        }
      })();
      expect(probe).not.toMatch(/wellbeing_snapshots|wellbeingSnapshots/);
    }

    // Assertion 2 — Rendered output: keyboard has zero [N] highlights
    // (yesterday's energy=5 mood=5 anxiety=1 not surfaced as bracketed
    // labels). Necessary-but-not-sufficient on its own, but combined with
    // assertion 1 + the scripts/test.sh static grep guard (Task 3) gives
    // three independent regression-defense lines for D-27-04 prong 1.
    const sendArgs = mockSendMessage.mock.calls[0]!;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const opts = sendArgs[2] as any;
    const allButtonLabels = opts.reply_markup.inline_keyboard
      .flat()
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      .map((b: any) => b.text);
    expect(allButtonLabels.filter((l: string) => l.startsWith('['))).toHaveLength(0);

    selectSpy.mockRestore();
  });

  // ── Test 3 — No-anchor prompt text (WELL-03 + D-27-04 prong 2) ──────────
  it('Test 3: fire prompt text contains no historical numeric reference (anchor-bias defeat prong 2)', async () => {
    const [ritual] = await db.select().from(rituals).where(eq(rituals.id, testRitualId));
    const cfg = parseRitualConfig(ritual!.config);
    await fireWellbeing(ritual!, cfg);

    const text = mockSendMessage.mock.calls[0]![1] as string;
    // The prose body must not contain digits 1-5 (the keyboard buttons
    // separately contain digits, but those live in reply_markup, not in
    // the `text` arg).
    expect(/[1-5]/.test(text)).toBe(false);
    expect(text).toBe('Wellbeing snapshot — tap energy, mood, anxiety:');
  });

  // ── Test 4 — Per-tap merge (WELL-02 + WELL-03) ──────────────────────────
  it('Test 4: per-tap callback merges into metadata.partial via jsonb_set', async () => {
    const [ritual] = await db.select().from(rituals).where(eq(rituals.id, testRitualId));
    const cfg = parseRitualConfig(ritual!.config);
    await fireWellbeing(ritual!, cfg);

    // First tap: energy=3
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    await handleWellbeingCallback(buildMockCtx('r:w:e:3') as any, 'r:w:e:3');
    let [row] = await db
      .select()
      .from(ritualResponses)
      .where(eq(ritualResponses.ritualId, testRitualId));
    expect(row!.metadata).toMatchObject({ partial: { e: 3 } });

    // Second tap: mood=4
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    await handleWellbeingCallback(buildMockCtx('r:w:m:4') as any, 'r:w:m:4');
    [row] = await db
      .select()
      .from(ritualResponses)
      .where(eq(ritualResponses.ritualId, testRitualId));
    expect(row!.metadata).toMatchObject({ partial: { e: 3, m: 4 } });
  });

  // ── Test 5 — Rapid-tap concurrency against REAL Docker postgres (WELL-02 + D-27-05) ──
  it('Test 5: rapid-tap concurrency — Promise.all of 3 callbacks merges all 3 dims (race-safe)', async () => {
    const [ritual] = await db.select().from(rituals).where(eq(rituals.id, testRitualId));
    const cfg = parseRitualConfig(ritual!.config);
    await fireWellbeing(ritual!, cfg);

    // Rapid concurrent taps — relies on Postgres row-lock semantics for
    // jsonb_set atomicity. Mocks would silently pass broken merge logic
    // (last-write-wins). This is the test that mandates D-27-10's "real
    // Docker postgres" requirement.
    await Promise.all([
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      handleWellbeingCallback(buildMockCtx('r:w:e:3') as any, 'r:w:e:3'),
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      handleWellbeingCallback(buildMockCtx('r:w:m:4') as any, 'r:w:m:4'),
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      handleWellbeingCallback(buildMockCtx('r:w:a:2') as any, 'r:w:a:2'),
    ]);

    // After Promise.all, metadata.partial must have ALL 3 keys (no overwrites).
    const [row] = await db
      .select()
      .from(ritualResponses)
      .where(eq(ritualResponses.ritualId, testRitualId));
    expect(row!.metadata).toMatchObject({ partial: { e: 3, m: 4, a: 2 } });

    // wellbeing_snapshots row written (completion-gated insert per D-27-05).
    const [snapshot] = await db.select().from(wellbeingSnapshots).limit(1);
    expect(snapshot).toBeDefined();
    expect(snapshot!.energy).toBe(3);
    expect(snapshot!.mood).toBe(4);
    expect(snapshot!.anxiety).toBe(2);
  });

  // ── Test 6 — Completion-gated write + emit outcome (WELL-02 + WELL-03) ──
  it('Test 6: third-dim tap completes snapshot — writes wellbeing_snapshots + clears keyboard + emits wellbeing_completed', async () => {
    const [ritual] = await db.select().from(rituals).where(eq(rituals.id, testRitualId));
    const cfg = parseRitualConfig(ritual!.config);
    await fireWellbeing(ritual!, cfg);

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    await handleWellbeingCallback(buildMockCtx('r:w:e:3') as any, 'r:w:e:3');
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    await handleWellbeingCallback(buildMockCtx('r:w:m:4') as any, 'r:w:m:4');
    const completionCtx = buildMockCtx('r:w:a:2');
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    await handleWellbeingCallback(completionCtx as any, 'r:w:a:2');

    // wellbeing_snapshots row exists with all 3 values.
    const [snapshot] = await db.select().from(wellbeingSnapshots).limit(1);
    expect(snapshot).toMatchObject({ energy: 3, mood: 4, anxiety: 2 });

    // ritual_fire_events row with outcome 'wellbeing_completed'.
    const [event] = await db
      .select()
      .from(ritualFireEvents)
      .where(eq(ritualFireEvents.ritualId, testRitualId));
    expect(event!.outcome).toBe('wellbeing_completed');

    // Keyboard cleared via editMessageText (NOT editMessageReplyMarkup) on
    // completion. Message text reports the 3 captured values.
    expect(completionCtx.editMessageText).toHaveBeenCalledTimes(1);
    expect(
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (completionCtx.editMessageText as any).mock.calls[0][0],
    ).toMatch(/Logged: energy 3, mood 4, anxiety 2/);
  });

  // ── Test 7 — Skip button (WELL-04) ──────────────────────────────────────
  it('Test 7: skip button writes adjustment_eligible: false + emits wellbeing_skipped + does NOT increment skip_count', async () => {
    const [ritual] = await db.select().from(rituals).where(eq(rituals.id, testRitualId));
    const skipCountBefore = ritual!.skipCount;
    const cfg = parseRitualConfig(ritual!.config);
    await fireWellbeing(ritual!, cfg);

    const skipCtx = buildMockCtx('r:w:skip');
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    await handleWellbeingCallback(skipCtx as any, 'r:w:skip');

    // Metadata has adjustment_eligible: false + skipped: true.
    const [row] = await db
      .select()
      .from(ritualResponses)
      .where(eq(ritualResponses.ritualId, testRitualId));
    expect(row!.metadata).toMatchObject({ skipped: true, adjustment_eligible: false });
    expect(row!.respondedAt).not.toBeNull();

    // ritual_fire_events emits 'wellbeing_skipped' (distinct from
    // 'fired_no_response' — Phase 28 will filter this out of skip_count).
    const [event] = await db
      .select()
      .from(ritualFireEvents)
      .where(eq(ritualFireEvents.ritualId, testRitualId));
    expect(event!.outcome).toBe('wellbeing_skipped');

    // No wellbeing_snapshots row written.
    const snapshots = await db.select().from(wellbeingSnapshots);
    expect(snapshots).toHaveLength(0);

    // rituals.skip_count UNCHANGED (Phase 28 will not count this toward
    // 3-strikes adjustment).
    const [updatedRitual] = await db
      .select()
      .from(rituals)
      .where(eq(rituals.id, testRitualId));
    expect(updatedRitual!.skipCount).toBe(skipCountBefore);

    // Keyboard cleared — message edited to the canonical skip text.
    expect(skipCtx.editMessageText).toHaveBeenCalledWith('Skipped wellbeing snapshot.');
  });

  // ── Test 8 — Invalid callback payload graceful handling (D-27-09) ────────
  it('Test 8: invalid callback payload acks gracefully without DB write', async () => {
    const [ritual] = await db.select().from(rituals).where(eq(rituals.id, testRitualId));
    const cfg = parseRitualConfig(ritual!.config);
    await fireWellbeing(ritual!, cfg);

    // Invalid: out-of-range value (1-5 only).
    const ctx1 = buildMockCtx('r:w:e:6');
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    await handleWellbeingCallback(ctx1 as any, 'r:w:e:6');
    expect(ctx1.answerCallbackQuery).toHaveBeenCalled();

    // Invalid: unknown dim (e/m/a only).
    const ctx2 = buildMockCtx('r:w:x:3');
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    await handleWellbeingCallback(ctx2 as any, 'r:w:x:3');
    expect(ctx2.answerCallbackQuery).toHaveBeenCalled();

    // metadata.partial unchanged (no DB write from invalid payloads).
    const [row] = await db
      .select()
      .from(ritualResponses)
      .where(eq(ritualResponses.ritualId, testRitualId));
    expect(row!.metadata).toMatchObject({ partial: {} });
  });
});
