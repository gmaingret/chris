/**
 * Phase 35 Plan 35-03 — /profile handler integration test (SURF-03, SURF-05).
 * Phase 39 Plan 39-02 — extended for the 3-reply psychological loop (PSURF-04).
 *
 * Covers (D-18 + D-19 + D-31 + HARD CO-LOC #M10-5 + #M11-3):
 *   1. emits exactly 7 ctx.reply calls when all profiles are populated
 *      (4 operational + 3 psychological per D-17 + D-18)
 *   2. reply order is jurisdictional → capital → health → family →
 *      hexaco → schwartz → attachment
 *   3. all-null profiles → 7 replies with localized progress indicators
 *      / never-fired strings / attachment-deferred string (D-21 + D-19)
 *   4. plain text invariant — ctx.reply called with exactly 1 arg per call,
 *      no parse_mode anywhere (D-17 + SURF-05)
 *   5. getOperationalProfiles throws → 1 genericError reply + logger.warn
 *      with 'profile.command.error' key
 *   6. EN fallback when getLastUserLanguage returns null (default state)
 *
 * vi.mock hoisting + dynamic `await import(...)` follows the project's
 * canonical pattern (src/episodic/__tests__/cron.test.ts:52-99). The handler's
 * pure formatProfileForDisplay + formatPsychologicalProfileForDisplay are
 * exercised end-to-end through the mocked Phase 33 + Phase 37 readers; the
 * golden-output review for the formatters lives in
 * src/bot/handlers/__tests__/profile.golden.test.ts (operational) and
 * src/bot/handlers/__tests__/profile-psychological.golden.test.ts (psych).
 *
 * No DB I/O — getOperationalProfiles + getPsychologicalProfiles are mocked.
 * Mirrors src/bot/handlers/__tests__/summary.test.ts:77-91 for the buildCtx
 * Grammy spy idiom.
 *
 * D-02: vi.setSystemTime ONLY (forbidden: vi.useFakeTimers — breaks postgres.js
 * keep-alive timers). This file does no time-travel, so neither is invoked.
 */
import { describe, it, expect, beforeEach, afterAll, vi } from 'vitest';

// ── Hoisted mocks ───────────────────────────────────────────────────────────
//
// vi.mock calls are hoisted by Vitest to module top. The dynamic `await
// import(...)` after the mocks ensures the module under test resolves
// getOperationalProfiles / logger from the mocked modules, not the real ones.

vi.mock('../../../memory/profiles.js', () => ({
  getOperationalProfiles: vi.fn(),
  getPsychologicalProfiles: vi.fn(async () => ({
    hexaco: null,
    schwartz: null,
    attachment: null,
  })),
}));

// Logger spies — same shape as cron.test.ts:73-85. Silences warn output and
// enables structured-log assertion on the error path.
const mockLoggerInfo = vi.fn();
const mockLoggerWarn = vi.fn();
const mockLoggerError = vi.fn();

vi.mock('../../../utils/logger.js', () => ({
  logger: {
    info: mockLoggerInfo,
    warn: mockLoggerWarn,
    error: mockLoggerError,
    debug: vi.fn(),
    fatal: vi.fn(),
  },
}));

// ── Imports after mocks ─────────────────────────────────────────────────────

const { handleProfileCommand } = await import('../profile.js');
const profilesModule = await import('../../../memory/profiles.js');
const { clearLanguageState, setLastUserLanguage } = await import(
  '../../../chris/language.js'
);
import type {
  ProfileRow,
} from '../../../memory/profiles.js';
import type {
  JurisdictionalProfileData,
  CapitalProfileData,
  HealthProfileData,
  FamilyProfileData,
} from '../../../memory/profiles/schemas.js';

// ── Constants + fixtures ────────────────────────────────────────────────────

const FIXTURE_CHAT_ID = 77_771;
const NOW = new Date('2026-05-13T00:00:00Z');

const POPULATED_FRESH = {
  jurisdictional: {
    data: {
      current_country: 'Georgia',
      physical_location: 'Tbilisi',
      residency_status: [],
      tax_residency: 'France',
      active_legal_entities: [],
      next_planned_move: { destination: null, from_date: null },
      planned_move_date: null,
      passport_citizenships: ['France'],
      data_consistency: 0.8,
    } as JurisdictionalProfileData,
    confidence: 0.7,
    lastUpdated: new Date(NOW.getTime() - 2 * 86_400_000),
    schemaVersion: 1,
  } as ProfileRow<JurisdictionalProfileData>,
  capital: {
    data: {
      fi_phase: 'accumulation',
      fi_target_amount: 'EUR 1,500,000',
      estimated_net_worth: null,
      runway_months: null,
      next_sequencing_decision: null,
      income_sources: [],
      major_allocation_decisions: [],
      tax_optimization_status: null,
      active_legal_entities: [],
      data_consistency: 0.7,
    } as CapitalProfileData,
    confidence: 0.6,
    lastUpdated: new Date(NOW.getTime() - 5 * 86_400_000),
    schemaVersion: 1,
  } as ProfileRow<CapitalProfileData>,
  health: {
    data: {
      open_hypotheses: [],
      pending_tests: [],
      active_treatments: [],
      recent_resolved: [],
      case_file_narrative: 'Energy stable.',
      wellbeing_trend: { energy_30d_mean: 6.0, mood_30d_mean: 7.0, anxiety_30d_mean: 3.0 },
      data_consistency: 0.65,
    } as HealthProfileData,
    confidence: 0.55,
    lastUpdated: new Date(NOW.getTime() - 3 * 86_400_000),
    schemaVersion: 1,
  } as ProfileRow<HealthProfileData>,
  family: {
    data: {
      relationship_status: 'single, dating',
      partnership_criteria_evolution: [],
      children_plans: null,
      parent_care_responsibilities: { notes: null, dependents: [] },
      active_dating_context: null,
      milestones: [],
      constraints: [],
      data_consistency: 0.6,
    } as FamilyProfileData,
    confidence: 0.5,
    lastUpdated: new Date(NOW.getTime() - 7 * 86_400_000),
    schemaVersion: 1,
  } as ProfileRow<FamilyProfileData>,
};

// ── Helpers ─────────────────────────────────────────────────────────────────

/**
 * Build a duck-typed Grammy Context that captures every ctx.reply call's
 * argument list (not just the first arg). The per-call args array is the
 * load-bearing assertion for SURF-05 — if any future change passes a 2nd
 * argument (parse_mode), tests assert args.length === 1 and fail.
 *
 * IN-03: Omits `ctx.from` deliberately. The production handler
 * (src/bot/handlers/profile.ts) reads only `ctx.chat?.id` — `ctx.from` is
 * never accessed. Including it in the fixture would falsely suggest a
 * Telegram-identity check happens inside the handler. In the single-user
 * D009 deployment chat.id and from.id are always equal anyway.
 */
function buildCtx(
  chatId: number = FIXTURE_CHAT_ID,
): {
  captured: string[];
  capturedAllArgs: unknown[][];
  ctx: unknown;
} {
  const captured: string[] = [];
  const capturedAllArgs: unknown[][] = [];
  const ctx = {
    chat: { id: chatId },
    message: { text: '/profile' },
    reply: async (...args: unknown[]): Promise<void> => {
      captured.push(args[0] as string);
      capturedAllArgs.push(args);
    },
  };
  return { captured, capturedAllArgs, ctx };
}

// ── Lifecycle ───────────────────────────────────────────────────────────────

beforeEach(() => {
  vi.clearAllMocks();
  // Default mock — all 4 profiles populated. Tests that need a different
  // shape override via vi.mocked(...).mockResolvedValueOnce(...).
  vi.mocked(profilesModule.getOperationalProfiles).mockResolvedValue(POPULATED_FRESH);
  // Reset language state so each test starts with the EN fallback (langOf(null)
  // → English). Tests that need FR/RU opt in via setLastUserLanguage.
  clearLanguageState(FIXTURE_CHAT_ID.toString());
  vi.setSystemTime(NOW);
});

afterAll(() => {
  clearLanguageState(FIXTURE_CHAT_ID.toString());
  vi.useRealTimers();
});

// ── Tests ───────────────────────────────────────────────────────────────────

describe('SURF-03: /profile handler', () => {
  it('emits exactly 7 ctx.reply calls when all 4 operational + 3 psychological profile sections render (Phase 39 PSURF-04)', async () => {
    const { captured, ctx } = buildCtx();
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    await handleProfileCommand(ctx as any);

    expect(captured).toHaveLength(7);
  });

  it('reply order is jurisdictional → capital → health → family → HEXACO → Schwartz → Attachment', async () => {
    const { captured, ctx } = buildCtx();
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    await handleProfileCommand(ctx as any);

    expect(captured).toHaveLength(7);
    expect(captured[0]).toContain('Jurisdictional Profile');
    expect(captured[1]).toContain('Capital Profile');
    expect(captured[2]).toContain('Health Profile');
    expect(captured[3]).toContain('Family Profile');
    // Phase 39 PSURF-04: M011 placeholder replaced by 3 psychological sections.
    expect(captured[4]).toMatch(/HEXACO/i);
    expect(captured[5]).toMatch(/Schwartz/i);
    expect(captured[6]).toMatch(/Attachment/i);
  });

  it('gracefully handles all-null profiles → 7 replies with progress indicators (D-21 + Phase 39 D-19)', async () => {
    vi.mocked(profilesModule.getOperationalProfiles).mockResolvedValueOnce({
      jurisdictional: null,
      capital: null,
      health: null,
      family: null,
    });

    const { captured, ctx } = buildCtx();
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    await handleProfileCommand(ctx as any);

    expect(captured).toHaveLength(7);
    // Each of the 4 operational replies is the localized progress indicator.
    expect(captured[0]).toContain('Chris needs more entries');
    expect(captured[0]).toContain('location and tax situation');
    expect(captured[1]).toContain('Chris needs more entries');
    expect(captured[1]).toContain('finances');
    expect(captured[2]).toContain('Chris needs more entries');
    expect(captured[2]).toContain('wellbeing');
    expect(captured[3]).toContain('Chris needs more entries');
    expect(captured[3]).toContain('relationships');
    // Phase 39 D-19: null psych profiles → never-fired branch for HEXACO/Schwartz; Attachment always deferred.
    expect(captured[4]).toMatch(/HEXACO/i);
    expect(captured[5]).toMatch(/Schwartz/i);
    expect(captured[6]).toMatch(/Attachment/i);
    expect(captured[6]).toMatch(/D028|not yet active/i);
  });

  it('uses plain text — no parse_mode arg on any ctx.reply (SURF-05)', async () => {
    const { capturedAllArgs, ctx } = buildCtx();
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    await handleProfileCommand(ctx as any);

    expect(capturedAllArgs).toHaveLength(7);
    // SURF-05 invariant: every ctx.reply call passes ONLY the text argument.
    // A future regression that adds `{ parse_mode: 'Markdown' }` as the second
    // arg fails this assertion immediately.
    for (const args of capturedAllArgs) {
      expect(args).toHaveLength(1);
      expect(typeof args[0]).toBe('string');
    }
  });

  it('logs profile.command.error and replies with genericError when getOperationalProfiles throws', async () => {
    vi.mocked(profilesModule.getOperationalProfiles).mockRejectedValueOnce(
      new Error('simulated DB drop'),
    );

    const { captured, ctx } = buildCtx();
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    await handleProfileCommand(ctx as any);

    // Single reply on the error path — the localized genericError.
    expect(captured).toHaveLength(1);
    expect(captured[0]).toMatch(/I ran into trouble|trouble reading|profiles/i);

    // logger.warn called with structured payload + canonical log key.
    expect(mockLoggerWarn).toHaveBeenCalledTimes(1);
    const [payload, logKey] = mockLoggerWarn.mock.calls[0]!;
    expect(payload).toMatchObject({ chatId: FIXTURE_CHAT_ID });
    expect(payload).toHaveProperty('error');
    expect((payload as { error: string }).error).toContain('simulated DB drop');
    expect(logKey).toBe('profile.command.error');
  });

  it('falls back to English when getLastUserLanguage returns null (D-19 fallback)', async () => {
    // beforeEach already ran clearLanguageState — no FR/RU session entry exists.
    const { captured, ctx } = buildCtx();
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    await handleProfileCommand(ctx as any);

    // Phase 39 PSURF-04: English HEXACO/Schwartz/Attachment section titles must appear.
    expect(captured[4]).toMatch(/HEXACO/);
    expect(captured[6]).toMatch(/Attachment/);
  });

  it('localizes to French when getLastUserLanguage returns French', async () => {
    setLastUserLanguage(FIXTURE_CHAT_ID.toString(), 'French');
    const { captured, ctx } = buildCtx();
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    await handleProfileCommand(ctx as any);

    expect(captured).toHaveLength(7);
    // Jurisdictional section title in French.
    expect(captured[0]).toContain('Profil juridictionnel');
    // Phase 39 PSURF-04: French psychological section titles (machine-translate-quality).
    // HEXACO and Schwartz are proper names — preserved across locales.
    expect(captured[4]).toMatch(/HEXACO/i);
    expect(captured[5]).toMatch(/Schwartz/i);
  });

  it('returns silently when ctx.chat is undefined (defensive early-return)', async () => {
    const captured: string[] = [];
    const ctx = {
      // chat omitted on purpose — Grammy's Context type permits this for
      // non-message updates (callback_query, inline_query, etc.). The handler
      // must not throw, and must not invoke getOperationalProfiles.
      reply: async (t: string): Promise<void> => {
        captured.push(t);
      },
    };
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    await handleProfileCommand(ctx as any);

    expect(captured).toHaveLength(0);
    expect(profilesModule.getOperationalProfiles).not.toHaveBeenCalled();
  });
});
