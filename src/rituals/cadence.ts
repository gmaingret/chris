/**
 * src/rituals/cadence.ts — Phase 25 Plan 02 Task 2 (RIT-08)
 *
 * Pure-function cadence math: given the current instant + a cadence enum +
 * the validated `RitualConfig`, return the next UTC fire instant. No DB, no
 * mutation, no I/O.
 *
 * DST safety (the load-bearing requirement, RIT-08): we use Luxon's
 * `DateTime.plus({ days/weeks/months })` exclusively. Luxon's
 * `plus({ days: 1 })` operates on local wall-clock time within the
 * configured timezone — so a daily ritual configured for `21:00` in
 * `Europe/Paris` fires at 21:00 Paris on BOTH 2026-03-29 (the 23h
 * spring-forward day) and 2026-10-25 (the 25h fall-back day). A naïve
 * UTC-millisecond addition (raw ms-per-day literal) would land at 22:00
 * Paris on the spring-forward day and 20:00 Paris on the fall-back day —
 * that's the bug class this module exists to prevent. Likewise, JS Date
 * wall-clock setters (the `set*Hours` family) operate on the host machine's
 * local timezone and silently ignore the IANA `time_zone` config — also
 * forbidden.
 *
 * Mirrors the canonical `dayBoundaryUtc` Luxon idiom in
 * `src/episodic/sources.ts:74-83`. Same `DateTime.fromJSDate(...).setZone()`
 * → `.startOf('day')` → `.plus({ … })` → `.toUTC().toJSDate()` chain.
 *
 * Anchored to the wall-clock target (`config.fire_at`), NEVER to
 * `last_run_at`. This matters because the cron sweep that fires the ritual
 * may run at any time — e.g. the 21:00 Paris cron tick might actually fire
 * at 21:03 due to scheduler jitter. If we anchored to `last_run_at`, the
 * next fire would drift to 21:03, then 21:06, then 21:09 over the course of
 * a few weeks (Pitfall 3: cadence drift). Anchoring to `config.fire_at`
 * guarantees the ritual ALWAYS fires at exactly the configured wall-clock
 * time.
 *
 * Signature locked per CONTEXT.md D-09 (2026-04-26): cadence is the second
 * parameter, sourced from `rituals.type` (the enum column), NOT from
 * `RitualConfig` (the jsonb column). The caller in Plan 25-03's
 * `runRitualSweep` already has both `row.type` and `parseRitualConfig(row.config)`
 * in scope, so the 3-arg signature has zero ergonomic cost at the call site
 * and avoids denormalizing the cadence into the jsonb blob.
 *
 * Pitfall 2/3 code-review guard: this file MUST contain zero raw
 * ms-per-day literals and zero JS Date wall-clock setter calls. The
 * verification regex lives in 25-02-PLAN.md so it does not appear in this
 * source file (otherwise the docstring would self-trigger the guard).
 */
import { DateTime } from 'luxon';
import type { RitualConfig } from './types.js';

// ── Cadence advancement (M009 Phase 25 RIT-08) ─────────────────────────────

/**
 * Compute the next UTC fire instant for a ritual given:
 *   - `now`: the reference instant (typically `new Date()` from the cron tick)
 *   - `cadence`: one of `'daily'|'weekly'|'monthly'|'quarterly'` from the
 *     `rituals.type` enum column
 *   - `config`: the validated jsonb config (`fire_at`, `time_zone`, optional
 *     `fire_dow` for weekly cadence)
 *
 * Returns a UTC `Date` representing the next time this ritual should fire,
 * preserving wall-clock alignment across DST transitions.
 */
export function computeNextRunAt(
  now: Date,
  cadence: 'daily' | 'weekly' | 'monthly' | 'quarterly',
  config: RitualConfig,
): Date {
  const tz = config.time_zone;
  const [hh, mm] = config.fire_at.split(':').map((s) => Number(s));

  // Today's local fire slot (in tz) — anchored to wall-clock fire time, NOT
  // to last_run_at. This is the Pitfall 3 (cadence drift) prevention.
  let target = DateTime.fromJSDate(now, { zone: tz })
    .startOf('day')
    .set({ hour: hh!, minute: mm!, second: 0, millisecond: 0 });

  // If today's slot is at-or-before `now`, start tomorrow. `plus({ days: 1 })`
  // is the DST-safe step: Luxon advances the wall clock, not the UTC ms,
  // which is exactly what spring-forward / fall-back days need.
  if (target.toJSDate() <= now) {
    target = target.plus({ days: 1 });
  }

  // Cadence advancement on top of the local-day target.
  switch (cadence) {
    case 'daily':
      // The local-day-advance above is already the daily answer.
      break;
    case 'weekly': {
      // Advance to the next ISO weekday matching fire_dow (1=Mon..7=Sun).
      // Default fire_dow=7 (Sunday) when omitted — matches the M009 weekly
      // review ritual default. `(targetDow - target.weekday + 7) % 7` gives
      // the days-until-next-target; `|| 7` flips a 0 (today is the target
      // weekday) into 7 so weekly never returns "same day next week" within
      // 0 days.
      const targetDow = config.fire_dow ?? 7;
      const daysToAdd = ((targetDow - target.weekday + 7) % 7) || 7;
      target = target.plus({ days: daysToAdd });
      break;
    }
    case 'monthly':
      target = target.plus({ months: 1 });
      break;
    case 'quarterly':
      target = target.plus({ months: 3 });
      break;
  }

  return target.toUTC().toJSDate();
}
