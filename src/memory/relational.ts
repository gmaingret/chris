import { eq, desc } from 'drizzle-orm';
import { db } from '../db/connection.js';
import { relationalMemory, relationalMemoryTypeEnum } from '../db/schema.js';
import { anthropic, HAIKU_MODEL } from '../llm/client.js';
import { RELATIONAL_MEMORY_PROMPT } from '../llm/prompts.js';
import { getRecentHistory } from './conversation.js';
import { logger } from '../utils/logger.js';

/** Valid relational memory observation types, derived from the schema enum. */
const VALID_TYPES = relationalMemoryTypeEnum.enumValues;

/** Return type for the reader function. */
export type RelationalMemory = {
  id: string;
  type: string;
  content: string;
  confidence: number | null;
  createdAt: Date | null;
};

/**
 * Strip markdown code fences from LLM output before parsing.
 * Handles ```json ... ``` and ``` ... ``` patterns (K003).
 */
function stripFences(text: string): string {
  const match = text.match(/```(?:json)?\s*\n?([\s\S]*?)\n?\s*```/);
  return match ? match[1]!.trim() : text.trim();
}

/**
 * Analyze a journal exchange via Haiku and write an observation to relational memory
 * if the exchange reveals something genuinely new about John.
 *
 * Fire-and-forget contract: never throws. All errors are logged at warn level and swallowed.
 */
export async function writeRelationalMemory(
  chatId: bigint,
  userText: string,
  assistantResponse: string,
): Promise<void> {
  try {
    // Gate: skip trivial messages
    if (userText.length <= 50) {
      logger.debug(
        { chatId: chatId.toString(), reason: 'message_too_short', length: userText.length },
        'memory.relational.skip',
      );
      return;
    }

    // Fetch recent history for context
    const history = await getRecentHistory(chatId, 10);
    const recentContext = history
      .map((h) => `[${h.role}]: ${h.content}`)
      .join('\n');

    // Format prompt with exchange and context
    const exchange = `John: ${userText}\n\nChris: ${assistantResponse}`;
    const systemPrompt = RELATIONAL_MEMORY_PROMPT
      .replace('{exchange}', exchange)
      .replace('{recentContext}', recentContext || '(no prior context)');

    // Call Haiku for observation analysis
    const response = await anthropic.messages.create({
      cache_control: { type: 'ephemeral' },
      model: HAIKU_MODEL,
      max_tokens: 300,
      system: systemPrompt,
      messages: [{ role: 'user', content: 'Analyze this exchange and decide whether to record an observation.' }],
    });

    const textBlock = response.content.find(
      (block: { type: string }) => block.type === 'text',
    );
    if (!textBlock || textBlock.type !== 'text') {
      logger.warn(
        { chatId: chatId.toString(), phase: 'haiku_call', error: 'No text block in response' },
        'memory.relational.error',
      );
      return;
    }

    // Strip fences (K003) and parse JSON
    const raw = (textBlock as { type: 'text'; text: string }).text;
    const cleaned = stripFences(raw);

    let parsed: { observe?: boolean; type?: string; content?: string; confidence?: number };
    try {
      parsed = JSON.parse(cleaned);
    } catch {
      logger.warn(
        { chatId: chatId.toString(), phase: 'parse', error: 'Unparseable Haiku response' },
        'memory.relational.error',
      );
      return;
    }

    // If Haiku says no observation, skip
    if (!parsed.observe) {
      logger.debug(
        { chatId: chatId.toString(), reason: 'haiku_declined' },
        'memory.relational.skip',
      );
      return;
    }

    // Validate type is one of the 5 enum values
    const observationType = parsed.type;
    if (!observationType || !VALID_TYPES.includes(observationType as (typeof VALID_TYPES)[number])) {
      logger.warn(
        { chatId: chatId.toString(), phase: 'parse', error: `Invalid type: ${observationType}` },
        'memory.relational.error',
      );
      return;
    }

    // Validate content exists
    if (!parsed.content) {
      logger.warn(
        { chatId: chatId.toString(), phase: 'parse', error: 'Missing content' },
        'memory.relational.error',
      );
      return;
    }

    // Insert into relational memory table
    await db.insert(relationalMemory).values({
      type: observationType as (typeof VALID_TYPES)[number],
      content: parsed.content,
      confidence: parsed.confidence ?? 0.5,
      supportingEntries: [],
    });

    logger.info(
      { chatId: chatId.toString(), type: observationType, confidence: parsed.confidence },
      'memory.relational.write',
    );
  } catch (error) {
    logger.warn(
      {
        chatId: chatId.toString(),
        phase: 'haiku_call',
        error: error instanceof Error ? error.message : String(error),
      },
      'memory.relational.error',
    );
  }
}

/**
 * Read relational memories with optional type filtering and limit.
 * Used by downstream modes (Reflect, Coach, Psychology) to ground responses.
 */
export async function getRelationalMemories(
  options?: { type?: string; limit?: number },
): Promise<RelationalMemory[]> {
  const limit = options?.limit ?? 50;

  const baseSelect = {
    id: relationalMemory.id,
    type: relationalMemory.type,
    content: relationalMemory.content,
    confidence: relationalMemory.confidence,
    createdAt: relationalMemory.createdAt,
  };

  const whereClause = options?.type
    ? eq(relationalMemory.type, options.type as (typeof VALID_TYPES)[number])
    : undefined;

  const rows = whereClause
    ? await db.select(baseSelect).from(relationalMemory).where(whereClause).orderBy(desc(relationalMemory.createdAt)).limit(limit)
    : await db.select(baseSelect).from(relationalMemory).orderBy(desc(relationalMemory.createdAt)).limit(limit);

  return rows;
}
