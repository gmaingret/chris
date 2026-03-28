import { eq } from 'drizzle-orm';
import { db } from '../db/connection.js';
import { pensieveEntries, epistemicTagEnum } from '../db/schema.js';
import { anthropic, HAIKU_MODEL } from '../llm/client.js';
import { logger } from '../utils/logger.js';

/** All 12 valid epistemic tag values, derived from the schema enum. */
export const VALID_TAGS = epistemicTagEnum.enumValues;

const SYSTEM_PROMPT = `You are an epistemic classifier. Given a piece of personal content, classify it into exactly ONE of these 12 epistemic categories. Respond with ONLY a JSON object: {"tag": "TAG_NAME"}

Categories:
- FACT: A concrete, verifiable piece of information. E.g. "I was born in 1990" or "The meeting is at 3pm"
- EMOTION: An expression of current or past feeling. E.g. "I feel anxious today" or "That made me furious"
- BELIEF: A held conviction or worldview. E.g. "I think honesty matters most" or "People are fundamentally kind"
- INTENTION: A plan, goal, or commitment. E.g. "I want to start running" or "I'll call her tomorrow"
- EXPERIENCE: A recounted event or lived moment. E.g. "We hiked to the summit last weekend" or "I tried sushi for the first time"
- PREFERENCE: A taste, like, or dislike. E.g. "I prefer mornings" or "I can't stand loud music"
- RELATIONSHIP: Information about connections with others. E.g. "My sister and I are close" or "I haven't spoken to Jake in months"
- DREAM: An aspiration, fantasy, or literal dream. E.g. "I dream of living by the sea" or "I had a nightmare about falling"
- FEAR: An anxiety, worry, or dread. E.g. "I'm terrified of public speaking" or "I worry about money constantly"
- VALUE: A core principle or priority. E.g. "Family comes first" or "I value my independence above all"
- CONTRADICTION: A self-contradicting statement or tension. E.g. "I say I want change but I keep doing the same thing"
- OTHER: Content that doesn't fit any of the above categories.

Pick the single primary epistemic mode. Respond with ONLY {"tag": "TAG_NAME"}.`;

/**
 * Classify an entry's content with an epistemic tag via Haiku.
 *
 * Fire-and-forget contract: never throws. Returns the assigned tag on success,
 * null on any failure (LLM error, parse error, invalid tag, DB error).
 */
export async function tagEntry(
  entryId: string,
  content: string,
): Promise<string | null> {
  try {
    const response = await anthropic.messages.create({
      cache_control: { type: 'ephemeral' },
      model: HAIKU_MODEL,
      max_tokens: 50,
      system: SYSTEM_PROMPT,
      messages: [{ role: 'user', content }],
    });

    // Extract text from the response
    const textBlock = response.content.find((block) => block.type === 'text');
    if (!textBlock || textBlock.type !== 'text') {
      logger.warn({ entryId, error: 'No text block in LLM response' }, 'pensieve.tag.error');
      return null;
    }

    // Parse JSON from response
    let parsed: { tag?: string };
    try {
      parsed = JSON.parse(textBlock.text.trim());
    } catch {
      logger.warn({ entryId, error: 'Unparseable LLM response' }, 'pensieve.tag.error');
      return null;
    }

    // Validate tag is in the enum
    const tag = parsed.tag;
    if (!tag || !VALID_TAGS.includes(tag as (typeof VALID_TAGS)[number])) {
      logger.warn({ entryId, error: `Invalid tag: ${tag}` }, 'pensieve.tag.error');
      return null;
    }

    // Update entry with the classified tag
    await db
      .update(pensieveEntries)
      .set({ epistemicTag: tag as (typeof VALID_TAGS)[number], updatedAt: new Date() })
      .where(eq(pensieveEntries.id, entryId));

    logger.info({ entryId, tag }, 'pensieve.tag');

    return tag;
  } catch (error) {
    logger.warn(
      { entryId, error: error instanceof Error ? error.message : String(error) },
      'pensieve.tag.error',
    );
    return null;
  }
}
