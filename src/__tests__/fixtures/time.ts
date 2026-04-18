/**
 * Shared test-time constants.
 *
 * Phase 18 IN-05: `DAY_MS` (86_400_000) appeared duplicated across multiple
 * test files. Centralize here so a single grep finds every occurrence and
 * a single edit changes them all.
 *
 * Production code that needs a day-in-ms uses its own inline literal (see
 * `src/decisions/resolve-by.ts` and `src/proactive/triggers/deadline.ts`) —
 * those are intentionally not importing from a test-only module. This file
 * is for tests only.
 */

/** One calendar day in milliseconds. Equivalent to `24 * 60 * 60 * 1000`. */
export const DAY_MS = 86_400_000;
