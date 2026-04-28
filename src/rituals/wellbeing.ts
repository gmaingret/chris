/**
 * src/rituals/wellbeing.ts — Phase 27 Plan 01 STUB (replaced by Plan 02)
 *
 * Phase 27 Plan 01 ships only the bot router infrastructure. This stub
 * exports the function signature that handleRitualCallback imports, so
 * Plan 01 compiles without depending on Plan 02 having shipped.
 *
 * Plan 02 replaces this file wholesale with the real implementation
 * (fireWellbeing + full handleWellbeingCallback).
 */
import type { Context } from 'grammy';

export async function handleWellbeingCallback(_ctx: Context, _data: string): Promise<void> {
  throw new Error('rituals.wellbeing.handleWellbeingCallback: stub — Plan 27-02 fills this');
}
