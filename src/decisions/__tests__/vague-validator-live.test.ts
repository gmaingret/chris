/**
 * TEST-14: Vague-prediction resistance (live Haiku).
 * Requires a real ANTHROPIC_API_KEY and a running Postgres database.
 *
 * Proves the real Haiku vague-prediction validator prompt actually catches
 * hedged-confidence predictions across EN/FR/RU.
 *
 * Test 1: Haiku flags >= 9 of 10 adversarial vague predictions on first pass.
 * Test 2: Exactly one pushback before accepting — enforced by handleCapture via capture_state.
 *
 * CRITICAL: This file does NOT mock `callLLM` or `../../llm/client.js`.
 * The entire point is proving the real Haiku prompt catches vague predictions.
 *
 * Run: DATABASE_URL=... ANTHROPIC_API_KEY=... npx vitest run src/decisions/__tests__/vague-validator-live.test.ts
 */
import { describe, it, expect, afterEach, beforeAll, afterAll, vi } from 'vitest';
import { eq, inArray } from 'drizzle-orm';
import { db, sql } from '../../db/connection.js';
import {
  decisions,
  decisionEvents,
  decisionCaptureState,
  pensieveEntries,
} from '../../db/schema.js';
import { validateVagueness, buildVaguePushback } from '../vague-validator.js';
import { handleCapture } from '../capture.js';
import { DAY_MS } from '../../__tests__/fixtures/time.js';
import { CHAT_ID_VAGUE_VALIDATOR_LIVE } from '../../__tests__/fixtures/chat-ids.js';

// ── Adversarial predictions (D-11: ~4 EN, 3 FR, 3 RU; D-12: hedged-confidence) ──

const ADVERSARIAL_PREDICTIONS: Array<{
  prediction: string;
  falsification_criterion: string;
  lang: string;
}> = [
  // EN (4) — hedged confidence, sounds specific but dodges falsifiability
  {
    prediction: "I think the project will probably work out in the end",
    falsification_criterion: "It doesn't feel like it worked out",
    lang: 'en',
  },
  {
    prediction: "Things should generally improve once we make the change",
    falsification_criterion: "Things don't feel better",
    lang: 'en',
  },
  {
    prediction: "I'm fairly confident the new approach will be better",
    falsification_criterion: "The new approach doesn't seem better",
    lang: 'en',
  },
  {
    prediction: "It'll likely sort itself out within a reasonable timeframe",
    falsification_criterion: "It hasn't sorted itself out yet",
    lang: 'en',
  },
  // FR (3) — hedged confidence in French
  {
    prediction: "Je pense que ca va probablement bien se passer au final",
    falsification_criterion: "Ca ne s'est pas bien passe",
    lang: 'fr',
  },
  {
    prediction: "Les choses devraient sans doute s'ameliorer avec le temps",
    falsification_criterion: "Les choses ne se sont pas ameliorees",
    lang: 'fr',
  },
  {
    prediction: "Ca devrait aller, je suis plutot confiant",
    falsification_criterion: "Ca n'a pas ete",
    lang: 'fr',
  },
  // RU (3) — hedged confidence in Russian
  {
    prediction: "Думаю, скорее всего все наладится со временем",
    falsification_criterion: "Ничего не наладилось",
    lang: 'ru',
  },
  {
    prediction: "Наверное, новый подход окажется лучше в итоге",
    falsification_criterion: "Новый подход не оказался лучше",
    lang: 'ru',
  },
  {
    prediction: "Возможно, ситуация улучшится сама по себе",
    falsification_criterion: "Ситуация не улучшилась",
    lang: 'ru',
  },
];

const TEST_CHAT_ID = CHAT_ID_VAGUE_VALIDATOR_LIVE;

// Dual-gated per D-30-03 cost discipline. Default `bash scripts/test.sh` skips.
describe.skipIf(!process.env.RUN_LIVE_TESTS || !process.env.ANTHROPIC_API_KEY)('TEST-14: vague-prediction resistance (live Haiku)', () => {
  beforeAll(async () => {
    const result = await sql`SELECT 1 as ok`;
    expect(result[0]!.ok).toBe(1);
  });

  afterAll(async () => {
    await sql.end();
  });

  afterEach(async () => {
    // FK-safe cleanup — scoped to TEST_CHAT_ID to avoid affecting other test data.
    await db.delete(decisionEvents).where(
      inArray(
        decisionEvents.decisionId,
        db.select({ id: decisions.id }).from(decisions).where(eq(decisions.chatId, TEST_CHAT_ID)),
      ),
    );
    await db.delete(decisions).where(eq(decisions.chatId, TEST_CHAT_ID));
    await db.delete(decisionCaptureState).where(eq(decisionCaptureState.chatId, TEST_CHAT_ID));
    await db.delete(pensieveEntries).where(eq(pensieveEntries.source, 'telegram'));
    vi.restoreAllMocks();
  });

  // ── Test 1: First-pass flag rate ──────────────────────────────────────────

  it('flags >= 9 of 10 adversarial vague predictions on first pass', async () => {
    let flaggedCount = 0;
    for (const { prediction, falsification_criterion } of ADVERSARIAL_PREDICTIONS) {
      const result = await validateVagueness({ prediction, falsification_criterion });
      if (result.verdict === 'vague') flaggedCount++;
    }
    expect(flaggedCount).toBeGreaterThanOrEqual(9);
  }, 120_000);

  // ── Test 2: One pushback then accept (enforced by handleCapture) ──────────

  it('accepts on second pass after exactly one pushback (per D-14, enforced by handleCapture)', async () => {
    // The "one pushback" contract is enforced by handleCapture tracking vague_validator_run
    // and vague_pushback_fired in capture_state — validateVagueness itself is stateless.
    // Per the capture.ts implementation:
    //   Turn 1: vague_validator_run=false → validator fires → verdict=vague → pushback returned
    //   Turn 2: vague_validator_run=true  → validator NOT re-run → falls through to commit path

    // Seed a capture state at FALSIFICATION stage (prediction + falsification_criterion already set)
    // so the vague validator gate fires on the very first handleCapture call.
    await db.insert(decisionCaptureState).values({
      chatId: TEST_CHAT_ID,
      stage: 'FALSIFICATION' as never,
      draft: {
        language_at_capture: 'en',
        decision_text: 'Whether to commit to the new product roadmap',
        alternatives: ['stick with current roadmap', 'partial pivot'],
        reasoning: 'Market signals suggest a shift is needed',
        prediction: "I think the project will probably work out in the end",
        falsification_criterion: "It doesn't feel like it worked out",
        resolve_by_iso: new Date(Date.now() + 30 * DAY_MS).toISOString(),
        turn_count: 0,
        triggering_message: 'I need to decide whether to commit to this roadmap',
      },
    });

    // Turn 1: first handleCapture call — vague_validator_run=false → real Haiku runs → pushback
    const turn1Response = await handleCapture(TEST_CHAT_ID, "that's my prediction");

    // The first response must be EXACTLY the vague pushback (D-14 invariant).
    // buildVaguePushback('en') = "What would make you say this turned out right or wrong?"
    expect(turn1Response).toBe(buildVaguePushback('en'));

    // D-14 invariant: Turn 1 pushback must NOT commit a decision row.
    // If it did, Turn 2's row-transition check (0 → 1) would be meaningless.
    const preRows = await db
      .select()
      .from(decisions)
      .where(eq(decisions.chatId, TEST_CHAT_ID));
    expect(preRows.length).toBe(0);

    // Turn 2: same vague prediction — vague_validator_run=true → validator NOT re-run → accepted
    const turn2Response = await handleCapture(TEST_CHAT_ID, "still feels like it'll work out");

    // D-14 "exactly one pushback": Turn 2 must NOT be the pushback string again —
    // it must be the commit confirmation (commitOpen or commitOpenDraft ack).
    expect(turn2Response).not.toBe(buildVaguePushback('en'));
    expect(turn2Response.length).toBeGreaterThan(0);

    // Row-count transition 0 → 1 proves Turn 2 actually committed (not silently no-op'd).
    const postRows = await db
      .select()
      .from(decisions)
      .where(eq(decisions.chatId, TEST_CHAT_ID));
    expect(postRows.length).toBe(1);

    // Status: open-draft (second-vague landing via D-15) or open (if secondVague=false).
    expect(['open', 'open-draft']).toContain(postRows[0]!.status);
  }, 60_000);
});
