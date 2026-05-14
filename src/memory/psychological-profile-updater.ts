/**
 * src/memory/psychological-profile-updater.ts — Phase 38 Plan 38-03 (M011 / PGEN-04)
 *
 * Orchestrator that fans out the 2 psychological-profile generators
 * (hexaco + schwartz) via Promise.allSettled — the production cron handler
 * body. Registered as the 1st-of-month 09:00 Paris cron in
 * src/cron-registration.ts (D-26: monthly cadence, 13h before the M010
 * Sunday-22:00 cron when the 1st falls on a Sunday — collision verified at
 * registration time per D-27).
 *
 * Satisfies (per 38-CONTEXT.md + REQUIREMENTS PGEN-04):
 *   - D-18 — UNCONDITIONAL-FIRE rationale comment lives at the top of the
 *            function body (NOT in a JSDoc tucked above the signature where
 *            grep-for-refactors might miss it). Pitfall 1 mitigation #1; the
 *            3-cycle integration test docblock (Plan 38-02) is mitigation #2.
 *   - D-21 — Promise.allSettled per-generator error isolation: a HEXACO
 *            failure does NOT abort Schwartz.
 *   - D-22 — NO retry within a fire; monthly cadence IS the retry. A rejected
 *            allSettled result emits one log line and is counted in the
 *            aggregate summary.
 *   - D-23 — Third psychological-profile generator (the relational-style
 *            third dimension named in Phase 37 migration 0013) is NOT
 *            included here. Population is deferred to v2.6.1 / ATT-POP-01
 *            (REQUIREMENTS PGEN-04 verbatim) and its row stays in
 *            cold-start state throughout M011.
 *   - D-24 — Substrate loaded TWICE per fire (once per profile type) for
 *            the per-profileType `prevHistorySnapshot`. The corpus query is
 *            identical; postgres caches the second call. `now` is computed
 *            ONCE at the top and passed to both `loadPsychologicalSubstrate`
 *            calls (RESEARCH Open Q2 — calendar-month boundary stability).
 *   - D-25 — Returns Promise<void> (fire-and-forget); outcomes observed via
 *            discriminated log keys only, never via return-value inspection.
 *
 * Logging convention (mirrors M010 src/memory/profile-updater.ts but in the
 * psychological namespace):
 *   - 'chris.psychological.cron.start' — fired ONCE at the top of each cron
 *     run (debug-grade context: wordCount, threshold, belowThreshold flag)
 *   - 'chris.psychological.profile_generation_failed' — fired for each
 *     allSettled `rejected` reason (each generator emits its own
 *     `chris.psychological.<profileType>.<outcome>` log INSIDE its body for
 *     the `fulfilled` path including its own failure outcome; this orchestrator
 *     log handles only the case where a generator throws BEFORE returning a
 *     discriminated outcome — D-21 emergency path)
 *   - 'chris.psychological.cron.complete' — aggregate at the end (counts +
 *     total durationMs)
 *   - 'psychological.profile.cron.error' (lowercase, namespace-different) —
 *     fired by the outer try/catch if `loadPsychologicalSubstrate` itself
 *     throws or some other unexpected error escapes. Mirrors the existing
 *     'episodic.cron.error', 'profile.cron.error' lowercase-infra-error
 *     convention.
 *
 * NO retry loop (D-22). NO retry on Sonnet failure. NO Stage-2 Haiku. NO
 * Telegram side-effect. The only side effects are: (a) TWO DB reads via
 * `loadPsychologicalSubstrate` (corpus identical; postgres caches the second),
 * (b) calling the 2 generators (which each do their own DB writes + own SDK
 * calls), (c) pino log lines.
 */
import { logger } from '../utils/logger.js';
import { loadPsychologicalSubstrate } from './profiles/psychological-shared.js';
import { generateHexacoProfile } from './profiles/hexaco.js';
import { generateSchwartzProfile } from './profiles/schwartz.js';
import type { PsychologicalProfileGenerationOutcome } from './profiles/psychological-shared.js';
import type {
  HexacoProfileData,
  SchwartzProfileData,
} from './profiles/psychological-schemas.js';
import { MIN_SPEECH_WORDS } from './confidence.js';

/**
 * Fire both psychological-profile generators in parallel, isolated by
 * Promise.allSettled (D-21). Returns void (D-25 fire-and-forget); the
 * orchestrator's only externally observable signal is the pino log stream.
 *
 * Calling convention (D-24): substrate is loaded TWICE per fire (once per
 * profile type) because `prevHistorySnapshot` is per-profile-type; the corpus
 * query is identical, postgres caches the second invocation. `now` is computed
 * ONCE at the top and passed to both calls so a clock skew across the two
 * queries cannot push them into different calendar-month windows.
 *
 * The "load substrate once + look up snapshot twice" optimization is deferred
 * to v2.6.1 if profiling shows >100ms overhead per fire.
 */
export async function updateAllPsychologicalProfiles(): Promise<void> {
  // ───────────────────────────────────────────────────────────────────────
  // D-18 — UNCONDITIONAL-FIRE rationale (PGEN-06 divergence from M010 GEN-07):
  //
  // Divergence from M010 GEN-07 (operational profile-updater.ts):
  // psychological profiles fire UNCONDITIONALLY on the monthly cron.
  // A skipped month creates a permanent gap in the inter-period consistency
  // time series; trait inference needs a data point every month.
  // substrate_hash is recorded on each fire for audit-trail / forensic-replay
  // only — NOT used for short-circuit.
  //
  // Pitfall 1 mitigation point #1: this comment documents the divergence so
  // future refactors do not "fix" the perceived inconsistency by reintroducing
  // hash-skip. Mitigation point #2 is the 3-cycle integration test docblock
  // at src/memory/__tests__/psychological-profile-updater.integration.test.ts
  // (Plan 38-02) — the test fails immediately if hash-skip is reintroduced.
  // ───────────────────────────────────────────────────────────────────────

  const startMs = Date.now();
  try {
    // D-24 + RESEARCH Open Q2: compute `now` once at the top and pass to both
    // substrate loads — calendar-month boundary stability across the two
    // queries. A clock skew across the two `new Date()` calls would (in the
    // pathological case of firing at calendar-month boundary) push one query
    // into a different month than the other.
    const now = new Date();

    // D-24 — substrate loaded TWICE per fire (once per profile type) for the
    // per-profileType `prevHistorySnapshot`. The corpus query is identical
    // (same source='telegram' filter + same calendar month); postgres caches
    // the second invocation. The "load once" optimization is deferred to
    // v2.6.1 if profiling shows >100ms overhead per fire.
    const [substrateA, substrateB] = await Promise.all([
      loadPsychologicalSubstrate<HexacoProfileData>('hexaco', now),
      loadPsychologicalSubstrate<SchwartzProfileData>('schwartz', now),
    ]);

    // Aggregate start log. Both substrates have identical wordCount because
    // the corpus filter is identical (D-24); pick either. The `belowThreshold`
    // discriminator is also identical for the same reason.
    logger.info(
      {
        wordCount: substrateA.wordCount,
        threshold: MIN_SPEECH_WORDS,
        belowThreshold: substrateA.belowThreshold,
      },
      'chris.psychological.cron.start',
    );

    // D-21 — Promise.allSettled per-generator error isolation (PGEN-04).
    // HEXACO failure does NOT abort Schwartz.
    // D-23 — Third dimension (Phase 37 migration 0013) NOT included
    // (deferred to v2.6.1 / ATT-POP-01 per REQUIREMENTS PGEN-04 verbatim).
    const results = await Promise.allSettled([
      generateHexacoProfile({ substrate: substrateA }),
      generateSchwartzProfile({ substrate: substrateB }),
    ]);

    // Discriminated outcome aggregation — 3 cases per Plan 38-02's
    // PsychologicalProfileGenerationOutcome (no 'skipped_no_change' because
    // PGEN-06 eliminates hash-skip). Each generator already emitted its own
    // per-profile-type log INSIDE its function body; this loop only counts
    // for the aggregate cron-complete log + handles the D-21 emergency path
    // where a generator throws BEFORE returning a discriminated outcome.
    const counts = { updated: 0, belowThreshold: 0, error: 0 };
    for (const r of results) {
      if (r.status === 'fulfilled') {
        const o: PsychologicalProfileGenerationOutcome = r.value;
        switch (o.outcome) {
          case 'updated':
            counts.updated += 1;
            break;
          case 'skipped_below_threshold':
            counts.belowThreshold += 1;
            break;
          case 'error':
            counts.error += 1;
            break;
        }
      } else {
        // Emergency path (D-21): generator threw BEFORE returning a
        // discriminated outcome. Log + count, then move on — D-22 says no
        // within-fire retry; next month's cron IS the retry.
        logger.warn(
          { err: r.reason instanceof Error ? r.reason.message : String(r.reason) },
          'chris.psychological.profile_generation_failed',
        );
        counts.error += 1;
      }
    }

    // Aggregate cron-complete log.
    logger.info(
      { counts, durationMs: Date.now() - startMs },
      'chris.psychological.cron.complete',
    );
  } catch (err) {
    // Outer try/catch belt-and-suspenders (CRON-01; mirror the
    // 'profile.cron.error' lowercase-infra-error convention at
    // src/memory/profile-updater.ts:139). Triggered if
    // `loadPsychologicalSubstrate` itself throws (DB outage at substrate
    // fetch time) or some other unexpected error escapes the allSettled
    // barrier.
    logger.error(
      {
        err: err instanceof Error ? err.message : String(err),
        durationMs: Date.now() - startMs,
      },
      'psychological.profile.cron.error',
    );
  }
}
