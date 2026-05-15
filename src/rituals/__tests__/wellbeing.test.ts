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
import { and, desc, eq, sql as drzSql } from 'drizzle-orm';
import { runConcurrently } from '../../__tests__/helpers/concurrent-harness.js';

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
import { simulateCallbackQuery } from './fixtures/simulate-callback-query.js';

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
    await handleWellbeingCallback(simulateCallbackQuery({ callbackData: 'r:w:e:3' }) as any, 'r:w:e:3');
    let [row] = await db
      .select()
      .from(ritualResponses)
      .where(eq(ritualResponses.ritualId, testRitualId));
    expect(row!.metadata).toMatchObject({ partial: { e: 3 } });

    // Second tap: mood=4
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    await handleWellbeingCallback(simulateCallbackQuery({ callbackData: 'r:w:m:4' }) as any, 'r:w:m:4');
    [row] = await db
      .select()
      .from(ritualResponses)
      .where(eq(ritualResponses.ritualId, testRitualId));
    expect(row!.metadata).toMatchObject({ partial: { e: 3, m: 4 } });
  });

  // ── Test 5 — Rapid-tap concurrency against REAL Docker postgres ────────
  //           (WELL-02 + D-27-05 + Phase 42 RACE-03 D-42-06)
  it('Test 5: rapid-tap concurrency — Promise.all of 3 callbacks merges all 3 dims AND emits exactly ONE wellbeing_completed (RACE-03)', async () => {
    const [ritual] = await db.select().from(rituals).where(eq(rituals.id, testRitualId));
    const cfg = parseRitualConfig(ritual!.config);
    await fireWellbeing(ritual!, cfg);

    // Rapid concurrent taps — relies on Postgres row-lock semantics for
    // jsonb_set atomicity. Mocks would silently pass broken merge logic
    // (last-write-wins). This is the test that mandates D-27-10's "real
    // Docker postgres" requirement.
    //
    // Phase 42 RACE-03 tightening (D-42-06): under the OLD code, three
    // concurrent callbacks could each reach completeSnapshot and each emit
    // a duplicate WELLBEING_COMPLETED ritual_fire_events row, call
    // editMessageText three times, redundantly set skip_count=0 three
    // times. The atomic completion-claim UPDATE makes the side-effect path
    // winner-only. The assertion below for "exactly ONE wellbeing_completed"
    // pins the RACE-03 contract.
    const ctxs = [
      simulateCallbackQuery({ callbackData: 'r:w:e:3' }),
      simulateCallbackQuery({ callbackData: 'r:w:m:4' }),
      simulateCallbackQuery({ callbackData: 'r:w:a:2' }),
    ];
    await runConcurrently(3, (i) =>
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      handleWellbeingCallback(ctxs[i]! as any, ctxs[i]!.callbackQuery.data),
    );

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

    // RACE-03 contract: EXACTLY ONE wellbeing_completed fire_event under
    // three-way concurrent completion. The completion-claim UPDATE on
    // `respondedAt IS NULL` is the canonical idempotency key.
    const completedEvents = await db
      .select()
      .from(ritualFireEvents)
      .where(
        and(
          eq(ritualFireEvents.ritualId, testRitualId),
          eq(ritualFireEvents.outcome, 'wellbeing_completed'),
        ),
      );
    expect(completedEvents).toHaveLength(1);

    // RACE-03 contract: EXACTLY ONE editMessageText call across all 3
    // contexts (only the claim winner runs the Telegram side-effect).
    const editMessageTextCalls = ctxs.reduce(
      (sum, c) => sum + c.editMessageText.mock.calls.length,
      0,
    );
    expect(editMessageTextCalls).toBe(1);
  });

  // ── Test 6 — Completion-gated write + emit outcome (WELL-02 + WELL-03) ──
  it('Test 6: third-dim tap completes snapshot — writes wellbeing_snapshots + clears keyboard + emits wellbeing_completed', async () => {
    const [ritual] = await db.select().from(rituals).where(eq(rituals.id, testRitualId));
    const cfg = parseRitualConfig(ritual!.config);
    await fireWellbeing(ritual!, cfg);

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    await handleWellbeingCallback(simulateCallbackQuery({ callbackData: 'r:w:e:3' }) as any, 'r:w:e:3');
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    await handleWellbeingCallback(simulateCallbackQuery({ callbackData: 'r:w:m:4' }) as any, 'r:w:m:4');
    const completionCtx = simulateCallbackQuery({ callbackData: 'r:w:a:2' });
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    await handleWellbeingCallback(completionCtx as any, 'r:w:a:2');

    // wellbeing_snapshots row exists with all 3 values.
    const [snapshot] = await db.select().from(wellbeingSnapshots).limit(1);
    expect(snapshot).toMatchObject({ energy: 3, mood: 4, anxiety: 2 });

    // ritual_fire_events row with outcome 'wellbeing_completed'.
    // ORDER BY firedAt DESC: fireWellbeing writes a 'fired' row first, then
    // completion writes a 'wellbeing_completed' row. Without ORDER BY the
    // destructure picks whichever the planner returns first (v2.4 carry-forward
    // false-negative — production behavior correct, test query was wrong).
    const [event] = await db
      .select()
      .from(ritualFireEvents)
      .where(eq(ritualFireEvents.ritualId, testRitualId))
      .orderBy(desc(ritualFireEvents.firedAt));
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

    const skipCtx = simulateCallbackQuery({ callbackData: 'r:w:skip' });
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
    // ORDER BY firedAt DESC: same reason as Test 6 — pick the latest event.
    const [event] = await db
      .select()
      .from(ritualFireEvents)
      .where(eq(ritualFireEvents.ritualId, testRitualId))
      .orderBy(desc(ritualFireEvents.firedAt));
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
    const ctx1 = simulateCallbackQuery({ callbackData: 'r:w:e:6' });
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    await handleWellbeingCallback(ctx1 as any, 'r:w:e:6');
    expect(ctx1.answerCallbackQuery).toHaveBeenCalled();

    // Invalid: unknown dim (e/m/a only).
    const ctx2 = simulateCallbackQuery({ callbackData: 'r:w:x:3' });
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

  // ── Test 9 — RACE-04: handleSkip jsonb_set merge preserves partial taps ─
  it('RACE-04: handleSkip preserves concurrent partial taps via nested jsonb_set merge (D-42-08)', async () => {
    const [ritual] = await db.select().from(rituals).where(eq(rituals.id, testRitualId));
    const cfg = parseRitualConfig(ritual!.config);
    await fireWellbeing(ritual!, cfg);

    // Simulate that a partial tap arrived BEFORE the skip — e.g., Greg
    // tapped energy=3 and then skipped before completing the other 2 dims.
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    await handleWellbeingCallback(simulateCallbackQuery({ callbackData: 'r:w:e:3' }) as any, 'r:w:e:3');

    // Verify partial state landed
    const [rowBefore] = await db
      .select()
      .from(ritualResponses)
      .where(eq(ritualResponses.ritualId, testRitualId));
    expect(rowBefore!.metadata).toMatchObject({ partial: { e: 3 } });

    // Skip — the pre-RACE-04 code did a full-object overwrite that discarded
    // metadata.partial.e. Post-RACE-04, nested jsonb_set merges {skipped:
    // true, adjustment_eligible: false} INTO whatever metadata is there.
    const skipCtx = simulateCallbackQuery({ callbackData: 'r:w:skip' });
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    await handleWellbeingCallback(skipCtx as any, 'r:w:skip');

    // Re-read; partial.e MUST still be 3 (preserved); skipped + adjustment_eligible flipped.
    const [rowAfter] = await db
      .select()
      .from(ritualResponses)
      .where(eq(ritualResponses.ritualId, testRitualId));
    expect(rowAfter!.metadata).toMatchObject({
      partial: { e: 3 },
      skipped: true,
      adjustment_eligible: false,
    });
    expect(rowAfter!.respondedAt).not.toBeNull();
  });

  // ── Test 10 — RACE-05: findOpenWellbeingRow 24-hour absolute-window guard ─
  it('RACE-05: findOpenWellbeingRow rejects 25h-old open row and returns 1h-old open row (D-42-10)', async () => {
    // We exercise findOpenWellbeingRow indirectly via handleWellbeingCallback —
    // the function is non-exported. The contract: a tap callback arriving
    // when the only open row is >24 hours old should hit the no_open_row
    // path; a tap when the open row is fresh should land the partial.

    // Setup: directly insert an open ritual_responses row with firedAt =
    // 25 hours ago (server-side via sql`now() - interval '25 hours'`).
    const [stale] = await db
      .insert(ritualResponses)
      .values({
        ritualId: testRitualId,
        firedAt: new Date(),
        promptText: 'stale wellbeing prompt',
        metadata: { partial: {} },
      })
      .returning({ id: ritualResponses.id });

    // Force fired_at to 25 hours in the past (must use server-side time to
    // be DST-stable + match the now() the production WHERE evaluates).
    await db.execute(
      drzSql`UPDATE ritual_responses SET fired_at = now() - interval '25 hours' WHERE id = ${stale!.id}`,
    );

    // Tap a stale row — should be rejected by the 24h window AND-clause;
    // the callback should hit the "no_open_row" path and return without
    // touching metadata.
    const staleCtx = simulateCallbackQuery({ callbackData: 'r:w:e:3' });
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    await handleWellbeingCallback(staleCtx as any, 'r:w:e:3');

    const [staleAfter] = await db
      .select()
      .from(ritualResponses)
      .where(eq(ritualResponses.id, stale!.id));
    // metadata.partial.e must still be {} — no row was found, no UPDATE ran
    expect(staleAfter!.metadata).toMatchObject({ partial: {} });
    // answerCallbackQuery called with "Snapshot already closed" (no_open_row branch)
    expect(staleCtx.answerCallbackQuery).toHaveBeenCalledWith({
      text: 'Snapshot already closed',
    });

    // Now insert a FRESH open row (firedAt = now()), expected to be returned.
    // First clear the stale row so the query has only one candidate.
    await db
      .delete(ritualResponses)
      .where(eq(ritualResponses.id, stale!.id));

    const [ritual] = await db.select().from(rituals).where(eq(rituals.id, testRitualId));
    const cfg = parseRitualConfig(ritual!.config);
    await fireWellbeing(ritual!, cfg); // inserts a fresh open row

    const freshCtx = simulateCallbackQuery({ callbackData: 'r:w:e:4' });
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    await handleWellbeingCallback(freshCtx as any, 'r:w:e:4');

    // Fresh row tap landed — metadata.partial.e = 4
    const [freshAfter] = await db
      .select()
      .from(ritualResponses)
      .where(eq(ritualResponses.ritualId, testRitualId));
    expect(freshAfter!.metadata).toMatchObject({ partial: { e: 4 } });
  });
});
