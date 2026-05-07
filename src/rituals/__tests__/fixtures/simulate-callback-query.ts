/**
 * src/rituals/__tests__/fixtures/simulate-callback-query.ts — Phase 30 Plan 02
 *
 * Shared test helper extracted from src/rituals/__tests__/wellbeing.test.ts:77-86
 * (formerly buildMockCtx). Forges a Grammy Context shape with a callbackQuery
 * field for inline-keyboard tap simulation in tests.
 *
 * Consumers (D-30-05; 2 consumers — exception to TESTING.md:255-257
 * "extract at 3+ consumers" rule, justified per RESEARCH §D-30-05):
 *   1. src/rituals/__tests__/wellbeing.test.ts (Phase 27 — refactored to import here)
 *   2. src/rituals/__tests__/synthetic-fixture.test.ts (Phase 30 — TEST-28)
 *
 * The optional `userId` parameter from CONTEXT.md D-30-05 is intentionally NOT
 * included; the wellbeing handler reads only `callbackQuery.data` and
 * `callbackQuery.message.message_id`. Add it when a third consumer needs it (YAGNI).
 */
import { vi } from 'vitest';

export interface SimulatedCallbackCtx {
  callbackQuery: { data: string; message: { message_id: number } };
  answerCallbackQuery: ReturnType<typeof vi.fn>;
  editMessageReplyMarkup: ReturnType<typeof vi.fn>;
  editMessageText: ReturnType<typeof vi.fn>;
}

export function simulateCallbackQuery(opts: {
  callbackData: string;
  messageId?: number;
}): SimulatedCallbackCtx {
  return {
    callbackQuery: {
      data: opts.callbackData,
      message: { message_id: opts.messageId ?? 12345 },
    },
    answerCallbackQuery: vi.fn().mockResolvedValue(true),
    editMessageReplyMarkup: vi.fn().mockResolvedValue(true),
    editMessageText: vi.fn().mockResolvedValue(true),
  };
}
