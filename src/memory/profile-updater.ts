/**
 * src/memory/profile-updater.ts — Phase 34 Plan 03 (M010)
 *
 * Orchestrator that fans out the 4 per-dimension profile generators
 * (jurisdictional/capital/health/family) via Promise.allSettled — the
 * production cron handler body. Registered as the Sunday 22:00 Paris cron
 * in src/cron-registration.ts (D-24: 2h gap after weekly_review's 20:00,
 * mitigating M010-04 timing collisions).
 *
 * Satisfies (per 34-CONTEXT.md + REQUIREMENTS GEN-02):
 *   - D-14 — loadProfileSubstrate called ONCE per fire; result passed to all
 *            4 generators (no per-dimension substrate reloads)
 *   - D-21 — Promise.allSettled error isolation: one generator throwing does
 *            NOT abort the other 3
 *   - D-22 — NO retry within a fire; weekly cadence IS the retry. A rejected
 *            allSettled result emits one log line and is counted in the
 *            aggregate summary
 *   - D-23 — returns Promise<void> (fire-and-forget); outcomes observed via
 *            discriminated log keys only, never via return-value inspection
 *   - D-34 — aggregate cron-complete log: 'chris.profile.cron.complete' with
 *            per-dimension outcome counts
 *
 * Logging convention:
 *   - 'chris.profile.cron.start' — fired ONCE at the top of each cron run
 *     (debug-grade context: substrate sizes)
 *   - 'chris.profile.profile_generation_failed' — fired for each allSettled
 *     `rejected` reason (the per-dimension generator emits its own
 *     `chris.profile.<outcome>` log INSIDE the function body for the
 *     `fulfilled` path, including its own failure outcome; this orchestrator
 *     log handles only the case where the generator throws BEFORE returning
 *     a discriminated outcome — D-21 emergency path)
 *   - 'chris.profile.cron.complete' — aggregate at the end (per-dimension
 *     outcome counts + total durationMs)
 *   - 'profile.cron.error' (lowercase, namespace-different) — fired by the
 *     outer try/catch if loadProfileSubstrate itself throws or some other
 *     unexpected error escapes. Mirrors the existing 'episodic.cron.error',
 *     'rituals.cron.error', 'sync.cron.error' convention at
 *     src/cron-registration.ts:73,92,110,131,149 — infra-level errors use a
 *     short lowercase key without the 'chris.' namespace.
 *
 * NO retry loop (D-22). NO Stage-2 Haiku. NO Telegram side-effect. The only
 * side effects are: (a) ONE DB read via loadProfileSubstrate, (b) calling
 * the 4 generators (which each do their own DB writes + own SDK calls), (c)
 * pino log lines.
 */
import { logger } from '../utils/logger.js';
import { loadProfileSubstrate } from './profiles/shared.js';
import { generateJurisdictionalProfile } from './profiles/jurisdictional.js';
import { generateCapitalProfile } from './profiles/capital.js';
import { generateHealthProfile } from './profiles/health.js';
import { generateFamilyProfile } from './profiles/family.js';
import type { ProfileGenerationOutcome } from './profiles/shared.js';

/**
 * Fire all 4 dimension profile generators in parallel, isolated by
 * Promise.allSettled (D-21). Returns void (D-23 fire-and-forget); the
 * orchestrator's only externally observable signal is the pino log stream.
 *
 * Calling convention (D-14): substrate is loaded ONCE here and passed by
 * reference to all 4 generators. Each generator independently compares its
 * own dimension's substrate_hash against the freshly-computed hash before
 * deciding whether to call Sonnet (D-15, GEN-07).
 */
export async function updateAllOperationalProfiles(): Promise<void> {
  const startMs = Date.now();
  try {
    // 1. Load substrate ONCE (D-14)
    const substrate = await loadProfileSubstrate();

    logger.info(
      {
        entryCount: substrate.entryCount,
        episodicCount: substrate.episodicSummaries.length,
        decisionCount: substrate.decisions.length,
      },
      'chris.profile.cron.start',
    );

    // 2. Promise.allSettled fan-out (D-21 — per-generator error isolation;
    //    one throw does NOT abort the other 3)
    const results = await Promise.allSettled([
      generateJurisdictionalProfile({ substrate }),
      generateCapitalProfile({ substrate }),
      generateHealthProfile({ substrate }),
      generateFamilyProfile({ substrate }),
    ]);

    // 3. Discriminated outcome aggregation (D-34). Each generator already
    //    emitted its own per-dimension `chris.profile.<outcome>` log INSIDE
    //    its function body (Plan 34-02 deliverable). Here we ONLY count for
    //    the aggregate cron-complete log + handle the D-21 emergency path
    //    where a generator throws BEFORE returning a discriminated outcome.
    const counts = { updated: 0, skipped: 0, belowThreshold: 0, failed: 0 };
    for (const r of results) {
      if (r.status === 'fulfilled') {
        const o: ProfileGenerationOutcome = r.value;
        switch (o.outcome) {
          case 'profile_updated':
            counts.updated += 1;
            break;
          case 'profile_skipped_no_change':
            counts.skipped += 1;
            break;
          case 'profile_below_threshold':
            counts.belowThreshold += 1;
            break;
          case 'profile_generation_failed':
            counts.failed += 1;
            break;
        }
      } else {
        // Emergency path (D-21): generator threw BEFORE returning a
        // discriminated outcome. Log + count, then move on — D-22 says
        // no within-fire retry; next Sunday's cron IS the retry.
        logger.warn(
          { err: r.reason instanceof Error ? r.reason.message : String(r.reason) },
          'chris.profile.profile_generation_failed',
        );
        counts.failed += 1;
      }
    }

    // 4. Aggregate cron-complete log (D-34)
    logger.info(
      { counts, durationMs: Date.now() - startMs },
      'chris.profile.cron.complete',
    );
  } catch (err) {
    // Outer try/catch belt-and-suspenders (CRON-01; mirror the
    // 'episodic.cron.error' lowercase-infra-error convention at
    // src/cron-registration.ts:73,92,110,131,149). Triggered if
    // loadProfileSubstrate itself throws (DB outage at substrate fetch
    // time) or some other unexpected error escapes the allSettled barrier.
    logger.error(
      {
        err: err instanceof Error ? err.message : String(err),
        durationMs: Date.now() - startMs,
      },
      'profile.cron.error',
    );
  }
}
